import { FrameworkError, FrameworkErrorCode } from "../error/FrameworkError";

export interface FsmState<S, C> {
  enter?(context: C, previous?: S): Promise<void> | void;
  exit?(context: C, next: S): Promise<void> | void;
  update?(context: C, deltaTime: number): void;
}

export type TransitionRule<S> = ReadonlyMap<S, ReadonlySet<S>>;
export interface FsmEvent<S = unknown> {
  readonly type: "transition-start" | "transition-complete" | "transition-failed" | "faulted";
  readonly from?: S;
  readonly to: S;
  readonly error?: unknown;
}
export type FsmObserver = (event: FsmEvent) => void;

export class StateMachine<S, C> {
  private readonly states = new Map<S, FsmState<S, C>>();
  private currentState?: S;
  private queue: Promise<void> = Promise.resolve();
  private transitionActive = false;
  private faulted = false;

  public constructor(
    private readonly context: C,
    private readonly transitions?: TransitionRule<S>,
    private readonly observer?: FsmObserver,
  ) {}

  public get current(): S | undefined { return this.currentState; }
  public get isFaulted(): boolean { return this.faulted; }

  public addState(id: S, state: FsmState<S, C>): this {
    if (this.states.has(id)) {
      throw new FrameworkError(FrameworkErrorCode.DuplicateState, `FSM state already registered: ${String(id)}.`);
    }
    this.states.set(id, state);
    return this;
  }

  public transition(to: S): Promise<void> {
    if (this.faulted) {
      return Promise.reject(new FrameworkError(FrameworkErrorCode.FsmFaulted, "FSM is faulted."));
    }
    const request = this.queue.then(() => this.performTransition(to));
    this.queue = request.catch(() => undefined);
    return request;
  }

  public update(deltaTime: number): void {
    if (this.transitionActive || this.faulted || this.currentState === undefined) return;
    this.states.get(this.currentState)?.update?.(this.context, deltaTime);
  }

  private async performTransition(to: S): Promise<void> {
    if (this.currentState === to) return;
    const next = this.states.get(to);
    if (next === undefined) {
      throw new FrameworkError(FrameworkErrorCode.UnknownState, `Unknown FSM state: ${String(to)}.`);
    }

    const previousId = this.currentState;
    if (previousId !== undefined && this.transitions !== undefined && !this.transitions.get(previousId)?.has(to)) {
      throw new FrameworkError(
        FrameworkErrorCode.InvalidTransition,
        `FSM transition ${String(previousId)} -> ${String(to)} is not allowed.`,
      );
    }

    const previous = previousId === undefined ? undefined : this.states.get(previousId);
    this.transitionActive = true;
    this.observer?.({ type: "transition-start", from: previousId, to });

    let previousExited = false;
    try {
      try {
        await previous?.exit?.(this.context, to);
        previousExited = previous !== undefined;
      } catch (cause: unknown) {
        this.faulted = true;
        const error = new FrameworkError(
          FrameworkErrorCode.StateExitFailed,
          `FSM failed to exit ${String(previousId)}; state consistency cannot be guaranteed.`,
          { cause },
        );
        this.observer?.({ type: "faulted", from: previousId, to, error });
        throw error;
      }

      try {
        await next.enter?.(this.context, previousId);
      } catch (cause: unknown) {
        if (previousExited && previous !== undefined && previousId !== undefined) {
          try {
            await previous.enter?.(this.context, to);
          } catch (rollbackCause: unknown) {
            this.faulted = true;
            const error = new FrameworkError(
              FrameworkErrorCode.FsmFaulted,
              `FSM transition ${String(previousId)} -> ${String(to)} failed and rollback also failed.`,
              { cause, context: { rollbackCause } },
            );
            this.observer?.({ type: "faulted", from: previousId, to, error });
            throw error;
          }
        }
        const error = new FrameworkError(
          FrameworkErrorCode.StateEnterFailed,
          `FSM failed to enter ${String(to)}.`,
          { cause },
        );
        this.observer?.({ type: "transition-failed", from: previousId, to, error });
        throw error;
      }

      this.currentState = to;
      this.observer?.({ type: "transition-complete", from: previousId, to });
    } finally {
      this.transitionActive = false;
    }
  }
}

export class FsmModule {
  public constructor(private readonly observer?: FsmObserver) {}

  public create<S, C>(context: C, transitions?: TransitionRule<S>): StateMachine<S, C> {
    return new StateMachine(context, transitions, this.observer);
  }
}
