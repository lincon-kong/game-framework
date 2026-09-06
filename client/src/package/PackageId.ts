export type PackageId = string & {
  readonly __packageId: unique symbol;
};

const PACKAGE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function createPackageId(value: string): PackageId {
  if (!PACKAGE_ID_PATTERN.test(value)) {
    throw new Error(`Invalid package ID "${value}".`);
  }

  return value as PackageId;
}
