import type { AssetBackend } from "../asset/AssetModule";
import type { PackageBackend } from "../package/PackageModule";
import type { UILayerName, UINode } from "../ui/UIContracts";
import type { UIBackend } from "../ui/UIModule";
import type { UIRoot } from "./UIRoot";

interface LayaBinaryResource {
  readonly data: ArrayBuffer;
}

interface LayaPackageRuntime {
  readonly loader: {
    load<T = unknown>(path: string, type?: unknown): Promise<T>;
    loadPackage(path: string): Promise<boolean>;
    clearRes(path: string): void;
  };
  readonly Loader: {
    readonly BUFFER: unknown;
  };
}

declare const Laya: LayaPackageRuntime;

export function createLayaPackageBackend(): PackageBackend {
  return {
    async load(path: string): Promise<void> {
      const loaded = await Laya.loader.loadPackage(path);
      if (!loaded) {
        throw new Error(`Laya failed to load package "${path}".`);
      }
    },
  };
}

export function createLayaAssetBackend(): AssetBackend {
  return {
    load: <T>(path: string) => Laya.loader.load<T>(path),
    async loadBytes(path: string): Promise<ArrayBuffer> {
      const resource = await Laya.loader.load<LayaBinaryResource>(path, Laya.Loader.BUFFER);
      if (resource === null || typeof resource !== "object" || !(resource.data instanceof ArrayBuffer)) {
        throw new Error(`Laya binary asset "${path}" did not return an ArrayBuffer resource.`);
      }
      return resource.data;
    },
    release(path: string): void {
      Laya.loader.clearRes(path);
    },
  };
}

export function createLayaUIBackend(uiRoot: UIRoot): UIBackend {
  return {
    add<T extends UINode>(layer: UILayerName, node: T): T {
      return uiRoot.add(layer, node);
    },
    remove<T extends UINode>(layer: UILayerName, node: T, destroy = true): T {
      return uiRoot.remove(layer, node, destroy);
    },
  };
}
