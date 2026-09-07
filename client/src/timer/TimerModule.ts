import type { LifecycleOwner, LifecycleParticipant } from "../lifecycle/LifecycleModule";
export interface TimerService { delay(milliseconds: number, callback: () => void): () => void; interval(milliseconds: number, callback: () => void): () => void; }
type TimerHandle = ReturnType<typeof setTimeout>;
interface OwnedTimer { readonly handle: TimerHandle; readonly interval: boolean; }

export class TimerModule implements LifecycleParticipant {
  private readonly ownership = new Map<number, Set<OwnedTimer>>();
  public bind(owner: LifecycleOwner, assertActive: () => void): TimerService {
    return {
      delay: (milliseconds, callback) => { assertActive(); return this.delay(owner, milliseconds, callback); },
      interval: (milliseconds, callback) => { assertActive(); return this.interval(owner, milliseconds, callback); },
    };
  }
  public disposeOwner(owner: LifecycleOwner): void {
    const timers = this.ownership.get(owner.id); if (timers === undefined) return;
    for (const timer of timers) timer.interval ? clearInterval(timer.handle) : clearTimeout(timer.handle);
    this.ownership.delete(owner.id);
  }
  private delay(owner: LifecycleOwner, milliseconds: number, callback: () => void): () => void {
    const handle = setTimeout(() => { this.ownership.get(owner.id)?.delete(timer); callback(); }, milliseconds);
    const timer: OwnedTimer = { handle, interval: false }; this.track(owner, timer);
    return () => { clearTimeout(handle); this.ownership.get(owner.id)?.delete(timer); };
  }
  private interval(owner: LifecycleOwner, milliseconds: number, callback: () => void): () => void {
    const handle = setInterval(callback, milliseconds); const timer = { handle, interval: true }; this.track(owner, timer);
    return () => { clearInterval(handle); this.ownership.get(owner.id)?.delete(timer); };
  }
  private track(owner: LifecycleOwner, timer: OwnedTimer): void {
    let owned = this.ownership.get(owner.id); if (owned === undefined) { owned = new Set(); this.ownership.set(owner.id, owned); } owned.add(timer);
  }
}
