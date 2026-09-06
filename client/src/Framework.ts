import { AssetModule, type AssetBackend, type AssetService } from "./asset/AssetModule";
import {
  CrashReporter,
  type CrashReporterService,
  type CrashRuntimeHooks,
  type CrashStorage,
} from "./crash/CrashReporter";
import { EntityModule, type EntityService } from "./entity/EntityModule";
import { FrameworkError, FrameworkErrorCode } from "./error/FrameworkError";
import { EventModule, type EventService } from "./event/EventModule";
import { FsmModule, type FsmEvent } from "./fsm/FsmModule";
import type { FrameworkAccess } from "./FrameworkAccess";
import { LifecycleModule, type LifecycleOwner } from "./lifecycle/LifecycleModule";
import { ModuleModule, type FrameworkModule, type ModuleService } from "./module/ModuleModule";
import { PackageModule, type PackageBackend } from "./package/PackageModule";
import { PerfDogModule, type PerfDogModuleOptions, type PerfDogService } from "./perfdog/PerfDogModule";
import { PoolModule, type PoolService } from "./pool/PoolModule";
import {
  RouterModule,
  type RouteModelService,
  type RoutePrefabMounter,
  type RouterEvent,
  type RouterService,
} from "./router/RouterModule";
import { TimerModule, type TimerService } from "./timer/TimerModule";
import { UpdateScheduler, type UpdateService } from "./update/UpdateScheduler";
import { UIModule, type UIBackend, type UIService } from "./ui/UIModule";
import { createWasmCapability, type WasmCapability } from "./wasm/WasmCapability";

export const FrameworkStatus = {
  Created: "Created",
  Active: "Active",
  Disposed: "Disposed",
} as const;
export type FrameworkStatus = (typeof FrameworkStatus)[keyof typeof FrameworkStatus];

export interface FrameDriver {
  start(tick: (deltaTimeSeconds: number) => void): () => void;
}

export interface FrameworkOptions {
  readonly packageBackend: PackageBackend;
  readonly assetBackend: AssetBackend;
  readonly uiBackend: UIBackend;
  readonly crashStorage?: CrashStorage;
  readonly crashHooks?: CrashRuntimeHooks;
  readonly frameDriver?: FrameDriver;
  readonly version?: string;
  /** Framework-owned performance monitor configuration. Set false to keep it disabled. */
  readonly perfDog?: PerfDogModuleOptions | false;
  /** Application-supplied modules registered into the framework lifecycle. */
  readonly modules?: readonly FrameworkModule[];
}

export class Framework {
  private currentStatus: FrameworkStatus = FrameworkStatus.Created;
  private readonly lifecycle = new LifecycleModule();
  private readonly assetModule: AssetModule;
  private readonly crashReporter: CrashReporter;
  private readonly eventModule = new EventModule();
  private readonly timerModule = new TimerModule();
  private readonly updateScheduler: UpdateScheduler;
  private readonly fsmModule: FsmModule;
  private readonly moduleModule = new ModuleModule();
  private readonly perfDogModule: PerfDogModule;
  private readonly poolModule = new PoolModule();
  private readonly entityModule = new EntityModule(this.poolModule);
  private readonly uiModule: UIModule;
  private readonly routerModule: RouterModule;
  private readonly packageModule: PackageModule;
  private readonly frameDriver?: FrameDriver;
  private readonly version: string;
  private appOwner?: LifecycleOwner;
  private appAccess?: FrameworkAccess;
  private stopFrameDriver?: () => void;

  public constructor(options: FrameworkOptions) {
    this.assetModule = new AssetModule(options.assetBackend);
    this.crashReporter = new CrashReporter(options.crashStorage, options.crashHooks);
    this.version = options.version ?? "unknown";
    this.frameDriver = options.frameDriver;
    this.updateScheduler = new UpdateScheduler(1 / 60, 5, (error, phase) => {
      this.crashReporter.capture(error, { subsystem: "update", phase });
    });
    this.fsmModule = new FsmModule((event) => this.observeFsm(event));
    this.uiModule = new UIModule(options.uiBackend);
    this.perfDogModule = new PerfDogModule(options.perfDog === false ? undefined : options.perfDog);

    const bind = (owner: LifecycleOwner): FrameworkAccess => this.bind(owner);
    const mountPrefab: RoutePrefabMounter = (owner, binding, prefab) => {
      const assertActive = (): void => this.lifecycle.assertActive(owner);
      assertActive();
      const assets = this.assetModule.bind(owner, assertActive);
      return this.uiModule.mountRoutePrefab(
        owner,
        assertActive,
        binding,
        assets,
        prefab.path,
        prefab.runtime,
      );
    };
    this.routerModule = new RouterModule(
      this.lifecycle,
      bind,
      mountPrefab,
      (event) => this.observeRouter(event),
      (error) => this.throwToRuntime(error),
    );
    this.packageModule = new PackageModule(
      this.lifecycle,
      this.routerModule,
      options.packageBackend,
      () => this.requireAppOwner(),
      bind,
    );

    this.lifecycle.registerParticipant(this.assetModule);
    this.lifecycle.registerParticipant(this.eventModule);
    this.lifecycle.registerParticipant(this.timerModule);
    this.lifecycle.registerParticipant(this.updateScheduler);
    this.lifecycle.registerParticipant(this.entityModule);
    this.lifecycle.registerParticipant(this.poolModule);
    this.lifecycle.registerParticipant(this.uiModule);
    this.lifecycle.registerParticipant(this.routerModule);

    // PerfDog is framework-owned and enabled by default. Application modules are
    // appended after it and may depend on PERF_DOG_MODULE_ID when it is enabled.
    if (options.perfDog !== false) this.moduleModule.register(this.perfDogModule);
    for (const module of options.modules ?? []) this.moduleModule.register(module);

    this.crashReporter.setContextProvider(() => ({
      version: this.version,
      route: this.tryCurrentRoute(),
      extras: { frameworkStatus: this.currentStatus },
    }));
  }

  public get status(): FrameworkStatus { return this.currentStatus; }
  public get packages(): PackageModule { this.requireActive(); return this.packageModule; }
  public get assets(): AssetService { return this.requireAppAccess().assets; }
  public get crash(): CrashReporterService { return this.requireAppAccess().crash; }
  public get entities(): EntityService { return this.requireAppAccess().entities; }
  public get events(): EventService { return this.requireAppAccess().events; }
  public get fsm(): FsmModule { return this.requireAppAccess().fsm; }
  public get modules(): ModuleService { return this.requireAppAccess().modules; }
  public get perfdog(): PerfDogService { this.requireActive(); return this.perfDogModule; }
  public get pools(): PoolService { return this.requireAppAccess().pools; }
  public get timer(): TimerService { return this.requireAppAccess().timer; }
  public get update(): UpdateService { return this.requireAppAccess().update; }
  public get ui(): UIService { return this.requireAppAccess().ui; }
  public get router(): RouterService { return this.requireAppAccess().router; }
  public get models(): RouteModelService { return this.requireAppAccess().models; }
  public get wasm(): WasmCapability { return this.requireAppAccess().wasm; }

  public registerModule(module: FrameworkModule): this {
    if (this.currentStatus !== FrameworkStatus.Created) {
      throw new FrameworkError(
        FrameworkErrorCode.InvalidState,
        `Framework modules cannot be registered from status ${this.currentStatus}.`,
      );
    }
    this.moduleModule.register(module);
    return this;
  }

  public async start(): Promise<void> {
    if (this.currentStatus !== FrameworkStatus.Created) {
      throw new FrameworkError(
        FrameworkErrorCode.InvalidState,
        `Framework cannot start from status ${this.currentStatus}.`,
      );
    }

    this.crashReporter.installGlobalHandlers();
    try {
      this.appOwner = this.lifecycle.createAppScope();
      this.appAccess = this.bind(this.appOwner);
      this.currentStatus = FrameworkStatus.Active;
      await this.moduleModule.start(this.appAccess);
      this.crashReporter.breadcrumb("framework", "Framework started.");
      if (this.frameDriver !== undefined) {
        this.stopFrameDriver = this.frameDriver.start((deltaTimeSeconds) => {
          try {
            this.tick(deltaTimeSeconds);
          } catch (error: unknown) {
            this.crashReporter.capture(error, { subsystem: "frame-driver" });
            throw error;
          }
        });
      }
    } catch (error: unknown) {
      this.crashReporter.capture(error, { subsystem: "framework", operation: "start" });
      const cleanupErrors: unknown[] = [];
      try { await this.moduleModule.shutdown(); } catch (cleanupError: unknown) { cleanupErrors.push(cleanupError); }
      const owner = this.appOwner;
      this.appAccess = undefined;
      this.appOwner = undefined;
      if (owner !== undefined) {
        try { await this.lifecycle.dispose(owner); } catch (cleanupError: unknown) { cleanupErrors.push(cleanupError); }
      }
      this.currentStatus = FrameworkStatus.Disposed;
      this.crashReporter.dispose();
      if (cleanupErrors.length > 0) {
        throw new FrameworkError(
          FrameworkErrorCode.InvalidState,
          "Framework startup and rollback both failed.",
          { cause: error, context: { cleanupErrors } },
        );
      }
      throw error;
    }
  }

  public tick(deltaTime: number): void {
    this.requireActive();
    this.updateScheduler.tick(deltaTime);
  }

  public async shutdown(): Promise<void> {
    if (this.currentStatus === FrameworkStatus.Disposed) return;
    const errors: unknown[] = [];

    const stopFrameDriver = this.stopFrameDriver;
    this.stopFrameDriver = undefined;
    if (stopFrameDriver !== undefined) {
      try { stopFrameDriver(); } catch (error: unknown) { errors.push(error); }
    }

    try { await this.moduleModule.shutdown(); } catch (error: unknown) { errors.push(error); }

    const appOwner = this.appOwner;
    this.appAccess = undefined;
    this.appOwner = undefined;
    if (appOwner !== undefined) {
      try { await this.lifecycle.dispose(appOwner); } catch (error: unknown) { errors.push(error); }
    }

    this.currentStatus = FrameworkStatus.Disposed;
    this.crashReporter.breadcrumb("framework", "Framework disposed.");
    this.crashReporter.dispose();

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new FrameworkError(
        FrameworkErrorCode.InvalidState,
        "Framework shutdown failed.",
        { cause: errors[0], context: { errors } },
      );
    }
  }

  private bind(owner: LifecycleOwner): FrameworkAccess {
    const assertActive = (): void => this.lifecycle.assertActive(owner);
    assertActive();
    const assets = this.assetModule.bind(owner, assertActive);
    return Object.freeze({
      assets,
      crash: this.crashReporter,
      entities: this.entityModule.bind(owner, assertActive, assets),
      events: this.eventModule.bind(owner, assertActive),
      fsm: this.fsmModule,
      modules: this.moduleModule.bind(assertActive),
      perfdog: this.perfDogModule,
      pools: this.poolModule.bind(owner, assertActive),
      timer: this.timerModule.bind(owner, assertActive),
      update: this.updateScheduler.bind(owner, assertActive),
      ui: this.uiModule.bind(owner, assertActive),
      router: this.routerModule.bind(owner),
      models: this.routerModule.bindModels(owner),
      wasm: createWasmCapability((wasmUrl) => assets.loadBytes(wasmUrl)),
    });
  }

  private observeRouter(event: RouterEvent): void {
    const data = event.id === undefined ? undefined : { route: event.id };
    this.crashReporter.breadcrumb("router", `${event.operation}:${event.type.replace("navigation-", "")}`, data);
    if (event.type === "navigation-failed" && event.error !== undefined) {
      this.crashReporter.capture(
        event.error,
        { subsystem: "router", operation: event.operation, ...(data ?? {}) },
      );
    }
  }

  private throwToRuntime(error: unknown): void {
    setTimeout(() => { throw error; }, 0);
  }

  private observeFsm(event: FsmEvent): void {
    const data = {
      from: event.from === undefined ? undefined : String(event.from),
      to: String(event.to),
      type: event.type,
    };
    this.crashReporter.breadcrumb("fsm", event.type, data);
    if (event.error !== undefined) this.crashReporter.capture(event.error, { subsystem: "fsm", ...data });
  }

  private tryCurrentRoute(): string | undefined {
    if (this.appAccess === undefined || this.currentStatus !== FrameworkStatus.Active) return undefined;
    try {
      return this.appAccess.router.current();
    } catch (error: unknown) {
      this.crashReporter.breadcrumb("framework", "current route unavailable", { error: String(error) });
      return undefined;
    }
  }

  private requireAppOwner(): LifecycleOwner {
    this.requireActive();
    if (this.appOwner === undefined) {
      throw new FrameworkError(FrameworkErrorCode.InvalidState, "Framework AppScope is not available.");
    }
    return this.appOwner;
  }

  private requireAppAccess(): FrameworkAccess {
    this.requireActive();
    if (this.appAccess === undefined) {
      throw new FrameworkError(FrameworkErrorCode.InvalidState, "Framework app access is not available.");
    }
    return this.appAccess;
  }

  private requireActive(): void {
    if (this.currentStatus !== FrameworkStatus.Active) {
      throw new FrameworkError(
        FrameworkErrorCode.InvalidState,
        `Framework operation requires Active status, got ${this.currentStatus}.`,
      );
    }
  }
}

export function createFramework(options: FrameworkOptions): Framework {
  return new Framework(options);
}
