export interface Breadcrumb {
  readonly timestamp: number;
  readonly category: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface CrashContext {
  readonly version: string;
  readonly route?: string;
  readonly network?: string;
  readonly battleTick?: number;
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface CrashReport {
  readonly error: Error;
  readonly timestamp: number;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly context: CrashContext;
}

export interface CrashReporterProvider { report(report: CrashReport): Promise<void>; }
export interface CrashStorage { read(): string | undefined; write(value: string): void; }
export interface CrashRuntimeHooks {
  onError?(listener: (error: unknown) => void): () => void;
  onUnhandledRejection?(listener: (reason: unknown) => void): () => void;
}

export interface CrashReporterService {
  capture(error: unknown, data?: Readonly<Record<string, unknown>>): void;
  breadcrumb(category: string, message: string, data?: Readonly<Record<string, unknown>>): void;
  registerProvider(provider: CrashReporterProvider): void;
  setContextProvider(provider: () => CrashContext): void;
  getBreadcrumbs(): readonly Breadcrumb[];
  getInternalFailures(): readonly unknown[];
}

interface PersistedCrash {
  readonly message: string;
  readonly stack?: string;
  readonly timestamp: number;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly context: CrashContext;
}

export class CrashReporter implements CrashReporterService {
  private readonly providers: CrashReporterProvider[] = [];
  private readonly breadcrumbs: Breadcrumb[] = [];
  private contextProvider?: () => CrashContext;
  private installed = false;
  private readonly removeHooks: Array<() => void> = [];
  private readonly internalFailures: unknown[] = [];

  public constructor(
    private readonly storage?: CrashStorage,
    private readonly hooks?: CrashRuntimeHooks,
    private readonly maxBreadcrumbs = 50,
    private readonly maxPersisted = 10,
  ) {}

  public installGlobalHandlers(): void {
    if (this.installed) return;
    this.installed = true;
    if (this.hooks === undefined) return;

    const removeError = this.hooks.onError?.((error) => this.capture(error));
    const removeRejection = this.hooks.onUnhandledRejection?.((reason) => this.capture(reason));
    if (removeError !== undefined) this.removeHooks.push(removeError);
    if (removeRejection !== undefined) this.removeHooks.push(removeRejection);
  }

  public dispose(): void {
    for (const remove of this.removeHooks.splice(0)) {
      try { remove(); } catch (error: unknown) { this.recordInternalFailure(error); }
    }
    this.installed = false;
  }

  public registerProvider(provider: CrashReporterProvider): void {
    this.providers.push(provider);
    void this.flushPersisted().catch((error: unknown) => this.recordInternalFailure(error));
  }

  public setContextProvider(provider: () => CrashContext): void { this.contextProvider = provider; }
  public getBreadcrumbs(): readonly Breadcrumb[] { return [...this.breadcrumbs]; }
  public getInternalFailures(): readonly unknown[] { return [...this.internalFailures]; }

  public breadcrumb(category: string, message: string, data?: Readonly<Record<string, unknown>>): void {
    this.breadcrumbs.push({ timestamp: Date.now(), category, message, data });
    while (this.breadcrumbs.length > this.maxBreadcrumbs) this.breadcrumbs.shift();
  }

  public capture(error: unknown, data?: Readonly<Record<string, unknown>>): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (data !== undefined) this.breadcrumb("error", normalized.message, data);
    const report: CrashReport = {
      error: normalized,
      timestamp: Date.now(),
      breadcrumbs: [...this.breadcrumbs],
      context: this.readContext(),
    };
    const persisted: PersistedCrash = {
      message: normalized.message,
      stack: normalized.stack,
      timestamp: report.timestamp,
      breadcrumbs: report.breadcrumbs,
      context: report.context,
    };
    this.persist(persisted);
    void this.deliver(report)
      .then((delivered) => { if (delivered) this.removePersisted(report.timestamp); })
      .catch((deliveryError: unknown) => this.recordInternalFailure(deliveryError));
  }

  private readContext(): CrashContext {
    if (this.contextProvider === undefined) return { version: "unknown" };
    try { return this.contextProvider(); }
    catch (error: unknown) {
      this.recordInternalFailure(error);
      return { version: "unknown" };
    }
  }

  private async deliver(report: CrashReport): Promise<boolean> {
    if (this.providers.length === 0) return false;
    const outcomes = await Promise.all(this.providers.map(async (provider) => {
      try { await provider.report(report); return true; }
      catch (error: unknown) { this.recordInternalFailure(error); return false; }
    }));
    return outcomes.some(Boolean);
  }

  private readPersisted(): PersistedCrash[] {
    if (this.storage === undefined) return [];
    let raw: string | undefined;
    try { raw = this.storage.read(); }
    catch (error: unknown) { this.recordInternalFailure(error); return []; }
    if (raw === undefined || raw.length === 0) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed as PersistedCrash[] : [];
    } catch (error: unknown) {
      this.recordInternalFailure(error);
      try { this.storage.write("[]"); } catch (writeError: unknown) { this.recordInternalFailure(writeError); }
      return [];
    }
  }

  private persist(report: PersistedCrash): void {
    if (this.storage === undefined) return;
    const values = this.readPersisted();
    values.push(report);
    while (values.length > this.maxPersisted) values.shift();
    try { this.storage.write(JSON.stringify(values)); }
    catch (error: unknown) { this.recordInternalFailure(error); }
  }

  private removePersisted(timestamp: number): void {
    if (this.storage === undefined) return;
    try { this.storage.write(JSON.stringify(this.readPersisted().filter((item) => item.timestamp !== timestamp))); }
    catch (error: unknown) { this.recordInternalFailure(error); }
  }

  private async flushPersisted(): Promise<void> {
    for (const value of this.readPersisted()) {
      const error = new Error(value.message);
      if (value.stack !== undefined) error.stack = value.stack;
      if (await this.deliver({ error, timestamp: value.timestamp, breadcrumbs: value.breadcrumbs, context: value.context })) {
        this.removePersisted(value.timestamp);
      }
    }
  }

  private recordInternalFailure(error: unknown): void { this.internalFailures.push(error); }
}
