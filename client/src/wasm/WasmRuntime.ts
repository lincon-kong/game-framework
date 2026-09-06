export type WasmLoadPhase = "load" | "compile" | "instantiate" | "ready";
export type WasmRuntimeStatus = "Created" | "Loading" | "Ready" | "Disposed";

export type WasmByteProvider = (wasmUrl: string) => Promise<ArrayBuffer>;

export interface WasmRuntimeLoadOptions {
  readonly wasmUrl: string;
  readonly loadBytes?: WasmByteProvider;
  readonly imports?: WebAssembly.Imports;
  readonly onPhase?: (phase: WasmLoadPhase) => void;
}

type WasmFetchResponse = {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export class WasmLoadError extends Error {
  public constructor(
    public readonly wasmUrl: string,
    public readonly phase: WasmLoadPhase,
    cause: unknown,
  ) {
    super(`WASM load failed for "${wasmUrl}" during ${phase}.`);
    errorWithCause(this, cause);
    this.name = "WasmLoadError";
  }
}

function loadBytesFromFetch(wasmUrl: string): Promise<ArrayBuffer> {
  return fetch(wasmUrl).then(async (response: WasmFetchResponse) => {
    if (!response.ok) {
      throw new Error(`WASM request failed with HTTP ${response.status}.`);
    }
    return response.arrayBuffer();
  });
}

export class WasmRuntime {
  private currentStatus: WasmRuntimeStatus = "Created";

  private constructor(
    private readonly compiledModule: WebAssembly.Module,
    private readonly wasmInstance: WebAssembly.Instance,
  ) {}

  public static async load(options: WasmRuntimeLoadOptions): Promise<WasmRuntime> {
    const loadBytes = options.loadBytes ?? loadBytesFromFetch;
    const onPhase = options.onPhase ?? (() => {});
    let phase: WasmLoadPhase = "load";
    let runtime: WasmRuntime | undefined;

    try {
      onPhase(phase);
      const bytes = await loadBytes(options.wasmUrl);

      phase = "compile";
      onPhase(phase);
      const compiledModule = await WebAssembly.compile(bytes);

      phase = "instantiate";
      onPhase(phase);
      const wasmInstance = await WebAssembly.instantiate(compiledModule, options.imports ?? {});
      runtime = new WasmRuntime(compiledModule, wasmInstance);
      runtime.currentStatus = "Loading";

      phase = "ready";
      onPhase(phase);
      runtime.currentStatus = "Ready";
      return runtime;
    } catch (cause: unknown) {
      runtime?.dispose();
      throw new WasmLoadError(options.wasmUrl, phase, cause);
    }
  }

  public get status(): WasmRuntimeStatus {
    return this.currentStatus;
  }

  public get module(): WebAssembly.Module {
    this.requireReady();
    return this.compiledModule;
  }

  public get instance(): WebAssembly.Instance {
    this.requireReady();
    return this.wasmInstance;
  }

  public get exports(): WebAssembly.Exports {
    this.requireReady();
    return this.wasmInstance.exports;
  }

  public getExport<T>(name: string): T {
    const value = this.exports[name];
    if (value === undefined) {
      throw new Error(`WASM export "${name}" is missing.`);
    }
    return value as T;
  }

  public getMemory(exportName: string): WebAssembly.Memory {
    const value = this.getExport<unknown>(exportName);
    if (!(value instanceof WebAssembly.Memory)) {
      throw new Error(`WASM export "${exportName}" is missing or has an invalid memory type.`);
    }
    return value;
  }

  public dispose(): void {
    if (this.currentStatus === "Disposed") {
      return;
    }
    this.currentStatus = "Disposed";
  }

  private requireReady(): void {
    if (this.currentStatus !== "Ready") {
      throw new Error(`WASM runtime requires Ready status, got ${this.currentStatus}.`);
    }
  }
}
import { errorWithCause } from "../error/FrameworkError";
