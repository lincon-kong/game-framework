import type { FrameworkModule, FrameworkModuleContext, FrameworkModuleDescriptor } from "../module/ModuleModule";
import { UpdatePhase } from "../update/UpdateScheduler";

export const PERF_DOG_MODULE_ID = "perfdog";

export interface PerfDogSink {
  enable?(): void;
  disable?(): void;
  postValueF?(category: string, key: string, ...values: readonly number[]): void;
  postValueI?(category: string, key: string, ...values: readonly number[]): void;
  postValueS?(category: string, key: string, value: string): void;
  setLabel?(name: string): void;
  addNote?(name: string): void;
}

export interface PerfDogFrameMetrics {
  readonly drawCalls?: number;
  readonly drawCalls2D?: number;
  readonly drawCalls3D?: number;
}

/** Engine adapter used by the framework-owned PerfDog module for render metrics. */
export interface PerfDogFrameMetricsSource {
  read(): PerfDogFrameMetrics;
}

export interface PerfDogModuleOptions {
  readonly sink?: PerfDogSink;
  readonly metricsSource?: PerfDogFrameMetricsSource;
  readonly category?: string;
  readonly sampleWindowSize?: number;
  readonly publishIntervalSeconds?: number;
  readonly updatePriority?: number;
}

export interface PerfDogSnapshot {
  readonly fps: number;
  readonly frameTime: number;
  readonly frameTimeP95: number;
  readonly frameTimeP99: number;
  readonly drawCalls?: number;
  readonly drawCalls2D?: number;
  readonly drawCalls3D?: number;
}

export interface PerfDogCounterSnapshot {
  readonly name: string;
  readonly value: number;
}

export interface PerfDogTimingSnapshot {
  readonly name: string;
  readonly duration: number;
  readonly count: number;
  readonly average: number;
}

export interface PerfDogService {
  getSnapshot(): PerfDogSnapshot;
  readonly lastSinkError: unknown;
  readonly lastMetricsError: unknown;
  getCounters(): readonly PerfDogCounterSnapshot[];
  setCounter(name: string, value: number): void;
  incrementCounter(name: string, value?: number): void;
  startTiming(name: string): () => void;
  getTimings(): readonly PerfDogTimingSnapshot[];
  postValue(category: string, key: string, ...values: readonly number[]): void;
  postInteger(category: string, key: string, ...values: readonly number[]): void;
  postText(category: string, key: string, value: string): void;
  setLabel(name: string): void;
  addNote(name: string): void;
  reset(): void;
}

/**
 * Framework-owned performance monitoring module inspired by the profiler in ts-game-framework.
 * Frame metrics are collected locally and can optionally be forwarded to a native/platform PerfDog sink.
 */
export class PerfDogModule implements FrameworkModule, PerfDogService {
  public readonly descriptor: FrameworkModuleDescriptor;

  private readonly sink?: PerfDogSink;
  private readonly metricsSource?: PerfDogFrameMetricsSource;
  private readonly category: string;
  private readonly sampleWindowSize: number;
  private readonly publishIntervalSeconds: number;
  private readonly frameTimeSamples: number[] = [];
  private readonly counters = new Map<string, number>();
  private readonly timings = new Map<string, { total: number; count: number }>();
  private fps = 0;
  private fpsFrameCount = 0;
  private fpsElapsed = 0;
  private publishElapsed = 0;
  private currentFrameMetrics: PerfDogFrameMetrics = {};
  private sinkEnabled = false;
  private sinkError?: unknown;
  private metricsError?: unknown;

  public constructor(options: PerfDogModuleOptions = {}) {
    this.sink = options.sink;
    this.metricsSource = options.metricsSource;
    this.category = options.category ?? "Game";
    this.sampleWindowSize = options.sampleWindowSize ?? 300;
    this.publishIntervalSeconds = options.publishIntervalSeconds ?? 1;
    if (!Number.isSafeInteger(this.sampleWindowSize) || this.sampleWindowSize <= 0) {
      throw new Error("PerfDog sampleWindowSize must be a positive safe integer.");
    }
    if (!Number.isFinite(this.publishIntervalSeconds) || this.publishIntervalSeconds <= 0) {
      throw new Error("PerfDog publishIntervalSeconds must be greater than zero.");
    }
    const updatePriority = options.updatePriority ?? -10_000;
    if (!Number.isFinite(updatePriority)) throw new Error("PerfDog updatePriority must be finite.");
    this.descriptor = Object.freeze({
      id: PERF_DOG_MODULE_ID,
      updatePhase: UpdatePhase.PreUpdate,
      updatePriority,
    });
  }

  public initialize(_context: FrameworkModuleContext): void {
    this.reset();
    if (this.sink === undefined) return;
    this.invokeSink(() => this.sink?.enable?.());
    this.sinkEnabled = this.sinkError === undefined;
  }

  public update(deltaTime: number): void {
    const frameTime = deltaTime * 1000;
    this.frameTimeSamples.push(frameTime);
    if (this.frameTimeSamples.length > this.sampleWindowSize) this.frameTimeSamples.shift();
    this.readFrameMetrics();

    this.fpsElapsed += deltaTime;
    this.fpsFrameCount += 1;
    if (this.fpsElapsed >= 1) {
      this.fps = this.fpsFrameCount / this.fpsElapsed;
      this.fpsElapsed = 0;
      this.fpsFrameCount = 0;
    }

    this.publishElapsed += deltaTime;
    if (this.publishElapsed >= this.publishIntervalSeconds) {
      this.publishElapsed %= this.publishIntervalSeconds;
      this.publishSnapshot();
    }
  }

  public shutdown(_context: FrameworkModuleContext): void {
    if (this.sinkEnabled) this.invokeSink(() => this.sink?.disable?.());
    this.sinkEnabled = false;
    this.reset();
  }

  public getSnapshot(): PerfDogSnapshot {
    const frameTime = this.frameTimeSamples[this.frameTimeSamples.length - 1] ?? 0;
    const sorted = [...this.frameTimeSamples].sort((left, right) => left - right);
    return {
      fps: this.fps,
      frameTime,
      frameTimeP95: percentile(sorted, 0.95),
      frameTimeP99: percentile(sorted, 0.99),
      ...this.currentFrameMetrics,
    };
  }

  public get lastSinkError(): unknown { return this.sinkError; }
  public get lastMetricsError(): unknown { return this.metricsError; }

  public getCounters(): readonly PerfDogCounterSnapshot[] {
    return Array.from(this.counters, ([name, value]) => ({ name, value }));
  }

  public setCounter(name: string, value: number): void {
    this.assertMetric(name, value);
    this.counters.set(name, value);
  }

  public incrementCounter(name: string, value = 1): void {
    this.assertMetric(name, value);
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  public startTiming(name: string): () => void {
    if (name.length === 0) throw new Error("PerfDog timing name must not be empty.");
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      const existing = this.timings.get(name);
      if (existing === undefined) this.timings.set(name, { total: duration, count: 1 });
      else {
        existing.total += duration;
        existing.count += 1;
      }
    };
  }

  public getTimings(): readonly PerfDogTimingSnapshot[] {
    return Array.from(this.timings, ([name, data]) => ({
      name,
      duration: data.total,
      count: data.count,
      average: data.count === 0 ? 0 : data.total / data.count,
    }));
  }

  public postValue(category: string, key: string, ...values: readonly number[]): void {
    this.assertValues(category, key, values);
    this.invokeSink(() => this.sink?.postValueF?.(category, key, ...values));
  }

  public postInteger(category: string, key: string, ...values: readonly number[]): void {
    this.assertValues(category, key, values);
    if (!values.every(Number.isSafeInteger)) throw new Error("PerfDog integer values must be safe integers.");
    this.invokeSink(() => this.sink?.postValueI?.(category, key, ...values));
  }

  public postText(category: string, key: string, value: string): void {
    if (category.length === 0 || key.length === 0) throw new Error("PerfDog category and key must not be empty.");
    this.invokeSink(() => this.sink?.postValueS?.(category, key, value));
  }

  public setLabel(name: string): void {
    if (name.length === 0) throw new Error("PerfDog label must not be empty.");
    this.invokeSink(() => this.sink?.setLabel?.(name));
  }

  public addNote(name: string): void {
    if (name.length === 0) throw new Error("PerfDog note must not be empty.");
    this.invokeSink(() => this.sink?.addNote?.(name));
  }

  public reset(): void {
    this.frameTimeSamples.length = 0;
    this.counters.clear();
    this.timings.clear();
    this.fps = 0;
    this.fpsFrameCount = 0;
    this.fpsElapsed = 0;
    this.publishElapsed = 0;
    this.currentFrameMetrics = {};
    this.sinkError = undefined;
    this.metricsError = undefined;
  }

  private readFrameMetrics(): void {
    if (this.metricsSource === undefined) return;
    try {
      const metrics = this.metricsSource.read();
      this.currentFrameMetrics = {
        drawCalls: finiteMetric(metrics.drawCalls),
        drawCalls2D: finiteMetric(metrics.drawCalls2D),
        drawCalls3D: finiteMetric(metrics.drawCalls3D),
      };
      this.metricsError = undefined;
    } catch (error: unknown) {
      this.metricsError = error;
    }
  }

  private publishSnapshot(): void {
    if (!this.sinkEnabled) return;
    const snapshot = this.getSnapshot();
    this.invokeSink(() => this.sink?.postValueF?.(this.category, "fps", snapshot.fps));
    this.invokeSink(() => this.sink?.postValueF?.(this.category, "frame_time_ms", snapshot.frameTime));
    this.invokeSink(() => this.sink?.postValueF?.(this.category, "frame_time_p95_ms", snapshot.frameTimeP95));
    this.invokeSink(() => this.sink?.postValueF?.(this.category, "frame_time_p99_ms", snapshot.frameTimeP99));
    this.publishOptionalMetric("draw_calls", snapshot.drawCalls);
    this.publishOptionalMetric("draw_calls_2d", snapshot.drawCalls2D);
    this.publishOptionalMetric("draw_calls_3d", snapshot.drawCalls3D);
    for (const [name, value] of this.counters) {
      this.invokeSink(() => this.sink?.postValueF?.(this.category, name, value));
    }
  }

  private publishOptionalMetric(key: string, value: number | undefined): void {
    if (value === undefined) return;
    this.invokeSink(() => this.sink?.postValueF?.(this.category, key, value));
  }

  private invokeSink(call: () => void): void {
    if (this.sink === undefined) return;
    try {
      call();
    } catch (error: unknown) {
      this.sinkError = error;
      this.sinkEnabled = false;
    }
  }

  private assertMetric(name: string, value: number): void {
    if (name.length === 0 || !Number.isFinite(value)) throw new Error("PerfDog metrics require a name and finite value.");
  }

  private assertValues(category: string, key: string, values: readonly number[]): void {
    if (category.length === 0 || key.length === 0) throw new Error("PerfDog category and key must not be empty.");
    if (values.length < 1 || values.length > 3 || !values.every(Number.isFinite)) {
      throw new Error("PerfDog numeric values require one to three finite numbers.");
    }
  }
}

function finiteMetric(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(Math.floor(sorted.length * ratio), sorted.length - 1);
  return sorted[index] ?? 0;
}
