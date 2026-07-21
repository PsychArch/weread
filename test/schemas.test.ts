import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { inspectBook, projectNotebooks } from "../src/domain.js";
import { jsonSuccess } from "../src/output.js";
import { annotateHistoryPeriods, summarizeTrendPeriod } from "../src/stats.js";
import {
  INVOCATION_ERROR_OPERATION_ID,
  STABLE_OPERATIONS,
  dataSchemaFor,
  describeOperation,
  operationsCatalog,
  responseSchemaId,
  schemaFor,
} from "../src/schemas.js";

const EXPECTED_OPERATION_IDS = [
  "operations.list",
  "operation.describe",
  "invocation.error",
  "doctor",
  "config.path",
  "config.show",
  "config.set-key",
  "config.clear",
  "search",
  "stats.detail",
  "stats.trend",
  "stats.history",
  "book.resolve",
  "book.resolve-batch",
  "book.info",
  "book.chapters",
  "book.progress",
  "book.inspect",
  "book.inspect-batch",
  "shelf.summary",
  "shelf.list",
  "notes.notebooks",
  "notes.export",
  "notes.corpus",
  "notes.popular",
  "reviews.list",
  "reviews.batch",
  "discover.recommend",
  "discover.similar",
] as const;

function validator() {
  return new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
}

describe("bundled JSON Schemas", () => {
  it("registers every structured response contract and no task-specific sample workflow", () => {
    expect(STABLE_OPERATIONS.map((operation) => operation.id)).toEqual(EXPECTED_OPERATION_IDS);
    expect(STABLE_OPERATIONS.some((operation) => operation.id === "notes.sample")).toBe(false);
  });

  it("compiles every advertised response and data schema", () => {
    for (const operation of STABLE_OPERATIONS) {
      const responseSchema = schemaFor(operation.id);
      const dataSchema = dataSchemaFor(operation.id);
      expect(responseSchema, operation.id).toBeDefined();
      expect(dataSchema, operation.id).toBeDefined();
      expect(() => validator().compile(responseSchema!), `${operation.id} response`).not.toThrow();
      expect(() => validator().compile(dataSchema!), `${operation.id} data`).not.toThrow();
    }
  });

  it("makes discovery small and each operation descriptor self-contained", () => {
    const catalog = operationsCatalog();
    expect(catalog).toMatchObject({
      contractVersion: "1",
      executable: "weread",
      rawEscape: {
        argv: ["--raw", "api", "call"],
        stability: "upstream-shaped",
        responseSchema: null,
      },
    });
    expect(catalog.operations.map((operation) => operation.id)).toEqual(EXPECTED_OPERATION_IDS);

    const describeDataSchema = validator().compile(dataSchemaFor("operation.describe")!);
    for (const operation of STABLE_OPERATIONS) {
      const descriptor = describeOperation(operation.id)!;
      expect(descriptor).toMatchObject({
        id: operation.id,
        invocation: {
          executable: "weread",
          argv: operation.argv,
          jsonArgv: ["--json", ...operation.argv],
        },
        output: {
          schemaId: responseSchemaId(operation.id),
          responseSchema: {
            $id: responseSchemaId(operation.id),
            $defs: { data: operation.dataSchema },
          },
          dataSchemaRef: "#/$defs/data",
        },
      });
      expect(descriptor.output).not.toHaveProperty("dataSchema");
      expect(describeDataSchema(descriptor), JSON.stringify(describeDataSchema.errors)).toBe(true);
    }
    expect(describeOperation("missing.operation")).toBeUndefined();
  });

  it("publishes an error-only contract for unmatched stable invocations", () => {
    const descriptor = describeOperation(INVOCATION_ERROR_OPERATION_ID)!;
    expect(descriptor).toMatchObject({
      id: INVOCATION_ERROR_OPERATION_ID,
      invocation: {
        argv: [],
        jsonArgv: ["--json"],
        helpArgv: ["--help"],
      },
      output: {
        schemaId: responseSchemaId(INVOCATION_ERROR_OPERATION_ID),
      },
    });

    const validate = validator().compile(schemaFor(INVOCATION_ERROR_OPERATION_ID)!);
    const error = {
      ok: false,
      error: { code: "ARG_INVALID", message: "unknown command" },
      meta: {
        schemaVersion: "3",
        gatewaySkillVersion: "1.0.5",
        complete: false,
        timeZone: "Asia/Shanghai",
        operationId: INVOCATION_ERROR_OPERATION_ID,
        schemaId: responseSchemaId(INVOCATION_ERROR_OPERATION_ID),
      },
      warnings: [],
    };
    expect(validate(error), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(jsonSuccess({}, {
      operationId: INVOCATION_ERROR_OPERATION_ID,
      schemaId: responseSchemaId(INVOCATION_ERROR_OPERATION_ID),
    }))).toBe(false);
  });

  it("keeps every advertised continuation argument executable", () => {
    const expectedOptions: Record<string, string[]> = {
      search: ["--max-idx", "--session-id"],
      "shelf.list": ["--all"],
      "notes.notebooks": ["--last-sort"],
      "notes.corpus": ["--cursor"],
      "reviews.list": ["--max-idx", "--synckey"],
      "reviews.batch": ["--max-idx", "--synckey"],
      "discover.similar": ["--max-idx", "--session-id"],
    };

    for (const [operationId, flags] of Object.entries(expectedOptions)) {
      const descriptor = describeOperation(operationId)!;
      expect(descriptor.pagination.nextArgsField).not.toBeNull();
      expect(descriptor.pagination.nextArgvField).not.toBeNull();
      const accepted = descriptor.input.options.map((option) => option.flag);
      for (const flag of flags) expect(accepted, `${operationId} ${flag}`).toContain(flag);
    }
    expect(describeOperation("discover.recommend")?.pagination).toMatchObject({
      mode: "none",
      pageField: null,
      nextArgsField: null,
      nextArgvField: null,
    });
  });

  it("requires a usable continuation exactly when hasMore is true", () => {
    const validate = validator().compile(dataSchemaFor("search")!);
    const base = { queryResultCount: 1, books: [{ bookId: "1", title: "One", author: "" }] };

    const searchNextArgv = [
      "--json", "search", "term", "--scope", "book", "--limit", "1",
      "--max-idx", "7", "--session-id", "sid", "--skill-version", "1.0.5",
    ];
    expect(validate({
      ...base,
      page: {
        hasMore: true,
        nextArgs: { "--max-idx": 7, "--session-id": "sid" },
        nextArgv: searchNextArgv,
      },
    })).toBe(true);
    expect(validate({
      ...base,
      page: {
        hasMore: true,
        nextArgs: { "--max-idx": 7, "--session-id": "sid" },
        nextArgv: searchNextArgv.slice(0, -2),
      },
    })).toBe(false);
    expect(validate({ ...base, page: { hasMore: true, nextArgs: null, nextArgv: null } })).toBe(false);
    expect(validate({ ...base, page: { hasMore: true, nextArgs: {}, nextArgv: searchNextArgv } })).toBe(false);
    expect(validate({ ...base, page: { hasMore: true, nextArgs: { "--max-idx": 7 }, nextArgv: searchNextArgv } })).toBe(false);
    expect(validate({ ...base, page: { hasMore: true, nextArgs: { "--all": true }, nextArgv: searchNextArgv } })).toBe(false);
    expect(validate({ ...base, page: { hasMore: false, nextArgs: null, nextArgv: null } })).toBe(true);
    expect(validate({
      ...base,
      page: { hasMore: false, nextArgs: { "--max-idx": 7, "--session-id": "sid" }, nextArgv: searchNextArgv },
    })).toBe(false);

    const validateShelf = validator().compile(dataSchemaFor("shelf.list")!);
    const shelf = { returned: 0, total: 1, archives: [], entries: [] };
    expect(validateShelf({
      ...shelf,
      page: {
        hasMore: true,
        nextArgs: { "--all": true },
        nextArgv: ["--json", "shelf", "list", "--all", "--skill-version", "1.0.5"],
      },
    })).toBe(true);
    expect(validateShelf({
      ...shelf,
      page: {
        hasMore: true,
        nextArgs: { "--all": false },
        nextArgv: ["--json", "shelf", "list", "--all", "--skill-version", "1.0.5"],
      },
    })).toBe(false);

    const validateNotebooks = validator().compile(dataSchemaFor("notes.notebooks")!);
    const notebooks = {
      returned: 0,
      totalBookCount: 1,
      totalNoteCount: 0,
      syncKey: null,
      noBookReviewCount: null,
      books: [],
    };
    const notebookNextArgv = [
      "--json", "notes", "notebooks", "--limit", "20", "--last-sort", "10",
      "--skill-version", "1.0.5",
    ];
    expect(validateNotebooks({
      ...notebooks,
      page: { hasMore: true, nextArgs: { "--last-sort": 10 }, nextArgv: notebookNextArgv },
    })).toBe(true);
    expect(validateNotebooks({
      ...notebooks,
      page: { hasMore: true, nextArgs: { "--max-idx": 10 }, nextArgv: notebookNextArgv },
    })).toBe(false);

    const validateCorpus = validator().compile(dataSchemaFor("notes.corpus")!);
    const corpus = {
      view: "thoughts",
      selection: {
        mode: "all-notebooks",
        requestedBooks: 0,
        notebookIndex: { returned: 2, totalBookCount: 2, indexExhausted: false },
      },
      contentScope: {
        includes: ["personal note/review entries"],
        excludes: ["bookmark positions", "standalone source-book highlights"],
        personalWordsField: "books[].thoughts[].content",
        sourceContextFields: ["books[].thoughts[].quotedText", "books[].thoughts[].contextText"],
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
    const corpusCursor = "wrc1.eyJsYXN0U29ydCI6MTAsImxhc3RCb29rSWQiOiIxIiwiZW1pdHRlZCI6MSwidG90YWxCb29rQ291bnQiOjJ9";
    const corpusNextArgv = [
      "--json", "notes", "corpus", "--all-notebooks", "--view", "thoughts",
      "--limit", "1", "--cursor", corpusCursor, "--skill-version", "1.0.5",
    ];
    expect(validateCorpus({
      ...corpus,
      page: { hasMore: true, nextArgs: { "--cursor": corpusCursor }, nextArgv: corpusNextArgv },
    }), JSON.stringify(validateCorpus.errors)).toBe(true);
    expect(validateCorpus({
      ...corpus,
      selection: {
        ...corpus.selection,
        notebookIndex: { ...corpus.selection.notebookIndex, indexExhausted: true },
      },
      page: { hasMore: true, nextArgs: { "--cursor": corpusCursor }, nextArgv: corpusNextArgv },
    })).toBe(false);
    expect(validateCorpus({
      ...corpus,
      page: { hasMore: true, nextArgs: { "--cursor": corpusCursor }, nextArgv: notebookNextArgv },
    })).toBe(false);

    const validateReviews = validator().compile(dataSchemaFor("reviews.list")!);
    const reviews = { bookId: "1", type: "latest", returned: 0, reviews: [] };
    const reviewNextArgv = [
      "--json", "reviews", "list", "1", "--type", "latest", "--limit", "20",
      "--max-idx", "2", "--synckey", "3", "--skill-version", "1.0.5",
    ];
    expect(validateReviews({
      ...reviews,
      page: { hasMore: true, nextArgs: { "--max-idx": 2, "--synckey": 3 }, nextArgv: reviewNextArgv },
    })).toBe(true);
    expect(validateReviews({
      ...reviews,
      page: { hasMore: true, nextArgs: { "--max-idx": 2 }, nextArgv: reviewNextArgv },
    })).toBe(false);
  });

  it("discriminates notes corpus views and selection continuations", () => {
    const validate = validator().compile(dataSchemaFor("notes.corpus")!);
    const contentFields = {
      personalWordsField: "books[].thoughts[].content",
      sourceContextFields: ["books[].thoughts[].quotedText", "books[].thoughts[].contextText"],
    };
    const book = {
      book: { bookId: "1", title: "One", author: "Author" },
      bookId: "1",
      counts: {
        highlights: 1,
        thoughts: 0,
        thoughtsWithText: 0,
        contextOnlyThoughts: 0,
        ratingOnlyThoughts: 0,
        emptyThoughts: 0,
        total: 1,
      },
      reviewsExhausted: true,
      thoughts: [],
    };
    const terminalPage = { hasMore: false, nextArgs: null, nextArgv: null };
    const selection = {
      mode: "explicit-book-ids",
      requestedBooks: 1,
      notebookIndex: { returned: 1, totalBookCount: 1, indexExhausted: true },
    };
    const totals = {
      books: 1,
      sourceHighlights: 1,
      sourceThoughts: 0,
      returnedHighlights: 0,
      returnedThoughts: 0,
      returnedItems: 0,
      thoughtsWithText: 0,
      contextOnlyThoughts: 0,
      ratingOnlyThoughts: 0,
      emptyThoughts: 0,
    };
    const thoughtsCorpus = {
      view: "thoughts",
      selection,
      page: terminalPage,
      contentScope: {
        includes: ["personal note/review entries"],
        excludes: ["bookmark positions", "standalone source-book highlights"],
        ...contentFields,
      },
      books: [book],
      totals,
    };
    const fullCorpus = {
      ...thoughtsCorpus,
      view: "full",
      contentScope: {
        includes: ["highlights", "personal note/review entries"],
        excludes: ["bookmark positions"],
        ...contentFields,
      },
      books: [{
        ...book,
        highlights: [{
          chapterUid: "1",
          chapterTitle: "Chapter",
          text: "Source highlight",
          createdAt: null,
          createdDate: null,
        }],
      }],
      totals: { ...totals, returnedHighlights: 1, returnedItems: 1 },
    };

    expect(validate(fullCorpus), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fullCorpus, books: [book] })).toBe(false);
    expect(validate({
      ...fullCorpus,
      contentScope: { ...fullCorpus.contentScope, includes: ["personal note/review entries"] },
    })).toBe(false);
    expect(validate({
      ...fullCorpus,
      contentScope: {
        ...fullCorpus.contentScope,
        excludes: ["bookmark positions", "standalone source-book highlights"],
      },
    })).toBe(false);

    expect(validate(thoughtsCorpus), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...thoughtsCorpus, books: [{ ...book, highlights: [] }] })).toBe(false);
    expect(validate({
      ...thoughtsCorpus,
      contentScope: {
        ...thoughtsCorpus.contentScope,
        includes: ["highlights", "personal note/review entries"],
      },
    })).toBe(false);
    expect(validate({
      ...thoughtsCorpus,
      contentScope: { ...thoughtsCorpus.contentScope, excludes: ["bookmark positions"] },
    })).toBe(false);

    const corpusCursor = "wrc1.eyJsYXN0U29ydCI6MTAsImxhc3RCb29rSWQiOiIxIiwiZW1pdHRlZCI6MSwidG90YWxCb29rQ291bnQiOjJ9";
    const continuationPage = {
      hasMore: true,
      nextArgs: { "--cursor": corpusCursor },
      nextArgv: [
        "--json", "notes", "corpus", "--all-notebooks", "--view", "thoughts",
        "--limit", "1", "--cursor", corpusCursor, "--skill-version", "1.0.5",
      ],
    };
    const continuedAllNotebooks = {
      ...thoughtsCorpus,
      selection: {
        ...selection,
        mode: "all-notebooks",
        notebookIndex: { ...selection.notebookIndex, indexExhausted: false },
      },
      page: continuationPage,
    };
    expect(validate(continuedAllNotebooks), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({
      ...continuedAllNotebooks,
      selection: { ...continuedAllNotebooks.selection, mode: "explicit-book-ids" },
    })).toBe(false);
    expect(validate({
      ...continuedAllNotebooks,
      selection: {
        ...continuedAllNotebooks.selection,
        notebookIndex: { ...continuedAllNotebooks.selection.notebookIndex, indexExhausted: true },
      },
    })).toBe(false);

    const terminalAllNotebooks = {
      ...thoughtsCorpus,
      selection: { ...selection, mode: "all-notebooks" },
    };
    expect(validate(terminalAllNotebooks), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({
      ...terminalAllNotebooks,
      selection: {
        ...terminalAllNotebooks.selection,
        notebookIndex: { ...terminalAllNotebooks.selection.notebookIndex, indexExhausted: false },
      },
    })).toBe(false);
  });

  it("separates successful command completion from collection breadth", () => {
    const document = jsonSuccess({
      queryResultCount: 1,
      page: {
        hasMore: true,
        nextArgs: { "--max-idx": 7, "--session-id": "sid" },
        nextArgv: [
          "--json", "search", "term", "--scope", "book", "--limit", "1",
          "--max-idx", "7", "--session-id", "sid",
        ],
      },
      books: [{ bookId: "1", title: "One", author: "" }],
    }, {
      operationId: "search",
      schemaId: responseSchemaId("search"),
    });
    const validate = validator().compile(schemaFor("search")!);

    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    const incomplete = structuredClone(document);
    incomplete.meta.complete = false;
    expect(validate(incomplete)).toBe(false);
  });

  it("validates representative neutral stats, notebook, and inspection documents", () => {
    const history = {
      timeZone: "Asia/Shanghai",
      asOfDate: "2026-07-20",
      historyRange: {
        earliestSupportedYear: 2017,
        firstNonzeroYear: 2024,
        lastCompleteYear: 2025,
        currentYear: 2026,
        source: "stats.trend.overall.buckets",
      },
      fromYear: 2024,
      toYear: 2024,
      periods: annotateHistoryPeriods([{ year: 2024, ...summarizeTrendPeriod({}, "annually") }], "2026-07-20"),
    };
    const validateHistory = validator().compile(dataSchemaFor("stats.history")!);
    expect(validateHistory(history), JSON.stringify(validateHistory.errors)).toBe(true);
    expect(history.periods[0]).not.toHaveProperty("derivedMetrics");
    expect(history.periods[0]).not.toHaveProperty("historyAnalysis");

    const currentHistoryData = {
      ...history,
      fromYear: 2026,
      toYear: 2026,
      periods: annotateHistoryPeriods([
        { year: 2026, ...summarizeTrendPeriod({}, "annually") },
      ], "2026-07-20"),
    };
    const currentHistory = jsonSuccess(currentHistoryData, {
      operationId: "stats.history",
      schemaId: responseSchemaId("stats.history"),
    });
    const validateHistoryEnvelope = validator().compile(schemaFor("stats.history")!);
    expect(validateHistoryEnvelope(currentHistory), JSON.stringify(validateHistoryEnvelope.errors)).toBe(true);
    expect(currentHistory.meta.complete).toBe(true);
    expect(currentHistoryData.periods[0]?.periodComplete).toBe(false);

    const notebooks = projectNotebooks({
      totalBookCount: 1,
      totalNoteCount: 3,
      hasMore: 0,
      books: [{
        sort: 10,
        markedStatus: 2,
        noteCount: 1,
        reviewCount: 2,
        book: { bookId: "1", title: "Book", author: "Author" },
      }],
    });
    const validateNotebooks = validator().compile(dataSchemaFor("notes.notebooks")!);
    expect(validateNotebooks(notebooks), JSON.stringify(validateNotebooks.errors)).toBe(true);
    expect(notebooks.books[0]).toMatchObject({ readingProgress: null, markedStatus: 2, sort: 10 });

    const inspection = inspectBook({
      bookId: "1",
      info: { bookId: "1", title: "Book", author: "Author", soldout: 0 },
      chapters: { chapters: [{ price: 0 }, { price: 10 }] },
      progress: { bookId: "1" },
      shelf: { books: [] },
      notebooks: { books: [] },
    });
    const validateInspection = validator().compile(dataSchemaFor("book.inspect")!);
    expect(validateInspection(inspection), JSON.stringify(validateInspection.errors)).toBe(true);
    expect(inspection.progress).toMatchObject({
      percent: null,
      readingSeconds: null,
      recordReadingSeconds: null,
      listeningSeconds: null,
    });
  });

  it("keeps stable projections closed while allowing embedded JSON Schemas", () => {
    for (const operation of STABLE_OPERATIONS) {
      const schema = schemaFor(operation.id)!;
      expect(findValues(schema, "additionalProperties"), operation.id).not.toContain(true);
    }

    const inspectionSchema = validator().compile(dataSchemaFor("book.inspect")!);
    const inspection = inspectBook({
      bookId: "1",
      info: { bookId: "1", title: "Book", author: "Author" },
      chapters: { chapters: [] },
      progress: { bookId: "1" },
      shelf: { books: [] },
      notebooks: { books: [] },
    }) as unknown as { book: Record<string, unknown> };
    inspection.book.uncontracted = true;
    expect(inspectionSchema(inspection)).toBe(false);
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
