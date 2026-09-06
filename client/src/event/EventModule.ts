import type { LifecycleOwner, LifecycleParticipant } from "../lifecycle/LifecycleModule";

export type EventListener<T = unknown> = (payload: T) => void;
export interface EventService {
  on<T = unknown>(event: string, listener: EventListener<T>): () => void;
  emit<T = unknown>(event: string, payload: T): void;
}

interface Subscription {
  readonly ownerId: number;
  readonly event: string;
  readonly listener: EventListener;
}

export class EventModule implements LifecycleParticipant {
  private readonly listeners = new Map<string, Set<Subscription>>();
  private readonly ownership = new Map<number, Set<Subscription>>();

  public bind(owner: LifecycleOwner, assertActive: () => void): EventService {
    return {
      on: <T>(event: string, listener: EventListener<T>) => {
        assertActive();
        return this.on(owner, event, listener as EventListener);
      },
      emit: <T>(event: string, payload: T) => {
        assertActive();
        this.emit(event, payload);
      },
    };
  }

  public disposeOwner(owner: LifecycleOwner): void {
    const subscriptions = this.ownership.get(owner.id);
    if (subscriptions === undefined) return;
    for (const subscription of [...subscriptions]) this.remove(subscription);
    this.ownership.delete(owner.id);
  }

  private on(owner: LifecycleOwner, event: string, listener: EventListener): () => void {
    let listeners = this.listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }

    let owned = this.ownership.get(owner.id);
    if (owned === undefined) {
      owned = new Set();
      this.ownership.set(owner.id, owned);
    }

    const subscription: Subscription = { ownerId: owner.id, event, listener };
    listeners.add(subscription);
    owned.add(subscription);
    return () => this.remove(subscription);
  }

  private emit<T>(event: string, payload: T): void {
    for (const subscription of [...(this.listeners.get(event) ?? [])]) {
      subscription.listener(payload);
    }
  }

  private remove(subscription: Subscription): void {
    const listeners = this.listeners.get(subscription.event);
    listeners?.delete(subscription);
    if (listeners?.size === 0) this.listeners.delete(subscription.event);

    const owned = this.ownership.get(subscription.ownerId);
    owned?.delete(subscription);
    if (owned?.size === 0) this.ownership.delete(subscription.ownerId);
  }
}
