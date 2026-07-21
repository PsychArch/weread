import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
const mockGatewayPath = fileURLToPath(new URL("./fixtures/mock-gateway.mjs", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("built CLI", () => {
  it("exposes one offline discovery path with self-contained descriptors", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
    expect(run(["--version"]).stdout.trim()).toBe(manifest.version);
    expect(run(["--help"]).stdout).toContain("--json");
    expect(run(["--help"]).stdout).toContain("--raw");

    const humanCatalog = run(["operations"]);
    expect(humanCatalog.status).toBe(0);
    expect(humanCatalog.stdout).toContain("notes.notebooks");
    expect(humanCatalog.stdout).toContain("weread --json operation describe <operation-id>");

    const catalogResult = run(["--json", "operations"]);
    expect(catalogResult.status).toBe(0);
    const catalog = JSON.parse(catalogResult.stdout) as {
      data: {
        operations: Array<{
          id: string;
          describeArgv: string[];
        }>;
        rawEscape: unknown;
      };
    };
    expect(catalog).toMatchObject({
      ok: true,
      data: {
        contractVersion: "1",
        executable: "weread",
        rawEscape: { argv: ["--raw", "api", "call"], responseSchema: null },
      },
      meta: {
        complete: true,
        operationId: "operations.list",
        schemaId: "urn:weread:response:3:operations.list",
      },
      warnings: [],
    });
    expect(catalog.data.operations).toHaveLength(29);
    expect(catalog.data.operations.map((operation) => operation.id)).toContain("invocation.error");
    expect(catalog.data.operations.map((operation) => operation.id)).not.toContain("notes.sample");

    const descriptorResult = run(["--json", "operation", "describe", "notes.notebooks"]);
    expect(descriptorResult.status).toBe(0);
    const descriptor = JSON.parse(descriptorResult.stdout);
    expect(descriptor).toMatchObject({
      ok: true,
      data: {
        id: "notes.notebooks",
        sideEffects: "gateway-read",
        invocation: {
          executable: "weread",
          argv: ["notes", "notebooks"],
          jsonArgv: ["--json", "notes", "notebooks"],
          helpArgv: ["notes", "notebooks", "--help"],
        },
        output: {
          schemaId: "urn:weread:response:3:notes.notebooks",
          responseSchema: {
            $id: "urn:weread:response:3:notes.notebooks",
            $defs: { data: expect.any(Object) },
          },
          dataSchemaRef: "#/$defs/data",
        },
        pagination: {
          mode: "cursor",
          pageField: "data.page",
          nextArgsField: "data.page.nextArgs",
          nextArgvField: "data.page.nextArgv",
        },
      },
      meta: {
        operationId: "operation.describe",
        schemaId: "urn:weread:response:3:operation.describe",
      },
    });

    for (const operation of catalog.data.operations) {
      expect(operation.describeArgv).toEqual(["--json", "operation", "describe", operation.id]);
      const described = JSON.parse(run(operation.describeArgv).stdout).data as {
        invocation: { helpArgv: string[] };
        input: { options: Array<{ flag: string }> };
      };
      const help = run(described.invocation.helpArgv);
      expect(help.status, operation.id).toBe(0);
      for (const option of described.input.options) {
        expect(help.stdout, `${operation.id} ${option.flag}`).toContain(option.flag);
      }
    }

    expect(run(["capabilities"]).status).toBe(2);
    expect(run(["schema", "get", "notes.notebooks"]).status).toBe(2);
    expect(run(["notes", "--help"]).stdout).not.toContain("sample");
  }, 15_000);

  it("reports readiness without making ready=false a command failure", async () => {
    const environment = await isolatedEnvironment();
    environment.WEREAD_SKILL_VERSION = " 1.0.9 ";

    const json = run(["--json", "doctor"], environment);
    const agent = run(["--agent", "doctor"], environment);
    const both = run(["--json", "--agent", "doctor"], environment);

    expect(json.status).toBe(0);
    expect(json.stderr).toBe("");
    expect(agent.stdout).toBe(json.stdout);
    expect(both.stdout).toBe(json.stdout);
    expect(JSON.parse(json.stdout)).toMatchObject({
      ok: true,
      data: {
        ready: false,
        gatewaySkillVersion: "1.0.9",
        credential: { configured: false, source: null },
        gateway: { checked: false },
      },
      meta: {
        gatewaySkillVersion: "1.0.9",
        complete: true,
        operationId: "doctor",
        schemaId: "urn:weread:response:3:doctor",
      },
    });

    const raw = run(["--raw", "doctor"], environment);
    expect(raw.status).toBe(0);
    expect(JSON.parse(raw.stdout)).toMatchObject({ ready: false, credential: { configured: false } });
    expect(JSON.parse(raw.stdout)).not.toHaveProperty("ok");
  });

  it("wraps local config operations and never returns the full key", async () => {
    const environment = await isolatedEnvironment();
    const apiKey = "wrk-test-contract-key";

    const path = JSON.parse(run(["--json", "config", "path"], environment).stdout);
    expect(path).toMatchObject({
      ok: true,
      data: { path: expect.stringContaining("/weread/config.json") },
      meta: { operationId: "config.path", schemaId: "urn:weread:response:3:config.path" },
    });

    const saved = run(["--json", "config", "set-key", apiKey], environment);
    expect(saved.status).toBe(0);
    expect(saved.stdout).not.toContain(apiKey);
    expect(JSON.parse(saved.stdout)).toMatchObject({
      ok: true,
      data: { ok: true, apiKey: expect.stringContaining("...") },
      meta: { operationId: "config.set-key" },
    });

    const shown = run(["--json", "config", "show"], environment);
    expect(shown.stdout).not.toContain(apiKey);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      data: { hasApiKey: true, apiKey: expect.stringContaining("...") },
      meta: { operationId: "config.show" },
    });

    const cleared = JSON.parse(run(["--json", "config", "clear"], environment).stdout);
    expect(cleared).toMatchObject({ ok: true, data: { ok: true }, meta: { operationId: "config.clear" } });
  });

  it("uses structured invocation errors and reserves raw API access for --raw", async () => {
    const environment = await isolatedEnvironment();

    const cases = [
      { args: ["--json"], operationId: "invocation.error" },
      { args: ["--json", "missing"], operationId: "invocation.error" },
      { args: ["--json", "book", "info"], operationId: "book.info" },
      { args: ["--json", "operation", "describe", "missing.operation"], operationId: "operation.describe" },
      { args: ["--json", "search", "book", "--limit", "0"], operationId: "search" },
      { args: ["--json", "reviews", "batch", "--book-id", "1234", "--type", ","], operationId: "reviews.batch" },
      { args: ["--json", "api", "call", "/_list"], operationId: "invocation.error" },
      { args: ["--json", "--raw", "doctor"], operationId: "doctor" },
      { args: ["--agent", "--raw", "doctor"], operationId: "doctor" },
    ];
    for (const { args, operationId } of cases) {
      const result = run(args, environment);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stdout, args.join(" ")).toBe("");
      expect(JSON.parse(result.stderr), args.join(" ")).toMatchObject({
        ok: false,
        error: { code: "ARG_INVALID" },
        meta: {
          complete: false,
          operationId,
          schemaId: `urn:weread:response:3:${operationId}`,
        },
        warnings: [],
      });
    }

    const stableApiMisuse = JSON.parse(run(["--json", "api", "call", "/_list"], environment).stderr);
    expect(stableApiMisuse.meta).toMatchObject({
      operationId: "invocation.error",
      schemaId: "urn:weread:response:3:invocation.error",
    });
    expect(JSON.parse(run(["--json"], environment).stderr).error.message).toContain("weread operations");
    expect(run(["--agent", "missing"], environment).stderr)
      .toBe(run(["--json", "missing"], environment).stderr);

    const humanApi = run(["api", "call", "/_list"], environment);
    expect(humanApi.status).toBe(2);
    expect(humanApi.stdout).toBe("");
    expect(humanApi.stderr).toContain("Raw API calls require --raw");

    const rawApi = run(["--raw", "api", "call", "/_list"], environment);
    expect(rawApi.status).toBe(1);
    expect(rawApi.stdout).toBe("");
    expect(JSON.parse(rawApi.stderr)).toMatchObject({
      ok: false,
      error: { code: "AUTH_MISSING" },
    });
    expect(JSON.parse(rawApi.stderr)).not.toHaveProperty("meta");
  });

  it("advertises cursor inputs on the commands that return them", () => {
    const reviewBatch = JSON.parse(run([
      "--json", "operation", "describe", "reviews.batch",
    ]).stdout).data;
    expect(reviewBatch.input.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ flag: "--max-idx" }),
      expect.objectContaining({ flag: "--synckey" }),
    ]));

    const recommend = JSON.parse(run([
      "--json", "operation", "describe", "discover.recommend",
    ]).stdout).data;
    expect(recommend.pagination).toEqual({
      mode: "none",
      pageField: null,
      nextArgsField: null,
      nextArgvField: null,
    });
    expect(recommend.input.options.map((option: { flag: string }) => option.flag)).not.toContain("--max-idx");

    const corpus = JSON.parse(run([
      "--json", "operation", "describe", "notes.corpus",
    ]).stdout).data;
    expect(corpus.pagination).toMatchObject({
      mode: "cursor",
      pageField: "data.page",
      nextArgvField: "data.page.nextArgv",
    });
    expect(corpus.input.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ flag: "--limit", maximum: 50 }),
      expect.objectContaining({ flag: "--cursor", type: "string", pattern: expect.stringContaining("wrc1") }),
    ]));

    expect(run(["stats", "detail", "--help"]).stdout).not.toContain("--view");
    expect(run(["reviews", "batch", "--help"]).stdout).toContain("--synckey");
    expect(run(["notes", "corpus", "--help"]).stdout).toContain("--cursor");
  });

  it("honors notes corpus views in both human and stable output", () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      WEREAD_API_KEY: "wrk-test-key",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${mockGatewayPath}`].filter(Boolean).join(" "),
    };

    const thoughts = run([
      "notes", "corpus", "--book-id", "1234", "--view", "thoughts",
    ], environment);
    expect(thoughts.status).toBe(0);
    expect(thoughts.stdout).toContain("PERSONAL_THOUGHT_FIXTURE");
    expect(thoughts.stdout).not.toContain("SOURCE_HIGHLIGHT_FIXTURE");
    expect(thoughts.stdout).not.toContain("[划线]");

    const full = run([
      "notes", "corpus", "--book-id", "1234", "--view", "full",
    ], environment);
    expect(full.status).toBe(0);
    expect(full.stdout).toContain("SOURCE_HIGHLIGHT_FIXTURE");
    expect(full.stdout).toContain("PERSONAL_THOUGHT_FIXTURE");

    const stable = JSON.parse(run([
      "--json", "notes", "corpus", "--book-id", "1234", "--view", "thoughts",
    ], environment).stdout);
    expect(stable.data).toMatchObject({
      selection: {
        mode: "explicit-book-ids",
        requestedBooks: 1,
        notebookIndex: { returned: 1, totalBookCount: 3, indexExhausted: true },
      },
      page: { hasMore: false, nextArgs: null, nextArgv: null },
    });
    expect(stable.data.books[0]).not.toHaveProperty("highlights");
    expect(stable.data.books[0].book).toMatchObject({
      bookId: "1234",
      title: "Fixture Book",
      author: "Fixture Author",
      category: "Fixture Category",
    });
    expect(stable.data.books[0].thoughts[0].content).toBe("PERSONAL_THOUGHT_FIXTURE");
    expect(stable.data.books[0].thoughts[0].createdDate).toBe("2023-11-15");
    expect(stable.data.books[0].reviewsExhausted).toBe(true);

    const all = JSON.parse(run([
      "--json", "notes", "corpus", "--all-notebooks", "--view", "thoughts", "--limit", "1",
      "--skill-version", "1.0.8",
    ], environment).stdout);
    expect(all.meta.gatewaySkillVersion).toBe("1.0.8");
    expect(all.data.selection).toMatchObject({ mode: "all-notebooks", requestedBooks: 1 });
    expect(all.data.totals.books).toBe(1);
    expect(all.data.books[0].bookId).toBe("1234");
    expect(all.data.selection.notebookIndex).toMatchObject({
      returned: 1,
      totalBookCount: 3,
      indexExhausted: false,
    });
    expect(all.data.page.hasMore).toBe(true);
    expect(all.data.page.nextArgs["--cursor"]).toMatch(/^wrc1\./);
    expect(all.data.page.nextArgv).toEqual([
      "--json", "notes", "corpus", "--all-notebooks", "--view", "thoughts",
      "--limit", "1", "--cursor", all.data.page.nextArgs["--cursor"],
      "--skill-version", "1.0.8",
    ]);

    const continued = JSON.parse(run(all.data.page.nextArgv, environment).stdout);
    expect(continued.meta.gatewaySkillVersion).toBe("1.0.8");
    expect(continued.data.books[0].bookId).toBe("5678");
    expect(continued.data.page.hasMore).toBe(true);
    expect(continued.data.page.nextArgs["--cursor"]).toMatch(/^wrc1\./);

    const terminal = JSON.parse(run(continued.data.page.nextArgv, environment).stdout);
    expect(terminal.data.books[0].bookId).toBe("9012");
    expect(terminal.data.page).toEqual({ hasMore: false, nextArgs: null, nextArgv: null });
    expect(terminal.data.selection.notebookIndex.indexExhausted).toBe(true);
    expect([
      all.data.books[0].bookId,
      continued.data.books[0].bookId,
      terminal.data.books[0].bookId,
    ]).toEqual(["1234", "5678", "9012"]);

    const invalidCursorMode = run([
      "--json", "notes", "corpus", "--book-id", "1234", "--cursor", all.data.page.nextArgs["--cursor"],
    ], environment);
    expect(invalidCursorMode.status).toBe(2);
    expect(JSON.parse(invalidCursorMode.stderr).error.code).toBe("ARG_INVALID");

    const malformedCursor = run([
      "--json", "notes", "corpus", "--all-notebooks", "--cursor", "wrc1.not-canonical!",
    ], environment);
    expect(malformedCursor.status).toBe(2);
    expect(JSON.parse(malformedCursor.stderr).error.message).toContain("restart without --cursor");

    const oversizedPage = run([
      "--json", "notes", "corpus", "--all-notebooks", "--limit", "51",
    ], environment);
    expect(oversizedPage.status).toBe(2);
    expect(JSON.parse(oversizedPage.stderr).error.message).toContain("cannot exceed 50");

    const malformed = run([
      "--json", "notes", "corpus", "--book-id", "1234\n5678", "--view", "thoughts",
    ], environment);
    expect(malformed.status).toBe(2);
    expect(JSON.parse(malformed.stderr)).toMatchObject({
      ok: false,
      error: { code: "ARG_INVALID", message: expect.stringContaining("without whitespace") },
    });
  });

  it("preserves an environment-selected gateway version in executable page and batch continuations", () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      WEREAD_API_KEY: "wrk-test-key",
      WEREAD_SKILL_VERSION: "1.0.7",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${mockGatewayPath}`].filter(Boolean).join(" "),
    };

    const firstPage = JSON.parse(run([
      "--json", "notes", "notebooks", "--limit", "1",
    ], environment).stdout);
    expect(firstPage.meta.gatewaySkillVersion).toBe("1.0.7");
    expect(firstPage.data.page.nextArgv).toEqual([
      "--json", "notes", "notebooks", "--limit", "1", "--last-sort", "30",
      "--skill-version", "1.0.7",
    ]);

    const continuationEnvironment = { ...environment };
    delete continuationEnvironment.WEREAD_SKILL_VERSION;
    const continuedPage = JSON.parse(run(firstPage.data.page.nextArgv, continuationEnvironment).stdout);
    expect(continuedPage.meta.gatewaySkillVersion).toBe("1.0.7");
    expect(continuedPage.data.books[0].book.bookId).toBe("5678");

    const firstBatch = JSON.parse(run([
      "--json", "reviews", "batch", "--book-id", "1234", "--limit", "1",
    ], environment).stdout);
    expect(firstBatch.data.batches[0].page.nextArgv).toEqual([
      "--json", "reviews", "batch", "--book-id", "1234", "--type", "all", "--limit", "1",
      "--max-idx", "1", "--synckey", "1", "--skill-version", "1.0.7",
    ]);

    const continuedBatch = JSON.parse(run(
      firstBatch.data.batches[0].page.nextArgv,
      continuationEnvironment,
    ).stdout);
    expect(continuedBatch.meta.gatewaySkillVersion).toBe("1.0.7");
    expect(continuedBatch.data.batches[0]).toMatchObject({
      returned: 1,
      page: { hasMore: false, nextArgs: null, nextArgv: null },
      reviews: [{ reviewId: "public-review-2" }],
    });
  });

  it("keeps the Commander leaf surface in registry parity except for raw api.call", () => {
    const expected: Record<string, string[]> = {
      "": ["doctor", "operations", "operation", "config", "search", "book", "shelf", "stats", "notes", "reviews", "discover", "api"],
      operation: ["describe"],
      config: ["path", "set-key", "clear", "show"],
      book: ["resolve", "resolve-batch", "info", "chapters", "progress", "inspect", "inspect-batch"],
      shelf: ["summary", "list"],
      stats: ["detail", "trend", "history"],
      notes: ["notebooks", "export", "corpus", "popular"],
      reviews: ["list", "batch"],
      discover: ["recommend", "similar"],
      api: ["call"],
    };

    for (const [parent, commands] of Object.entries(expected)) {
      const args = parent ? [parent, "--help"] : ["--help"];
      expect(commandNames(run(args).stdout), parent || "root").toEqual(commands);
    }
  });
});

async function isolatedEnvironment(): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(join(tmpdir(), "weread-cli-test-"));
  temporaryDirectories.push(directory);
  const environment: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: directory };
  delete environment.WEREAD_API_KEY;
  return environment;
}

function run(args: string[], environment: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: environment,
  });
}

function commandNames(help: string): string[] {
  const commands = help.split("\nCommands:\n", 2)[1] ?? "";
  return [...commands.matchAll(/^  (\S+)/gm)]
    .map((match) => match[1]!)
    .filter((name) => name !== "help");
}
