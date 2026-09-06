import type { FrameworkAccess } from "../FrameworkAccess";
import { composeFrameworkError, FrameworkErrorCode } from "../error/FrameworkError";
import type { LifecycleModule, LifecycleOwner } from "../lifecycle/LifecycleModule";
import type { RouterModule } from "../router/RouterModule";
import { getPackageInstaller, type PackageHandle } from "./PackageEntry";
import type { PackageId } from "./PackageId";

export interface PackageDefinition {
  readonly id: PackageId;
  readonly path: string;
}

export interface PackageBackend {
  load(path: string): Promise<void>;
}

interface LoadedPackage {
  readonly owner: LifecycleOwner;
}

interface PackageOperation {
  readonly kind: "load" | "unload";
  readonly promise: Promise<void>;
}

export class PackageModule {
  private readonly definitions = new Map<PackageId, PackageDefinition>();
  private readonly loaded = new Map<PackageId, LoadedPackage>();
  private readonly operations = new Map<PackageId, PackageOperation>();

  public constructor(
    private readonly lifecycle: LifecycleModule,
    private readonly router: RouterModule,
    private readonly backend: PackageBackend,
    private readonly getAppOwner: () => LifecycleOwner,
    private readonly bindFramework: (owner: LifecycleOwner) => FrameworkAccess,
  ) {}

  public define(definition: PackageDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Package "${definition.id}" is already defined.`);
    }
    if (definition.path.length === 0 || definition.path.trim() !== definition.path) {
      throw new Error(`Package "${definition.id}" path must be a non-empty trimmed string.`);
    }
    this.definitions.set(definition.id, definition);
  }

  public isLoaded(id: PackageId): boolean {
    return this.loaded.has(id);
  }

  public load(id: PackageId): Promise<void> {
    const current = this.operations.get(id);
    if (current?.kind === "load") return current.promise;
    if (current === undefined && this.loaded.has(id)) return Promise.resolve();
    return this.enqueue(id, "load", async () => {
      if (this.loaded.has(id)) return;
      await this.performLoad(id);
    });
  }

  public unload(id: PackageId): Promise<void> {
    const current = this.operations.get(id);
    if (current?.kind === "unload") return current.promise;
    if (current === undefined && !this.loaded.has(id)) return Promise.resolve();
    return this.enqueue(id, "unload", async () => {
      const record = this.loaded.get(id);
      if (record === undefined) return;
      await this.lifecycle.dispose(record.owner);
    });
  }

  private enqueue(
    id: PackageId,
    kind: PackageOperation["kind"],
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.operations.get(id)?.promise ?? Promise.resolve();
    const request = previous
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        if (this.operations.get(id)?.promise === request) this.operations.delete(id);
      });
    this.operations.set(id, { kind, promise: request });
    return request;
  }

  private async performLoad(id: PackageId): Promise<void> {
    const definition = this.definitions.get(id);
    if (definition === undefined) {
      throw new Error(`Package "${id}" is not defined.`);
    }

    const owner = this.lifecycle.createPackageScope(this.getAppOwner(), id);
    try {
      await this.backend.load(definition.path);
      const installer = getPackageInstaller(id);
      if (installer === undefined) {
        throw new Error(`Package "${id}" loaded but did not publish an installer.`);
      }

      const handle: PackageHandle | void = await installer({
        framework: this.bindFramework(owner),
        routes: this.router.createRegistrar(owner),
      });
      this.lifecycle.onDispose(owner, () => {
        this.loaded.delete(id);
      });
      if (handle !== undefined) {
        this.lifecycle.onDispose(owner, () => handle.dispose());
      }
      this.loaded.set(id, { owner });
    } catch (error: unknown) {
      try {
        await this.lifecycle.dispose(owner);
      } catch (cleanupError: unknown) {
        throw composeFrameworkError(
          FrameworkErrorCode.PackageLoadFailed,
          [error, cleanupError],
          `Package "${id}" load cleanup failed.`,
        );
      }
      throw error;
    }
  }
}
