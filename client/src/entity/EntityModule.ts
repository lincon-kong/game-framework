import type { AssetService } from "../asset/AssetModule";
import { FrameworkError, FrameworkErrorCode } from "../error/FrameworkError";
import type { LifecycleOwner, LifecycleParticipant } from "../lifecycle/LifecycleModule";
import type { PoolModule } from "../pool/PoolModule";

export interface EntityDefinition {
  readonly id: string;
  readonly prefabPath: string;
  readonly maxRetained?: number;
  /** Presentation-specific cleanup for listeners, timers, tweens, or effects. */
  readonly onAcquire?: (node: unknown) => void;
  readonly onRecycle?: (node: unknown) => void;
}

export interface EntityHandle<TNode = unknown> {
  readonly id: string;
  readonly node: TNode;
  readonly released: boolean;
  show(): void;
  hide(): void;
  recycle(): void;
  release(): void;
}

export interface EntityPrefab<TNode = unknown> { create(): TNode; }
export interface EntityService {
  register(definition: EntityDefinition): void;
  prepare(id: string, prewarmCount?: number): Promise<void>;
  acquire<TNode = unknown>(id: string): EntityHandle<TNode>;
  activeCount(id?: string): number;
}

interface RegisteredDefinition {
  readonly ownerId: number;
  readonly definition: EntityDefinition;
}
type InternalHandle<TNode> = EntityHandle<TNode>;

interface EntityNodeLike {
  destroyed?: boolean;
  visible?: boolean;
  x?: number;
  y?: number;
  rotation?: number;
  alpha?: number;
  scaleX?: number;
  scaleY?: number;
  filters?: unknown;
  removeSelf?(): unknown;
  destroy?(destroyChild?: boolean): void;
}

export class EntityModule implements LifecycleParticipant {
  private readonly definitions = new Map<string, RegisteredDefinition>();
  private readonly activeByOwner = new Map<number, Set<InternalHandle<unknown>>>();
  private readonly poolKeysByOwner = new Map<number, Set<string>>();
  private readonly preparing = new Map<string, Promise<void>>();

  public constructor(private readonly pools: PoolModule) {}

  public bind(owner: LifecycleOwner, assertActive: () => void, assets: AssetService): EntityService {
    return {
      register: (definition) => { assertActive(); this.register(owner, definition); },
      prepare: (id, prewarmCount = 0) => {
        assertActive();
        return this.prepare(owner, assertActive, assets, id, prewarmCount);
      },
      acquire: <TNode>(id: string) => {
        assertActive();
        return this.acquire<TNode>(owner, id);
      },
      activeCount: (id) => { assertActive(); return this.activeCount(owner, id); },
    };
  }

  public disposeOwner(owner: LifecycleOwner): void {
    const handles = this.activeByOwner.get(owner.id);
    if (handles !== undefined) {
      for (const handle of [...handles]) handle.release();
      this.activeByOwner.delete(owner.id);
    }

    const keys = this.poolKeysByOwner.get(owner.id);
    if (keys !== undefined) {
      for (const key of keys) {
        this.preparing.delete(key);
        if (this.pools.has(key)) this.pools.clear(key);
      }
      this.poolKeysByOwner.delete(owner.id);
    }

    for (const [id, registered] of [...this.definitions]) {
      if (registered.ownerId === owner.id) this.definitions.delete(id);
    }
  }

  private register(owner: LifecycleOwner, definition: EntityDefinition): void {
    this.validateDefinition(definition);
    const existing = this.definitions.get(definition.id);
    if (existing !== undefined) {
      if (
        existing.ownerId === owner.id
        && existing.definition.prefabPath === definition.prefabPath
        && existing.definition.maxRetained === definition.maxRetained
      ) return;
      throw new FrameworkError(
        FrameworkErrorCode.DuplicateEntityDefinition,
        `Entity definition "${definition.id}" is already registered.`,
      );
    }
    this.definitions.set(definition.id, { ownerId: owner.id, definition: { ...definition } });
  }

  private prepare(
    owner: LifecycleOwner,
    assertActive: () => void,
    assets: AssetService,
    id: string,
    prewarmCount: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(prewarmCount) || prewarmCount < 0) {
      return Promise.reject(new FrameworkError(
        FrameworkErrorCode.InvalidArgument,
        "Entity prewarmCount must be a non-negative safe integer.",
      ));
    }
    const registered = this.requireDefinition(id);
    const poolKey = this.poolKey(owner.id, id);
    if (this.pools.has(poolKey)) {
      if (prewarmCount > 0) this.pools.prewarm(poolKey, prewarmCount);
      return Promise.resolve();
    }

    const pending = this.preparing.get(poolKey);
    if (pending !== undefined) {
      return pending.then(() => {
        if (prewarmCount > 0) this.pools.prewarm(poolKey, prewarmCount);
      });
    }

    const request = this.performPrepare(owner, assertActive, assets, registered.definition, poolKey, prewarmCount)
      .finally(() => {
        if (this.preparing.get(poolKey) === request) this.preparing.delete(poolKey);
      });
    this.preparing.set(poolKey, request);
    return request;
  }

  private async performPrepare(
    owner: LifecycleOwner,
    assertActive: () => void,
    assets: AssetService,
    definition: EntityDefinition,
    poolKey: string,
    prewarmCount: number,
  ): Promise<void> {
    let prefab: EntityPrefab<unknown>;
    try {
      prefab = await assets.load<EntityPrefab<unknown>>(definition.prefabPath);
    } catch (cause: unknown) {
      throw new FrameworkError(
        FrameworkErrorCode.EntityUnavailable,
        `Failed to load entity prefab "${definition.prefabPath}".`,
        { cause, context: { entityId: definition.id } },
      );
    }
    assertActive();
    if (prefab === null || typeof prefab !== "object" || typeof prefab.create !== "function") {
      throw new FrameworkError(
        FrameworkErrorCode.EntityUnavailable,
        `Entity prefab "${definition.prefabPath}" is invalid.`,
      );
    }

    if (!this.pools.has(poolKey)) {
      this.pools.define<unknown>(poolKey, {
        create: () => prefab.create(),
        isReusable: (value) => !this.isDestroyed(value),
        onAcquire: (value) => {
          this.resetTransientState(value, true);
          definition.onAcquire?.(value);
        },
        onRelease: (value) => {
          definition.onRecycle?.(value);
          this.removeFromParent(value);
          this.resetTransientState(value, false);
        },
        destroy: (value) => {
          this.removeFromParent(value);
          (value as EntityNodeLike)?.destroy?.(true);
        },
        maxRetained: definition.maxRetained ?? 32,
      });
      const keys = this.poolKeysByOwner.get(owner.id) ?? new Set<string>();
      keys.add(poolKey);
      this.poolKeysByOwner.set(owner.id, keys);
    }
    if (prewarmCount > 0) this.pools.prewarm(poolKey, prewarmCount);
  }

  private acquire<TNode>(owner: LifecycleOwner, id: string): EntityHandle<TNode> {
    this.requireDefinition(id);
    const poolKey = this.poolKey(owner.id, id);
    if (!this.pools.has(poolKey)) {
      throw new FrameworkError(
        FrameworkErrorCode.EntityNotPrepared,
        `Entity "${id}" must be prepared before synchronous acquire.`,
      );
    }

    const node = this.pools.acquire<TNode>(poolKey);
    const handles = this.activeByOwner.get(owner.id) ?? new Set<InternalHandle<unknown>>();
    let releasedValue = false;
    const release = (): void => {
      if (releasedValue) return;
      releasedValue = true;
      handles.delete(handle as InternalHandle<unknown>);
      this.pools.release(poolKey, node);
    };
    const handle: InternalHandle<TNode> = {
      id,
      node,
      get released() { return releasedValue; },
      show: () => { if (!releasedValue) this.setVisible(node, true); },
      hide: () => { if (!releasedValue) this.setVisible(node, false); },
      recycle: release,
      release,
    };
    handles.add(handle as InternalHandle<unknown>);
    this.activeByOwner.set(owner.id, handles);
    return handle;
  }

  private activeCount(owner: LifecycleOwner, id?: string): number {
    const handles = this.activeByOwner.get(owner.id);
    if (handles === undefined) return 0;
    let count = 0;
    for (const handle of handles) if (id === undefined || handle.id === id) count += 1;
    return count;
  }

  private requireDefinition(id: string): RegisteredDefinition {
    const registered = this.definitions.get(id);
    if (registered === undefined) {
      throw new FrameworkError(FrameworkErrorCode.UnknownEntityDefinition, `Unknown entity definition: ${id}.`);
    }
    return registered;
  }

  private validateDefinition(definition: EntityDefinition): void {
    if (definition === null || typeof definition !== "object") {
      throw new FrameworkError(FrameworkErrorCode.InvalidEntityDefinition, "Entity definition is required.");
    }
    if (typeof definition.id !== "string" || definition.id.length === 0 || definition.id.trim() !== definition.id) {
      throw new FrameworkError(FrameworkErrorCode.InvalidEntityDefinition, "Entity definition id must be a non-empty trimmed string.");
    }
    if (
      typeof definition.prefabPath !== "string"
      || definition.prefabPath.length === 0
      || definition.prefabPath.trim() !== definition.prefabPath
    ) {
      throw new FrameworkError(FrameworkErrorCode.InvalidEntityDefinition, "Entity prefabPath must be a non-empty trimmed string.");
    }
    if (
      definition.maxRetained !== undefined
      && (!Number.isSafeInteger(definition.maxRetained) || definition.maxRetained < 0)
    ) {
      throw new FrameworkError(FrameworkErrorCode.InvalidEntityDefinition, "Entity maxRetained must be a non-negative safe integer.");
    }
  }

  private poolKey(ownerId: number, id: string): string { return `entity:${ownerId}:${id}`; }
  private setVisible(value: unknown, visible: boolean): void {
    if (value !== null && typeof value === "object" && "visible" in value) {
      (value as EntityNodeLike).visible = visible;
    }
  }
  private resetTransientState(value: unknown, visible: boolean): void {
    if (value === null || typeof value !== "object") return;
    const node = value as EntityNodeLike;
    this.setVisible(node, visible);
    if ("x" in node) node.x = 0;
    if ("y" in node) node.y = 0;
    if ("rotation" in node) node.rotation = 0;
    if ("alpha" in node) node.alpha = 1;
    if ("scaleX" in node) node.scaleX = 1;
    if ("scaleY" in node) node.scaleY = 1;
    if ("filters" in node) node.filters = null;
  }
  private isDestroyed(value: unknown): boolean {
    return value !== null && typeof value === "object" && (value as EntityNodeLike).destroyed === true;
  }
  private removeFromParent(value: unknown): void {
    if (value !== null && typeof value === "object") (value as EntityNodeLike).removeSelf?.();
  }
}
