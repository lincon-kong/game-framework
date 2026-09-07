import { decodeMessage, decodePacket, decodeRemoteError, encodePacket, encodeRequest } from "./PitayaProtocol";

export type PitayaClientStatus = "Disconnected" | "Connecting" | "Connected" | "Disposed";

export interface ProtobufCodec<T> {
  encode(value: T): { finish(): Uint8Array };
  decode(data: Uint8Array): T;
}

export interface PitayaRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface PitayaClientOptions {
  readonly url: string;
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly socketFactory?: (url: string) => WebSocket;
  readonly onDisconnect?: (reason: Error) => void;
}

export class PitayaRemoteError extends Error {
  public constructor(public readonly code: string, message: string, public readonly metadata?: Readonly<Record<string, string>>) {
    super(message);
    this.name = "PitayaRemoteError";
  }
}

interface PendingRequest {
  resolve(body: Uint8Array): void;
  reject(reason: unknown): void;
  cleanup(): void;
}

function positiveTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Network timeout must be finite and positive.");
  return value;
}

export class PitayaClient {
  private currentStatus: PitayaClientStatus = "Disconnected";
  private socket?: WebSocket;
  private nextID = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly pushes = new Map<string, Set<(body: Uint8Array) => void>>();
  private readonly routes = new Map<number, string>();
  private connectPromise?: Promise<void>;
  private resolveConnect?: () => void;
  private rejectConnect?: (reason: unknown) => void;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private lastReceived = 0;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  public constructor(private readonly options: PitayaClientOptions) {
    const url = new URL(options.url);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Pitaya requires a ws:// or wss:// URL.");
    this.connectTimeoutMs = positiveTimeout(options.connectTimeoutMs ?? 10000);
    this.requestTimeoutMs = positiveTimeout(options.requestTimeoutMs ?? 10000);
  }

  public get status(): PitayaClientStatus { return this.currentStatus; }

  public connect(): Promise<void> {
    if (this.currentStatus === "Disposed") throw new Error("Pitaya client is disposed.");
    if (this.currentStatus === "Connected") return Promise.resolve();
    if (this.connectPromise !== undefined) return this.connectPromise;
    const socket = this.options.socketFactory?.(this.options.url) ?? new WebSocket(this.options.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.currentStatus = "Connecting";
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    this.connectTimer = setTimeout(() => this.close(new Error("Pitaya handshake timed out.")), this.connectTimeoutMs);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      try {
        this.send(1, new TextEncoder().encode(JSON.stringify({ sys: { type: "typescript", version: "1" }, user: {} })));
      } catch (error: unknown) {
        this.close(error instanceof Error ? error : new Error(String(error)));
      }
    };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (this.socket !== socket) return;
      let dispatch: (() => void) | undefined;
      try {
        if (!(event.data instanceof ArrayBuffer)) throw new Error("Pitaya requires binary WebSocket messages.");
        dispatch = this.receive(new Uint8Array(event.data));
      } catch (error: unknown) {
        this.close(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      dispatch?.();
    };
    socket.onerror = () => {
      if (this.socket === socket) this.close(new Error("Pitaya WebSocket transport failed."));
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.close(new Error(`Pitaya connection closed (${event.code}): ${event.reason}`));
    };
    return this.connectPromise;
  }

  public async request<TRequest, TResponse>(
    route: string, value: TRequest, requestCodec: ProtobufCodec<TRequest>, responseCodec: ProtobufCodec<TResponse>,
    options: PitayaRequestOptions = {},
  ): Promise<TResponse> {
    const bytes = await this.requestBytes(route, requestCodec.encode(value).finish(), options);
    return responseCodec.decode(bytes);
  }

  public requestBytes(route: string, body: Uint8Array, options: PitayaRequestOptions = {}): Promise<Uint8Array> {
    this.requireConnected();
    const timeout = positiveTimeout(options.timeoutMs ?? this.requestTimeoutMs);
    if (options.signal?.aborted) return Promise.reject(new Error("Pitaya request aborted."));
    if (this.nextID === Number.MAX_SAFE_INTEGER) throw new Error("Pitaya request IDs exhausted; create a new client.");
    const id = ++this.nextID;
    const data = encodeRequest(0, id, route, body);
    return new Promise<Uint8Array>((resolve, reject) => {
      const fail = (reason: Error): void => {
        const pending = this.pending.get(id);
        if (pending === undefined) return;
        this.pending.delete(id);
        pending.cleanup();
        reject(reason);
      };
      const abort = (): void => fail(new Error("Pitaya request aborted."));
      const timer = setTimeout(() => fail(new Error(`Pitaya request timed out: ${route}.`)), timeout);
      this.pending.set(id, {
        resolve, reject,
        cleanup: () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
        },
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        this.send(4, data);
      } catch (error: unknown) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  public notify<T>(route: string, value: T, codec: ProtobufCodec<T>): void {
    this.requireConnected();
    this.send(4, encodeRequest(1, 0, route, codec.encode(value).finish()));
  }

  public onPush<T>(route: string, codec: ProtobufCodec<T>, listener: (value: T) => void): () => void {
    if (this.currentStatus === "Disposed") throw new Error("Pitaya client is disposed.");
    const handler = (body: Uint8Array): void => listener(codec.decode(body));
    let listeners = this.pushes.get(route);
    if (listeners === undefined) {
      listeners = new Set();
      this.pushes.set(route, listeners);
    }
    listeners.add(handler);
    const registered = listeners;
    return () => {
      registered.delete(handler);
      if (registered.size === 0 && this.pushes.get(route) === registered) this.pushes.delete(route);
    };
  }

  public disconnect(): void { this.close(new Error("Pitaya client disconnected.")); }

  public dispose(): void {
    if (this.currentStatus === "Disposed") return;
    this.currentStatus = "Disposed";
    this.pushes.clear();
    this.close(new Error("Pitaya client disposed."));
  }

  private receive(data: Uint8Array): (() => void) | undefined {
    const packet = decodePacket(data);
    this.lastReceived = Date.now();
    if (packet.type === 1) {
      if (this.currentStatus !== "Connecting") throw new Error("Unexpected Pitaya handshake.");
      const handshake = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packet.body)) as {
        code?: number; sys?: { heartbeat?: number; dict?: Record<string, number>; serializer?: string };
      };
      if (handshake.code !== 200) throw new Error(`Pitaya handshake rejected (${handshake.code}).`);
      if (handshake.sys?.serializer !== "protobuf") throw new Error("Pitaya server must use the Protobuf serializer.");
      const heartbeat = handshake.sys?.heartbeat;
      if (typeof heartbeat !== "number" || !Number.isFinite(heartbeat) || heartbeat <= 0) throw new Error("Invalid Pitaya heartbeat interval.");
      this.routes.clear();
      for (const [route, code] of Object.entries(handshake.sys?.dict ?? {})) {
        if (!Number.isInteger(code) || code < 0 || code > 65535 || this.routes.has(code)) throw new Error("Invalid Pitaya route dictionary.");
        this.routes.set(code, route);
      }
      this.send(2);
      this.currentStatus = "Connected";
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
      this.heartbeatTimer = setInterval(() => {
        if (Date.now() - this.lastReceived > heartbeat * 2000) {
          this.close(new Error("Pitaya heartbeat timed out."));
          return;
        }
        try {
          this.send(3);
        } catch (error: unknown) {
          this.close(error instanceof Error ? error : new Error(String(error)));
        }
      }, heartbeat * 1000);
      const resolve = this.resolveConnect;
      this.connectPromise = undefined;
      this.resolveConnect = undefined;
      this.rejectConnect = undefined;
      resolve?.();
      return;
    }
    if (packet.type === 5) throw new Error("Pitaya server kicked this connection.");
    this.requireConnected();
    if (packet.type === 3) return;
    if (packet.type !== 4) throw new Error(`Unexpected Pitaya packet type ${packet.type}.`);
    const message = decodeMessage(packet.body, this.routes);
    if (message.type === 3) {
      const listeners = [...(this.pushes.get(message.route) ?? [])];
      return () => { for (const listener of listeners) listener(message.body); };
    }
    const pending = this.pending.get(message.id);
    // Timed-out or cancelled requests may still complete on the server.
    if (pending === undefined) return;
    let error: PitayaRemoteError | undefined;
    if (message.error) {
      const payload = decodeRemoteError(message.body);
      error = new PitayaRemoteError(payload.code, payload.msg, payload.metadata);
    }
    this.pending.delete(message.id);
    pending.cleanup();
    if (error !== undefined) pending.reject(error);
    else pending.resolve(message.body);
  }

  private send(type: number, body?: Uint8Array): void {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== 1) throw new Error("Pitaya WebSocket is not open.");
    socket.send(encodePacket(type, body));
  }

  private requireConnected(): void {
    if (this.currentStatus !== "Connected") throw new Error(`Pitaya requires Connected status, got ${this.currentStatus}.`);
  }

  private close(reason: Error): void {
    const socket = this.socket;
    this.socket = undefined;
    clearTimeout(this.connectTimer);
    clearInterval(this.heartbeatTimer);
    this.connectTimer = undefined;
    this.heartbeatTimer = undefined;
    if (this.currentStatus !== "Disposed") this.currentStatus = "Disconnected";
    this.rejectConnect?.(reason);
    this.connectPromise = undefined;
    this.resolveConnect = undefined;
    this.rejectConnect = undefined;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(reason);
    }
    this.pending.clear();
    this.routes.clear();
    if (socket !== undefined) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      this.options.onDisconnect?.(reason);
    }
  }
}
