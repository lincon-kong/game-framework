import { FrameworkError, FrameworkErrorCode } from "../error/FrameworkError";

export type LifecycleKind = "app" | "package" | "route";

export interface LifecycleOwner {
  readonly id: number;
  readonly kind: LifecycleKind;
  readonly key: string;
}

export interface LifecycleParticipant {
  disposeOwner(owner: LifecycleOwner): Promise<void> | void;
}

type Cleanup = () => Promise<void> | void;

interface LifecycleNode extends LifecycleOwner {
  readonly parent?: LifecycleNode;
  readonly children: Set<LifecycleNode>;
  readonly cleanups: Cleanup[];
  disposing: boolean;
  disposed: boolean;
  disposeInFlight?: Promise<void>;
}

export class LifecycleModule {
  private readonly participants = new Set<LifecycleParticipant>();
  private readonly nodes = new Map<number, LifecycleNode>();
  private nextId = 1;
  private appOwner?: LifecycleNode;

  public registerParticipant(participant: LifecycleParticipant): void {
    this.participants.add(participant);
  }

  public createAppScope(): LifecycleOwner {
    if (this.appOwner !== undefined && !this.appOwner.disposed) {
      throw new FrameworkError(FrameworkErrorCode.LifecycleConflict, "Lifecycle AppScope already exists.");
    }
    const owner = this.createNode("app", "app");
    this.appOwner = owner;
    return owner;
  }

  public createPackageScope(parent: LifecycleOwner, packageId: string): LifecycleOwner {
    const parentNode = this.requireActiveNode(parent);
    if (parentNode.kind !== "app") {
      throw new FrameworkError(FrameworkErrorCode.LifecycleInvalidParent, "PackageScope parent must be AppScope.");
    }
    return this.createNode("package", packageId, parentNode);
  }

  public createRouteScope(parent: LifecycleOwner, routeId: string): LifecycleOwner {
    const parentNode = this.requireActiveNode(parent);
    if (parentNode.kind !== "package" && parentNode.kind !== "route") {
      throw new FrameworkError(
        FrameworkErrorCode.LifecycleInvalidParent,
        "RouteScope parent must be PackageScope or RouteScope.",
      );
    }
    return this.createNode("route", routeId, parentNode);
  }

  public onDispose(owner: LifecycleOwner, cleanup: Cleanup): void {
    this.requireActiveNode(owner).cleanups.push(cleanup);
  }

  public assertActive(owner: LifecycleOwner): void {
    this.requireActiveNode(owner);
  }

  public dispose(owner: LifecycleOwner): Promise<void> {
    const node = this.nodes.get(owner.id);
    if (node === undefined || node.disposed) return Promise.resolve();
    if (node.disposeInFlight !== undefined) return node.disposeInFlight;
    node.disposing = true;
    const request = this.disposeNode(node).finally(() => {
      if (node.disposeInFlight === request) node.disposeInFlight = undefined;
    });
    node.disposeInFlight = request;
    return request;
  }

  private createNode(kind: LifecycleKind, key: string, parent?: LifecycleNode): LifecycleNode {
    const node: LifecycleNode = {
      id: this.nextId++, kind, key, parent,
      children: new Set(), cleanups: [], disposing: false, disposed: false,
    };
    parent?.children.add(node);
    this.nodes.set(node.id, node);
    return node;
  }

  private requireActiveNode(owner: LifecycleOwner): LifecycleNode {
    const node = this.nodes.get(owner.id);
    if (node === undefined || node.disposed || node.disposing) {
      throw new FrameworkError(
        FrameworkErrorCode.LifecycleOwnerInactive,
        `${owner.kind} scope "${owner.key}" is not active.`,
      );
    }
    return node;
  }

  private async disposeNode(node: LifecycleNode): Promise<void> {
    const errors: unknown[] = [];
    for (const child of [...node.children].reverse()) {
      try { await this.dispose(child); } catch (error: unknown) { errors.push(error); }
    }
    for (const cleanup of [...node.cleanups].reverse()) {
      try { await cleanup(); } catch (error: unknown) { errors.push(error); }
    }
    node.cleanups.length = 0;
    for (const participant of this.participants) {
      try { await participant.disposeOwner(node); } catch (error: unknown) { errors.push(error); }
    }
    node.disposed = true;
    node.parent?.children.delete(node);
    node.children.clear();
    this.nodes.delete(node.id);
    if (this.appOwner === node) this.appOwner = undefined;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new FrameworkError(
        FrameworkErrorCode.InvalidState,
        `Failed to dispose ${node.kind} scope "${node.key}".`,
        { cause: errors[0], context: { errors } },
      );
    }
  }
}
