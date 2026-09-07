import { FrameworkError, FrameworkErrorCode } from "../error/FrameworkError";
import type { LifecycleOwner, LifecycleParticipant } from "../lifecycle/LifecycleModule";

export interface PoolPolicy<T> {
  create(): T;
  /** Return false for an externally invalidated retained value. */
  isReusable?(value: T): boolean;
  onAcquire?(value: T): void;
  onRelease?(value: T): void;
  destroy?(value: T): void;
  readonly maxRetained?: number;
}

export interface PoolStats {
  readonly active: number;
  readonly retained: number;
  readonly hits: number;
  readonly misses: number;
  readonly created: number;
  readonly destroyed: number;
}

export interface PoolService {
  define<T>(key: string, policy: PoolPolicy<T>): void;
  acquire<T>(key: string): T;
  release<T>(key: string, value: T): void;
  prewarm(key: string, count: number): void;
  trim(key: string, retainedCount?: number): void;
  clear(key?: string): void;
  stats(key: string): PoolStats;
}

interface PoolRecord<T> {
  readonly policy: PoolPolicy<T>;
  readonly retained: T[];
  readonly activeValues: Set<T>;
  hits: number;
  misses: number;
  created: number;
  destroyed: number;
}

export class PoolModule implements LifecycleParticipant {
  private readonly pools = new Map<string, PoolRecord<unknown>>();

  public bind(owner: LifecycleOwner, assertActive: () => void): PoolService {
    const keyOf = (key: string) => `${owner.id}:${key}`;
    return {
      define: <T>(key: string, policy: PoolPolicy<T>) => { assertActive(); this.define(keyOf(key), policy); },
      acquire: <T>(key: string) => { assertActive(); return this.acquire<T>(keyOf(key)); },
      release: <T>(key: string, value: T) => { assertActive(); this.release(keyOf(key), value); },
      prewarm: (key, count) => { assertActive(); this.prewarm(keyOf(key), count); },
      trim: (key, retainedCount = 0) => { assertActive(); this.trim(keyOf(key), retainedCount); },
      clear: (key) => {
        assertActive();
        if (key === undefined) this.clearOwner(owner.id, false);
        else this.clear(keyOf(key));
      },
      stats: (key) => { assertActive(); return this.stats(keyOf(key)); },
    };
  }

  public disposeOwner(owner: LifecycleOwner): void { this.clearOwner(owner.id, true); }

  public define<T>(key: string, policy: PoolPolicy<T>): void {
    this.validateKey(key);
    if (policy === null || typeof policy !== "object" || typeof policy.create !== "function") {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, `Pool "${key}" requires a create policy.`);
    }
    if (this.pools.has(key)) {
      throw new FrameworkError(FrameworkErrorCode.DuplicatePool, `Pool "${key}" is already defined.`);
    }
    const maxRetained = policy.maxRetained ?? 32;
    if (!Number.isSafeInteger(maxRetained) || maxRetained < 0) {
      throw new FrameworkError(
        FrameworkErrorCode.InvalidPoolCapacity,
        `Pool "${key}" maxRetained must be a non-negative safe integer.`,
      );
    }
    const record: PoolRecord<T> = {
      policy: { ...policy, maxRetained },
      retained: [],
      activeValues: new Set<T>(),
      hits: 0,
      misses: 0,
      created: 0,
      destroyed: 0,
    };
    this.pools.set(key, record as unknown as PoolRecord<unknown>);
  }

  public acquire<T>(key: string): T {
    const record = this.requirePool<T>(key);
    let value: T | undefined;
    while (record.retained.length > 0) {
      const candidate = record.retained.pop()!;
      if (record.policy.isReusable?.(candidate) === false) {
        this.destroy(record, candidate);
        continue;
      }
      value = candidate;
      break;
    }
    if (value === undefined) {
      try { value = record.policy.create(); }
      catch (cause: unknown) {
        throw new FrameworkError(FrameworkErrorCode.InvalidState, `Pool "${key}" failed to create an object.`, { cause });
      }
      record.misses += 1;
      record.created += 1;
    } else {
      record.hits += 1;
    }

    record.activeValues.add(value);
    try {
      record.policy.onAcquire?.(value);
      return value;
    } catch (cause: unknown) {
      record.activeValues.delete(value);
      try { this.destroy(record, value); }
      catch (cleanupError: unknown) {
        throw new FrameworkError(
          FrameworkErrorCode.InvalidState,
          `Pool "${key}" acquire hook and cleanup both failed.`,
          { cause, context: { cleanupError } },
        );
      }
      throw new FrameworkError(FrameworkErrorCode.InvalidState, `Pool "${key}" acquire hook failed.`, { cause });
    }
  }

  public release<T>(key: string, value: T): void {
    const record = this.requirePool<T>(key);
    if (!record.activeValues.delete(value)) {
      throw new FrameworkError(
        FrameworkErrorCode.PoolObjectNotActive,
        `Pool "${key}" cannot release an object that is not active.`,
      );
    }
    try {
      record.policy.onRelease?.(value);
    } catch (cause: unknown) {
      try { this.destroy(record, value); }
      catch (cleanupError: unknown) {
        throw new FrameworkError(
          FrameworkErrorCode.InvalidState,
          `Pool "${key}" release hook and cleanup both failed.`,
          { cause, context: { cleanupError } },
        );
      }
      throw new FrameworkError(FrameworkErrorCode.InvalidState, `Pool "${key}" release hook failed.`, { cause });
    }
    if (record.retained.length < (record.policy.maxRetained ?? 32)) record.retained.push(value);
    else this.destroy(record, value);
  }

  public prewarm(key: string, count: number): void {
    const record = this.requirePool<unknown>(key);
    this.validateCount(count, "prewarm count");
    const target = Math.min(count, record.policy.maxRetained ?? 32);
    while (record.retained.length < target) {
      try {
        record.retained.push(record.policy.create());
        record.created += 1;
      } catch (cause: unknown) {
        throw new FrameworkError(FrameworkErrorCode.InvalidState, `Pool "${key}" prewarm failed.`, { cause });
      }
    }
  }

  public trim(key: string, retainedCount = 0): void {
    const record = this.requirePool<unknown>(key);
    this.validateCount(retainedCount, "retainedCount");
    while (record.retained.length > retainedCount) this.destroy(record, record.retained.pop()!);
  }

  public clear(key: string): void {
    const record = this.requirePool<unknown>(key);
    if (record.activeValues.size !== 0) {
      throw new FrameworkError(
        FrameworkErrorCode.PoolNotEmpty,
        `Pool "${key}" cannot be removed while ${record.activeValues.size} objects are active.`,
      );
    }
    this.trim(key, 0);
    this.pools.delete(key);
  }

  public stats(key: string): PoolStats {
    const record = this.requirePool<unknown>(key);
    return {
      active: record.activeValues.size,
      retained: record.retained.length,
      hits: record.hits,
      misses: record.misses,
      created: record.created,
      destroyed: record.destroyed,
    };
  }

  public has(key: string): boolean { return this.pools.has(key); }

  private clearOwner(ownerId: number, force: boolean): void {
    const prefix = `${ownerId}:`;
    const errors: unknown[] = [];
    for (const key of [...this.pools.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const record = this.requirePool<unknown>(key);
      if (force) {
        for (const value of [...record.activeValues]) {
          record.activeValues.delete(value);
          try { this.destroy(record, value); } catch (error: unknown) { errors.push(error); }
        }
        while (record.retained.length > 0) {
          try { this.destroy(record, record.retained.pop()!); } catch (error: unknown) { errors.push(error); }
        }
        this.pools.delete(key);
      } else {
        try { this.clear(key); } catch (error: unknown) { errors.push(error); }
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new FrameworkError(
        FrameworkErrorCode.InvalidState,
        `Failed to clear pools for owner ${ownerId}.`,
        { cause: errors[0], context: { errors } },
      );
    }
  }

  private destroy<T>(record: PoolRecord<T>, value: T): void {
    record.policy.destroy?.(value);
    record.destroyed += 1;
  }

  private requirePool<T>(key: string): PoolRecord<T> {
    const record = this.pools.get(key);
    if (record === undefined) {
      throw new FrameworkError(FrameworkErrorCode.UnknownPool, `Pool "${key}" is not defined.`);
    }
    return record as unknown as PoolRecord<T>;
  }

  private validateKey(key: string): void {
    if (typeof key !== "string" || key.length === 0 || key.trim() !== key) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, "Pool key must be a non-empty trimmed string.");
    }
  }

  private validateCount(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new FrameworkError(FrameworkErrorCode.InvalidArgument, `Pool ${label} must be a non-negative safe integer.`);
    }
  }
}
