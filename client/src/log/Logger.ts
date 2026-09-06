export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export type LogCategory = string;

export interface LogRecord {
  readonly level: LogLevel;
  readonly category: LogCategory;
  readonly message: string;
  readonly args: readonly unknown[];
}

export type LogSink = (record: LogRecord) => void;
export type LoggerEnvironment = "development" | "production";

export interface LoggerOptions {
  readonly environment?: LoggerEnvironment;
  readonly minimumLevel?: LogLevel;
  readonly sink?: LogSink;
}

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

function writeToConsole(record: LogRecord): void {
  const message = `[${record.category}] ${record.message}`;
  switch (record.level) {
    case LogLevel.DEBUG:
      console.debug(message, ...record.args);
      return;
    case LogLevel.INFO:
      console.info(message, ...record.args);
      return;
    case LogLevel.WARN:
      console.warn(message, ...record.args);
      return;
    case LogLevel.ERROR:
      console.error(message, ...record.args);
      return;
  }
}

export class Logger {
  private readonly minimumLevel: LogLevel;
  private readonly sink: LogSink;

  public constructor(options: LoggerOptions = {}) {
    const environment = options.environment ?? "development";
    const requestedMinimumLevel = options.minimumLevel ?? LogLevel.INFO;
    this.minimumLevel = environment === "production"
      ? this.atLeastInfo(requestedMinimumLevel)
      : requestedMinimumLevel;
    this.sink = options.sink ?? writeToConsole;
  }

  public debug(category: LogCategory, message: string, ...args: readonly unknown[]): void {
    this.write(LogLevel.DEBUG, category, message, args);
  }

  public info(category: LogCategory, message: string, ...args: readonly unknown[]): void {
    this.write(LogLevel.INFO, category, message, args);
  }

  public warn(category: LogCategory, message: string, ...args: readonly unknown[]): void {
    this.write(LogLevel.WARN, category, message, args);
  }

  public error(category: LogCategory, message: string, ...args: readonly unknown[]): void {
    this.write(LogLevel.ERROR, category, message, args);
  }

  private write(
    level: LogLevel,
    category: LogCategory,
    message: string,
    args: readonly unknown[],
  ): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minimumLevel]) {
      return;
    }

    this.sink({ level, category, message, args });
  }

  private atLeastInfo(level: LogLevel): LogLevel {
    return LEVEL_PRIORITY[level] < LEVEL_PRIORITY[LogLevel.INFO] ? LogLevel.INFO : level;
  }
}

export const logger = new Logger();
