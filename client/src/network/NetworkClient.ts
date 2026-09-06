export type NetworkMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type NetworkClientStatus = "Active" | "Disposed";

export interface NetworkRequest<TBody = unknown> {
  readonly path: string;
  readonly method?: NetworkMethod;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: TBody;
  readonly signal?: AbortSignal;
}

export type NetworkTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface NetworkClientOptions {
  readonly baseUrl: string;
  readonly transport?: NetworkTransport;
}

export class NetworkHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly responseText: string,
  ) {
    super(`Network request failed with HTTP ${status}${statusText.length > 0 ? ` ${statusText}` : ""}.`);
    this.name = "NetworkHttpError";
  }
}

function defaultTransport(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json"
    || (mediaType.startsWith("application/") && mediaType.endsWith("+json"));
}

export class NetworkClient {
  private currentStatus: NetworkClientStatus = "Active";
  private readonly activeControllers = new Set<AbortController>();
  private readonly baseUrl: URL;
  private readonly transport: NetworkTransport;

  public constructor(options: NetworkClientOptions) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl);
    } catch (cause: unknown) {
      throw errorWithCause(new Error(`Network base URL is invalid: "${options.baseUrl}".`), cause);
    }

    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new Error(`Network base URL must use HTTP or HTTPS: "${options.baseUrl}".`);
    }

    this.baseUrl = baseUrl;
    this.transport = options.transport ?? defaultTransport;
  }

  public get status(): NetworkClientStatus {
    return this.currentStatus;
  }

  public request<TResponse, TBody = unknown>(
    request: NetworkRequest<TBody>,
  ): Promise<TResponse | undefined> {
    this.ensureActive();
    const url = this.resolveUrl(request.path);
    const headers = new Headers(request.headers);
    const hasBody = request.body !== undefined;
    if (hasBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const controller = new AbortController();
    this.activeControllers.add(controller);

    const externalSignal = request.signal;
    let removeExternalAbortListener: (() => void) | undefined;
    if (externalSignal !== undefined) {
      const forwardAbort = (): void => {
        controller.abort();
      };

      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", forwardAbort, { once: true });
        removeExternalAbortListener = () => {
          externalSignal.removeEventListener("abort", forwardAbort);
        };
      }
    }

    const promise = Promise.resolve()
      .then(() => this.transport(url, {
        method: request.method ?? "GET",
        headers,
        body: hasBody ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      }))
      .then(async (response) => {
        if (!response.ok) {
          throw new NetworkHttpError(
            response.status,
            response.statusText,
            await response.text(),
          );
        }

        const responseText = await response.text();
        if (responseText.length === 0) {
          return undefined;
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!isJsonContentType(contentType)) {
          return responseText as TResponse;
        }

        try {
          return JSON.parse(responseText) as TResponse;
        } catch (cause: unknown) {
          throw errorWithCause(new Error(`Network response from "${url}" is not valid JSON.`), cause);
        }
      })
      .finally(() => {
        removeExternalAbortListener?.();
        this.activeControllers.delete(controller);
      });

    return promise;
  }

  public dispose(): void {
    if (this.currentStatus === "Disposed") {
      return;
    }

    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
    this.currentStatus = "Disposed";
  }

  private resolveUrl(path: string): string {
    const normalizedPath = path.trim();
    if (normalizedPath.length === 0) {
      throw new Error("Network request path must not be empty.");
    }

    if (
      /^[a-z][a-z\d+.-]*:/i.test(normalizedPath)
      || normalizedPath.startsWith("//")
      || normalizedPath.startsWith("\\\\")
    ) {
      throw new Error(`Network request path must be relative: "${path}".`);
    }

    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(normalizedPath, this.baseUrl);
    } catch (cause: unknown) {
      throw errorWithCause(new Error(`Network request path is invalid: "${path}".`), cause);
    }

    if (resolvedUrl.origin !== this.baseUrl.origin) {
      throw new Error(`Network request path resolves outside the configured origin: "${path}".`);
    }
    return resolvedUrl.toString();
  }

  private ensureActive(): void {
    if (this.currentStatus !== "Active") {
      throw new Error(`NetworkClient cannot be used from status ${this.currentStatus}.`);
    }
  }
}
import { errorWithCause } from "../error/FrameworkError";
