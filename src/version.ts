import { readFileSync } from "node:fs";

interface PackageManifest {
  version?: unknown;
}

export function readPackageVersion(baseUrl: string | URL = import.meta.url): string {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", baseUrl), "utf8"),
  ) as PackageManifest;
  if (typeof manifest.version !== "string" || !manifest.version) {
    throw new Error("package.json does not contain a valid version.");
  }
  return manifest.version;
}

export const VERSION = readPackageVersion();
