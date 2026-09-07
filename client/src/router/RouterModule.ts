import type { FrameworkAccess } from "../FrameworkAccess";
import type { RuntimeConstructor } from "../asset/AssetModule";
import { composeFrameworkError, FrameworkErrorCode } from "../error/FrameworkError";
import type { LifecycleModule, LifecycleOwner, LifecycleParticipant } from "../lifecycle/LifecycleModule";
import {
  UILayer,
  UI_LAYER_ORDER,
  type UILayerName,
  type UIMountBinding,
  type UINode,
} from "../ui/UIContracts";

export type RouteKey = string;
export type RouteParams = unknown;

export const RouteType = {
  Page: "page",
  Tab: "tab",
  Pop: "pop",
} as const;
export type RouteType = (typeof RouteType)[keyof typeof RouteType];

export interface RouteController {
  enter(params?: RouteParams): Promise<void> | void;
  leave?(): Promise<void> | void;
}

export interface RouteInstance {
  readonly controller: RouteController;
  readonly model?: unknown;
}

export interface RoutePrefabDefinition<TView extends UINode = UINode> {
  readonly path: string;
  readonly runtime: RuntimeConstructor<TView>;
}

/** Public, lifecycle-bound context supplied to a Game Route factory. */
export interface RouteContext<TView = UINode> {
  readonly id: RouteKey;
  readonly type: RouteType;
  readonly parentId?: RouteKey;
  readonly framework: FrameworkAccess;
  readonly view: TView;
}

export interface RouteRegistrationOptions<TView extends UINode = UINode> {
  readonly parent?: RouteKey;
  readonly type?: RouteType;
  /** Page defaults to Page; Pop defaults to Popup. Tab mounts to its parent's authored outlet. */
  readonly layer?: UILayerName;
  /** Every business Route declares one Runtime Prefab mounted before Controller creation. */
  readonly prefab: RoutePrefabDefinition<TView>;
}

export type RouteFactory<TView extends UINode = UINode> = (route: RouteContext<TView>) => RouteInstance;

export interface RouteRegistrar {
  register<TView extends UINode>(
    id: RouteKey,
    factory: RouteFactory<TView>,
    options: RouteRegistrationOptions<TView>,
  ): void;
}

export interface RouteModelService {
  has(id: RouteKey): boolean;
  get<T = unknown>(id: RouteKey): T;
}

export interface RouterService {
  open(id: RouteKey, params?: RouteParams): Promise<void>;
  replace(id: RouteKey, params?: RouteParams): Promise<void>;
  close(): Promise<void>;
  back(): Promise<void>;
  /** UI intents use latest-wins queuing while another navigation is in flight. */
  openFromIntent(id: RouteKey, params?: RouteParams): void;
  replaceFromIntent(id: RouteKey, params?: RouteParams): void;
  closeFromIntent(): void;
  backFromIntent(): void;
  current(): RouteKey | undefined;
  isActive(id: RouteKey): boolean;
}

export interface RouterEvent {
  readonly type: "navigation-start" | "navigation-complete" | "navigation-failed";
  readonly operation: "open" | "replace" | "close" | "back";
  readonly id?: RouteKey;
  readonly error?: unknown;
}
export type RouterObserver = (event: RouterEvent) => void;
export type RouterIntentErrorHandler = (error: unknown) => void;

export type RoutePrefabMounter = (
  owner: LifecycleOwner,
  binding: UIMountBinding,
  prefab: RoutePrefabDefinition,
) => Promise<UINode>;

interface RouteDefinition {
  readonly id: RouteKey;
  readonly type: RouteType;
  readonly layer?: UILayerName;
  readonly packageOwner: LifecycleOwner;
  readonly parentId?: RouteKey;
  readonly prefab: RoutePrefabDefinition;
  readonly factory: (route: RouteContext) => RouteInstance;
}

interface RouteNode {
  readonly id: RouteKey;
  readonly type: RouteType;
  readonly parentId?: RouteKey;
  readonly owner: LifecycleOwner;
  readonly controller: RouteController;
  readonly model?: unknown;
}

interface HistoryEntry {
  readonly id: RouteKey;
  readonly params?: RouteParams;
}

interface PendingNavigationIntent {
  readonly operation: RouterEvent["operation"];
  readonly id?: RouteKey;
  readonly request: () => Promise<void>;
}

export class RouterModule implements LifecycleParticipant {
  private readonly definitions = new Map<RouteKey, RouteDefinition>();
  private readonly active = new Map<RouteKey, RouteNode>();
  private readonly routeModels = new Map<RouteKey, unknown>();
  private readonly history: HistoryEntry[] = [];
  private readonly popStack: RouteKey[] = [];
  private navigationInFlight?: Promise<void>;
  private navigationInFlightId?: RouteKey;
  private pendingIntent?: PendingNavigationIntent;

  public constructor(
    private readonly lifecycle: LifecycleModule,
    private readonly bindFramework: (owner: LifecycleOwner) => FrameworkAccess,
    private readonly mountPrefab: RoutePrefabMounter,
    private readonly observer?: RouterObserver,
    private readonly onIntentError?: RouterIntentErrorHandler,
  ) {}

  public bind(owner: LifecycleOwner): RouterService {
    const active = (): void => this.lifecycle.assertActive(owner);
    return {
      open: (id, params) => {
        active();
        return this.navigate("open", id, () => this.open(id, params));
      },
      replace: (id, params) => {
        active();
        return this.navigate("replace", id, () => this.replace(id, params));
      },
      close: () => {
        active();
        return this.navigate("close", this.currentRouteId(), () => this.back());
      },
      back: () => {
        active();
        return this.navigate("back", this.currentRouteId(), () => this.back());
      },
      openFromIntent: (id, params) => {
        active();
        if (this.active.has(id) || this.navigationInFlightId === id) return;
        this.dispatchIntent("open", id, () => {
          active();
          if (this.active.has(id)) return Promise.resolve();
          return this.navigate("open", id, () => this.open(id, params));
        });
      },
      replaceFromIntent: (id, params) => {
        active();
        this.dispatchIntent("replace", id, () => {
          active();
          return this.navigate("replace", id, () => this.replace(id, params));
        });
      },
      closeFromIntent: () => {
        active();
        this.dispatchIntent("close", this.currentRouteId(), () => {
          active();
          return this.navigate("close", this.currentRouteId(), () => this.back());
        });
      },
      backFromIntent: () => {
        active();
        this.dispatchIntent("back", this.currentRouteId(), () => {
          active();
          return this.navigate("back", this.currentRouteId(), () => this.back());
        });
      },
      current: () => {
        active();
        return this.currentRouteId();
      },
      isActive: (id) => {
        active();
        return this.active.has(id);
      },
    };
  }

  public bindModels(owner: LifecycleOwner): RouteModelService {
    const active = (): void => this.lifecycle.assertActive(owner);
    return {
      has: (id) => {
        active();
        return this.routeModels.has(id);
      },
      get: <T = unknown>(id: RouteKey): T => {
        active();
        if (!this.routeModels.has(id)) throw new Error(`Route model "${id}" is not active.`);
        return this.routeModels.get(id) as T;
      },
    };
  }

  public createRegistrar(packageOwner: LifecycleOwner): RouteRegistrar {
    if (packageOwner.kind !== "package") throw new Error("Routes can only be registered by a PackageScope.");
    return {
      register: ((id: RouteKey, factory: RouteFactory, options: RouteRegistrationOptions) =>
        this.register(
          packageOwner,
          id,
          factory as (route: RouteContext) => RouteInstance,
          options,
        )) as RouteRegistrar["register"],
    };
  }

  public disposeOwner(owner: LifecycleOwner): void {
    if (owner.kind === "route") {
      const node = [...this.active.values()].find((entry) => entry.owner.id === owner.id);
      if (node !== undefined) {
        this.active.delete(node.id);
        this.routeModels.delete(node.id);
        const retainedPops = this.popStack.filter((id) => id !== node.id);
        this.popStack.length = 0;
        this.popStack.push(...retainedPops);
      }
      return;
    }
    if (owner.kind === "package") {
      const removedIds = new Set<RouteKey>();
      for (const [id, definition] of [...this.definitions]) {
        if (definition.packageOwner.id === owner.id) {
          this.definitions.delete(id);
          removedIds.add(id);
        }
      }
      if (removedIds.size > 0) {
        const retainedHistory = this.history.filter((entry) => !removedIds.has(entry.id));
        this.history.length = 0;
        this.history.push(...retainedHistory);
        const retainedPops = this.popStack.filter((id) => !removedIds.has(id));
        this.popStack.length = 0;
        this.popStack.push(...retainedPops);
      }
    }
  }

  private navigate(
    operation: RouterEvent["operation"],
    id: RouteKey | undefined,
    action: () => Promise<void>,
  ): Promise<void> {
    if (this.navigationInFlight !== undefined) {
      return Promise.reject(new Error("Router navigation is already in progress."));
    }
    const request = Promise.resolve().then(async () => {
      this.observer?.({ type: "navigation-start", operation, ...(id === undefined ? {} : { id }) });
      try {
        await action();
        this.observer?.({ type: "navigation-complete", operation, ...(id === undefined ? {} : { id }) });
      } catch (error: unknown) {
        this.observer?.({ type: "navigation-failed", operation, ...(id === undefined ? {} : { id }), error });
        throw error;
      }
    }).finally(() => {
      if (this.navigationInFlight !== request) return;
      this.navigationInFlight = undefined;
      this.navigationInFlightId = undefined;
      const pending = this.pendingIntent;
      this.pendingIntent = undefined;
      if (pending !== undefined) this.runIntent(pending);
    });
    this.navigationInFlight = request;
    this.navigationInFlightId = id;
    return request;
  }

  private dispatchIntent(
    operation: RouterEvent["operation"],
    id: RouteKey | undefined,
    request: () => Promise<void>,
  ): void {
    const intent: PendingNavigationIntent = {
      operation,
      ...(id === undefined ? {} : { id }),
      request,
    };
    if (this.navigationInFlight !== undefined) {
      this.pendingIntent = intent;
      return;
    }
    this.runIntent(intent);
  }

  private runIntent(intent: PendingNavigationIntent): void {
    try {
      void intent.request().catch((error: unknown) => {
        // navigate() emitted navigation-failed before this reaches the runtime boundary.
        this.onIntentError?.(error);
      });
    } catch (error: unknown) {
      this.observer?.({
        type: "navigation-failed",
        operation: intent.operation,
        ...(intent.id === undefined ? {} : { id: intent.id }),
        error,
      });
    }
  }

  private currentRouteId(): RouteKey | undefined {
    return this.popStack[this.popStack.length - 1] ?? this.history[this.history.length - 1]?.id;
  }

  private register(
    packageOwner: LifecycleOwner,
    id: RouteKey,
    factory: (route: RouteContext) => RouteInstance,
    options: RouteRegistrationOptions,
  ): void {
    if (id.length === 0 || id.trim() !== id) throw new Error("Route ID must be a non-empty trimmed string.");
    if (this.definitions.has(id)) throw new Error(`Route "${id}" is already registered.`);
    this.lifecycle.assertActive(packageOwner);
    if (options === undefined || options.prefab === undefined) {
      throw new Error(`Route "${id}" requires a Prefab definition.`);
    }

    const type = options.type ?? RouteType.Page;
    if (type !== RouteType.Page && type !== RouteType.Tab && type !== RouteType.Pop) {
      throw new Error(`Route "${id}" has an invalid type.`);
    }

    const requestedLayer = options.layer;
    if (requestedLayer !== undefined && !UI_LAYER_ORDER.includes(requestedLayer)) {
      throw new Error(`Route "${id}" has an invalid UI layer.`);
    }

    const prefab = options.prefab;
    if (typeof prefab.path !== "string" || prefab.path.length === 0 || prefab.path.trim() !== prefab.path) {
      throw new Error(`Route "${id}" Prefab path must be a non-empty trimmed string.`);
    }
    if (typeof prefab.runtime !== "function") {
      throw new Error(`Route "${id}" Prefab Runtime must be a constructor.`);
    }

    const parentId = options.parent;
    if (type === RouteType.Page && parentId !== undefined) {
      throw new Error(`Page route "${id}" cannot have a parent.`);
    }
    if (type !== RouteType.Page && parentId === undefined) {
      throw new Error(`${type === RouteType.Tab ? "Tab" : "Pop"} route "${id}" requires a parent.`);
    }

    let layer: UILayerName | undefined;
    if (type === RouteType.Page) {
      if (requestedLayer !== undefined && requestedLayer !== UILayer.PAGE) {
        throw new Error(`Page route "${id}" must use the Page UI layer.`);
      }
      layer = UILayer.PAGE;
    } else if (type === RouteType.Tab) {
      if (requestedLayer !== undefined) {
        throw new Error(`Tab route "${id}" cannot select a global UI layer; it mounts to its parent Route outlet.`);
      }
    } else {
      layer = requestedLayer ?? UILayer.POPUP;
      if (layer === UILayer.PAGE) {
        throw new Error(`Pop route "${id}" cannot use the Page UI layer.`);
      }
    }

    if (parentId !== undefined) {
      if (parentId === id) throw new Error(`Route "${id}" cannot be its own parent.`);
      const parent = this.definitions.get(parentId);
      if (parent === undefined) throw new Error(`Parent route "${parentId}" must be registered before child "${id}".`);
      if (parent.packageOwner.id !== packageOwner.id) {
        throw new Error("Parent and child routes must belong to the same package.");
      }
      if (type === RouteType.Tab && parent.type === RouteType.Pop) {
        throw new Error(`Tab route "${id}" cannot be parented by Pop route "${parentId}".`);
      }
    }

    this.definitions.set(id, { id, type, layer, packageOwner, parentId, prefab, factory });
  }

  private async open(id: RouteKey, params?: RouteParams): Promise<void> {
    const definition = this.requireDefinition(id);
    if (definition.type === RouteType.Pop) {
      await this.openPop(definition, params);
      return;
    }

    const current = this.history[this.history.length - 1];
    if (current?.id === id) throw new Error(`Route "${id}" is already the current location.`);
    const currentRoot = current === undefined ? undefined : this.pageRootId(current.id);
    const targetRoot = this.pageRootId(id);

    await this.transitionLocationTo(id, params, false);
    await this.closeAllPops();

    if (current === undefined || currentRoot !== targetRoot) this.history.push({ id, params });
    else this.history[this.history.length - 1] = { id, params };
  }

  private async replace(id: RouteKey, params?: RouteParams): Promise<void> {
    const definition = this.requireDefinition(id);
    if (definition.type === RouteType.Pop) {
      await this.replacePop(definition, params);
      return;
    }

    const current = this.history[this.history.length - 1];
    await this.transitionLocationTo(id, params, current?.id === id);
    await this.closeAllPops();
    if (this.history.length === 0) this.history.push({ id, params });
    else this.history[this.history.length - 1] = { id, params };
  }

  private async back(): Promise<void> {
    if (await this.closeTopPop()) return;
    if (this.history.length === 0) return;
    if (this.history.length === 1) {
      const current = this.history[0];
      const currentPath = this.activePath(current.id);
      const root = currentPath[0];
      if (root !== undefined) await this.lifecycle.dispose(root.owner);
      this.history.length = 0;
      return;
    }
    const current = this.history[this.history.length - 1];
    const previous = this.history[this.history.length - 2];
    await this.transitionLocationTo(previous.id, previous.params, current.id === previous.id);
    this.history.pop();
  }

  private async openPop(definition: RouteDefinition, params?: RouteParams): Promise<void> {
    if (this.active.has(definition.id)) throw new Error(`Route "${definition.id}" already has an active instance.`);
    const parentId = definition.parentId;
    if (parentId === undefined) throw new Error(`Pop route "${definition.id}" requires a parent.`);
    const parentNode = this.active.get(parentId);
    if (parentNode === undefined) throw new Error(`Pop route "${definition.id}" requires active parent "${parentId}".`);
    await this.activate(definition, parentNode, params);
    this.popStack.push(definition.id);
  }

  private async replacePop(definition: RouteDefinition, params?: RouteParams): Promise<void> {
    const topId = this.popStack[this.popStack.length - 1];
    if (topId === undefined) {
      await this.openPop(definition, params);
      return;
    }
    if (this.active.has(definition.id) && definition.id !== topId) {
      throw new Error(`Pop route "${definition.id}" is already active below the top popup.`);
    }
    if (definition.parentId === topId) {
      throw new Error(`Cannot replace Pop route "${topId}" with its child "${definition.id}".`);
    }
    const topNode = this.active.get(topId);
    if (topNode !== undefined) await this.lifecycle.dispose(topNode.owner);
    await this.openPop(definition, params);
  }

  private async closeTopPop(): Promise<boolean> {
    while (this.popStack.length > 0) {
      const id = this.popStack[this.popStack.length - 1];
      const node = id === undefined ? undefined : this.active.get(id);
      if (node === undefined) {
        this.popStack.pop();
        continue;
      }
      await this.lifecycle.dispose(node.owner);
      return true;
    }
    return false;
  }

  private async closeAllPops(): Promise<void> {
    while (await this.closeTopPop()) {
      // Close transient overlays before committing a Page/Tab navigation location.
    }
  }

  private async transitionLocationTo(
    id: RouteKey,
    params: RouteParams,
    forceTargetRecreate: boolean,
  ): Promise<void> {
    const targetDefinitions = this.definitionPath(id);
    const targetLeaf = targetDefinitions[targetDefinitions.length - 1];
    if (targetLeaf?.type === RouteType.Pop) {
      throw new Error(`Pop route "${id}" is not a Page/Tab location.`);
    }

    const currentId = this.history[this.history.length - 1]?.id;
    const currentNodes = currentId === undefined ? [] : this.activePath(currentId);

    let commonLength = 0;
    while (
      commonLength < currentNodes.length
      && commonLength < targetDefinitions.length
      && currentNodes[commonLength]?.id === targetDefinitions[commonLength]?.id
    ) commonLength += 1;

    if (forceTargetRecreate && commonLength === targetDefinitions.length && commonLength > 0) {
      commonLength -= 1;
    }

    const oldBranch = currentNodes[commonLength];
    if (forceTargetRecreate && oldBranch !== undefined) await this.lifecycle.dispose(oldBranch.owner);

    const activated: RouteNode[] = [];
    let parentNode = commonLength === 0 ? undefined : currentNodes[commonLength - 1];
    try {
      for (let index = commonLength; index < targetDefinitions.length; index += 1) {
        const definition = targetDefinitions[index];
        if (definition === undefined) continue;
        const node = await this.activate(
          definition,
          parentNode,
          index === targetDefinitions.length - 1 ? params : undefined,
        );
        activated.push(node);
        parentNode = node;
      }
    } catch (error: unknown) {
      const root = activated[0];
      if (root !== undefined) {
        try {
          await this.lifecycle.dispose(root.owner);
        } catch (cleanupError: unknown) {
          throw composeFrameworkError(
            FrameworkErrorCode.RouteActivationFailed,
            [error, cleanupError],
            `Route "${id}" transition cleanup failed.`,
          );
        }
      }
      throw error;
    }

    if (!forceTargetRecreate && oldBranch !== undefined) await this.lifecycle.dispose(oldBranch.owner);
  }

  private requireDefinition(id: RouteKey): RouteDefinition {
    const definition = this.definitions.get(id);
    if (definition === undefined) throw new Error(`Route "${id}" is not registered.`);
    return definition;
  }

  private pageRootId(id: RouteKey): RouteKey {
    const root = this.definitionPath(id)[0];
    if (root === undefined || root.type !== RouteType.Page) {
      throw new Error(`Route "${id}" is not rooted at a Page.`);
    }
    return root.id;
  }

  private definitionPath(id: RouteKey): RouteDefinition[] {
    const leaf = this.requireDefinition(id);
    const path: RouteDefinition[] = [];
    const seen = new Set<RouteKey>();
    let current: RouteDefinition | undefined = leaf;
    while (current !== undefined) {
      if (seen.has(current.id)) throw new Error(`Route tree contains a cycle at "${current.id}".`);
      seen.add(current.id);
      path.unshift(current);
      current = current.parentId === undefined ? undefined : this.definitions.get(current.parentId);
      if (current === undefined && path[0]?.parentId !== undefined) {
        throw new Error(`Parent route "${path[0].parentId}" is not registered.`);
      }
    }
    return path;
  }

  private activePath(id: RouteKey): RouteNode[] {
    const definitions = this.definitionPath(id);
    const path: RouteNode[] = [];
    for (const definition of definitions) {
      const node = this.active.get(definition.id);
      if (node === undefined) break;
      path.push(node);
    }
    return path;
  }

  private uiBindingFor(definition: RouteDefinition, parentNode: RouteNode | undefined): UIMountBinding {
    if (definition.type === RouteType.Tab) {
      if (parentNode === undefined) {
        throw new Error(`Tab route "${definition.id}" requires an active parent Route outlet.`);
      }
      return { kind: "outlet", parentOwnerId: parentNode.owner.id };
    }
    if (definition.layer === undefined) {
      throw new Error(`Route "${definition.id}" has no global UI layer binding.`);
    }
    return { kind: "layer", layer: definition.layer };
  }

  private async activate(
    definition: RouteDefinition,
    parentNode: RouteNode | undefined,
    params?: RouteParams,
  ): Promise<RouteNode> {
    if (this.active.has(definition.id)) {
      throw new Error(`Route "${definition.id}" already has an active instance.`);
    }
    this.lifecycle.assertActive(definition.packageOwner);
    const parentOwner = parentNode?.owner ?? definition.packageOwner;
    const owner = this.lifecycle.createRouteScope(parentOwner, definition.id);
    let instance: RouteInstance;
    try {
      const framework = this.bindFramework(owner);
      const view = await this.mountPrefab(owner, this.uiBindingFor(definition, parentNode), definition.prefab);
      instance = definition.factory({
        id: definition.id,
        type: definition.type,
        ...(definition.parentId === undefined ? {} : { parentId: definition.parentId }),
        framework,
        view,
      });
    } catch (error: unknown) {
      await this.lifecycle.dispose(owner);
      throw error;
    }
    if (
      instance === null
      || typeof instance !== "object"
      || instance.controller === null
      || typeof instance.controller !== "object"
      || typeof instance.controller.enter !== "function"
    ) {
      await this.lifecycle.dispose(owner);
      throw new TypeError(`Route "${definition.id}" factory must return { controller, model? }.`);
    }

    const node: RouteNode = {
      id: definition.id,
      type: definition.type,
      parentId: definition.parentId,
      owner,
      controller: instance.controller,
      model: instance.model,
    };
    this.active.set(definition.id, node);
    if (instance.model !== undefined) {
      this.routeModels.set(definition.id, instance.model);
      const disposable = instance.model as { dispose?: () => Promise<void> | void };
      if (typeof disposable.dispose === "function") {
        this.lifecycle.onDispose(owner, () => disposable.dispose?.());
      }
    }
    this.lifecycle.onDispose(owner, async () => instance.controller.leave?.());

    try {
      await instance.controller.enter(params);
      this.lifecycle.assertActive(owner);
      return node;
    } catch (error: unknown) {
      try {
        await this.lifecycle.dispose(owner);
      } catch (cleanupError: unknown) {
        throw composeFrameworkError(
          FrameworkErrorCode.RouteActivationFailed,
          [error, cleanupError],
          `Route "${definition.id}" activation cleanup failed.`,
        );
      }
      throw error;
    }
  }
}
