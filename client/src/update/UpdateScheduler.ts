import { FrameworkError, FrameworkErrorCode } from "../error/FrameworkError";
import type { LifecycleOwner, LifecycleParticipant } from "../lifecycle/LifecycleModule";

export const UpdatePhase = {
  PreUpdate: "PreUpdate",
  NetworkUpdate: "NetworkUpdate",
  FixedUpdate: "FixedUpdate",
  Update: "Update",
  LateUpdate: "LateUpdate",
  RenderUpdate: "RenderUpdate",
} as const;
export type UpdatePhase = (typeof UpdatePhase)[keyof typeof UpdatePhase];

export interface UpdateRegistration { cancel(): void; }
export interface UpdateService {
  /** FixedUpdate receives logical fixed-step time; all other phases receive real frame time. */
  schedule(phase: UpdatePhase, callback: (deltaSeconds: number) => void, priority?: number): UpdateRegistration;
}
export type UpdateErrorHandler = (error: FrameworkError, phase: UpdatePhase) => void;

interface Entry {
  readonly ownerId: number;
  readonly callback: (deltaSeconds: number) => void;
  readonly priority: number;
  readonly sequence: number;
  cancelled: boolean;
}

export class UpdateScheduler implements LifecycleParticipant {
  private readonly callbacks = new Map<UpdatePhase, Entry[]>();
  private readonly updateBuffer: Entry[] = [];
  private sequence = 0;
  private fixedAccumulator = 0;

  public constructor(
    public readonly fixedDeltaTime = 1 / 60,
    public readonly maxFixedSteps = 5,
    private readonly onError?: UpdateErrorHandler,
  ) {
    if (!Number.isFinite(fixedDeltaTime) || fixedDeltaTime <= 0) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, "fixedDeltaTime must be greater than zero.");
    }
    if (!Number.isSafeInteger(maxFixedSteps) || maxFixedSteps <= 0) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, "maxFixedSteps must be a positive safe integer.");
    }
  }

  public bind(owner: LifecycleOwner, assertActive: () => void): UpdateService {
    return {
      schedule: (phase, callback, priority = 0) => {
        assertActive();
        return this.schedule(owner, phase, callback, priority);
      },
    };
  }

  /** Consume one real frame delta and derive zero or more logical fixed steps. */
  public tick(realDeltaSeconds: number): void {
    if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds < 0) {
      throw new FrameworkError(
        FrameworkErrorCode.InvalidArgument,
        `Update realDeltaSeconds must be finite and non-negative, got ${realDeltaSeconds}.`,
      );
    }
    this.dispatch(UpdatePhase.PreUpdate, realDeltaSeconds);
    this.dispatch(UpdatePhase.NetworkUpdate, realDeltaSeconds);
    this.fixedAccumulator = Math.min(
      this.fixedAccumulator + realDeltaSeconds,
      this.fixedDeltaTime * this.maxFixedSteps,
    );
    while (this.fixedAccumulator + Number.EPSILON >= this.fixedDeltaTime) {
      this.dispatch(UpdatePhase.FixedUpdate, this.fixedDeltaTime);
      this.fixedAccumulator -= this.fixedDeltaTime;
    }
    this.dispatch(UpdatePhase.Update, realDeltaSeconds);
    this.dispatch(UpdatePhase.LateUpdate, realDeltaSeconds);
    this.dispatch(UpdatePhase.RenderUpdate, realDeltaSeconds);
  }

  public disposeOwner(owner: LifecycleOwner): void {
    for (const entries of this.callbacks.values()) {
      for (const entry of entries) if (entry.ownerId === owner.id) entry.cancelled = true;
    }
  }

  private schedule(
    owner: LifecycleOwner,
    phase: UpdatePhase,
    callback: (deltaSeconds: number) => void,
    priority: number,
  ): UpdateRegistration {
    if (!Object.values(UpdatePhase).includes(phase)) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, `Unknown update phase: ${String(phase)}.`);
    }
    if (typeof callback !== "function" || !Number.isFinite(priority)) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, "Update callback and finite priority are required.");
    }
    const entry: Entry = { ownerId: owner.id, callback, priority, sequence: this.sequence++, cancelled: false };
    const entries = this.callbacks.get(phase) ?? [];
    entries.push(entry);
    entries.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    this.callbacks.set(phase, entries);
    return { cancel: () => { entry.cancelled = true; } };
  }

  private dispatch(phase: UpdatePhase, deltaSeconds: number): void {
    const entries = this.callbacks.get(phase);
    if (entries === undefined || entries.length === 0) return;

    this.updateBuffer.length = 0;
    for (const entry of entries) this.updateBuffer.push(entry);
    for (const entry of this.updateBuffer) {
      if (entry.cancelled) continue;
      try {
        entry.callback(deltaSeconds);
      } catch (cause: unknown) {
        const error = new FrameworkError(
          FrameworkErrorCode.UpdateCallbackFailed,
          `${phase} callback failed.`,
          { cause, context: { phase, ownerId: entry.ownerId, priority: entry.priority } },
        );
        this.onError?.(error, phase);
        throw error;
      }
    }
    this.updateBuffer.length = 0;

    const active = entries.filter((entry) => !entry.cancelled);
    if (active.length === 0) this.callbacks.delete(phase);
    else this.callbacks.set(phase, active);
  }
}
