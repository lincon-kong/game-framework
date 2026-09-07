import type { LifecycleOwner, LifecycleParticipant } from "../lifecycle/LifecycleModule";
import { composeFrameworkError, FrameworkErrorCode } from "../error/FrameworkError";
import { instantiatePrefabRuntime, type AssetService, type RuntimeConstructor } from "../asset/AssetModule";
import type { UIContainerNode, UILayerName, UIMountBinding, UINode } from "./UIContracts";

export interface UIBackend {
  add<T extends UINode>(layer: UILayerName, node: T): T;
  remove<T extends UINode>(layer: UILayerName, node: T, destroy?: boolean): T;
}

export interface UIService {
  /** Parent Page/Tab Routes may expose one container authored inside their mounted Prefab. */
  setOutlet(node: unknown): void;
}

interface OwnedNode {
  readonly binding: UIMountBinding;
  readonly node: UINode;
}

export class UIModule implements LifecycleParticipant {
  private readonly ownership = new Map<number, Set<OwnedNode>>();
  private readonly outlets = new Map<number, UIContainerNode>();

  public constructor(private readonly backend: UIBackend) {}

  public bind(owner: LifecycleOwner, assertActive: () => void): UIService {
    return Object.freeze({
      setOutlet: (node: unknown) => {
        assertActive();
        this.setOutlet(owner, node);
      },
    });
  }

  /** Framework-internal Route root creation. This capability is intentionally absent from UIService. */
  public async mountRoutePrefab<T extends UINode>(
    owner: LifecycleOwner,
    assertActive: () => void,
    binding: UIMountBinding,
    assets: AssetService,
    path: string,
    runtime: RuntimeConstructor<T>,
  ): Promise<T> {
    assertActive();
    const node = await instantiatePrefabRuntime(assets, path, runtime);
    try {
      assertActive();
      return this.mount(owner, binding, node);
    } catch (error: unknown) {
      try {
        node.destroy(true);
      } catch (cleanupError: unknown) {
        throw composeFrameworkError(
          FrameworkErrorCode.InvalidUiState,
          [error, cleanupError],
          `Failed to rollback unmounted Route Prefab for ${owner.kind} scope "${owner.key}".`,
        );
      }
      throw error;
    }
  }

  public disposeOwner(owner: LifecycleOwner): void {
    const nodes = this.ownership.get(owner.id);
    this.ownership.delete(owner.id);

    const errors: unknown[] = [];
    if (nodes !== undefined) {
      for (const entry of [...nodes].reverse()) {
        try {
          this.removeOwned(entry, true);
        } catch (error: unknown) {
          errors.push(error);
        }
      }
    }

    this.outlets.delete(owner.id);

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw composeFrameworkError(
        FrameworkErrorCode.InvalidUiState,
        errors,
        `Failed to dispose UI for ${owner.kind} scope "${owner.key}".`,
      );
    }
  }

  private setOutlet(owner: LifecycleOwner, value: unknown): void {
    if (owner.kind !== "route") {
      throw new Error("Only Route scopes may expose a child UI outlet.");
    }
    if (
      value === null
      || typeof value !== "object"
      || typeof (value as { addChild?: unknown }).addChild !== "function"
      || typeof (value as { removeChild?: unknown }).removeChild !== "function"
      || typeof (value as { destroy?: unknown }).destroy !== "function"
    ) {
      throw new TypeError("UI outlet must be a Laya container node.");
    }
    if (this.outlets.has(owner.id)) {
      throw new Error(`Route scope "${owner.key}" already exposes a UI outlet.`);
    }
    if (!this.isOwnedPrefabNode(owner.id, value)) {
      throw new Error(`Route scope "${owner.key}" UI outlet must belong to its mounted Prefab tree.`);
    }
    this.outlets.set(owner.id, value as UIContainerNode);
  }

  private isOwnedPrefabNode(ownerId: number, value: unknown): boolean {
    const owned = this.ownership.get(ownerId);
    if (owned === undefined || owned.size === 0) return false;

    const roots = new Set<UINode>([...owned].map((entry) => entry.node));
    const seen = new Set<unknown>();
    let current: unknown = value;
    while (current !== null && typeof current === "object" && !seen.has(current)) {
      if (roots.has(current as UINode)) return true;
      seen.add(current);
      current = (current as { parent?: unknown }).parent;
    }
    return false;
  }

  private mount<T extends UINode>(owner: LifecycleOwner, binding: UIMountBinding, node: T): T {
    let result: T;
    if (binding.kind === "layer") {
      result = this.backend.add(binding.layer, node);
    } else {
      const outlet = this.outlets.get(binding.parentOwnerId);
      if (outlet === undefined) {
        throw new Error(`Parent Route scope ${binding.parentOwnerId} has no active UI outlet.`);
      }
      result = outlet.addChild(node) as T;
    }

    let owned = this.ownership.get(owner.id);
    if (owned === undefined) {
      owned = new Set();
      this.ownership.set(owner.id, owned);
    }
    owned.add({ binding, node });
    return result;
  }

  private removeOwned(entry: OwnedNode, destroy: boolean): void {
    if (entry.binding.kind === "layer") {
      this.backend.remove(entry.binding.layer, entry.node, destroy);
      return;
    }

    const outlet = this.outlets.get(entry.binding.parentOwnerId);
    if (outlet === undefined) {
      throw new Error(`Parent Route scope ${entry.binding.parentOwnerId} UI outlet is no longer active.`);
    }
    outlet.removeChild(entry.node);
    if (destroy) entry.node.destroy(true);
  }
}
