import type { AssetService } from "./asset/AssetModule";
import type { CrashReporterService } from "./crash/CrashReporter";
import type { EntityService } from "./entity/EntityModule";
import type { EventService } from "./event/EventModule";
import type { FsmModule } from "./fsm/FsmModule";
import type { ModuleService } from "./module/ModuleModule";
import type { PerfDogService } from "./perfdog/PerfDogModule";
import type { PoolService } from "./pool/PoolModule";
import type { RouteModelService, RouterService } from "./router/RouterModule";
import type { TimerService } from "./timer/TimerModule";
import type { UpdateService } from "./update/UpdateScheduler";
import type { UIService } from "./ui/UIModule";
import type { WasmCapability } from "./wasm/WasmCapability";

export interface FrameworkAccess {
  readonly assets: AssetService;
  readonly crash: CrashReporterService;
  readonly entities: EntityService;
  readonly events: EventService;
  readonly fsm: FsmModule;
  readonly modules: ModuleService;
  readonly perfdog: PerfDogService;
  readonly pools: PoolService;
  readonly timer: TimerService;
  readonly update: UpdateService;
  readonly ui: UIService;
  readonly router: RouterService;
  readonly models: RouteModelService;
  readonly wasm: WasmCapability;
}
