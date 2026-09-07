import { composeFrameworkError, FrameworkError, FrameworkErrorCode } from "../error/FrameworkError";
import type { FrameworkAccess } from "../FrameworkAccess";
import { UpdatePhase, type UpdateRegistration } from "../update/UpdateScheduler";

export interface FrameworkModuleDescriptor {
  readonly id: string;
  readonly dependencies?: readonly string[];
  readonly updatePhase?: UpdatePhase;
  readonly updatePriority?: number;
}

export interface FrameworkModuleContext {
  readonly framework: FrameworkAccess;
  readonly signal: AbortSignal;
}

export interface FrameworkModule {
  readonly descriptor: FrameworkModuleDescriptor;
  initialize?(context: FrameworkModuleContext): Promise<void> | void;
  update?(deltaTime: number): void;
  shutdown?(context: FrameworkModuleContext): Promise<void> | void;
}

export interface ModuleService {
  ids(): readonly string[];
  has(id: string): boolean;
  get<T extends FrameworkModule = FrameworkModule>(id: string): T;
  tryGet<T extends FrameworkModule = FrameworkModule>(id: string): T | undefined;
}

interface ManagedModule {
  readonly module: FrameworkModule;
  readonly abortController: AbortController;
  readonly context: FrameworkModuleContext;
  updateRegistration?: UpdateRegistration;
  initialized: boolean;
}

/** App-scope registry for framework extensions supplied by the application layer. */
export class ModuleModule {
  private readonly registered = new Map<string, FrameworkModule>();
  private readonly active = new Map<string, ManagedModule>();
  private readonly activeOrder: string[] = [];
  private started = false;

  public register(module: FrameworkModule): void {
    if (this.started) {
      throw new FrameworkError(FrameworkErrorCode.InvalidState, "Framework modules must be registered before Framework.start().");
    }
    const rawId = module.descriptor.id;
    const id = rawId.trim();
    if (id.length === 0) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, "Framework module id must not be empty.");
    }
    if (id !== rawId) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, "Framework module id must not contain surrounding whitespace.");
    }
    if (this.registered.has(id)) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, `Duplicate framework module: ${id}.`);
    }
    const priority = module.descriptor.updatePriority;
    if (priority !== undefined && !Number.isFinite(priority)) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, `Framework module ${id} has a non-finite update priority.`);
    }
    this.registered.set(id, module);
  }

  public bind(assertActive: () => void): ModuleService {
    return Object.freeze({
      ids: () => { assertActive(); return this.activeOrder.slice(); },
      has: (id: string) => { assertActive(); return this.active.has(id); },
      get: <T extends FrameworkModule>(id: string) => {
        assertActive();
        const managed = this.active.get(id);
        if (managed === undefined) {
          throw new FrameworkError(FrameworkErrorCode.InvalidArgument, `Unknown framework module: ${id}.`);
        }
        return managed.module as T;
      },
      tryGet: <T extends FrameworkModule>(id: string) => {
        assertActive();
        return this.active.get(id)?.module as T | undefined;
      },
    });
  }

  public async start(framework: FrameworkAccess): Promise<void> {
    if (this.started) {
      throw new FrameworkError(FrameworkErrorCode.InvalidState, "Framework modules are already started.");
    }
    this.started = true;
    try {
      const order = this.resolveOrder();
      for (const module of order) {
        const abortController = new AbortController();
        const context: FrameworkModuleContext = Object.freeze({ framework, signal: abortController.signal });
        const managed: ManagedModule = { module, abortController, context, initialized: true };
        this.active.set(module.descriptor.id, managed);
        this.activeOrder.push(module.descriptor.id);
        await module.initialize?.(context);
        if (module.update !== undefined) {
          managed.updateRegistration = framework.update.schedule(
            module.descriptor.updatePhase ?? UpdatePhase.Update,
            (deltaTime) => module.update?.(deltaTime),
            module.descriptor.updatePriority ?? 0,
          );
        }
      }
    } catch (error: unknown) {
      let rollbackError: unknown;
      try { await this.shutdown(); } catch (cleanupError: unknown) { rollbackError = cleanupError; }
      if (rollbackError !== undefined) {
        throw composeFrameworkError(
          FrameworkErrorCode.InvalidState,
          [error, rollbackError],
          "Framework module initialization rollback failed.",
        );
      }
      if (error instanceof FrameworkError) throw error;
      throw new FrameworkError(FrameworkErrorCode.InvalidState, "Framework module initialization failed.", { cause: error });
    }
  }

  public async shutdown(): Promise<void> {
    if (!this.started) return;
    const errors: unknown[] = [];
    for (const id of this.activeOrder.slice().reverse()) {
      const managed = this.active.get(id);
      if (managed === undefined) continue;
      managed.updateRegistration?.cancel();
      managed.updateRegistration = undefined;
      managed.abortController.abort();
      if (managed.initialized) {
        try { await managed.module.shutdown?.(managed.context); } catch (error: unknown) { errors.push(error); }
      }
      this.active.delete(id);
    }
    this.activeOrder.length = 0;
    this.started = false;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new FrameworkError(FrameworkErrorCode.InvalidState, "Framework module shutdown failed.", {
        cause: errors[0],
        context: { errors },
      });
    }
  }

  private resolveOrder(): FrameworkModule[] {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const order: FrameworkModule[] = [];
    const stack: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        const start = stack.indexOf(id);
        const cycle = [...stack.slice(start), id];
        throw new FrameworkError(FrameworkErrorCode.InvalidArgument, `Framework module dependency cycle: ${cycle.join(" -> ")}.`);
      }
      const module = this.registered.get(id);
      if (module === undefined) {
        throw new FrameworkError(FrameworkErrorCode.InvalidArgument, `Missing framework module dependency: ${id}.`);
      }
      visiting.add(id);
      stack.push(id);
      for (const dependency of module.descriptor.dependencies ?? []) visit(dependency);
      stack.pop();
      visiting.delete(id);
      visited.add(id);
      order.push(module);
    };

    for (const id of this.registered.keys()) visit(id);
    return order;
  }
}
