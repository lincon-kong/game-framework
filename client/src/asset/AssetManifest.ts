import type { PackageId } from "../package/PackageId";

export type AssetKey = string & {
  readonly __assetKey: unique symbol;
};

export function createAssetKey(value: string): AssetKey {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`Asset key must be a non-empty trimmed string, received "${value}".`);
  }

  return value as AssetKey;
}

export type AssetSource = "local" | "package" | "cdn";

export interface AssetManifestEntry {
  readonly key: AssetKey;
  readonly path: string;
  readonly source: AssetSource;
  readonly packageId?: PackageId;
}

export type AssetDefinition = AssetManifestEntry;
export type AssetManifest = readonly AssetManifestEntry[];
