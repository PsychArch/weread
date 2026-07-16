import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("built CLI", () => {
  it("reports the package version and exposes its command surface", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
    expect(run(["--version"]).stdout.trim()).toBe(manifest.version);
    expect(run(["--help"]).stdout).toContain("raw gateway escape hatch");

    const capabilities = run(["capabilities", "--json"]);
    expect(capabilities.status).toBe(0);
    expect(JSON.parse(capabilities.stdout)).toMatchObject({
      cliVersion: manifest.version,
      schemaVersion: "2",
      safety: { gatewayOperations: "read-only" },
    });
  });

  it("returns structured diagnostics and a failing status when auth is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "weread-cli-test-"));
    temporaryDirectories.push(directory);
    const environment: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: directory };
    delete environment.WEREAD_API_KEY;

    const result = run(["doctor", "--json"], environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ready: false,
      credential: { configured: false, source: null },
      gateway: { checked: false },
    });
  });

  it("rejects attempts to override gateway metadata before making a request", () => {
    const result = run(["--json", "api", "call", "/_list", "--param", "api_name=/store/search"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: { code: "ARG_INVALID" },
    });
  });
});

function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
