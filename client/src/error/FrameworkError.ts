export const FrameworkErrorCode = {
  InvalidArgument: "INVALID_ARGUMENT",
  InvalidState: "INVALID_STATE",
  InvalidTransition: "INVALID_TRANSITION",
  DuplicateState: "DUPLICATE_STATE",
  UnknownState: "UNKNOWN_STATE",
  StateEnterFailed: "STATE_ENTER_FAILED",
  StateExitFailed: "STATE_EXIT_FAILED",
  FsmFaulted: "FSM_FAULTED",
  LifecycleConflict: "LIFECYCLE_CONFLICT",
  LifecycleInvalidParent: "LIFECYCLE_INVALID_PARENT",
  LifecycleOwnerInactive: "LIFECYCLE_OWNER_INACTIVE",
  DuplicatePackage: "DUPLICATE_PACKAGE",
  UnknownPackage: "UNKNOWN_PACKAGE",
  InvalidPackagePath: "INVALID_PACKAGE_PATH",
  PackageInstallerMissing: "PACKAGE_INSTALLER_MISSING",
  PackageLoadFailed: "PACKAGE_LOAD_FAILED",
  InvalidAssetPath: "INVALID_ASSET_PATH",
  AssetLoadFailed: "ASSET_LOAD_FAILED",
  InvalidPoolCapacity: "INVALID_POOL_CAPACITY",
  DuplicatePool: "DUPLICATE_POOL",
  UnknownPool: "UNKNOWN_POOL",
  PoolObjectNotActive: "POOL_OBJECT_NOT_ACTIVE",
  PoolNotEmpty: "POOL_NOT_EMPTY",
  DuplicateEntityDefinition: "DUPLICATE_ENTITY_DEFINITION",
  UnknownEntityDefinition: "UNKNOWN_ENTITY_DEFINITION",
  InvalidEntityDefinition: "INVALID_ENTITY_DEFINITION",
  EntityUnavailable: "ENTITY_UNAVAILABLE",
  EntityNotPrepared: "ENTITY_NOT_PREPARED",
  UpdateCallbackFailed: "UPDATE_CALLBACK_FAILED",
  DuplicateRoute: "DUPLICATE_ROUTE",
  UnknownRoute: "UNKNOWN_ROUTE",
  InvalidRoute: "INVALID_ROUTE",
  NavigationInProgress: "NAVIGATION_IN_PROGRESS",
  RouteActivationFailed: "ROUTE_ACTIVATION_FAILED",
  InvalidNetworkConfig: "INVALID_NETWORK_CONFIG",
  NetworkUnavailable: "NETWORK_UNAVAILABLE",
  InvalidStorageConfig: "INVALID_STORAGE_CONFIG",
  StorageUnavailable: "STORAGE_UNAVAILABLE",
  InvalidUiState: "INVALID_UI_STATE",
  WasmUnavailable: "WASM_UNAVAILABLE",
  PlatformUnavailable: "PLATFORM_UNAVAILABLE",
} as const;

export type FrameworkErrorCode = (typeof FrameworkErrorCode)[keyof typeof FrameworkErrorCode];

export interface FrameworkErrorOptions {
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
}

export class FrameworkError extends Error {
  public readonly cause?: unknown;
  public readonly context?: Readonly<Record<string, unknown>>;

  public constructor(
    public readonly code: FrameworkErrorCode,
    message: string,
    options?: FrameworkErrorOptions,
  ) {
    super(message);
    this.name = "FrameworkError";
    this.cause = options?.cause;
    this.context = options?.context;
  }
}

/** Preserve an underlying error without relying on the newer Error constructor form. */
export function errorWithCause<T extends Error>(error: T, cause: unknown): T {
  Object.defineProperty(error, "cause", { configurable: true, enumerable: false, value: cause });
  return error;
}

export function composeFrameworkError(
  code: FrameworkErrorCode,
  errors: readonly unknown[],
  message: string,
): FrameworkError {
  return new FrameworkError(code, message, {
    cause: errors[0],
    context: errors.length > 1 ? { additionalErrors: errors.slice(1) } : undefined,
  });
}

export function asFrameworkError(
  error: unknown,
  code: FrameworkErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): FrameworkError {
  return error instanceof FrameworkError ? error : new FrameworkError(code, message, { cause: error, context });
}
