import type { LifecycleOwner, LifecycleParticipant } from "../lifecycle/LifecycleModule";
import {
  asFrameworkError,
  composeFrameworkError,
  FrameworkError,
  FrameworkErrorCode,
} from "../error/FrameworkError";

export interface AssetBackend {
  load<T = unknown>(path: string): Promise<T>;
  loadBytes?(path: string): Promise<ArrayBuffer>;
  release(path: string): Promise<void> | void;
}

export interface AssetService {
  load<T = unknown>(path: string): Promise<T>;
  loadBytes(path: string): Promise<ArrayBuffer>;
}

/** Generic resource contract implemented by Laya Prefab assets. */
export interface PrefabResource<TNode> {
  create(): TNode;
}

export type RuntimeConstructor<TNode> = new () => TNode;

function destroyPrefabInstance(instance: unknown): void {
  if (
    instance !== null
    && typeof instance === "object"
    && typeof (instance as { destroy?: unknown }).destroy === "function"
  ) {
    (instance as { destroy(destroyChildren?: boolean): void }).destroy(true);
  }
}

/**
 * Load a Prefab and require that it instantiates the Runtime class authored for
 * that Prefab. Business packages provide only the path and Runtime constructor.
 */
export async function instantiatePrefabRuntime<TNode>(
  assets: AssetService,
  prefabPath: string,
  runtime: RuntimeConstructor<TNode>,
): Promise<TNode> {
  let prefab: PrefabResource<unknown>;
  try {
    prefab = await assets.load<PrefabResource<unknown>>(prefabPath);
  } catch (cause: unknown) {
    throw asFrameworkError(
      cause,
      FrameworkErrorCode.AssetLoadFailed,
      `Failed to load Prefab "${prefabPath}".`,
      { prefabPath },
    );
  }
  if (prefab === null || typeof prefab !== "object" || typeof prefab.create !== "function") {
    throw new FrameworkError(
      FrameworkErrorCode.AssetLoadFailed,
      `Prefab "${prefabPath}" is invalid.`,
      { context: { prefabPath } },
    );
  }

  const instance = prefab.create();
  if (!(instance instanceof runtime)) {
    const runtimeError = new FrameworkError(
      FrameworkErrorCode.InvalidUiState,
      `Prefab "${prefabPath}" did not instantiate Runtime "${runtime.name}".`,
      { context: { prefabPath, runtime: runtime.name } },
    );
    try {
      destroyPrefabInstance(instance);
    } catch (cleanupError: unknown) {
      throw composeFrameworkError(
        FrameworkErrorCode.InvalidUiState,
        [runtimeError, cleanupError],
        `Prefab "${prefabPath}" Runtime validation cleanup failed.`,
      );
    }
    throw runtimeError;
  }
  return instance;
}

interface AssetRecord {
  value?: unknown;
  loading?: Promise<unknown>;
  references: number;
  waiters: number;
}

export class AssetModule implements LifecycleParticipant {
  private readonly records = new Map<string, AssetRecord>();
  private readonly ownership = new Map<number, Map<string, number>>();

  public constructor(private readonly backend: AssetBackend) {}

  public bind(owner: LifecycleOwner, assertActive: () => void): AssetService {
    return {
      load: <T>(path: string) => this.load<T>(owner, assertActive, path, () => this.backend.load<T>(path)),
      loadBytes: (path: string) => this.load<ArrayBuffer>(
        owner,
        assertActive,
        path,
        async () => {
          const bytes = this.backend.loadBytes === undefined
            ? await this.backend.load<ArrayBuffer>(path)
            : await this.backend.loadBytes(path);
          if (!(bytes instanceof ArrayBuffer)) {
            throw new FrameworkError(
              FrameworkErrorCode.AssetLoadFailed,
              `Binary asset "${path}" did not resolve to an ArrayBuffer.`,
              { context: { path } },
            );
          }
          return bytes;
        },
      ),
    };
  }

  public async disposeOwner(owner: LifecycleOwner): Promise<void> {
    const owned = this.ownership.get(owner.id);
    if (owned === undefined) return;
    this.ownership.delete(owner.id);

    const errors: unknown[] = [];
    for (const [path, count] of owned) {
      const record = this.records.get(path);
      if (record === undefined) continue;
      record.references -= count;
      if (record.references > 0 || record.waiters > 0) continue;
      this.records.delete(path);
      try {
        await this.backend.release(path);
      } catch (error: unknown) {
        errors.push(error);
      }
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw composeFrameworkError(
        FrameworkErrorCode.AssetLoadFailed,
        errors,
        `Failed to release assets for ${owner.kind} scope "${owner.key}".`,
      );
    }
  }

  private async load<T>(
    owner: LifecycleOwner,
    assertActive: () => void,
    path: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    assertActive();
    if (path.length === 0 || path.trim() !== path) {
      throw new Error("Asset path must be a non-empty trimmed string.");
    }

    let record = this.records.get(path);
    if (record === undefined) {
      record = { references: 0, waiters: 0 };
      this.records.set(path, record);
    }

    record.waiters += 1;
    let acquired = false;
    try {
      if (record.value === undefined) {
        const loading = record.loading ?? loader();
        record.loading = loading;
        try {
          record.value = await loading;
        } finally {
          if (record.loading === loading) record.loading = undefined;
        }
      }

      assertActive();
      record.references += 1;
      let owned = this.ownership.get(owner.id);
      if (owned === undefined) {
        owned = new Map();
        this.ownership.set(owner.id, owned);
      }
      owned.set(path, (owned.get(path) ?? 0) + 1);
      acquired = true;
      return record.value as T;
    } finally {
      record.waiters -= 1;
      if (!acquired && record.references === 0 && record.waiters === 0 && this.records.get(path) === record) {
        this.records.delete(path);
        if (record.value !== undefined) await this.backend.release(path);
      }
    }
  }
}
