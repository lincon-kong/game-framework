export type ClientStorageStatus = "Active" | "Disposed";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface StorageAdapter {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ClientStorageOptions {
  readonly namespace: string;
  readonly schemaVersion: number;
  readonly adapter?: StorageAdapter;
}

interface StorageEnvelope {
  readonly schemaVersion: number;
  readonly value: JsonValue;
}

function getDefaultAdapter(): StorageAdapter {
  try {
    const adapter = globalThis.localStorage;
    if (adapter === undefined) {
      throw new Error("localStorage is not available in this runtime.");
    }
    return adapter;
  } catch (cause: unknown) {
    throw errorWithCause(new Error("ClientStorage requires an available localStorage adapter."), cause);
  }
}

function validateIdentifier(value: string, label: string): void {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || value.includes(":")
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`ClientStorage ${label} must be a non-empty identifier without surrounding whitespace, colons, or control characters.`);
  }
}

function validateSchemaVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("ClientStorage schemaVersion must be a positive safe integer.");
  }
}

function isStorageEnvelope(value: unknown): value is StorageEnvelope {
  return typeof value === "object"
    && value !== null
    && Object.prototype.hasOwnProperty.call(value, "schemaVersion")
    && Object.prototype.hasOwnProperty.call(value, "value")
    && Number.isSafeInteger((value as { schemaVersion?: unknown }).schemaVersion);
}

function validateAdapter(adapter: StorageAdapter): void {
  if (
    adapter === null
    || typeof adapter !== "object"
    || typeof adapter.key !== "function"
    || typeof adapter.getItem !== "function"
    || typeof adapter.setItem !== "function"
    || typeof adapter.removeItem !== "function"
    || !Number.isSafeInteger(adapter.length)
    || adapter.length < 0
  ) {
    throw new Error("ClientStorage adapter does not implement the required Storage interface.");
  }
}

export class ClientStorage {
  private currentStatus: ClientStorageStatus = "Active";
  private readonly namespacePrefix: string;
  private readonly schemaVersion: number;
  private readonly adapter: StorageAdapter;

  public constructor(options: ClientStorageOptions) {
    if (options === null || typeof options !== "object") {
      throw new Error("ClientStorage options are required.");
    }

    validateIdentifier(options.namespace, "namespace");
    validateSchemaVersion(options.schemaVersion);

    const adapter = options.adapter === undefined ? getDefaultAdapter() : options.adapter;
    validateAdapter(adapter);

    this.namespacePrefix = `${options.namespace}:`;
    this.schemaVersion = options.schemaVersion;
    this.adapter = adapter;
  }

  public get status(): ClientStorageStatus {
    return this.currentStatus;
  }

  public read<TValue extends JsonValue = JsonValue>(key: string): TValue | undefined {
    this.ensureActive();
    const storageKey = this.getStorageKey(key);
    let rawValue: string | null;
    try {
      rawValue = this.adapter.getItem(storageKey);
    } catch (cause: unknown) {
      throw errorWithCause(new Error(`ClientStorage failed to read key "${key}".`), cause);
    }

    if (rawValue === null) {
      return undefined;
    }
    if (rawValue.length === 0) {
      throw new Error(`ClientStorage record for key "${key}" is empty.`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue) as unknown;
    } catch (cause: unknown) {
      throw errorWithCause(new Error(`ClientStorage record for key "${key}" is not valid JSON.`), cause);
    }

    if (!isStorageEnvelope(parsed)) {
      throw new Error(`ClientStorage record for key "${key}" has an invalid envelope.`);
    }
    if (parsed.schemaVersion !== this.schemaVersion) {
      throw new Error(
        `ClientStorage record for key "${key}" uses schemaVersion ${parsed.schemaVersion}; expected ${this.schemaVersion}.`,
      );
    }
    return parsed.value as TValue;
  }

  public write<TValue extends JsonValue>(key: string, value: TValue): void {
    this.ensureActive();
    const storageKey = this.getStorageKey(key);
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify({ schemaVersion: this.schemaVersion, value });
    } catch (cause: unknown) {
      throw errorWithCause(new Error(`ClientStorage value for key "${key}" is not serializable.`), cause);
    }
    if (serialized === undefined) {
      throw new Error(`ClientStorage value for key "${key}" is not serializable.`);
    }

    try {
      this.adapter.setItem(storageKey, serialized);
    } catch (cause: unknown) {
      throw errorWithCause(new Error(`ClientStorage failed to write key "${key}".`), cause);
    }
  }

  public remove(key: string): void {
    this.ensureActive();
    const storageKey = this.getStorageKey(key);
    try {
      this.adapter.removeItem(storageKey);
    } catch (cause: unknown) {
      throw errorWithCause(new Error(`ClientStorage failed to remove key "${key}".`), cause);
    }
  }

  public clear(): void {
    this.ensureActive();
    const ownedKeys: string[] = [];
    try {
      for (let index = 0; index < this.adapter.length; index += 1) {
        const key = this.adapter.key(index);
        if (key !== null && key.startsWith(this.namespacePrefix)) {
          ownedKeys.push(key);
        }
      }
      for (const key of ownedKeys) {
        this.adapter.removeItem(key);
      }
    } catch (cause: unknown) {
      throw errorWithCause(new Error("ClientStorage failed to clear its namespace."), cause);
    }
  }

  public dispose(): void {
    if (this.currentStatus === "Disposed") {
      return;
    }
    this.currentStatus = "Disposed";
  }

  private getStorageKey(key: string): string {
    validateIdentifier(key, "key");
    return `${this.namespacePrefix}${key}`;
  }

  private ensureActive(): void {
    if (this.currentStatus !== "Active") {
      throw new Error(`ClientStorage cannot be used from status ${this.currentStatus}.`);
    }
  }
}
import { errorWithCause } from "../error/FrameworkError";
