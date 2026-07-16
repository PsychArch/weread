import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configPath, findCredential, writeConfig } from "../src/config.js";

const originalXdg = process.env.XDG_CONFIG_HOME;
const originalKey = process.env.WEREAD_API_KEY;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  if (originalKey === undefined) delete process.env.WEREAD_API_KEY;
  else process.env.WEREAD_API_KEY = originalKey;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("credential resolution", () => {
  it("prefers WEREAD_API_KEY and reports its source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "weread-config-"));
    temporaryDirectories.push(directory);
    process.env.XDG_CONFIG_HOME = directory;
    await writeConfig({ apiKey: "wrk-config-key" });
    process.env.WEREAD_API_KEY = "wrk-env";

    await expect(findCredential()).resolves.toEqual({
      apiKey: "wrk-env",
      source: "environment",
    });
  });

  it("falls back to the config file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "weread-config-"));
    temporaryDirectories.push(directory);
    process.env.XDG_CONFIG_HOME = directory;
    delete process.env.WEREAD_API_KEY;
    await writeConfig({ apiKey: "wrk-config-key" });

    await expect(findCredential()).resolves.toEqual({ apiKey: "wrk-config-key", source: "config" });
  });

  it("restores user-only permissions when overwriting config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "weread-config-"));
    temporaryDirectories.push(directory);
    process.env.XDG_CONFIG_HOME = directory;

    await writeConfig({ apiKey: "wrk-config-key" });
    await chmod(configPath(), 0o644);
    await writeConfig({ apiKey: "wrk-new" });

    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
  });
});
