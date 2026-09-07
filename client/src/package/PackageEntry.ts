import type { FrameworkAccess } from "../FrameworkAccess";
import type { RouteRegistrar } from "../router/RouterModule";
import type { PackageId } from "./PackageId";

export interface PackageInstallContext {
  readonly framework: FrameworkAccess;
  readonly routes: RouteRegistrar;
}

export interface PackageHandle {
  dispose(): Promise<void> | void;
}

export type PackageInstaller = (
  context: PackageInstallContext,
) => Promise<PackageHandle | void> | PackageHandle | void;

const INSTALLERS_KEY = Symbol.for("@game-framework/client/package-installers");

function installers(): Map<PackageId, PackageInstaller> {
  const host = globalThis as typeof globalThis & { [INSTALLERS_KEY]?: Map<PackageId, PackageInstaller> };
  if (host[INSTALLERS_KEY] === undefined) host[INSTALLERS_KEY] = new Map<PackageId, PackageInstaller>();
  return host[INSTALLERS_KEY];
}

export function publishPackageInstaller(id: PackageId, installer: PackageInstaller): void {
  const registry = installers();
  const existing = registry.get(id);
  if (existing !== undefined && existing !== installer) {
    throw new Error(`Package installer "${id}" is already published.`);
  }
  registry.set(id, installer);
}

export function getPackageInstaller(id: PackageId): PackageInstaller | undefined {
  return installers().get(id);
}
