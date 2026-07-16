import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { VERSION, readPackageVersion } from "../src/version.js";

describe("package version", () => {
  it("uses package.json as the single source of truth", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(VERSION).toBe(manifest.version);
    expect(readPackageVersion()).toBe(manifest.version);
  });
});
