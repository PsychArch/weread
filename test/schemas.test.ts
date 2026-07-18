import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { inspectBook, projectNotebooks, sampleThoughtNotebooks } from "../src/domain.js";
import { agentSuccess } from "../src/output.js";
import { STATS_FIELD_GUIDE, annotateHistoryPeriods, summarizeTrendPeriod } from "../src/stats.js";
import {
  CAPABILITIES_SCHEMA,
  CAPABILITIES_SCHEMA_ID,
  CAPABILITIES_MANIFEST_VERSION,
  JSON_SCHEMA_DIALECT,
  STABLE_OPERATIONS,
  agentSchemaId,
  dataSchemaFor,
  operationManifest,
  schemaFor,
} from "../src/schemas.js";

function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  return ajv;
}

describe("bundled JSON Schemas", () => {
  it("compiles every advertised response schema", () => {
    const ajv = validator();
    expect(() => ajv.compile(CAPABILITIES_SCHEMA)).not.toThrow();
    for (const operation of STABLE_OPERATIONS) {
      const schema = schemaFor(operation.id);
      expect(schema, operation.id).toBeDefined();
      expect(() => ajv.compile(schema!), operation.id).not.toThrow();
      expect(() => validator().compile(dataSchemaFor(operation.id)!), `${operation.id} data`).not.toThrow();
    }
  });

  it("validates the capabilities manifest and resolves every schema command", () => {
    const manifest = {
      schemaId: CAPABILITIES_SCHEMA_ID,
      schemaCommand: ["schema", "get", "capabilities"],
      manifestVersion: CAPABILITIES_MANIFEST_VERSION,
      schemaDialect: JSON_SCHEMA_DIALECT,
      executable: "weread",
      cliVersion: "0.1.0",
      gatewaySkillVersion: "1.0.5",
      authentication: ["WEREAD_API_KEY", "config"],
      outputModes: ["human", "raw-json", "agent"],
      operations: operationManifest(),
      rawGateway: { argv: ["--json", "api", "call"], stability: "upstream-shaped", schema: null },
      completeness: { metaComplete: "fetch completeness", warnings: "inspect warnings" },
      safety: { gatewayOperations: "read-only" },
    };
    const validate = validator().compile(CAPABILITIES_SCHEMA);

    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    for (const operation of manifest.operations) {
      expect(operation.command.argv[0], operation.id).toBe("--agent");
      expect(operation.command.helpArgv.at(-1), operation.id).toBe("--help");
      expect(operation.input).toMatchObject({ positionals: expect.any(Array), options: expect.any(Array), constraints: expect.any(Array) });
      expect(schemaFor(operation.id)?.$id).toBe(operation.output.schemaId);
      expect(dataSchemaFor(operation.id)?.$id).toBe(operation.output.dataSchemaId);
    }

    const selected = { ...manifest, operations: operationManifest("stats.history") };
    expect(validate(selected), JSON.stringify(validate.errors)).toBe(true);
    expect(selected.operations).toHaveLength(1);
    expect(selected.operations[0]?.input.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ flag: "--from", required: true, minimum: 1900 }),
      expect.objectContaining({ flag: "--to", required: true, maximum: 2100 }),
    ]));
  });

  it("keeps stable projections closed and history guarantees explicit", () => {
    for (const name of ["capabilities", ...STABLE_OPERATIONS.map((operation) => operation.id)]) {
      const schema = schemaFor(name)!;
      expect(findValues(schema, "additionalProperties")).not.toContain(true);
    }

    const history = {
      timeZone: "Asia/Shanghai",
      fromYear: 2024,
      toYear: 2024,
      fieldGuide: STATS_FIELD_GUIDE,
      periods: annotateHistoryPeriods([{ year: 2024, ...summarizeTrendPeriod({}, "annually") }]),
    };
    const validate = validator().compile(dataSchemaFor("stats.history")!);
    expect(validate(history), JSON.stringify(validate.errors)).toBe(true);

    const missingYear = structuredClone(history) as unknown as { periods: Array<Record<string, unknown>> };
    delete missingYear.periods[0]!.year;
    expect(validate(missingYear)).toBe(false);

    const missingAnalysis = structuredClone(history) as unknown as { periods: Array<Record<string, unknown>> };
    delete missingAnalysis.periods[0]!.historyAnalysis;
    expect(validate(missingAnalysis)).toBe(false);

    const wrongMode = structuredClone(history);
    wrongMode.periods[0]!.mode = "monthly";
    expect(validate(wrongMode)).toBe(false);

    expect(dataSchemaFor("stats.trend")?.$defs).toMatchObject({
      statsCategorySummary: {
        properties: {
          count: { description: expect.stringContaining("separately from readTime") },
          readTime: { description: expect.stringContaining("separately from count") },
        },
      },
      fieldGuide: {
        required: expect.arrayContaining(["categories"]),
      },
    });
  });

  it("validates representative notebook and inspection agent documents", () => {
    const notebooks = projectNotebooks({
      totalBookCount: 1,
      totalNoteCount: 3,
      hasMore: 0,
      books: [{
        noteCount: 1,
        reviewCount: 2,
        book: { bookId: "1", title: "Book", author: "Author" },
      }],
    });
    const notebookDocument = agentSuccess(notebooks, {
      operationId: "notes.notebooks",
      schemaId: agentSchemaId("notes.notebooks"),
    });
    const validateNotebooks = validator().compile(schemaFor("notes.notebooks")!);
    expect(validateNotebooks(notebookDocument), JSON.stringify(validateNotebooks.errors)).toBe(true);

    const sampleDocument = agentSuccess(sampleThoughtNotebooks(notebooks), {
      operationId: "notes.sample",
      schemaId: agentSchemaId("notes.sample"),
    });
    const validateSample = validator().compile(schemaFor("notes.sample")!);
    expect(validateSample(sampleDocument), JSON.stringify(validateSample.errors)).toBe(true);

    const validateResolved = validator().compile(dataSchemaFor("book.resolve")!);
    expect(validateResolved({
      query: "Book",
      match: "exact-title",
      bookId: "1",
      title: "Book",
      author: "Author",
    }), JSON.stringify(validateResolved.errors)).toBe(true);

    const inspection = inspectBook({
      bookId: "1",
      info: { bookId: "1", title: "Book", author: "Author", soldout: 0 },
      chapters: { chapters: [{ price: 0 }, { price: 10 }] },
      progress: { bookId: "1" },
      shelf: { books: [] },
      notebooks: { books: [] },
    });
    const inspectionDocument = agentSuccess(inspection, {
      operationId: "book.inspect",
      schemaId: agentSchemaId("book.inspect"),
    });
    const validateInspection = validator().compile(schemaFor("book.inspect")!);
    expect(validateInspection(inspectionDocument), JSON.stringify(validateInspection.errors)).toBe(true);
    expect(inspection.progress).toMatchObject({ percent: null, readingSeconds: null });

    const unexpected = structuredClone(inspectionDocument) as { data: { book: Record<string, unknown> } };
    unexpected.data.book.uncontracted = true;
    expect(validateInspection(unexpected)).toBe(false);
  });

  it("makes the notes corpus evidence paths and view scope machine-checkable", () => {
    const corpus = {
      view: "thoughts",
      contentScope: {
        includes: ["personal note/review entries"],
        excludes: ["bookmark positions", "standalone source-book highlights"],
        personalWordsField: "books[].thoughts[].content",
        sourceContextFields: ["books[].thoughts[].quotedText", "books[].thoughts[].contextText"],
        maxBookIdsPerCall: 50,
      },
      books: [],
      totals: {
        books: 0,
        sourceHighlights: 0,
        sourceThoughts: 0,
        returnedHighlights: 0,
        returnedThoughts: 0,
        returnedItems: 0,
        thoughtsWithText: 0,
        contextOnlyThoughts: 0,
        ratingOnlyThoughts: 0,
        emptyThoughts: 0,
      },
    };
    const validate = validator().compile(dataSchemaFor("notes.corpus")!);

    expect(validate(corpus), JSON.stringify(validate.errors)).toBe(true);

    const guessedPath = structuredClone(corpus);
    guessedPath.contentScope.personalWordsField = "thoughts[].content";
    expect(validate(guessedPath)).toBe(false);

    const mismatchedView = structuredClone(corpus);
    mismatchedView.contentScope.includes = ["highlights", "personal note/review entries"];
    expect(validate(mismatchedView)).toBe(false);
  });
});

function findValues(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => findValues(item, key));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([entryKey, child]) => [
    ...(entryKey === key ? [child] : []),
    ...findValues(child, key),
  ]);
}
