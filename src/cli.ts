#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { JsonObject, JsonValue, SKILL_VERSION, WereadClient, parseParam } from "./client.js";
import { clearConfig, configPath, findCredential, readConfig, redactKey, validateApiKey, writeConfig } from "./config.js";
import {
  asArray,
  asRecord,
  compactBook,
  fetchNotebooks,
  fetchNotes,
  inspectBook,
  limitShelfRaw,
  number,
  projectBookInfo,
  projectChapters,
  projectNotebooks,
  projectNotes,
  projectPopularHighlights,
  projectProgress,
  projectRecommendations,
  projectReviews,
  projectSearch,
  projectShelfEntries,
  projectSimilar,
  sampleThoughtNotebooks,
  text,
} from "./domain.js";
import { CliError } from "./errors.js";
import { formatDate, formatDuration, formatRating, formatStars, truncate } from "./format.js";
import { GlobalOptions, printError, printResult, setAgentMetadataProvider } from "./output.js";
import {
  CAPABILITIES_MANIFEST_VERSION,
  CAPABILITIES_SCHEMA_ID,
  JSON_SCHEMA_DIALECT,
  STABLE_OPERATIONS,
  dataSchemaFor,
  operationManifest,
  schemaFor,
  schemaIdForOperation,
  stableOperationFor,
} from "./schemas.js";
import {
  STATS_FIELD_GUIDE,
  StatsTrendPeriod,
  annotateHistoryPeriods,
  parsePeriodDate,
  statsHistoryRange,
  statsWarnings,
  summarizeStats,
  summarizeTrendPeriod,
} from "./stats.js";
import { VERSION } from "./version.js";

type UnknownRecord = Record<string, unknown>;

const scopeMap: Record<string, number> = {
  all: 0,
  book: 10,
  "web-novel": 16,
  audio: 14,
  author: 6,
  fulltext: 12,
  booklist: 13,
  mp: 2,
  article: 4,
};

const reviewTypeMap: Record<string, number> = {
  all: 0,
  recommend: 1,
  bad: 2,
  latest: 3,
  normal: 4,
};

const program = new Command();
program
  .name("weread")
  .description("Human- and agent-friendly CLI for the WeRead Agent Gateway.")
  .version(VERSION)
  .option("--json", "emit raw-compatible JSON; use --agent for a stable schema-backed contract")
  .option("--agent", "emit a compact, versioned JSON envelope for agents")
  .option("--skill-version <version>", "override the gateway protocol version");

let applicationClient: WereadClient | undefined;
let activeOperationId: string | undefined;
program.hook("preAction", (_rootCommand, actionCommand) => {
  activeOperationId = operationIdFor(actionCommand);
});
setAgentMetadataProvider(() => {
  const schemaId = schemaIdForOperation(activeOperationId);
  return {
    gatewaySkillVersion: applicationClient?.skillVersion ?? globalOptions().skillVersion ?? SKILL_VERSION,
    warnings: applicationClient?.getWarnings() ?? [],
    ...(activeOperationId ? { operationId: activeOperationId } : {}),
    ...(schemaId ? { schemaId } : {}),
  };
});

program
  .command("doctor")
  .description("check config and gateway reachability")
  .action(run(async () => {
    const config = await readConfig();
    const credential = await findCredential();
    const result: UnknownRecord = {
      ready: false,
      version: VERSION,
      gatewaySkillVersion: globalOptions().skillVersion ?? process.env.WEREAD_SKILL_VERSION?.trim() ?? SKILL_VERSION,
      credential: {
        configured: Boolean(credential),
        source: credential?.source ?? null,
      },
      config: {
        path: configPath(),
        hasApiKey: Boolean(config.apiKey),
      },
      gateway: {
        checked: false,
      },
    };

    if (credential) {
      try {
        await client().call("/_list");
        result.ready = true;
        result.gatewaySkillVersion = client().skillVersion;
        result.gateway = { checked: true, reachable: true };
      } catch (error) {
        result.gateway = {
          checked: true,
          reachable: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    printResult(globalOptions(), result, () => {
      const lines = [
        `weread ${VERSION}`,
        `config: ${configPath()}`,
        `credential: ${credential ? credential.source : "missing"}`,
      ];
      const gateway = result.gateway as UnknownRecord;
      if (gateway.checked) lines.push(`gateway: ${gateway.reachable ? "ok" : `failed (${gateway.message})`}`);
      else lines.push("gateway: skipped (missing credential)");
      return lines.join("\n");
    });
    if (result.ready !== true) process.exitCode = 1;
  }));

program
  .command("capabilities")
  .description("describe stable commands and how to discover their schemas")
  .option("--operation <operation-id>", "return one operation contract instead of the full catalog")
  .action(run(async (options: { operation?: string }) => {
    if (options.operation && !stableOperationFor(options.operation)) {
      throw new CliError("ARG_INVALID", `Unknown operation: ${options.operation}`);
    }
    const result = {
      schemaId: CAPABILITIES_SCHEMA_ID,
      schemaCommand: ["schema", "get", "capabilities"],
      manifestVersion: CAPABILITIES_MANIFEST_VERSION,
      schemaDialect: JSON_SCHEMA_DIALECT,
      executable: "weread",
      cliVersion: VERSION,
      gatewaySkillVersion: SKILL_VERSION,
      authentication: ["WEREAD_API_KEY", "config"],
      outputModes: ["human", "raw-json", "agent"],
      operations: operationManifest(options.operation),
      rawGateway: {
        argv: ["--json", "api", "call"],
        stability: "upstream-shaped",
        schema: null,
      },
      completeness: {
        metaComplete: "Whether the requested fetch/pagination completed, not whether every upstream statistical category is identifiable.",
        warnings: "Protocol retries and data-quality caveats that must be checked before analysis.",
      },
      safety: { gatewayOperations: "read-only" },
    };
    printResult(globalOptions(), result, () => {
      const selected = result.operations[0];
      if (options.operation && selected) {
        return [
          `${selected.id}: ${selected.description}`,
          `Run: weread ${selected.command.argv.join(" ")}`,
          `Data schema: weread ${selected.output.dataSchemaCommand.join(" ")}`,
          `Response schema: weread ${selected.output.schemaCommand.join(" ")}`,
        ].join("\n");
      }
      return [
        `weread ${VERSION} exposes ${result.operations.length} schema-backed agent operations.`,
        "Run `weread capabilities --operation <operation-id> --json` for one strict input/output contract.",
        "Run `weread capabilities --json` only when the full operation catalog is needed.",
        "Run `weread schema get capabilities` for the manifest's own strict JSON Schema.",
        "Run `weread schema get <operation-id> --data` for its compact data-payload schema.",
        "Raw gateway JSON is an upstream-shaped debugging escape hatch and has no stable schema.",
      ].join("\n");
    });
  }));

const schema = program.command("schema").description("inspect bundled JSON Schemas without network access");
schema
  .command("list")
  .description("list schema-backed operation IDs as concise text")
  .action(run(async () => {
    console.log(["capabilities", ...STABLE_OPERATIONS.map((operation) => operation.id)].join("\n"));
  }));
schema
  .command("get")
  .description("print one complete Draft 2020-12 JSON Schema, compact by default")
  .argument("<operation-id>", "operation ID from capabilities, or capabilities")
  .option("--data", "print the standalone data-payload schema without the common envelope")
  .option("--pretty", "indent the schema for human inspection")
  .action(run(async (operationId: string, options: { data?: boolean; pretty?: boolean }) => {
    if (options.data && operationId === "capabilities") {
      throw new CliError("ARG_INVALID", "The capabilities document is already a top-level manifest; omit --data.");
    }
    const result = options.data ? dataSchemaFor(operationId) : schemaFor(operationId);
    if (!result) throw new CliError("ARG_INVALID", `Unknown schema: ${operationId}`);
    console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
  }));

const config = program.command("config").description("manage local credentials");
config
  .command("path")
  .description("print config path")
  .action(run(async () => {
    printResult(globalOptions(), { path: configPath() }, () => configPath());
  }));

config
  .command("set-key")
  .description("store WeRead API key in local config")
  .argument("<api-key>", "API key beginning with wrk-")
  .action(run(async (apiKey: string) => {
    validateApiKey(apiKey);
    await writeConfig({ apiKey });
    printResult(globalOptions(), { ok: true, path: configPath(), apiKey: redactKey(apiKey) }, () => `Saved API key to ${configPath()}`);
  }));

config
  .command("clear")
  .description("remove local config")
  .action(run(async () => {
    await clearConfig();
    printResult(globalOptions(), { ok: true, path: configPath() }, () => `Removed ${configPath()}`);
  }));

config
  .command("show")
  .description("show redacted config")
  .action(run(async () => {
    const current = await readConfig();
    printResult(
      globalOptions(),
      { path: configPath(), hasApiKey: Boolean(current.apiKey), apiKey: redactKey(current.apiKey) },
      () => [`path: ${configPath()}`, `api key: ${current.apiKey ? redactKey(current.apiKey) : "missing"}`].join("\n"),
    );
  }));

program
  .command("search")
  .description("search WeRead")
  .argument("<keyword>", "search keyword")
  .option("--scope <scope>", "all|book|web-novel|audio|author|fulltext|booklist|mp|article", "book")
  .option("--limit <n>", "result count", parsePositiveInt, 10)
  .option("--max-idx <n>", "pagination offset from the previous response", parseNonNegativeInt, 0)
  .action(run(async (keyword: string, options: { scope: string; limit: number; maxIdx: number }) => {
    const scope = scopeNumber(options.scope);
    const result = await client().call("/store/search", {
      keyword,
      scope,
      count: options.limit,
      maxIdx: options.maxIdx,
    });
    const raw = limitSearchRaw(result, options.limit);
    printResult(globalOptions(), agentData(raw, projectSearch(result, options.limit)), () => renderSearch(raw));
  }));

const book = program.command("book").description("book information and reading progress");
book
  .command("resolve")
  .description("resolve a book name to a bookId")
  .argument("<name>", "book name")
  .action(run(async (name: string) => {
    const resolved = await resolveBook(name);
    const compact = compactResolvedBook(resolved);
    printResult(globalOptions(), agentData(resolved, compact), () => renderResolvedBook(resolved));
  }));

book
  .command("resolve-batch")
  .description("resolve up to 20 candidate book names in one schema-backed response")
  .requiredOption("--name <name>", "candidate book name; repeatable, maximum 20", collect, [])
  .action(run(async (options: { name: string[] }) => {
    const names = uniqueCandidateNames(options.name);
    const books: ReturnType<typeof compactResolvedBook>[] = [];
    const unresolved: Array<{ query: string; code: string; message: string }> = [];
    for (const name of names) {
      try {
        books.push(compactResolvedBook(await resolveBook(name)));
      } catch (error) {
        if (!(error instanceof CliError) || error.code !== "NOT_FOUND") throw error;
        unresolved.push({ query: name, code: error.code, message: error.message });
      }
    }
    const result = {
      requested: names.length,
      returned: books.length,
      unresolvedCount: unresolved.length,
      books,
      unresolved,
    };
    printResult(
      globalOptions(),
      result,
      () => [
        ...books.map((entry) => `${entry.query} -> ${entry.title} (${entry.bookId}) [${entry.match}]`),
        ...unresolved.map((entry) => `${entry.query} -> unresolved (${entry.code})`),
      ].join("\n"),
      { warnings: unresolved.length ? [`${unresolved.length} candidate name(s) could not be resolved.`] : [] },
    );
  }));

book
  .command("info")
  .description("show book information")
  .argument("<book-or-id>", "bookId or book name")
  .action(run(async (bookOrId: string) => {
    const bookId = await bookIdFromInput(bookOrId);
    const result = await client().call("/book/info", { bookId });
    printResult(globalOptions(), agentData(result, projectBookInfo(result)), () => renderBookInfo(result));
  }));

book
  .command("chapters")
  .description("show chapter table of contents")
  .argument("<book-or-id>", "bookId or book name")
  .action(run(async (bookOrId: string) => {
    const bookId = await bookIdFromInput(bookOrId);
    const result = await client().call("/book/chapterinfo", { bookId });
    printResult(globalOptions(), agentData(result, projectChapters(result, bookId)), () => renderChapters(result));
  }));

book
  .command("progress")
  .description("show reading progress")
  .argument("<book-or-id>", "bookId or book name")
  .action(run(async (bookOrId: string) => {
    const bookId = await bookIdFromInput(bookOrId);
    const result = await client().call("/book/getprogress", { bookId });
    printResult(globalOptions(), agentData(result, projectProgress(result, bookId)), () => renderProgress(result));
  }));

book
  .command("inspect")
  .description("inspect availability, progress, shelf, and note coverage for a book")
  .argument("<book-or-id>", "bookId or book name")
  .action(run(async (bookOrId: string) => {
    const bookId = await bookIdFromInput(bookOrId);
    const result = (await inspectBooks([bookId]))[0];
    if (!result) throw new CliError("NOT_FOUND", `No inspection result for ${bookId}`);
    printResult(globalOptions(), result, () => renderBookInspection(result));
  }));

book
  .command("inspect-batch")
  .description("inspect up to 20 book IDs while sharing shelf and notebook fetches")
  .requiredOption("--book-id <id>", "bookId to inspect; repeatable, maximum 20", collect, [])
  .action(run(async (options: { bookId: string[] }) => {
    const bookIds = uniqueBookIds(options.bookId, 20);
    const books = await inspectBooks(bookIds);
    const result = { returned: books.length, books };
    printResult(globalOptions(), result, () => books.map(renderBookInspection).join("\n\n"));
  }));

const shelf = program.command("shelf").description("bookshelf commands");
shelf
  .command("summary")
  .description("show shelf counts")
  .action(run(async () => {
    const result = await client().call("/shelf/sync");
    const summary = shelfSummary(result);
    printResult(globalOptions(), summary, () => renderShelfSummary(summary));
  }));

shelf
  .command("list")
  .description("list shelf entries")
  .option("--limit <n>", "maximum entries to show", parsePositiveInt, 50)
  .option("--all", "return every shelf entry")
  .action(run(async (options: { limit: number; all?: boolean }) => {
    const result = await client().call("/shelf/sync");
    const limit = options.all ? Number.POSITIVE_INFINITY : options.limit;
    const limited = limitShelfRaw(result, limit);
    const projected = projectShelfEntries(result, limit);
    const warnings = projected.hasMore
      ? [`Shelf list limited to ${projected.returned} of ${projected.total} entries; use --all for complete coverage.`]
      : [];
    printResult(
      globalOptions(),
      agentData(limited, projected),
      () => renderShelfList(limited, limit),
      { complete: !projected.hasMore, warnings },
    );
  }));

const stats = program.command("stats").description("reading statistics");
stats
  .command("detail")
  .description("show reading statistics detail")
  .option("--mode <mode>", "weekly|monthly|annually|overall", "monthly")
  .option("--base-time <timestamp>", "Unix timestamp inside target period", parseNonNegativeInt)
  .option("--date <date>", "date inside target period in Asia/Shanghai: YYYY, YYYY-MM, or YYYY-MM-DD")
  .option("--view <view>", "raw|summary", "raw")
  .addHelpText("after", `
Agent semantics:
  durations are seconds; dayAverageReadTime is a natural-calendar-day average
  compare is the ratio change in that average (0.2 means up 20%)
  weekly/monthly buckets are days, annually buckets are months, overall buckets are years
  --agent always returns the compact period contract; --view controls non-agent JSON only`)
  .action(run(async (options: { mode: string; baseTime?: number; date?: string; view: string }) => {
    if (!["weekly", "monthly", "annually", "overall"].includes(options.mode)) {
      throw new CliError("ARG_INVALID", "Mode must be weekly, monthly, annually, or overall.");
    }
    if (!["raw", "summary"].includes(options.view)) {
      throw new CliError("ARG_INVALID", "View must be raw or summary.");
    }
    if (options.baseTime !== undefined && options.date !== undefined) {
      throw new CliError("ARG_INVALID", "Use either --base-time or --date, not both.");
    }
    const params: JsonObject = { mode: options.mode };
    if (options.baseTime !== undefined) params.baseTime = options.baseTime;
    if (options.date !== undefined) params.baseTime = parseStatsDate(options.date);
    const result = await client().call("/readdata/detail", params);
    const period = summarizeTrendPeriod(result, options.mode);
    const output = globalOptions().agent
      ? { fieldGuide: STATS_FIELD_GUIDE, period }
      : options.view === "summary" ? summarizeStats(result, options.mode) : result;
    printResult(
      globalOptions(),
      output,
      () => renderStats(result, options.mode),
      { warnings: statsWarnings([period]) },
    );
  }));

stats
  .command("trend")
  .description("show compact weekly, monthly, annual, and overall reading trends")
  .addHelpText("after", `
Agent semantics:
  durations are seconds; dayAverageReadTime is a natural-calendar-day average
  compare is the ratio change in that average (0.2 means up 20%)
  inspect fieldGuide, dataQuality, meta.complete, and warnings before analysis`)
  .action(run(async () => {
    const modes = ["weekly", "monthly", "annually", "overall"] as const;
    const periods: StatsTrendPeriod[] = [];
    for (const mode of modes) {
      const result = await client().call("/readdata/detail", { mode });
      periods.push(summarizeTrendPeriod(result, mode));
    }
    const output = {
      timeZone: "Asia/Shanghai",
      historyRange: statsHistoryRange(periods, currentShanghaiYear()),
      fieldGuide: STATS_FIELD_GUIDE,
      periods,
    };
    printResult(
      globalOptions(),
      output,
      () => renderTrend(periods),
      { warnings: statsWarnings(periods) },
    );
  }));

stats
  .command("history")
  .description("show a bounded range of compact annual reading periods")
  .requiredOption("--from <year>", "first calendar year", parseYear)
  .requiredOption("--to <year>", "last calendar year", parseYear)
  .addHelpText("after", `
Agent semantics:
  returns one schema-backed response instead of requiring one CLI process per year
  the range is inclusive and limited to 20 years
  derive an unknown first year from stats trend's overall annual buckets; do not probe arbitrary early years
  use stats trend separately for the current weekly/monthly/overall snapshot`)
  .action(run(async (options: { from: number; to: number }) => {
    if (options.from > options.to) {
      throw new CliError("ARG_INVALID", "--from must be less than or equal to --to.");
    }
    if (options.to - options.from + 1 > 20) {
      throw new CliError("ARG_INVALID", "Stats history accepts at most 20 calendar years.");
    }
    const periods: Array<StatsTrendPeriod & { year: number }> = [];
    for (let year = options.from; year <= options.to; year += 1) {
      const result = await client().call("/readdata/detail", {
        mode: "annually",
        baseTime: parseStatsDate(`${year}-12-31`),
      });
      periods.push({ year, ...summarizeTrendPeriod(result, "annually") });
    }
    const annotatedPeriods = annotateHistoryPeriods(periods);
    const output = {
      timeZone: "Asia/Shanghai",
      fromYear: options.from,
      toYear: options.to,
      fieldGuide: STATS_FIELD_GUIDE,
      periods: annotatedPeriods,
    };
    printResult(
      globalOptions(),
      output,
      () => renderTrend(periods),
      { warnings: statsWarnings(annotatedPeriods) },
    );
  }));

const notes = program.command("notes").description("notes, highlights, and popular underlines");
notes
  .command("notebooks")
  .description("list books with notes")
  .option("--limit <n>", "maximum books when --all is absent", parsePositiveInt, 20)
  .option("--all", "fetch every page; ignores --limit")
  .action(run(async (options: { limit: number; all?: boolean }) => {
    const result = await fetchNotebooks(client(), options.limit, Boolean(options.all));
    const projected = projectNotebooks(result);
    const complete = asRecord(result).hasMore !== 1;
    const warnings = complete
      ? []
      : [`Notebook list limited to ${projected.returned} of ${projected.totalBookCount} books; use --all for complete coverage.`];
    printResult(
      globalOptions(),
      agentData(result, projected),
      () => renderNotebooks(result),
      { complete, warnings },
    );
  }));

notes
  .command("sample")
  .description("return one deterministic thought-book sample and its coverage")
  .action(run(async () => {
    const result = await fetchNotebooks(client(), 100, true);
    const index = projectNotebooks(result);
    const sample = sampleThoughtNotebooks(index);
    const complete = asRecord(result).hasMore !== 1;
    printResult(
      globalOptions(),
      sample,
      () => [
        `Selected ${sample.coverage.selectedBooks} of ${sample.index.booksWithThoughts} books with thoughts.`,
        `Thought coverage: ${sample.coverage.selectedThoughtCount}/${sample.index.totalThoughtCount} (${(sample.coverage.thoughtCoverageRatio * 100).toFixed(1)}%).`,
        `Book IDs: ${sample.bookIds.join(",")}`,
      ].join("\n"),
      { complete },
    );
  }));

notes
  .command("export")
  .description("export personal highlights and thoughts for one book")
  .argument("<book-or-id>", "bookId or book name")
  .option("--format <format>", "markdown|json", "markdown")
  .option("--output <path>", "write output to file")
  .action(run(async (bookOrId: string, options: { format: string; output?: string }) => {
    if (!["markdown", "json"].includes(options.format)) {
      throw new CliError("ARG_INVALID", "Format must be markdown or json.");
    }
    const bookId = await bookIdFromInput(bookOrId);
    const exported = await exportNotes(bookId);
    const content = options.format === "json" ? `${JSON.stringify(exported, null, 2)}\n` : renderNotesMarkdown(exported);
    if (options.output) {
      await writeFile(options.output, content, "utf8");
    }
    const result = options.output
      ? { bookId, output: options.output, format: options.format, bytes: Buffer.byteLength(content) }
      : agentData(exported, projectNotes(exported));
    printResult(
      globalOptions(),
      result,
      () => options.output ? `Wrote ${options.output}` : content.trimEnd(),
      { complete: asRecord(asRecord(exported).reviews).complete !== false },
    );
  }));

notes
  .command("corpus")
  .description("return a compact corpus of personal highlights and thoughts")
  .requiredOption("--book-id <id>", "bookId to include; repeatable, maximum 50", collect, [])
  .option("--view <view>", "full|thoughts; thoughts omits standalone source-book highlights", "full")
  .addHelpText("after", `
Content scope:
  exports highlights plus personal note/review entries, but not bookmark positions
  thoughts[].content contains the reader's own words
  thoughts[].quotedText/contextText contains source-book context, not the reader's words
  for large libraries, select a representative set or run batches with backoff`)
  .action(run(async (options: { bookId: string[]; view: string }) => {
    if (!["full", "thoughts"].includes(options.view)) {
      throw new CliError("ARG_INVALID", "View must be full or thoughts.");
    }
    const ids = uniqueBookIds(options.bookId);
    const fullBooks: ReturnType<typeof projectNotes>[] = [];
    let complete = true;
    for (const bookId of ids) {
      const projected = projectNotes(await exportNotes(bookId), false);
      fullBooks.push(projected);
      complete = complete && projected.complete;
    }
    const books = options.view === "thoughts"
      ? fullBooks.map(({ highlights: _highlights, ...book }) => book)
      : fullBooks;
    const sourceHighlights = fullBooks.reduce((sum, item) => sum + item.counts.highlights, 0);
    const sourceThoughts = fullBooks.reduce((sum, item) => sum + item.counts.thoughts, 0);
    const returnedHighlights = options.view === "thoughts" ? 0 : sourceHighlights;
    const output = {
      view: options.view,
      contentScope: {
        includes: options.view === "thoughts"
          ? ["personal note/review entries"]
          : ["highlights", "personal note/review entries"],
        excludes: options.view === "thoughts"
          ? ["bookmark positions", "standalone source-book highlights"]
          : ["bookmark positions"],
        personalWordsField: "books[].thoughts[].content",
        sourceContextFields: ["books[].thoughts[].quotedText", "books[].thoughts[].contextText"],
        maxBookIdsPerCall: 50,
      },
      books,
      totals: {
        books: fullBooks.length,
        sourceHighlights,
        sourceThoughts,
        returnedHighlights,
        returnedThoughts: sourceThoughts,
        returnedItems: returnedHighlights + sourceThoughts,
        thoughtsWithText: fullBooks.reduce((sum, item) => sum + item.counts.thoughtsWithText, 0),
        contextOnlyThoughts: fullBooks.reduce((sum, item) => sum + item.counts.contextOnlyThoughts, 0),
        ratingOnlyThoughts: fullBooks.reduce((sum, item) => sum + item.counts.ratingOnlyThoughts, 0),
        emptyThoughts: fullBooks.reduce((sum, item) => sum + item.counts.emptyThoughts, 0),
      },
    };
    printResult(globalOptions(), output, () => renderNotesCorpus(fullBooks), { complete });
  }));

notes
  .command("popular")
  .description("show popular highlights for a book")
  .argument("<book-or-id>", "bookId or book name")
  .option("--chapter-uid <uid>", "chapter UID", parseNonNegativeInt)
  .option("--limit <n>", "maximum highlights (gateway maximum: 20)", parsePopularLimit, 20)
  .action(run(async (bookOrId: string, options: { chapterUid?: number; limit: number }) => {
    const bookId = await bookIdFromInput(bookOrId);
    const params: JsonObject = { bookId };
    if (options.chapterUid !== undefined) params.chapterUid = options.chapterUid;
    const result = await client().call("/book/bestbookmarks", params);
    const raw = limitArrayField(result, "items", options.limit);
    printResult(globalOptions(), agentData(raw, projectPopularHighlights(result, options.limit)), () => renderPopularHighlights(raw));
  }));

const reviews = program.command("reviews").description("public book reviews");
reviews
  .command("list")
  .description("list public reviews for a book")
  .argument("<book-or-id>", "bookId or book name")
  .option("--type <type>", "all|recommend|bad|latest|normal", "all")
  .option("--limit <n>", "review count", parsePositiveInt, 20)
  .option("--max-content-chars <n>", "maximum review text per compact item", parsePositiveInt, 800)
  .option("--max-idx <n>", "pagination offset from the previous response", parseNonNegativeInt, 0)
  .option("--synckey <n>", "pagination cursor from the previous response", parseNonNegativeInt, 0)
  .action(run(async (bookOrId: string, options: { type: string; limit: number; maxContentChars: number; maxIdx: number; synckey: number }) => {
    const bookId = await bookIdFromInput(bookOrId);
    const reviewListType = reviewTypeNumber(options.type);
    const result = await client().call("/review/list", {
      bookId,
      reviewListType,
      count: options.limit,
      maxIdx: options.maxIdx,
      synckey: options.synckey,
    });
    const raw = limitArrayField(result, "reviews", options.limit);
    printResult(
      globalOptions(),
      agentData(raw, projectReviews(result, bookId, options.type, options.limit, options.maxContentChars)),
      () => renderReviews(raw),
    );
  }));

reviews
  .command("batch")
  .description("fetch bounded public reviews for multiple books and review types")
  .requiredOption("--book-id <id>", "bookId to include; repeatable", collect, [])
  .option("--type <type>", "all|recommend|bad|latest|normal; repeatable or comma-separated", collect, [])
  .option("--limit <n>", "maximum reviews per book and type", parsePositiveInt, 5)
  .option("--max-content-chars <n>", "maximum review text per compact item", parsePositiveInt, 800)
  .action(run(async (options: { bookId: string[]; type: string[]; limit: number; maxContentChars: number }) => {
    const bookIds = uniqueBookIds(options.bookId);
    const requestedTypes = options.type.length ? options.type : ["all"];
    const types = [...new Set(requestedTypes.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
    const batches: ReturnType<typeof projectReviews>[] = [];
    for (const bookId of bookIds) {
      for (const type of types) {
        const result = await client().call("/review/list", {
          bookId,
          reviewListType: reviewTypeNumber(type),
          count: options.limit,
          maxIdx: 0,
          synckey: 0,
        });
        batches.push(projectReviews(result, bookId, type, options.limit, options.maxContentChars));
      }
    }
    printResult(globalOptions(), { batches }, () => renderReviewBatches(batches));
  }));

const discover = program.command("discover").description("recommendation commands");
discover
  .command("recommend")
  .description("show personalized recommendations")
  .option("--limit <n>", "recommendation count", parsePositiveInt, 12)
  .option("--max-idx <n>", "pagination offset from the previous response", parseNonNegativeInt, 0)
  .action(run(async (options: { limit: number; maxIdx: number }) => {
    const result = await client().call("/book/recommend", { count: options.limit, maxIdx: options.maxIdx });
    const raw = limitArrayField(result, "books", options.limit);
    printResult(globalOptions(), agentData(raw, projectRecommendations(result, options.limit)), () => renderRecommend(raw));
  }));

discover
  .command("similar")
  .description("show books similar to a book")
  .argument("<book-or-id>", "bookId or book name")
  .option("--limit <n>", "recommendation count", parsePositiveInt, 12)
  .option("--max-idx <n>", "pagination offset from the previous response", parseNonNegativeInt, 0)
  .option("--session-id <id>", "pagination session ID from the previous response")
  .action(run(async (bookOrId: string, options: { limit: number; maxIdx: number; sessionId?: string }) => {
    const bookId = await bookIdFromInput(bookOrId);
    const result = await client().call("/book/similar", {
      bookId,
      count: options.limit,
      maxIdx: options.maxIdx,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    });
    const raw = limitSimilarRaw(result, options.limit);
    printResult(globalOptions(), agentData(raw, projectSimilar(result, options.limit)), () => renderSimilar(raw));
  }));

const api = program.command("api").description("raw gateway escape hatch");
api
  .command("call")
  .description("call a raw gateway API with configured auth")
  .argument("<api-name>", "gateway API name such as /store/search")
  .option("--param <key=value>", "flat business parameter; repeatable", collect, [])
  .action(run(async (apiName: string, options: { param: string[] }) => {
    const params: JsonObject = {};
    for (const raw of options.param) {
      const [key, value] = parseParam(raw);
      params[key] = value;
    }
    const result = await client().call(apiName, params);
    printResult(globalOptions(), result, () => JSON.stringify(result, null, 2));
  }));

await program.parseAsync(process.argv);

function run<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
  return async (...args: T): Promise<void> => {
    try {
      await fn(...args);
    } catch (error) {
      printError(globalOptions(), error);
      process.exitCode = 1;
    }
  };
}

function globalOptions(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

function operationIdFor(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;
  while (current?.parent) {
    names.unshift(current.name());
    current = current.parent;
  }
  return names.join(".");
}

function client(): WereadClient {
  applicationClient ??= new WereadClient({
    ...(globalOptions().skillVersion ? { skillVersion: globalOptions().skillVersion } : {}),
  });
  return applicationClient;
}

function agentData<T, U>(raw: T, compact: U): T | U {
  return globalOptions().agent ? compact : raw;
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError("ARG_INVALID", `Expected a positive integer, got ${value}`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError("ARG_INVALID", `Expected a non-negative integer, got ${value}`);
  }
  return parsed;
}

function parseYear(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
    throw new CliError("ARG_INVALID", `Expected a calendar year from 1900 to 2100, got ${value}`);
  }
  return parsed;
}

function parsePopularLimit(value: string): number {
  const parsed = parsePositiveInt(value);
  if (parsed > 20) {
    throw new CliError("ARG_INVALID", "Popular highlight limit cannot exceed the gateway maximum of 20.");
  }
  return parsed;
}

function scopeNumber(scope: string): number {
  const value = scopeMap[scope];
  if (value === undefined) {
    throw new CliError("ARG_INVALID", `Unknown scope: ${scope}`);
  }
  return value;
}

function reviewTypeNumber(type: string): number {
  const value = reviewTypeMap[type];
  if (value === undefined) {
    throw new CliError("ARG_INVALID", `Unknown review type: ${type}`);
  }
  return value;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function uniqueBookIds(values: string[], maximum = 50): string[] {
  const ids = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!ids.length) throw new CliError("ARG_INVALID", "Provide at least one --book-id.");
  if (ids.length > maximum) {
    throw new CliError("ARG_INVALID", `At most ${maximum} book IDs may be requested at once.`);
  }
  return ids;
}

function uniqueCandidateNames(values: string[]): string[] {
  const names = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!names.length) throw new CliError("ARG_INVALID", "Provide at least one --name.");
  if (names.length > 20) throw new CliError("ARG_INVALID", "At most 20 candidate names may be resolved at once.");
  return names;
}

function parseStatsDate(value: string): number {
  try {
    return parsePeriodDate(value);
  } catch (error) {
    throw new CliError("ARG_INVALID", error instanceof Error ? error.message : String(error));
  }
}

function currentShanghaiYear(): number {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(new Date()));
}

function limitArrayField(result: unknown, field: string, limit: number): UnknownRecord {
  const record = asRecord(result);
  return { ...record, [field]: asArray(record[field]).slice(0, limit) };
}

function limitSearchRaw(result: unknown, limit: number): UnknownRecord {
  const record = asRecord(result);
  let remaining = limit;
  const results = asArray(record.results).map((value) => {
    const group = asRecord(value);
    const books = asArray(group.books).slice(0, Math.max(0, remaining));
    remaining -= books.length;
    return { ...group, books };
  });
  return { ...record, results };
}

function limitSimilarRaw(result: unknown, limit: number): UnknownRecord {
  const record = asRecord(result);
  const similar = asRecord(record.booksimilar);
  return {
    ...record,
    booksimilar: { ...similar, books: asArray(similar.books).slice(0, limit) },
  };
}

function isProbablyBookId(value: string): boolean {
  return /^\d{4,}$/.test(value) || /^(?:[A-Za-z]+_)+[A-Za-z0-9_]+$/.test(value);
}

async function bookIdFromInput(input: string): Promise<string> {
  if (isProbablyBookId(input)) return input;
  return (await resolveBook(input)).bookId;
}

async function inspectBooks(bookIds: string[]): Promise<ReturnType<typeof inspectBook>[]> {
  const [shelfResult, notebookResult] = await Promise.all([
    client().call("/shelf/sync"),
    fetchNotebooks(client(), 100, true),
  ]);
  const results: ReturnType<typeof inspectBook>[] = [];
  for (const bookId of bookIds) {
    const [info, chapters, progress] = await Promise.all([
      client().call("/book/info", { bookId }),
      client().call("/book/chapterinfo", { bookId }),
      client().call("/book/getprogress", { bookId }),
    ]);
    results.push(inspectBook({
      bookId,
      info,
      chapters,
      progress,
      shelf: shelfResult,
      notebooks: notebookResult,
    }));
  }
  return results;
}

interface ResolvedBook {
  query: string;
  bookId: string;
  title: string;
  author: string;
  match: "exact-title" | "first-search-result";
  rating?: number;
  deepLink?: string;
  candidates: unknown[];
}

async function resolveBook(query: string): Promise<ResolvedBook> {
  query = query.trim();
  if (!query) throw new CliError("ARG_INVALID", "Book name cannot be empty.");
  const result = await client().call("/store/search", { keyword: query, scope: 10, count: 10 });
  const candidates = searchBooks(result);
  const exact = candidates.find((candidate) => text(asRecord(asRecord(candidate).bookInfo).title) === query);
  const selected = asRecord(exact ?? candidates[0]);
  const bookInfo = asRecord(selected.bookInfo);
  const bookId = text(bookInfo.bookId);
  const rating = number(selected.newRating) ?? number(bookInfo.newRating);
  if (!bookId) {
    throw new CliError("NOT_FOUND", `No book found for ${query}`);
  }
  return {
    query,
    bookId,
    title: text(bookInfo.title),
    author: text(bookInfo.author),
    match: exact ? "exact-title" : "first-search-result",
    ...(rating !== undefined ? { rating } : {}),
    ...(text(bookInfo.deepLink) ? { deepLink: text(bookInfo.deepLink) } : {}),
    candidates,
  };
}

function compactResolvedBook(resolved: ResolvedBook) {
  return {
    query: resolved.query,
    match: resolved.match,
    ...compactBook({
      bookInfo: {
        bookId: resolved.bookId,
        title: resolved.title,
        author: resolved.author,
        ...(resolved.deepLink ? { deepLink: resolved.deepLink } : {}),
        ...(resolved.rating !== undefined ? { newRating: resolved.rating } : {}),
      },
    }),
  };
}

function searchBooks(result: unknown): unknown[] {
  const groups = asArray(asRecord(result).results);
  return groups.flatMap((group) => asArray(asRecord(group).books));
}

function renderResolvedBook(book: ResolvedBook): string {
  return [
    `${book.title || book.query} (${book.bookId})`,
    book.author ? `作者: ${book.author}` : undefined,
    book.rating ? `评分: ${formatRating(book.rating)}` : undefined,
    book.deepLink ? `打开: ${book.deepLink}` : undefined,
  ].filter(Boolean).join("\n");
}

function renderSearch(result: unknown): string {
  const groups = asArray(asRecord(result).results);
  if (groups.length === 0) return "No results.";
  const lines: string[] = [];
  for (const group of groups) {
    const record = asRecord(group);
    lines.push(`## ${text(record.title) || `scope ${record.scope ?? ""}`}`.trim());
    const books = asArray(record.books);
    books.forEach((item, index) => {
      const itemRecord = asRecord(item);
      const info = asRecord(itemRecord.bookInfo);
      lines.push(`${index + 1}. ${text(info.title) || "-"} - ${text(info.author) || "-"} · ${formatRating(itemRecord.newRating)} · ${text(info.category) || "-"}`);
      if (info.deepLink) lines.push(`   ${text(info.deepLink)}`);
    });
  }
  return lines.join("\n");
}

function renderBookInfo(result: unknown): string {
  const record = asRecord(result);
  return [
    `${text(record.title) || "-"} (${text(record.bookId) || "-"})`,
    `作者: ${text(record.author) || "-"}`,
    record.translator ? `译者: ${text(record.translator)}` : undefined,
    `评分: ${formatRating(record.newRating)} (${record.newRatingCount ?? 0}人)`,
    record.category ? `分类: ${text(record.category)}` : undefined,
    record.publisher ? `出版社: ${text(record.publisher)}` : undefined,
    record.wordCount ? `字数: ${record.wordCount}` : undefined,
    "",
    truncate(record.intro, 500),
    text(record.deepLink) ? `\n打开: ${text(record.deepLink)}` : undefined,
  ].filter((line) => line !== undefined).join("\n");
}

function renderChapters(result: unknown): string {
  const record = asRecord(result);
  const chapters = asArray(record.chapters);
  return chapters.map((chapter) => {
    const item = asRecord(chapter);
    const level = Math.max(1, num(item.level) || 1);
    const indent = "  ".repeat(level - 1);
    const paid = num(item.price) > 0 && item.paid !== 1 ? " [付费]" : "";
    return `${indent}- ${text(item.title) || "-"} (${item.chapterUid ?? "-"})${paid}`;
  }).join("\n") || "No chapters.";
}

function renderProgress(result: unknown): string {
  const record = asRecord(result);
  const nestedBook = asRecord(record.book);
  const book = Object.keys(nestedBook).length ? nestedBook : record;
  const readingSeconds = number(book.readingTime) ?? number(book.recordReadingTime) ?? 0;
  const lines = [
    `进度: ${book.progress ?? 0}%`,
    `章节: ${book.chapterUid ?? "-"}`,
    `累计阅读: ${formatDuration(readingSeconds)}`,
    `最后阅读: ${formatDate(book.updateTime)}`,
  ];
  if (book.progress === 100 && book.finishTime) lines.push(`读完时间: ${formatDate(book.finishTime)}`);
  if (record.deepLink) lines.push(`继续阅读: ${text(record.deepLink)}`);
  return lines.join("\n");
}

interface ShelfSummary {
  books: number;
  albums: number;
  mp: number;
  total: number;
  publicCount: number;
  secretCount: number;
}

function shelfSummary(result: unknown): ShelfSummary {
  const record = asRecord(result);
  const books = asArray(record.books);
  const albums = asArray(record.albums);
  const mp = record.mp ? 1 : 0;
  const secretBooks = books.filter((book) => asRecord(book).secret === 1).length;
  const secretAlbums = albums.filter((album) => asRecord(asRecord(album).albumInfoExtra).secret === 1).length;
  return {
    books: books.length,
    albums: albums.length,
    mp,
    total: books.length + albums.length + mp,
    publicCount: books.length - secretBooks + albums.length - secretAlbums,
    secretCount: secretBooks + secretAlbums + mp,
  };
}

function renderShelfSummary(summary: ShelfSummary): string {
  return [
    `书架共有 ${summary.total} 个可见条目：${summary.books} 个书籍条目 + ${summary.albums} 个专辑/有声书 + ${summary.mp} 个文章收藏。`,
    `公开阅读 ${summary.publicCount} 个，私密阅读 ${summary.secretCount} 个。`,
  ].join("\n");
}

function renderShelfList(result: unknown, limit: number): string {
  const record = asRecord(result);
  const entries: string[] = [];
  for (const book of asArray(record.books)) {
    const item = asRecord(book);
    entries.push(`${entries.length + 1}. ${text(item.title) || "-"} - ${text(item.author) || "-"} · 电子书 · ${formatDate(item.readUpdateTime)}${item.deepLink ? `\n   ${text(item.deepLink)}` : ""}`);
  }
  for (const album of asArray(record.albums)) {
    const info = asRecord(asRecord(album).albumInfo);
    entries.push(`${entries.length + 1}. ${text(info.name) || "-"} - ${text(info.authorName) || "-"} · 专辑/有声书 · ${info.trackCount ?? 0}集`);
  }
  if (record.mp) entries.push(`${entries.length + 1}. 文章收藏 · 文章收藏入口`);
  return entries.slice(0, limit).join("\n") || "Shelf is empty.";
}

function renderStats(result: unknown, mode: string): string {
  const summary = summarizeStats(result, mode);
  const lines = [
    `周期: ${mode}`,
    `阅读天数: ${summary.readDays ?? 0}天`,
    `总时长: ${formatDuration(summary.totalReadTime)}`,
    `自然日均: ${formatDuration(summary.dayAverageReadTime)}`,
  ];
  if (typeof summary.compare === "number") {
    lines.push(`与上期相比: ${(summary.compare * 100).toFixed(1)}%`);
  }
  if (summary.topBooks.length) {
    lines.push("", "读得最多:");
    summary.topBooks.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.title || "-"} · ${formatDuration(entry.readTime)}`);
    });
  }
  if (summary.categories.length) {
    lines.push("", "偏好分类:");
    summary.categories.slice(0, 5).forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.title || "-"} · ${formatDuration(entry.readTime)}`);
    });
  }
  if (summary.authors.length) {
    lines.push("", "偏好作者:");
    summary.authors.slice(0, 5).forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.name || "-"} · ${entry.readTime ?? "-"}`);
    });
  }
  return lines.join("\n");
}

function renderTrend(periods: StatsTrendPeriod[]): string {
  return periods.map((period) => [
    `${period.mode}: ${formatDuration(period.totalReadTime)} · ${period.readDays ?? 0}天`,
    `  ${period.bucketGranularity} buckets: ${period.buckets.length}`,
    period.topBooks[0]?.title ? `  top: ${period.topBooks[0].title}` : undefined,
  ].filter(Boolean).join("\n")).join("\n");
}

function renderBookInspection(value: unknown): string {
  const result = asRecord(value);
  const book = asRecord(result.book);
  const availability = asRecord(result.availability);
  const chapters = asRecord(result.chapters);
  const progress = asRecord(result.progress);
  const shelf = asRecord(result.shelf);
  const notebook = asRecord(result.notebook);
  const progressText = progress.percent === null ? "未记录" : `${progress.percent ?? 0}%`;
  const readingText = progress.readingSeconds === null ? "未记录" : formatDuration(progress.readingSeconds);
  return [
    `${text(book.title) || text(book.bookId)} - ${text(book.author) || "-"}`,
    `可读: ${availability.readable ? "是" : "否"}${availability.reason ? ` (${availability.reason})` : ""}`,
    `章节: ${chapters.count ?? 0} · 免费 ${chapters.freeCount ?? 0} · 已购 ${chapters.purchasedCount ?? 0}`,
    `进度: ${progressText} · 累计 ${readingText}`,
    `书架: ${shelf.present ? "有" : "无"} · 笔记本: ${notebook.present ? "有" : "无"}`,
    book.deepLink ? `打开: ${text(book.deepLink)}` : undefined,
  ].filter((line) => line !== undefined).join("\n");
}

function renderNotebooks(result: unknown): string {
  const books = asArray(asRecord(result).books);
  if (!books.length) return "No notebooks.";
  return books.map((entry, index) => {
    const item = asRecord(entry);
    const book = asRecord(item.book);
    const total = num(item.reviewCount) + num(item.noteCount) + num(item.bookmarkCount);
    return `${index + 1}. ${text(book.title) || "-"} - ${text(book.author) || "-"} · 总笔记 ${total} · 想法/点评 ${item.reviewCount ?? 0} · 划线 ${item.noteCount ?? 0} · 书签 ${item.bookmarkCount ?? 0} · 进度 ${item.readingProgress ?? 0}%`;
  }).join("\n");
}

async function exportNotes(bookId: string): Promise<UnknownRecord> {
  return fetchNotes(client(), bookId);
}

function renderNotesMarkdown(exported: UnknownRecord): string {
  const bookmarks = asRecord(exported.bookmarks);
  const reviews = asRecord(exported.reviews);
  const book = asRecord(bookmarks.book);
  const bookId = text(exported.bookId);
  const chapters = new Map<string, string>();
  for (const chapter of asArray(bookmarks.chapters)) {
    const item = asRecord(chapter);
    chapters.set(String(item.chapterUid ?? ""), text(item.title));
  }

  const lines = [
    `# ${text(book.title) || bookId}`,
    "",
    `- Book ID: ${bookId}`,
    ...(text(book.deepLink) ? [`- Open: ${text(book.deepLink)}`] : []),
    "",
    "## 划线",
    "",
  ];

  const highlights = asArray(bookmarks.updated);
  if (!highlights.length) lines.push("_No exported highlights._", "");
  for (const item of highlights) {
    const mark = asRecord(item);
    const chapterUid = String(mark.chapterUid ?? "");
    const title = chapters.get(chapterUid) || `Chapter ${chapterUid}`;
    lines.push(`### ${title}`);
    lines.push("");
    lines.push(`> ${text(mark.markText)}`);
    lines.push("");
    lines.push(`- Date: ${formatDate(mark.createTime)}`);
    if (mark.deepLink) lines.push(`- Link: ${text(mark.deepLink)}`);
    lines.push("");
  }

  lines.push("## 想法/点评", "");
  const reviewItems = asArray(reviews.reviews);
  if (!reviewItems.length) lines.push("_No personal thoughts or reviews._", "");
  for (const item of reviewItems) {
    const wrapper = asRecord(item);
    const review = asRecord(wrapper.review);
    lines.push(`- ${formatDate(review.createTime)} ${review.chapterName ? `(${text(review.chapterName)}) ` : ""}${truncate(review.content, 500)}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderNotesCorpus(books: ReturnType<typeof projectNotes>[]): string {
  if (!books.length) return "No notes.";
  return books.map((book) => {
    const title = book.book.title || book.bookId;
    const lines = [`# ${title}`, `划线 ${book.counts.highlights} · 想法 ${book.counts.thoughts}`];
    for (const highlight of book.highlights) {
      lines.push(`- [划线] ${highlight.chapterTitle ? `${highlight.chapterTitle}: ` : ""}${highlight.text}`);
    }
    for (const thought of book.thoughts) {
      const body = thought.content
        || ("quotedText" in thought && thought.quotedText ? `[仅摘录] ${thought.quotedText}` : "")
        || ("rating" in thought && thought.rating !== undefined ? `[仅评分] ${thought.rating}/5` : "")
        || "[空记录]";
      lines.push(`- [个人条目] ${thought.chapterTitle ? `${thought.chapterTitle}: ` : ""}${body}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

function renderPopularHighlights(result: unknown): string {
  const items = asArray(asRecord(result).items);
  if (!items.length) return "No popular highlights.";
  return items.map((item, index) => {
    const mark = asRecord(item);
    return `${index + 1}. ${truncate(mark.markText, 180)}\n   ${mark.totalCount ?? 0}人划线 · chapter ${mark.chapterUid ?? "-"} · range ${mark.range ?? "-"}`;
  }).join("\n");
}

function renderReviews(result: unknown): string {
  const reviews = asArray(asRecord(result).reviews);
  if (!reviews.length) return "No reviews.";
  return reviews.map((item, index) => {
    const review = asRecord(asRecord(asRecord(item).review).review);
    const author = asRecord(review.author);
    return `${index + 1}. ${text(author.name) || "-"} · ${formatStars(review.star)} · ${formatDate(review.createTime)}\n${truncate(review.content || review.htmlContent, 220)}`;
  }).join("\n\n");
}

function renderReviewBatches(batches: ReturnType<typeof projectReviews>[]): string {
  if (!batches.length) return "No reviews.";
  return batches.map((batch) => {
    const lines = [`${batch.bookId} / ${batch.type} (${batch.returned})`];
    batch.reviews.forEach((review, index) => {
      lines.push(`${index + 1}. ${review.author || "-"}: ${truncate(review.content, 220)}`);
    });
    return lines.join("\n");
  }).join("\n\n");
}

function renderRecommend(result: unknown): string {
  const books = asArray(asRecord(result).books);
  if (!books.length) return "No recommendations.";
  return books.map((item, index) => {
    const book = asRecord(item);
    return `${index + 1}. ${text(book.title) || "-"} - ${text(book.author) || "-"} · ${formatRating(book.newRating)}\n   ${truncate(book.reason || book.intro, 140)}${book.deepLink ? `\n   ${text(book.deepLink)}` : ""}`;
  }).join("\n");
}

function renderSimilar(result: unknown): string {
  const similar = asRecord(asRecord(result).booksimilar);
  const books = asArray(similar.books);
  if (!books.length) return "No similar books.";
  return books.map((item, index) => {
    const info = asRecord(asRecord(asRecord(item).book).bookInfo);
    return `${index + 1}. ${text(info.title) || "-"} - ${text(info.author) || "-"} (${text(info.bookId) || "-"})${info.deepLink ? `\n   ${text(info.deepLink)}` : ""}`;
  }).join("\n");
}
