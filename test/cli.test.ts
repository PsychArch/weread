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

    const capabilitiesText = run(["capabilities"]);
    expect(capabilitiesText.status).toBe(0);
    expect(capabilitiesText.stdout).toContain("weread schema get capabilities");

    const capabilities = run(["capabilities", "--json"]);
    expect(capabilities.status).toBe(0);
    expect(JSON.parse(capabilities.stdout)).toMatchObject({
      schemaId: "urn:weread:capabilities:2",
      schemaCommand: ["schema", "get", "capabilities"],
      manifestVersion: "2",
      executable: "weread",
      cliVersion: manifest.version,
      safety: { gatewayOperations: "read-only" },
    });
    expect(JSON.parse(capabilities.stdout).operations).toContainEqual(expect.objectContaining({
      id: "notes.notebooks",
      command: {
        argv: ["--agent", "notes", "notebooks"],
        helpArgv: ["--agent", "notes", "notebooks", "--help"],
      },
      input: expect.objectContaining({
        options: expect.arrayContaining([expect.objectContaining({ flag: "--all", type: "boolean" })]),
      }),
      output: expect.objectContaining({
        schemaCommand: ["schema", "get", "notes.notebooks"],
        dataSchemaCommand: ["schema", "get", "notes.notebooks", "--data"],
      }),
    }));

    const selected = run(["capabilities", "--operation", "notes.notebooks", "--json"]);
    expect(JSON.parse(selected.stdout).operations).toHaveLength(1);
    expect(selected.stdout.length).toBeLessThan(capabilities.stdout.length);

    const unknown = run(["--json", "capabilities", "--operation", "missing.operation"]);
    expect(unknown.status).toBe(1);
    expect(JSON.parse(unknown.stderr)).toMatchObject({ ok: false, error: { code: "ARG_INVALID" } });

    const schema = run(["schema", "get", "notes.notebooks"]);
    expect(schema.status).toBe(0);
    expect(JSON.parse(schema.stdout)).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:weread:agent:2:notes.notebooks",
    });
    const dataSchema = run(["schema", "get", "notes.notebooks", "--data"]);
    expect(dataSchema.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(dataSchema.stdout)).toMatchObject({
      $id: "urn:weread:agent:2:notes.notebooks:data",
      required: ["returned", "totalBookCount", "totalNoteCount", "hasMore", "books"],
    });

    const prettySchema = run(["schema", "get", "notes.notebooks", "--data", "--pretty"]);
    expect(prettySchema.stdout.trim().split("\n").length).toBeGreaterThan(1);

    const bookResolveSchema = run(["schema", "get", "book.resolve", "--data"]);
    expect(JSON.parse(bookResolveSchema.stdout)).toMatchObject({ $id: "urn:weread:agent:2:book.resolve:data" });
    expect(JSON.parse(run(["schema", "get", "book.resolve-batch", "--data"]).stdout)).toMatchObject({
      $id: "urn:weread:agent:2:book.resolve-batch:data",
    });
    expect(JSON.parse(run(["schema", "get", "notes.sample", "--data"]).stdout)).toMatchObject({
      $id: "urn:weread:agent:2:notes.sample:data",
    });
    expect(JSON.parse(run(["schema", "get", "notes.corpus", "--data"]).stdout)).toMatchObject({
      properties: {
        contentScope: {
          properties: {
            personalWordsField: { const: "books[].thoughts[].content" },
            sourceContextFields: {
              const: ["books[].thoughts[].quotedText", "books[].thoughts[].contextText"],
            },
            maxBookIdsPerCall: { const: 50 },
          },
        },
      },
    });

    for (const operation of JSON.parse(capabilities.stdout).operations as Array<{ id: string; command: { helpArgv: string[] }; input: { options: Array<{ flag: string }> } }>) {
      const help = run(operation.command.helpArgv);
      expect(help.status, operation.id).toBe(0);
      for (const option of operation.input.options) expect(help.stdout, `${operation.id} ${option.flag}`).toContain(option.flag);
    }
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

  it("identifies the operation and schema in agent metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "weread-cli-test-"));
    temporaryDirectories.push(directory);
    const environment: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: directory };
    delete environment.WEREAD_API_KEY;

    const result = run(["--agent", "doctor"], environment);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: { ready: false },
      meta: {
        operationId: "doctor",
        schemaId: "urn:weread:agent:2:doctor",
      },
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
