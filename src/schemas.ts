export type JsonSchema = Record<string, unknown>;

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
export const CAPABILITIES_MANIFEST_VERSION = "2";
export const CAPABILITIES_SCHEMA_ID = "urn:weread:capabilities:2";

type InputValueType = "string" | "integer" | "boolean" | "string[]";

export interface OperationPositional {
  name: string;
  type: "string" | "integer";
  required: boolean;
  description: string;
}

export interface OperationOption {
  name: string;
  flag: string;
  type: InputValueType;
  required: boolean;
  repeatable: boolean;
  description: string;
  default?: string | number | boolean | string[];
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  acceptsCommaSeparated?: boolean;
}

export interface OperationInput {
  positionals: OperationPositional[];
  options: OperationOption[];
  constraints: string[];
}

export interface StableOperation {
  id: string;
  argv: string[];
  description: string;
  input: OperationInput;
}

const COMPACT_BOOK_PROPERTIES: Record<string, JsonSchema> = {
  bookId: { type: "string" },
  title: { type: "string" },
  author: { type: "string" },
  category: { type: "string" },
  categories: { type: "array", items: { type: "string" } },
  publisher: { type: "string" },
  rating: { type: "number", minimum: 0, maximum: 10 },
  ratingScale: { const: 10 },
  intro: { type: "string" },
  deepLink: { type: "string" },
  translator: { type: "string" },
  ratingCount: { type: "number", minimum: 0 },
  wordCount: { type: "number", minimum: 0 },
  lastChapterIndex: { type: "number", minimum: 0 },
  soldOut: { type: "boolean" },
};

const STATS_PERIOD_REQUIRED = [
  "mode",
  "bucketGranularity",
  "buckets",
  "counts",
  "topBooks",
  "categories",
  "authors",
  "dataQuality",
];

const STATS_PERIOD_PROPERTIES: Record<string, JsonSchema> = {
  mode: { enum: ["weekly", "monthly", "annually", "overall"] },
  year: { type: "integer" },
  baseTime: { type: "number" },
  totalReadTime: { type: "number", minimum: 0 },
  wrReadTime: { type: "number", minimum: 0 },
  wrListenTime: { type: "number", minimum: 0 },
  readDays: { type: "number", minimum: 0 },
  dayAverageReadTime: { type: "number", minimum: 0 },
  compare: { type: "number" },
  comparison: {
    type: "object",
    required: ["ratio", "percent", "direction", "basis"],
    properties: {
      ratio: { type: "number" },
      percent: { type: "number" },
      direction: { enum: ["up", "down", "unchanged"] },
      basis: { const: "natural-day-average" },
    },
    additionalProperties: false,
  },
  preferTimeWord: { type: "string" },
  preferCategoryWord: { type: "string" },
  bucketGranularity: { enum: ["day", "month", "year"] },
  buckets: {
    type: "array",
    items: {
      type: "object",
      required: ["startDate", "seconds"],
      properties: { startDate: { type: "string" }, seconds: { type: "number", minimum: 0 } },
      additionalProperties: false,
    },
  },
  counts: {
    type: "array",
    items: {
      type: "object",
      required: ["label", "value"],
      properties: { label: { type: "string" }, value: { type: "string" } },
      additionalProperties: false,
    },
  },
  topBooks: { type: "array", items: { $ref: "#/$defs/statsBookSummary" } },
  categories: { type: "array", items: { $ref: "#/$defs/statsCategorySummary" } },
  authors: { type: "array", items: { $ref: "#/$defs/statsAuthorSummary" } },
  dataQuality: { $ref: "#/$defs/statsDataQuality" },
};

const COMMON_DEFS: Record<string, JsonSchema> = {
  jsonValue: {
    oneOf: [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "null" },
      { type: "array", items: { $ref: "#/$defs/jsonValue" } },
      { type: "object", additionalProperties: { $ref: "#/$defs/jsonValue" } },
    ],
  },
  compactBook: {
    type: "object",
    required: ["bookId", "title", "author"],
    properties: COMPACT_BOOK_PROPERTIES,
    additionalProperties: false,
  },
  resolvedBook: {
    type: "object",
    required: ["query", "match", "bookId", "title", "author"],
    properties: {
      query: { type: "string" },
      match: {
        enum: ["exact-title", "first-search-result"],
        description: "Whether the returned title exactly matched the query or was the first search result.",
      },
      ...COMPACT_BOOK_PROPERTIES,
    },
    additionalProperties: false,
  },
  sampleBook: {
    type: "object",
    required: ["bookId", "title", "author"],
    properties: {
      bookId: { type: "string" },
      title: { type: "string" },
      author: { type: "string" },
      category: { type: "string" },
      categories: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
  thoughtSampleEntry: {
    type: "object",
    required: ["book", "thoughtCount", "updatedAt", "selectedBy", "addedCategories"],
    properties: {
      book: { $ref: "#/$defs/sampleBook" },
      thoughtCount: { type: "integer", minimum: 1 },
      updatedAt: { type: ["string", "null"], format: "date-time" },
      selectedBy: { enum: ["all-thought-books", "high-thought-count", "recent-notebook-update", "new-category", "fill"] },
      addedCategories: { type: "array", uniqueItems: true, items: { type: "string" } },
    },
    additionalProperties: false,
  },
  recommendationBook: {
    type: "object",
    required: ["bookId", "title", "author"],
    properties: { ...COMPACT_BOOK_PROPERTIES, reason: { type: "string" } },
    additionalProperties: false,
  },
  progress: {
    type: "object",
    required: ["bookId", "percent", "chapterUid", "readingSeconds", "updatedAt"],
    properties: {
      bookId: { type: "string" },
      percent: {
        type: ["number", "null"],
        minimum: 0,
        maximum: 100,
        description: "Reading progress percentage. Null means the upstream response did not report progress; it is not coerced to zero.",
      },
      chapterUid: { type: "string" },
      readingSeconds: {
        type: ["number", "null"],
        minimum: 0,
        description: "Cumulative reading duration in seconds. Null means the upstream response did not report a duration.",
      },
      updatedAt: { type: ["string", "null"], format: "date-time" },
      finishedAt: { type: ["string", "null"], format: "date-time" },
    },
    additionalProperties: false,
  },
  notebookSummary: {
    type: "object",
    required: ["book", "highlightCount", "bookmarkCount", "thoughtCount", "totalNoteCount", "readingProgress", "updatedAt"],
    properties: {
      book: { $ref: "#/$defs/compactBook" },
      highlightCount: { type: "integer", minimum: 0, description: "Saved source-text highlights, normalized from upstream noteCount." },
      bookmarkCount: { type: "integer", minimum: 0, description: "Saved bookmark positions; their text is not exportable through notes corpus." },
      thoughtCount: { type: "integer", minimum: 0, description: "Personal thought/review entries, normalized from upstream reviewCount." },
      totalNoteCount: { type: "integer", minimum: 0, description: "highlightCount + bookmarkCount + thoughtCount for this book." },
      readingProgress: { type: "number", minimum: 0, maximum: 100, description: "Notebook-reported reading progress percentage." },
      updatedAt: { type: ["string", "null"], format: "date-time" },
    },
    additionalProperties: false,
  },
  highlight: {
    type: "object",
    required: ["chapterUid", "chapterTitle", "text", "createdAt"],
    properties: {
      chapterUid: { type: "string" },
      chapterTitle: { type: "string" },
      text: { type: "string", description: "Source-book text, not the reader's own words." },
      createdAt: { type: ["string", "null"], format: "date-time" },
      range: { type: "string" },
      deepLink: { type: "string" },
    },
    additionalProperties: false,
  },
  thought: {
    type: "object",
    required: ["reviewId", "chapterUid", "chapterTitle", "entryKind", "content", "createdAt"],
    properties: {
      reviewId: { type: "string" },
      chapterUid: { type: "string" },
      chapterTitle: { type: "string" },
      entryKind: { enum: ["comment-on-text", "personal-comment", "excerpt-only", "rating-only", "empty"] },
      content: { type: "string", description: "The reader's own words; empty for non-text entries." },
      quotedText: { type: "string", description: "Quoted source-book text, not the reader's own words." },
      contextText: { type: "string", description: "Source-book context, not the reader's own words." },
      range: { type: "string" },
      createdAt: { type: ["string", "null"], format: "date-time" },
      sourceType: { type: "number" },
      rating: { type: "number", minimum: 0, maximum: 5 },
      ratingScale: { const: 5 },
    },
    additionalProperties: false,
  },
  statsDataQuality: {
    type: "object",
    required: ["unidentifiedRankedItems"],
    properties: {
      unidentifiedRankedItems: { type: "integer", minimum: 0 },
      durationBreakdownMatchesTotal: { type: "boolean" },
    },
    additionalProperties: false,
  },
  statsBookSummary: {
    type: "object",
    required: ["title", "author", "tags"],
    properties: {
      title: { type: "string" },
      author: { type: "string" },
      readTime: { type: "number", minimum: 0, description: "Reading duration in seconds." },
      tags: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
  statsCategorySummary: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      count: {
        type: "number",
        minimum: 0,
        description: "Upstream category item count for the period. Rank it separately from readTime.",
      },
      readTime: {
        type: "number",
        minimum: 0,
        description: "Category reading duration in seconds. Rank it separately from count.",
      },
    },
    additionalProperties: false,
  },
  statsAuthorSummary: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      count: { type: "number", minimum: 0 },
      readTime: { type: "string", description: "Upstream author reading-time display value." },
    },
    additionalProperties: false,
  },
  statsPeriod: {
    type: "object",
    required: STATS_PERIOD_REQUIRED,
    properties: STATS_PERIOD_PROPERTIES,
    additionalProperties: false,
  },
  annualStatsPeriod: {
    type: "object",
    required: [...STATS_PERIOD_REQUIRED, "year", "historyAnalysis"],
    properties: {
      ...STATS_PERIOD_PROPERTIES,
      mode: { const: "annually" },
      year: { type: "integer" },
      historyAnalysis: { $ref: "#/$defs/statsHistoryAnalysis" },
    },
    additionalProperties: false,
  },
  statsHistoryAnalysis: {
    type: "object",
    required: ["calendarDays", "readingDayCoverage", "accumulatedReadTimePerReadingDay", "totalReadTimeChange"],
    properties: {
      calendarDays: { type: "integer", minimum: 365, maximum: 366 },
      readingDayCoverage: {
        anyOf: [
          {
            type: "object",
            required: ["ratio", "percent", "basis"],
            properties: {
              ratio: { type: "number", minimum: 0 },
              percent: { type: "number", minimum: 0 },
              basis: { const: "calendar-year" },
            },
            additionalProperties: false,
          },
          { type: "null" },
        ],
      },
      accumulatedReadTimePerReadingDay: {
        anyOf: [
          {
            type: "object",
            required: ["seconds", "basis"],
            properties: {
              seconds: { type: "number", minimum: 0 },
              basis: { const: "reading-day-total-not-session" },
            },
            additionalProperties: false,
          },
          { type: "null" },
        ],
      },
      totalReadTimeChange: {
        anyOf: [
          {
            type: "object",
            required: ["previousYear", "ratio", "percent", "direction", "basis"],
            properties: {
              previousYear: { type: "integer" },
              ratio: { type: "number" },
              percent: { type: "number" },
              direction: { enum: ["up", "down", "unchanged"] },
              basis: { const: "total-read-time" },
            },
            additionalProperties: false,
          },
          { type: "null" },
        ],
      },
    },
    additionalProperties: false,
  },
  fieldGuide: {
    type: "object",
    required: ["durationUnit", "totalReadTime", "dayAverageReadTime", "compare", "counts", "buckets", "categories", "durationBreakdown", "topBooks"],
    properties: Object.fromEntries([
      "durationUnit",
      "totalReadTime",
      "dayAverageReadTime",
      "compare",
      "counts",
      "buckets",
      "categories",
      "durationBreakdown",
      "topBooks",
    ].map((key) => [key, { type: "string" }])),
    additionalProperties: false,
  },
  bookInspection: {
    type: "object",
    required: ["book", "availability", "chapters", "progress", "shelf", "notebook"],
    properties: {
      book: { $ref: "#/$defs/compactBook" },
      availability: {
        type: "object",
        required: ["available", "readable", "accessLevel", "confirmedReadableChapterCount"],
        properties: {
          available: { type: "boolean", description: "True when the title is not reported sold out." },
          readable: { type: "boolean", description: "Compatibility field: at least one chapter is confirmed readable; this does not prove full-book access." },
          accessLevel: { enum: ["unavailable", "unconfirmed", "some-chapters", "all-chapters"] },
          confirmedReadableChapterCount: { type: "integer", minimum: 0 },
          reason: { type: "string" },
        },
        additionalProperties: false,
      },
      chapters: {
        type: "object",
        required: ["count", "freeCount", "pricedCount", "purchasedCount", "unknownPriceCount"],
        properties: {
          count: { type: "integer", minimum: 0 },
          freeCount: { type: "integer", minimum: 0 },
          pricedCount: { type: "integer", minimum: 0 },
          purchasedCount: { type: "integer", minimum: 0 },
          unknownPriceCount: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
      progress: { $ref: "#/$defs/progress" },
      shelf: { type: "object", required: ["present"], properties: { present: { type: "boolean" }, entry: { $ref: "#/$defs/shelfEntry" } }, additionalProperties: false },
      notebook: { type: "object", required: ["present"], properties: { present: { type: "boolean" }, summary: { $ref: "#/$defs/notebookSummary" } }, additionalProperties: false },
    },
    additionalProperties: false,
  },
  shelfEntry: {
    oneOf: [
      {
        type: "object",
        required: ["type", "bookId", "title", "author", "secret", "updatedAt"],
        properties: {
          type: { const: "book" },
          ...COMPACT_BOOK_PROPERTIES,
          secret: { type: "boolean" },
          updatedAt: { type: ["string", "null"], format: "date-time" },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        required: ["type", "albumId", "title", "author", "trackCount", "secret"],
        properties: {
          type: { const: "album" },
          albumId: { type: "string" },
          title: { type: "string" },
          author: { type: "string" },
          trackCount: { type: "number", minimum: 0 },
          secret: { type: "boolean" },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        required: ["type", "title"],
        properties: { type: { const: "mp" }, title: { type: "string" } },
        additionalProperties: false,
      },
    ],
  },
  compactReview: {
    type: "object",
    required: ["reviewId", "author", "content", "contentTruncated", "createdAt", "likeCount"],
    properties: {
      reviewId: { type: "string" },
      author: { type: "string" },
      content: { type: "string" },
      contentTruncated: { type: "boolean" },
      rating: { type: "number", minimum: 0, maximum: 5 },
      ratingScale: { const: 5 },
      createdAt: { type: ["string", "null"], format: "date-time" },
      likeCount: { type: "number", minimum: 0 },
    },
    additionalProperties: false,
  },
};

const DATA_SCHEMAS: Record<string, JsonSchema> = {
  doctor: {
    type: "object",
    required: ["ready", "version", "gatewaySkillVersion", "credential", "config", "gateway"],
    properties: {
      ready: { type: "boolean" },
      version: { type: "string" },
      gatewaySkillVersion: { type: "string" },
      credential: { type: "object", required: ["configured", "source"], properties: { configured: { type: "boolean" }, source: { type: ["string", "null"] } }, additionalProperties: false },
      config: { type: "object", required: ["path", "hasApiKey"], properties: { path: { type: "string" }, hasApiKey: { type: "boolean" } }, additionalProperties: false },
      gateway: { type: "object", required: ["checked"], properties: { checked: { type: "boolean" }, reachable: { type: "boolean" }, message: { type: "string" } }, additionalProperties: false },
    },
    additionalProperties: false,
  },
  search: {
    type: "object",
    required: ["queryResultCount", "hasMore", "books"],
    properties: {
      queryResultCount: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" },
      nextMaxIdx: { type: "number" },
      sessionId: { type: "string" },
      books: { type: "array", items: { $ref: "#/$defs/compactBook" } },
    },
    additionalProperties: false,
  },
  "book.resolve": { $ref: "#/$defs/resolvedBook" },
  "book.resolve-batch": {
    type: "object",
    required: ["requested", "returned", "unresolvedCount", "books", "unresolved"],
    properties: {
      requested: { type: "integer", minimum: 1, maximum: 20 },
      returned: { type: "integer", minimum: 0, maximum: 20 },
      unresolvedCount: { type: "integer", minimum: 0, maximum: 20 },
      books: { type: "array", maxItems: 20, items: { $ref: "#/$defs/resolvedBook" } },
      unresolved: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          required: ["query", "code", "message"],
          properties: {
            query: { type: "string" },
            code: { const: "NOT_FOUND" },
            message: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  "stats.detail": {
    type: "object",
    required: ["fieldGuide", "period"],
    properties: { fieldGuide: { $ref: "#/$defs/fieldGuide" }, period: { $ref: "#/$defs/statsPeriod" } },
    additionalProperties: false,
  },
  "stats.trend": {
    type: "object",
    required: ["timeZone", "historyRange", "fieldGuide", "periods"],
    properties: {
      timeZone: { const: "Asia/Shanghai" },
      historyRange: {
        type: "object",
        required: ["firstNonzeroYear", "lastCompleteYear", "currentYear", "source"],
        properties: {
          firstNonzeroYear: { type: ["integer", "null"] },
          lastCompleteYear: { type: "integer" },
          currentYear: { type: "integer" },
          source: { const: "stats.trend.overall.buckets" },
        },
        additionalProperties: false,
      },
      fieldGuide: { $ref: "#/$defs/fieldGuide" },
      periods: { type: "array", items: { $ref: "#/$defs/statsPeriod" } },
    },
    additionalProperties: false,
  },
  "stats.history": {
    type: "object",
    required: ["timeZone", "fromYear", "toYear", "fieldGuide", "periods"],
    properties: {
      timeZone: { const: "Asia/Shanghai" },
      fromYear: { type: "integer" },
      toYear: { type: "integer" },
      fieldGuide: { $ref: "#/$defs/fieldGuide" },
      periods: { type: "array", items: { $ref: "#/$defs/annualStatsPeriod" } },
    },
    additionalProperties: false,
  },
  "book.inspect": { $ref: "#/$defs/bookInspection" },
  "book.inspect-batch": {
    type: "object",
    required: ["returned", "books"],
    properties: { returned: { type: "integer", minimum: 0 }, books: { type: "array", items: { $ref: "#/$defs/bookInspection" } } },
    additionalProperties: false,
  },
  "shelf.summary": {
    type: "object",
    required: ["books", "albums", "mp", "total", "publicCount", "secretCount"],
    properties: Object.fromEntries(["books", "albums", "mp", "total", "publicCount", "secretCount"].map((key) => [key, { type: "integer", minimum: 0 }])),
    additionalProperties: false,
  },
  "shelf.list": {
    type: "object",
    required: ["returned", "total", "hasMore", "entries"],
    properties: {
      returned: { type: "integer", minimum: 0 },
      total: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" },
      entries: { type: "array", items: { $ref: "#/$defs/shelfEntry" } },
    },
    additionalProperties: false,
  },
  "notes.notebooks": {
    type: "object",
    required: ["returned", "totalBookCount", "totalNoteCount", "hasMore", "books"],
    properties: {
      returned: { type: "integer", minimum: 0, description: "Number of notebook books returned in this response." },
      totalBookCount: { type: "integer", minimum: 0, description: "Total notebook books reported by WeRead for the account." },
      totalNoteCount: { type: "integer", minimum: 0, description: "Account-wide saved-item total reported by WeRead; it includes highlights, bookmarks, and personal thought/review entries." },
      hasMore: { type: "boolean", description: "Whether notebook pages remain after this response." },
      books: { type: "array", items: { $ref: "#/$defs/notebookSummary" } },
    },
    additionalProperties: false,
  },
  "notes.sample": {
    type: "object",
    required: ["index", "selectionRule", "bookIds", "selected", "coverage"],
    properties: {
      index: {
        type: "object",
        required: ["totalBookCount", "totalSavedItemCount", "booksWithThoughts", "totalThoughtCount", "totalCategories"],
        properties: {
          totalBookCount: { type: "integer", minimum: 0 },
          totalSavedItemCount: { type: "integer", minimum: 0 },
          booksWithThoughts: { type: "integer", minimum: 0 },
          totalThoughtCount: { type: "integer", minimum: 0 },
          totalCategories: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
      selectionRule: {
        type: "object",
        required: ["maximumBooks", "highThoughtLimit", "recentUpdateLimit", "newCategoryLimit", "recencyField", "ordering", "categoryRule", "fillRule"],
        properties: {
          maximumBooks: { const: 50 },
          highThoughtLimit: { const: 25 },
          recentUpdateLimit: { const: 15 },
          newCategoryLimit: { const: 10 },
          recencyField: { const: "notebook.updatedAt" },
          ordering: {
            type: "object",
            required: ["highThought", "recentUpdate", "newCategory"],
            properties: {
              highThought: {
                type: "array",
                prefixItems: [{ const: "thoughtCount:desc" }, { const: "updatedAt:desc" }, { const: "bookId:asc" }],
                minItems: 3,
                maxItems: 3,
                items: false,
              },
              recentUpdate: {
                type: "array",
                prefixItems: [{ const: "updatedAt:desc" }, { const: "thoughtCount:desc" }, { const: "bookId:asc" }],
                minItems: 3,
                maxItems: 3,
                items: false,
              },
              newCategory: {
                type: "array",
                prefixItems: [{ const: "newCategoryCount:desc" }, { const: "thoughtCount:desc" }, { const: "updatedAt:desc" }, { const: "bookId:asc" }],
                minItems: 4,
                maxItems: 4,
                items: false,
              },
            },
            additionalProperties: false,
          },
          categoryRule: { type: "string" },
          fillRule: { type: "string" },
        },
        additionalProperties: false,
      },
      bookIds: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string" } },
      selected: { type: "array", maxItems: 50, items: { $ref: "#/$defs/thoughtSampleEntry" } },
      coverage: {
        type: "object",
        required: ["selectedBooks", "selectedThoughtCount", "thoughtCoverageRatio", "selectedCategories", "totalCategories", "notebookUpdateYears", "requestedIds", "uniqueIds"],
        properties: {
          selectedBooks: { type: "integer", minimum: 0, maximum: 50 },
          selectedThoughtCount: { type: "integer", minimum: 0 },
          thoughtCoverageRatio: { type: "number", minimum: 0, maximum: 1 },
          selectedCategories: { type: "integer", minimum: 0 },
          totalCategories: { type: "integer", minimum: 0 },
          notebookUpdateYears: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^[0-9]{4}$" } },
          requestedIds: { type: "integer", minimum: 0, maximum: 50 },
          uniqueIds: { type: "integer", minimum: 0, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  "notes.corpus": {
    type: "object",
    required: ["view", "contentScope", "books", "totals"],
    properties: {
      view: { enum: ["full", "thoughts"] },
      contentScope: {
        type: "object",
        required: ["includes", "excludes", "personalWordsField", "sourceContextFields", "maxBookIdsPerCall"],
        properties: {
          includes: { type: "array", items: { type: "string" } },
          excludes: { type: "array", items: { type: "string" } },
          personalWordsField: { const: "books[].thoughts[].content" },
          sourceContextFields: {
            const: ["books[].thoughts[].quotedText", "books[].thoughts[].contextText"],
          },
          maxBookIdsPerCall: { const: 50 },
        },
        additionalProperties: false,
      },
      books: {
        type: "array",
        items: {
          type: "object",
          required: ["book", "bookId", "counts", "complete", "thoughts"],
          properties: {
            book: { $ref: "#/$defs/compactBook" },
            bookId: { type: "string" },
            counts: {
              type: "object",
              required: ["highlights", "thoughts", "thoughtsWithText", "contextOnlyThoughts", "ratingOnlyThoughts", "emptyThoughts", "total"],
              properties: Object.fromEntries([
                "highlights",
                "thoughts",
                "thoughtsWithText",
                "contextOnlyThoughts",
                "ratingOnlyThoughts",
                "emptyThoughts",
                "total",
              ].map((key) => [key, { type: "integer", minimum: 0 }])),
              additionalProperties: false,
            },
            complete: { type: "boolean" },
            highlights: { type: "array", items: { $ref: "#/$defs/highlight" } },
            thoughts: { type: "array", items: { $ref: "#/$defs/thought" } },
          },
          additionalProperties: false,
        },
      },
      totals: {
        type: "object",
        required: ["books", "sourceHighlights", "sourceThoughts", "returnedHighlights", "returnedThoughts", "returnedItems", "thoughtsWithText", "contextOnlyThoughts", "ratingOnlyThoughts", "emptyThoughts"],
        properties: Object.fromEntries([
          "books",
          "sourceHighlights",
          "sourceThoughts",
          "returnedHighlights",
          "returnedThoughts",
          "returnedItems",
          "thoughtsWithText",
          "contextOnlyThoughts",
          "ratingOnlyThoughts",
          "emptyThoughts",
        ].map((key) => [key, { type: "integer", minimum: 0 }])),
        additionalProperties: false,
      },
    },
    additionalProperties: false,
    allOf: [
      {
        if: {
          type: "object",
          required: ["view"],
          properties: { view: { const: "full" } },
        },
        then: {
          type: "object",
          properties: {
            contentScope: {
              type: "object",
              properties: {
                includes: { const: ["highlights", "personal note/review entries"] },
                excludes: { const: ["bookmark positions"] },
              },
            },
          },
        },
      },
      {
        if: {
          type: "object",
          required: ["view"],
          properties: { view: { const: "thoughts" } },
        },
        then: {
          type: "object",
          properties: {
            contentScope: {
              type: "object",
              properties: {
                includes: { const: ["personal note/review entries"] },
                excludes: { const: ["bookmark positions", "standalone source-book highlights"] },
              },
            },
          },
        },
      },
    ],
  },
  "reviews.batch": {
    type: "object",
    required: ["batches"],
    properties: {
      batches: {
        type: "array",
        items: {
          type: "object",
          required: ["bookId", "type", "returned", "hasMore", "reviews"],
          properties: {
            bookId: { type: "string" },
            type: { type: "string" },
            returned: { type: "integer", minimum: 0 },
            totalCount: { type: "number" },
            hasMore: { type: "boolean" },
            nextMaxIdx: { type: "number" },
            synckey: { type: "number" },
            reviews: { type: "array", items: { $ref: "#/$defs/compactReview" } },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  "discover.recommend": {
    type: "object",
    required: ["returned", "hasMore", "books"],
    properties: { returned: { type: "integer", minimum: 0 }, hasMore: { type: "boolean" }, books: { type: "array", items: { $ref: "#/$defs/recommendationBook" } } },
    additionalProperties: false,
  },
  "discover.similar": {
    type: "object",
    required: ["returned", "hasMore", "books"],
    properties: { returned: { type: "integer", minimum: 0 }, hasMore: { type: "boolean" }, sessionId: { type: "string" }, nextMaxIdx: { type: "number" }, books: { type: "array", items: { $ref: "#/$defs/compactBook" } } },
    additionalProperties: false,
  },
};

const EMPTY_INPUT: OperationInput = { positionals: [], options: [], constraints: [] };

export const STABLE_OPERATIONS: StableOperation[] = [
  { id: "doctor", argv: ["doctor"], description: "Check authentication and gateway readiness.", input: EMPTY_INPUT },
  {
    id: "search",
    argv: ["search"],
    description: "Search WeRead and return compact book candidates.",
    input: {
      positionals: [{ name: "keyword", type: "string", required: true, description: "Search keyword." }],
      options: [
        { name: "scope", flag: "--scope", type: "string", required: false, repeatable: false, default: "book", enum: ["all", "book", "web-novel", "audio", "author", "fulltext", "booklist", "mp", "article"], description: "Search scope." },
        { name: "limit", flag: "--limit", type: "integer", required: false, repeatable: false, default: 10, minimum: 1, description: "Maximum candidates to return." },
        { name: "maxIdx", flag: "--max-idx", type: "integer", required: false, repeatable: false, default: 0, minimum: 0, description: "Pagination offset from the previous response." },
      ],
      constraints: [],
    },
  },
  { id: "stats.trend", argv: ["stats", "trend"], description: "Return current weekly, monthly, annual, and overall periods.", input: EMPTY_INPUT },
  {
    id: "stats.detail",
    argv: ["stats", "detail"],
    description: "Return one compact statistics period.",
    input: {
      positionals: [],
      options: [
        { name: "mode", flag: "--mode", type: "string", required: false, repeatable: false, default: "monthly", enum: ["weekly", "monthly", "annually", "overall"], description: "Statistics period mode." },
        { name: "baseTime", flag: "--base-time", type: "integer", required: false, repeatable: false, minimum: 0, description: "Unix timestamp inside the target period." },
        { name: "date", flag: "--date", type: "string", required: false, repeatable: false, description: "Date inside the target period in Asia/Shanghai: YYYY, YYYY-MM, or YYYY-MM-DD." },
        { name: "view", flag: "--view", type: "string", required: false, repeatable: false, default: "raw", enum: ["raw", "summary"], description: "Non-agent output view; --agent always returns the compact period contract." },
      ],
      constraints: ["Use at most one of --base-time and --date."],
    },
  },
  {
    id: "stats.history",
    argv: ["stats", "history"],
    description: "Return a bounded range of annual statistics periods.",
    input: {
      positionals: [],
      options: [
        { name: "from", flag: "--from", type: "integer", required: true, repeatable: false, minimum: 1900, maximum: 2100, description: "First calendar year, inclusive." },
        { name: "to", flag: "--to", type: "integer", required: true, repeatable: false, minimum: 1900, maximum: 2100, description: "Last calendar year, inclusive." },
      ],
      constraints: ["--from must be less than or equal to --to.", "The inclusive range may contain at most 20 calendar years."],
    },
  },
  {
    id: "book.resolve",
    argv: ["book", "resolve"],
    description: "Resolve a book name to one compact book and stable bookId.",
    input: {
      positionals: [{ name: "name", type: "string", required: true, description: "Book name to resolve." }],
      options: [],
      constraints: [],
    },
  },
  {
    id: "book.resolve-batch",
    argv: ["book", "resolve-batch"],
    description: "Resolve up to 20 candidate names and report match quality without aborting on missing titles.",
    input: {
      positionals: [],
      options: [{ name: "name", flag: "--name", type: "string[]", required: true, repeatable: true, default: [], minItems: 1, maxItems: 20, uniqueItems: true, description: "Candidate book name to resolve." }],
      constraints: ["Provide 1 to 20 unique candidate names."],
    },
  },
  {
    id: "book.inspect",
    argv: ["book", "inspect"],
    description: "Inspect one book's access, progress, shelf, and notebook state.",
    input: {
      positionals: [{ name: "bookOrId", type: "string", required: true, description: "Book ID or book name." }],
      options: [],
      constraints: [],
    },
  },
  {
    id: "book.inspect-batch",
    argv: ["book", "inspect-batch"],
    description: "Inspect up to 20 books while sharing collection reads.",
    input: {
      positionals: [],
      options: [{ name: "bookId", flag: "--book-id", type: "string[]", required: true, repeatable: true, default: [], minItems: 1, maxItems: 20, uniqueItems: true, description: "Book ID to inspect." }],
      constraints: ["Provide 1 to 20 unique book IDs."],
    },
  },
  { id: "shelf.summary", argv: ["shelf", "summary"], description: "Return shelf counts.", input: EMPTY_INPUT },
  {
    id: "shelf.list",
    argv: ["shelf", "list"],
    description: "Return compact shelf entries.",
    input: {
      positionals: [],
      options: [
        { name: "limit", flag: "--limit", type: "integer", required: false, repeatable: false, default: 50, minimum: 1, description: "Maximum entries when --all is absent." },
        { name: "all", flag: "--all", type: "boolean", required: false, repeatable: false, default: false, description: "Return every shelf entry." },
      ],
      constraints: ["--all ignores --limit."],
    },
  },
  {
    id: "notes.notebooks",
    argv: ["notes", "notebooks"],
    description: "Return books with personal saved items.",
    input: {
      positionals: [],
      options: [
        { name: "limit", flag: "--limit", type: "integer", required: false, repeatable: false, default: 20, minimum: 1, description: "Maximum books when --all is absent." },
        { name: "all", flag: "--all", type: "boolean", required: false, repeatable: false, default: false, description: "Fetch every notebook page." },
      ],
      constraints: ["--all ignores --limit."],
    },
  },
  {
    id: "notes.sample",
    argv: ["notes", "sample"],
    description: "Return a deterministic sample of at most 50 books with personal thoughts and explicit coverage.",
    input: EMPTY_INPUT,
  },
  {
    id: "notes.corpus",
    argv: ["notes", "corpus"],
    description: "Return a bounded personal notes corpus.",
    input: {
      positionals: [],
      options: [
        { name: "bookId", flag: "--book-id", type: "string[]", required: true, repeatable: true, default: [], minItems: 1, maxItems: 50, uniqueItems: true, description: "Book ID to include." },
        { name: "view", flag: "--view", type: "string", required: false, repeatable: false, default: "full", enum: ["full", "thoughts"], description: "Use thoughts to omit standalone source-book highlights." },
      ],
      constraints: ["Provide 1 to 50 unique book IDs."],
    },
  },
  {
    id: "reviews.batch",
    argv: ["reviews", "batch"],
    description: "Return bounded public reviews for explicit books and types.",
    input: {
      positionals: [],
      options: [
        { name: "bookId", flag: "--book-id", type: "string[]", required: true, repeatable: true, default: [], minItems: 1, uniqueItems: true, description: "Book ID to include." },
        { name: "type", flag: "--type", type: "string[]", required: false, repeatable: true, default: ["all"], enum: ["all", "recommend", "bad", "latest", "normal"], acceptsCommaSeparated: true, description: "Review type; repeat the flag or use comma-separated values." },
        { name: "limit", flag: "--limit", type: "integer", required: false, repeatable: false, default: 5, minimum: 1, description: "Maximum reviews per book and type." },
        { name: "maxContentChars", flag: "--max-content-chars", type: "integer", required: false, repeatable: false, default: 800, minimum: 1, description: "Maximum review text characters per compact item." },
      ],
      constraints: ["Book IDs and review types are deduplicated before requests."],
    },
  },
  {
    id: "discover.recommend",
    argv: ["discover", "recommend"],
    description: "Return personalized discovery candidates.",
    input: {
      positionals: [],
      options: [
        { name: "limit", flag: "--limit", type: "integer", required: false, repeatable: false, default: 12, minimum: 1, description: "Maximum recommendations." },
        { name: "maxIdx", flag: "--max-idx", type: "integer", required: false, repeatable: false, default: 0, minimum: 0, description: "Pagination offset from the previous response." },
      ],
      constraints: [],
    },
  },
  {
    id: "discover.similar",
    argv: ["discover", "similar"],
    description: "Return similar-book candidates.",
    input: {
      positionals: [{ name: "bookOrId", type: "string", required: true, description: "Book ID or book name." }],
      options: [
        { name: "limit", flag: "--limit", type: "integer", required: false, repeatable: false, default: 12, minimum: 1, description: "Maximum recommendations." },
        { name: "maxIdx", flag: "--max-idx", type: "integer", required: false, repeatable: false, default: 0, minimum: 0, description: "Pagination offset from the previous response." },
        { name: "sessionId", flag: "--session-id", type: "string", required: false, repeatable: false, description: "Pagination session ID from the previous response." },
      ],
      constraints: [],
    },
  },
];

const operationIds = new Set(STABLE_OPERATIONS.map((operation) => operation.id));

export function agentSchemaId(operationId: string): string {
  return `urn:weread:agent:2:${operationId}`;
}

export function schemaIdForOperation(operationId: string | undefined): string | undefined {
  return operationId && operationIds.has(operationId) ? agentSchemaId(operationId) : undefined;
}

export function stableOperationFor(operationId: string): StableOperation | undefined {
  return STABLE_OPERATIONS.find((operation) => operation.id === operationId);
}

export function operationManifest(operationId?: string) {
  const operations = operationId ? STABLE_OPERATIONS.filter((operation) => operation.id === operationId) : STABLE_OPERATIONS;
  return operations.map((operation) => ({
    id: operation.id,
    description: operation.description,
    command: {
      argv: ["--agent", ...operation.argv],
      helpArgv: ["--agent", ...operation.argv, "--help"],
    },
    input: operation.input,
    output: {
      mode: "agent",
      schemaId: agentSchemaId(operation.id),
      schemaCommand: ["schema", "get", operation.id],
      dataSchemaId: `${agentSchemaId(operation.id)}:data`,
      dataSchemaCommand: ["schema", "get", operation.id, "--data"],
    },
  }));
}

function referencedDefs(schema: unknown): Record<string, JsonSchema> {
  const names = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string" && child.startsWith("#/$defs/")) {
        const name = child.slice("#/$defs/".length);
        if (!names.has(name)) {
          names.add(name);
          visit(COMMON_DEFS[name]);
        }
      } else {
        visit(child);
      }
    }
  };
  visit(schema);
  return Object.fromEntries([...names].map((name) => [name, COMMON_DEFS[name]!]));
}

export function dataSchemaFor(name: string): JsonSchema | undefined {
  const dataSchema = DATA_SCHEMAS[name];
  if (!dataSchema) return undefined;
  const command = stableOperationFor(name)?.argv.join(" ") ?? name;
  return {
    $schema: JSON_SCHEMA_DIALECT,
    $id: `${agentSchemaId(name)}:data`,
    title: `weread --agent ${command} data payload`,
    ...dataSchema,
    $defs: referencedDefs(dataSchema),
  };
}

export function schemaFor(name: string): JsonSchema | undefined {
  if (name === "capabilities") return CAPABILITIES_SCHEMA;
  const dataSchema = DATA_SCHEMAS[name];
  if (!dataSchema) return undefined;
  const schemaId = agentSchemaId(name);
  const command = stableOperationFor(name)?.argv.join(" ") ?? name;
  const metaProperties = {
    schemaVersion: { const: "2" },
    gatewaySkillVersion: { type: "string" },
    complete: { type: "boolean" },
    timeZone: { type: "string" },
    operationId: { const: name },
    schemaId: { const: schemaId },
  };
  return {
    $schema: JSON_SCHEMA_DIALECT,
    $id: schemaId,
    title: `weread --agent ${command} response`,
    description: "Validates either the success document written to stdout or the error document written to stderr.",
    oneOf: [
      {
        type: "object",
        required: ["ok", "data", "meta", "warnings"],
        properties: {
          ok: { const: true },
          data: dataSchema,
          meta: { type: "object", required: Object.keys(metaProperties), properties: metaProperties, additionalProperties: false },
          warnings: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        required: ["ok", "error", "meta", "warnings"],
        properties: {
          ok: { const: false },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" }, details: { $ref: "#/$defs/jsonValue" } },
            additionalProperties: false,
          },
          meta: {
            type: "object",
            required: Object.keys(metaProperties),
            properties: { ...metaProperties, complete: { const: false } },
            additionalProperties: false,
          },
          warnings: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    $defs: { ...referencedDefs(dataSchema), jsonValue: COMMON_DEFS.jsonValue },
  };
}

export const CAPABILITIES_SCHEMA: JsonSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: CAPABILITIES_SCHEMA_ID,
  title: "weread capabilities manifest",
  type: "object",
  required: ["schemaId", "schemaCommand", "manifestVersion", "schemaDialect", "executable", "cliVersion", "gatewaySkillVersion", "authentication", "outputModes", "operations", "rawGateway", "completeness", "safety"],
  properties: {
    schemaId: { const: CAPABILITIES_SCHEMA_ID },
    schemaCommand: {
      type: "array",
      prefixItems: [{ const: "schema" }, { const: "get" }, { const: "capabilities" }],
      minItems: 3,
      maxItems: 3,
      items: false,
    },
    manifestVersion: { const: CAPABILITIES_MANIFEST_VERSION },
    schemaDialect: { const: JSON_SCHEMA_DIALECT },
    executable: { const: "weread", description: "Executable to prepend to every advertised argv array." },
    cliVersion: { type: "string" },
    gatewaySkillVersion: { type: "string" },
    authentication: {
      type: "array",
      prefixItems: [{ const: "WEREAD_API_KEY" }, { const: "config" }],
      minItems: 2,
      maxItems: 2,
      items: false,
    },
    outputModes: {
      type: "array",
      prefixItems: [{ const: "human" }, { const: "raw-json" }, { const: "agent" }],
      minItems: 3,
      maxItems: 3,
      items: false,
    },
    operations: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/operation" },
    },
    rawGateway: {
      type: "object",
      required: ["argv", "stability", "schema"],
      properties: {
        argv: {
          type: "array",
          prefixItems: [{ const: "--json" }, { const: "api" }, { const: "call" }],
          minItems: 3,
          maxItems: 3,
          items: false,
        },
        stability: { const: "upstream-shaped" },
        schema: { type: "null" },
      },
      additionalProperties: false,
    },
    completeness: {
      type: "object",
      required: ["metaComplete", "warnings"],
      properties: { metaComplete: { type: "string" }, warnings: { type: "string" } },
      additionalProperties: false,
    },
    safety: { type: "object", required: ["gatewayOperations"], properties: { gatewayOperations: { const: "read-only" } }, additionalProperties: false },
  },
  additionalProperties: false,
  $defs: {
    jsonValue: COMMON_DEFS.jsonValue,
    positional: {
      type: "object",
      required: ["name", "type", "required", "description"],
      properties: {
        name: { type: "string" },
        type: { enum: ["string", "integer"] },
        required: { type: "boolean" },
        description: { type: "string" },
      },
      additionalProperties: false,
    },
    option: {
      type: "object",
      required: ["name", "flag", "type", "required", "repeatable", "description"],
      properties: {
        name: { type: "string" },
        flag: { type: "string", pattern: "^--[a-z0-9-]+$" },
        type: { enum: ["string", "integer", "boolean", "string[]"] },
        required: { type: "boolean" },
        repeatable: { type: "boolean" },
        description: { type: "string" },
        default: { $ref: "#/$defs/jsonValue" },
        enum: { type: "array", uniqueItems: true, items: { type: "string" } },
        minimum: { type: "number" },
        maximum: { type: "number" },
        minItems: { type: "integer", minimum: 0 },
        maxItems: { type: "integer", minimum: 0 },
        uniqueItems: { type: "boolean" },
        acceptsCommaSeparated: { type: "boolean" },
      },
      additionalProperties: false,
    },
    input: {
      type: "object",
      required: ["positionals", "options", "constraints"],
      properties: {
        positionals: { type: "array", items: { $ref: "#/$defs/positional" } },
        options: { type: "array", items: { $ref: "#/$defs/option" } },
        constraints: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    command: {
      type: "object",
      required: ["argv", "helpArgv"],
      properties: {
        argv: { type: "array", minItems: 2, items: { type: "string" } },
        helpArgv: { type: "array", minItems: 3, items: { type: "string" } },
      },
      additionalProperties: false,
    },
    output: {
      type: "object",
      required: ["mode", "schemaId", "schemaCommand", "dataSchemaId", "dataSchemaCommand"],
      properties: {
        mode: { const: "agent" },
        schemaId: { type: "string" },
        schemaCommand: { type: "array", minItems: 3, items: { type: "string" } },
        dataSchemaId: { type: "string" },
        dataSchemaCommand: { type: "array", minItems: 4, items: { type: "string" } },
      },
      additionalProperties: false,
    },
    operation: {
      type: "object",
      required: ["id", "description", "command", "input", "output"],
      properties: {
        id: { enum: STABLE_OPERATIONS.map((operation) => operation.id) },
        description: { type: "string" },
        command: { $ref: "#/$defs/command" },
        input: { $ref: "#/$defs/input" },
        output: { $ref: "#/$defs/output" },
      },
      additionalProperties: false,
    },
  },
};
