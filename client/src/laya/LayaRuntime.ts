import type { CrashRuntimeHooks, CrashStorage } from "../crash/CrashReporter";
import type { FrameDriver } from "../Framework";
import type { PerfDogFrameMetricsSource } from "../perfdog/PerfDogModule";
import { createUIViewportSnapshot, type UIViewportSource } from "./UIViewport";

interface LayaTimerRuntime {
  readonly delta: number;
  frameLoop(delay: number, caller: object, method: () => void): void;
  clear(caller: object, method: () => void): void;
}
interface LayaStageRuntime {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly width: number;
  readonly height: number;
  on(type: string, caller: object, listener: () => void): void;
  off(type: string, caller: object, listener: () => void): void;
}
interface LayaStatisticsContextRuntime {
  getElementData(element: number): number;
}
interface LayaGLRuntime {
  readonly statAgent?: LayaStatisticsContextRuntime;
}
interface LayaStatElementRuntime {
  readonly CT_DrawCall?: number;
  readonly CT_2DDrawCall?: number;
  readonly CT_3DDrawCall?: number;
}
interface LayaFrameRuntime {
  readonly timer: LayaTimerRuntime;
  readonly stage: LayaStageRuntime;
  readonly Event: { readonly RESIZE: string };
  readonly LayaGL?: LayaGLRuntime;
  readonly StatElement?: LayaStatElementRuntime;
}
declare const Laya: LayaFrameRuntime;

interface MiniGameUnhandledRejection { readonly reason?: unknown; }
interface MiniGameSafeArea {
  readonly left?: number;
  readonly top: number;
  readonly right?: number;
  readonly bottom: number;
}
interface MiniGameWindowInfo {
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly safeArea?: MiniGameSafeArea;
}
interface MiniGameRuntime {
  onError?(listener: (message: string) => void): void;
  offError?(listener: (message: string) => void): void;
  onUnhandledRejection?(listener: (event: MiniGameUnhandledRejection) => void): void;
  offUnhandledRejection?(listener: (event: MiniGameUnhandledRejection) => void): void;
  getStorageSync?(key: string): unknown;
  setStorageSync?(key: string, value: unknown): void;
  getWindowInfo?(): MiniGameWindowInfo;
  getSystemInfoSync?(): MiniGameWindowInfo;
}

interface BrowserErrorEventLike { readonly error?: unknown; readonly message?: string; }
interface BrowserRejectionEventLike { readonly reason?: unknown; }
interface BrowserStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface BrowserRuntime {
  addEventListener?(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
  readonly localStorage?: BrowserStorageLike;
}

type RuntimeGlobal = typeof globalThis & BrowserRuntime & {
  readonly wx?: MiniGameRuntime;
  readonly tt?: MiniGameRuntime;
  readonly Laya?: LayaFrameRuntime;
  readonly LayaGL?: LayaGLRuntime;
  readonly StatElement?: LayaStatElementRuntime;
};

const CRASH_STORAGE_KEY = "game-framework:crash-reports";

function runtimeGlobal(): RuntimeGlobal { return globalThis as RuntimeGlobal; }
function miniGameRuntime(): MiniGameRuntime | undefined {
  const runtime = runtimeGlobal();
  return runtime.wx ?? runtime.tt;
}

function readMiniGameWindowInfo(): MiniGameWindowInfo | undefined {
  const miniGame = miniGameRuntime();
  if (miniGame === undefined) return undefined;
  if (miniGame.getWindowInfo !== undefined) return miniGame.getWindowInfo();
  if (miniGame.getSystemInfoSync !== undefined) return miniGame.getSystemInfoSync();
  return undefined;
}

export function createLayaFrameDriver(): FrameDriver {
  return {
    start(tick): () => void {
      const caller = {};
      const frame = (): void => tick(Math.max(0, Laya.timer.delta) / 1000);
      Laya.timer.frameLoop(1, caller, frame);
      return () => Laya.timer.clear(caller, frame);
    },
  };
}

/** Reads Laya's engine statistics without enabling the on-screen Stat panel. */
export function createLayaPerfDogFrameMetricsSource(): PerfDogFrameMetricsSource {
  return {
    read: () => {
      const runtime = runtimeGlobal();
      const namespace = runtime.Laya ?? (typeof Laya === "undefined" ? undefined : Laya);
      const statAgent = namespace?.LayaGL?.statAgent ?? runtime.LayaGL?.statAgent;
      const elements = namespace?.StatElement ?? runtime.StatElement;
      if (statAgent === undefined || elements === undefined) return {};
      return {
        drawCalls: readStatElement(statAgent, elements.CT_DrawCall),
        drawCalls2D: readStatElement(statAgent, elements.CT_2DDrawCall),
        drawCalls3D: readStatElement(statAgent, elements.CT_3DDrawCall),
      };
    },
  };
}

export function createLayaViewportSource(): UIViewportSource {
  const stage = Laya.stage;
  return {
    read: () => {
      const windowInfo = readMiniGameWindowInfo();
      const safeArea = windowInfo?.safeArea;
      return createUIViewportSnapshot({
        designWidth: stage.designWidth,
        designHeight: stage.designHeight,
        stageWidth: stage.width,
        stageHeight: stage.height,
        windowWidth: safeArea === undefined ? undefined : windowInfo?.windowWidth,
        windowHeight: safeArea === undefined ? undefined : windowInfo?.windowHeight,
        safeLeft: safeArea?.left,
        safeTop: safeArea?.top,
        safeRight: safeArea?.right,
        safeBottom: safeArea?.bottom,
      });
    },
    subscribe(listener): () => void {
      const caller = {};
      stage.on(Laya.Event.RESIZE, caller, listener);
      return () => stage.off(Laya.Event.RESIZE, caller, listener);
    },
  };
}

export function createRuntimeCrashHooks(): CrashRuntimeHooks | undefined {
  const miniGame = miniGameRuntime();
  if (miniGame !== undefined) {
    return {
      onError: miniGame.onError === undefined ? undefined : (listener) => {
        const handler = (message: string): void => listener(new Error(message));
        miniGame.onError!(handler);
        return () => miniGame.offError?.(handler);
      },
      onUnhandledRejection: miniGame.onUnhandledRejection === undefined ? undefined : (listener) => {
        const handler = (event: MiniGameUnhandledRejection): void => listener(event.reason);
        miniGame.onUnhandledRejection!(handler);
        return () => miniGame.offUnhandledRejection?.(handler);
      },
    };
  }

  const browser = runtimeGlobal();
  if (browser.addEventListener === undefined || browser.removeEventListener === undefined) return undefined;
  return {
    onError: (listener) => {
      const handler = (event: unknown): void => {
        const value = event as BrowserErrorEventLike;
        listener(value.error instanceof Error ? value.error : new Error(value.message ?? "Unknown runtime error."));
      };
      browser.addEventListener!("error", handler);
      return () => browser.removeEventListener!("error", handler);
    },
    onUnhandledRejection: (listener) => {
      const handler = (event: unknown): void => listener((event as BrowserRejectionEventLike).reason);
      browser.addEventListener!("unhandledrejection", handler);
      return () => browser.removeEventListener!("unhandledrejection", handler);
    },
  };
}

export function createRuntimeCrashStorage(): CrashStorage | undefined {
  const miniGame = miniGameRuntime();
  if (miniGame?.getStorageSync !== undefined && miniGame.setStorageSync !== undefined) {
    return {
      read(): string | undefined {
        const value = miniGame.getStorageSync!(CRASH_STORAGE_KEY);
        if (value === undefined || value === null || value === "") return undefined;
        return typeof value === "string" ? value : JSON.stringify(value);
      },
      write(value: string): void { miniGame.setStorageSync!(CRASH_STORAGE_KEY, value); },
    };
  }

  try {
    const storage = runtimeGlobal().localStorage;
    if (storage === undefined) return undefined;
    return {
      read: () => storage.getItem(CRASH_STORAGE_KEY) ?? undefined,
      write: (value) => storage.setItem(CRASH_STORAGE_KEY, value),
    };
  } catch {
    return undefined;
  }
}

function readStatElement(statAgent: LayaStatisticsContextRuntime, element: number | undefined): number | undefined {
  if (element === undefined) return undefined;
  const value = statAgent.getElementData(element);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
