import { CORPUS_CURSOR_PATTERN } from "./corpus-cursor.js";
import { STATS_HISTORY_MIN_YEAR } from "./stats.js";

export type JsonSchema = Record<string, unknown>;

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
export const OPERATIONS_CATALOG_VERSION = "1";
export const RESPONSE_SCHEMA_VERSION = "3";
export const RESPONSE_DATA_SCHEMA_REF = "#/$defs/data";
export const INVOCATION_ERROR_OPERATION_ID = "invocation.error";
const META_COMPLETE_DESCRIPTION = "Whether this invocation completed. It does not assert collection exhaustion, period completion, or the presence of optional upstream facts; inspect operation-specific page, reviewsExhausted, indexExhausted, periodComplete, and data-quality fields.";

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
  pattern?: string;
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
  sideEffects: "none" | "gateway-read" | "local-config" | "local-file-optional";
  provides: string[];
  pagination: OperationPagination;
  limitations: string[];
  dataSchema: JsonSchema;
  errorOnly?: boolean;
}

export interface OperationPagination {
  mode: "none" | "all" | "cursor" | "offset";
  pageField: string | null;
  nextArgsField: string | null;
  nextArgvField: string | null;
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
  payTypeCode: { type: "number", description: "Undocumented upstream payType code." },
  resourceTypeCode: { type: "number", description: "Undocumented upstream resource type code." },
  bookStatusCode: { type: "number", description: "Undocumented upstream bookStatus code." },
  format: { type: "string" },
  price: { type: "number" },
  version: { type: "number" },
  readingCount: { type: "number", minimum: 0 },
  searchIndex: { type: "number", minimum: 0 },
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
  totalReadTime: { type: "number", minimum: 0, description: "Upstream total reading and listening duration in seconds." },
  wrReadTime: { type: "number", minimum: 0, description: "Upstream reading duration component in seconds." },
  wrListenTime: { type: "number", minimum: 0, description: "Upstream listening duration component in seconds." },
  readDays: { type: "number", minimum: 0, description: "Count of calendar dates with reported reading activity in the period." },
  dayAverageReadTime: { type: "number", minimum: 0, description: "Average seconds per natural calendar day in the period, including inactive dates." },
  compare: {
    type: "number",
    description: "Optional upstream compare value, copied without transformation: the ratio change in dayAverageReadTime from the upstream comparison period; 0.2 means 20 percent. It is normally reported only for current periods with sufficient upstream comparison data.",
  },
  preferTimeWord: { type: "string" },
  preferCategoryWord: { type: "string" },
  bucketGranularity: { enum: ["day", "month", "year"], description: "Time unit represented by each bucket." },
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
      required: ["label", "value", "numericValue", "unit"],
      properties: {
        label: { type: "string" },
        value: { type: "string" },
        numericValue: { type: ["number", "null"], minimum: 0 },
        unit: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  },
  topBooks: {
    type: "array",
    items: { $ref: "#/$defs/statsBookSummary" },
    description: "Upstream-ranked, potentially non-exhaustive book summaries for the period.",
  },
  categories: {
    type: "array",
    items: { $ref: "#/$defs/statsCategorySummary" },
    description: "Upstream-ranked, potentially non-exhaustive category summaries for the period.",
  },
  authors: {
    type: "array",
    items: { $ref: "#/$defs/statsAuthorSummary" },
    description: "Upstream-ranked, potentially non-exhaustive author summaries for the period.",
  },
  dataQuality: { $ref: "#/$defs/statsDataQuality" },
};

function exactNextArgs(required: string[], properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    required,
    properties,
    additionalProperties: false,
  };
}

function exactArgv(prefixItems: JsonSchema[]): JsonSchema {
  const versionedItems = [
    ...prefixItems,
    { const: "--skill-version" },
    { type: "string", minLength: 1 },
  ];
  return {
    type: "array",
    minItems: versionedItems.length,
    maxItems: versionedItems.length,
    prefixItems: versionedItems,
    items: false,
    description: "Complete arguments to pass after the executable for the next stable JSON request, including the effective gateway protocol version.",
  };
}

function pageSchema(nextArgsSchema: JsonSchema, nextArgvSchema: JsonSchema): JsonSchema {
  return {
    type: "object",
    required: ["hasMore", "nextArgs", "nextArgv"],
    properties: {
      hasMore: { type: "boolean" },
      nextArgs: { oneOf: [nextArgsSchema, { type: "null" }] },
      nextArgv: { oneOf: [nextArgvSchema, { type: "null" }] },
    },
    allOf: [{
      if: {
        required: ["hasMore"],
        properties: { hasMore: { const: true } },
      },
      then: { properties: { nextArgs: nextArgsSchema, nextArgv: nextArgvSchema } },
      else: { properties: { nextArgs: { type: "null" }, nextArgv: { type: "null" } } },
    }],
    additionalProperties: false,
  };
}

function reviewPageSchema(pageDefinition: string): JsonSchema {
  return {
    type: "object",
    required: ["bookId", "type", "returned", "page", "reviews"],
    properties: {
      bookId: { type: "string" },
      type: { enum: ["all", "recommend", "bad", "latest", "normal"] },
      returned: { type: "integer", minimum: 0 },
      totalCount: { type: "number", minimum: 0 },
      page: { $ref: `#/$defs/${pageDefinition}` },
      reviews: { type: "array", items: { $ref: "#/$defs/compactReview" } },
    },
    additionalProperties: false,
  };
}

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
        const: "exact-title",
        description: "The returned title exactly matched the query.",
      },
      ...COMPACT_BOOK_PROPERTIES,
    },
    additionalProperties: false,
  },
  searchCursorPage: pageSchema(exactNextArgs(
    ["--max-idx", "--session-id"],
    {
      "--max-idx": { type: "integer", minimum: 0 },
      "--session-id": { type: "string", minLength: 1 },
    },
  ), exactArgv([
    { const: "--json" },
    { const: "search" },
    { type: "string", minLength: 1 },
    { const: "--scope" },
    { enum: ["all", "book", "web-novel", "audio", "author", "fulltext", "booklist", "mp", "article"] },
    { const: "--limit" },
    { type: "string", pattern: "^[1-9][0-9]*$" },
    { const: "--max-idx" },
    { type: "string", pattern: "^[0-9]+$" },
    { const: "--session-id" },
    { type: "string", minLength: 1 },
  ])),
  similarCursorPage: pageSchema(exactNextArgs(
    ["--max-idx", "--session-id"],
    {
      "--max-idx": { type: "integer", minimum: 0 },
      "--session-id": { type: "string", minLength: 1 },
    },
  ), exactArgv([
    { const: "--json" },
    { const: "discover" },
    { const: "similar" },
    { type: "string", minLength: 1 },
    { const: "--limit" },
    { type: "string", pattern: "^[1-9][0-9]*$" },
    { const: "--max-idx" },
    { type: "string", pattern: "^[0-9]+$" },
    { const: "--session-id" },
    { type: "string", minLength: 1 },
  ])),
  reviewListCursorPage: pageSchema(exactNextArgs(
    ["--max-idx", "--synckey"],
    {
      "--max-idx": { type: "integer", minimum: 0 },
      "--synckey": { type: "integer", minimum: 0 },
    },
  ), exactArgv([
    { const: "--json" },
    { const: "reviews" },
    { const: "list" },
    { type: "string", minLength: 1 },
    { const: "--type" },
    { enum: ["all", "recommend", "bad", "latest", "normal"] },
    { const: "--limit" },
    { type: "string", pattern: "^[1-9][0-9]*$" },
    { const: "--max-idx" },
    { type: "string", pattern: "^[0-9]+$" },
    { const: "--synckey" },
    { type: "string", pattern: "^[0-9]+$" },
  ])),
  reviewBatchCursorPage: pageSchema(exactNextArgs(
    ["--max-idx", "--synckey"],
    {
      "--max-idx": { type: "integer", minimum: 0 },
      "--synckey": { type: "integer", minimum: 0 },
    },
  ), exactArgv([
    { const: "--json" },
    { const: "reviews" },
    { const: "batch" },
    { const: "--book-id" },
    { type: "string", minLength: 1 },
    { const: "--type" },
    { enum: ["all", "recommend", "bad", "latest", "normal"] },
    { const: "--limit" },
    { type: "string", pattern: "^[1-9][0-9]*$" },
    { const: "--max-idx" },
    { type: "string", pattern: "^[0-9]+$" },
    { const: "--synckey" },
    { type: "string", pattern: "^[0-9]+$" },
  ])),
  notebookCursorPage: pageSchema(exactNextArgs(
    ["--last-sort"],
    { "--last-sort": { type: "integer", minimum: 0 } },
  ), exactArgv([
    { const: "--json" },
    { const: "notes" },
    { const: "notebooks" },
    { const: "--limit" },
    { type: "string", pattern: "^[1-9][0-9]*$" },
    { const: "--last-sort" },
    { type: "string", pattern: "^[0-9]+$" },
  ])),
  corpusCursorPage: pageSchema(exactNextArgs(
    ["--cursor"],
    { "--cursor": { type: "string", pattern: CORPUS_CURSOR_PATTERN } },
  ), exactArgv([
    { const: "--json" },
    { const: "notes" },
    { const: "corpus" },
    { const: "--all-notebooks" },
    { const: "--view" },
    { enum: ["full", "thoughts"] },
    { const: "--limit" },
    { type: "string", pattern: "^(?:[1-9]|[1-4][0-9]|50)$" },
    { const: "--cursor" },
    { type: "string", pattern: CORPUS_CURSOR_PATTERN },
  ])),
  allPage: pageSchema(exactNextArgs(
    ["--all"],
    { "--all": { const: true } },
  ), exactArgv([
    { const: "--json" },
    { const: "shelf" },
    { const: "list" },
    { const: "--all" },
  ])),
  recommendationBook: {
    type: "object",
    required: ["bookId", "title", "author"],
    properties: { ...COMPACT_BOOK_PROPERTIES, reason: { type: "string" } },
    additionalProperties: false,
  },
  progress: {
    type: "object",
    required: ["bookId", "percent", "chapterUid", "chapterOffset", "readingSeconds", "recordReadingSeconds", "listeningSeconds", "started", "startedAt", "updatedAt", "serverTimestamp"],
    properties: {
      bookId: { type: "string" },
      percent: {
        type: ["number", "null"],
        minimum: 0,
        maximum: 100,
        description: "Reading progress percentage. Null means the upstream response did not report progress; it is not coerced to zero.",
      },
      chapterUid: { type: ["string", "null"] },
      chapterOffset: { type: ["number", "null"], minimum: 0 },
      readingSeconds: {
        type: ["number", "null"],
        minimum: 0,
        description: "Cumulative reading duration in seconds. Null means the upstream response did not report a duration.",
      },
      recordReadingSeconds: { type: ["number", "null"], minimum: 0 },
      listeningSeconds: { type: ["number", "null"], minimum: 0 },
      started: { type: ["boolean", "null"] },
      startedAt: { type: ["string", "null"], format: "date-time" },
      updatedAt: { type: ["string", "null"], format: "date-time" },
      serverTimestamp: { type: ["string", "null"], format: "date-time" },
      reviewId: { type: "string" },
      bookVersion: { type: "number" },
      finishedAt: { type: ["string", "null"], format: "date-time" },
    },
    additionalProperties: false,
  },
  notebookSummary: {
    type: "object",
    required: ["book", "highlightCount", "bookmarkCount", "thoughtCount", "totalNoteCount", "readingProgress", "markedStatus", "sort", "updatedAt"],
    properties: {
      book: { $ref: "#/$defs/compactBook" },
      highlightCount: { type: "integer", minimum: 0, description: "Saved source-text highlights, normalized from upstream noteCount." },
      bookmarkCount: { type: "integer", minimum: 0, description: "Saved bookmark positions; their text is not exportable through notes corpus." },
      thoughtCount: { type: "integer", minimum: 0, description: "Personal thought/review entries, normalized from upstream reviewCount." },
      totalNoteCount: { type: "integer", minimum: 0, description: "highlightCount + bookmarkCount + thoughtCount for this book." },
      readingProgress: { type: ["number", "null"], minimum: 0, maximum: 100, description: "Notebook-reported reading progress percentage; null means unreported." },
      markedStatus: { type: ["number", "null"], description: "Undocumented upstream markedStatus value, preserved without interpretation." },
      sort: { type: ["number", "null"], description: "Upstream notebook sort cursor, preserved for continuation." },
      updatedAt: { type: ["string", "null"], format: "date-time" },
    },
    additionalProperties: false,
  },
  highlight: {
    type: "object",
    required: ["chapterUid", "chapterTitle", "text", "createdAt", "createdDate"],
    properties: {
      chapterUid: { type: "string" },
      chapterTitle: { type: "string" },
      text: { type: "string", description: "Source-book text, not the reader's own words." },
      createdAt: { type: ["string", "null"], format: "date-time" },
      createdDate: { type: ["string", "null"], format: "date", description: "Asia/Shanghai calendar date." },
      range: { type: "string" },
      deepLink: { type: "string" },
    },
    additionalProperties: false,
  },
  thought: {
    type: "object",
    required: ["reviewId", "chapterUid", "chapterTitle", "entryKind", "content", "createdAt", "createdDate"],
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
      createdDate: { type: ["string", "null"], format: "date", description: "Asia/Shanghai calendar date." },
      sourceType: { type: "number" },
      rating: { type: "number", minimum: 0, maximum: 5 },
      ratingScale: { const: 5 },
    },
    additionalProperties: false,
  },
  statsDataQuality: {
    type: "object",
    required: ["unidentifiedRankedItems", "durationBreakdown"],
    properties: {
      unidentifiedRankedItems: { type: "integer", minimum: 0 },
      durationBreakdown: {
        type: "object",
        required: ["status", "deltaSeconds"],
        properties: {
          status: { enum: ["unavailable", "matches", "mismatch"] },
          deltaSeconds: {
            type: ["number", "null"],
            description: "wrReadTime + wrListenTime - totalReadTime, or null when a component was not reported.",
          },
        },
        additionalProperties: false,
      },
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
        description: "Upstream category item count for the period.",
      },
      readTime: {
        type: "number",
        minimum: 0,
        description: "Category reading duration in seconds.",
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
    required: [
      ...STATS_PERIOD_REQUIRED,
      "year",
      "startDate",
      "endDate",
      "throughDate",
      "periodComplete",
      "elapsedDays",
    ],
    properties: {
      ...STATS_PERIOD_PROPERTIES,
      mode: { const: "annually" },
      year: { type: "integer" },
      startDate: { type: "string", format: "date" },
      endDate: { type: "string", format: "date" },
      throughDate: { type: "string", format: "date" },
      periodComplete: {
        type: "boolean",
        description: "Whether the represented calendar year had ended by throughDate; independent of meta.complete.",
      },
      elapsedDays: { type: "integer", minimum: 1, maximum: 366 },
    },
    additionalProperties: false,
  },
  bookInspection: {
    type: "object",
    required: ["book", "accessFacts", "progress", "shelf", "notebook"],
    properties: {
      book: { $ref: "#/$defs/compactBook" },
      accessFacts: {
        type: "object",
        required: [
          "soldOut",
          "returnedChapterCount",
          "zeroPriceChapterCount",
          "pricedChapterCount",
          "purchasedChapterCount",
          "unknownPriceChapterCount",
        ],
        properties: {
          soldOut: { type: ["boolean", "null"], description: "Null means the upstream response did not report sold-out state." },
          returnedChapterCount: {
            type: "integer",
            minimum: 0,
            description: "Number of chapter rows returned by the current gateway response.",
          },
          zeroPriceChapterCount: {
            type: "integer",
            minimum: 0,
            description: "Returned chapters whose upstream price is exactly zero; this does not assert preview, openability, or entitlement.",
          },
          pricedChapterCount: {
            type: "integer",
            minimum: 0,
            description: "Returned chapters whose upstream price is greater than zero.",
          },
          purchasedChapterCount: {
            type: "integer",
            minimum: 0,
            description: "Returned chapters whose upstream paid flag is true.",
          },
          unknownPriceChapterCount: {
            type: "integer",
            minimum: 0,
            description: "Returned chapters whose upstream price is unreported.",
          },
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
        required: ["type", "bookId", "title", "author", "private", "finished", "lastReadAt", "upstreamUpdatedAt"],
        properties: {
          type: { const: "book" },
          ...COMPACT_BOOK_PROPERTIES,
          private: { type: "boolean" },
          finished: { type: ["boolean", "null"], description: "Reader completion state normalized from finishReading; null means unreported." },
          lastReadAt: { type: ["string", "null"], format: "date-time" },
          upstreamUpdatedAt: { type: ["string", "null"], format: "date-time" },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        required: ["type", "albumId", "title", "author", "trackCount", "private", "finished", "finishStatus", "payTypeCode", "off", "free", "pinned", "lastReadAt", "upstreamUpdatedAt"],
        properties: {
          type: { const: "album" },
          albumId: { type: "string" },
          title: { type: "string" },
          author: { type: "string" },
          trackCount: { type: "number", minimum: 0 },
          private: { type: "boolean" },
          finished: { type: ["boolean", "null"] },
          finishStatus: { type: ["string", "null"] },
          payTypeCode: { type: ["number", "null"] },
          off: { type: ["boolean", "null"] },
          free: { type: ["boolean", "null"] },
          pinned: { type: ["boolean", "null"] },
          lastReadAt: { type: ["string", "null"], format: "date-time" },
          upstreamUpdatedAt: { type: ["string", "null"], format: "date-time" },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        required: ["type", "title", "archiveId", "shown", "book", "private", "pinned", "lastReadAt", "upstreamUpdatedAt"],
        properties: {
          type: { const: "mp" },
          title: { type: "string" },
          archiveId: { type: ["number", "null"] },
          shown: { type: ["boolean", "null"] },
          book: { $ref: "#/$defs/compactBook" },
          private: { type: ["boolean", "null"] },
          pinned: { type: ["boolean", "null"] },
          lastReadAt: { type: ["string", "null"], format: "date-time" },
          upstreamUpdatedAt: { type: ["string", "null"], format: "date-time" },
        },
        additionalProperties: false,
      },
    ],
  },
  compactReview: {
    type: "object",
    required: ["reviewId", "author", "content", "createdAt", "likeCount"],
    properties: {
      reviewId: { type: "string" },
      author: { type: "string" },
      content: { type: "string" },
      rating: { type: "number", minimum: 0, maximum: 5 },
      ratingScale: { const: 5 },
      createdAt: { type: ["string", "null"], format: "date-time" },
      likeCount: { type: "number", minimum: 0 },
    },
    additionalProperties: false,
  },
  archive: {
    type: "object",
    required: ["name", "bookIds", "albumIds"],
    properties: {
      name: { type: "string" },
      bookIds: { type: "array", items: { type: "string" } },
      albumIds: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
  chapter: {
    type: "object",
    required: ["chapterUid", "title", "level", "index", "wordCount", "paid", "price", "isMpChapter", "updatedAt"],
    properties: {
      chapterUid: { type: "string" },
      title: { type: "string" },
      level: { type: "number", minimum: 0 },
      index: { type: ["number", "null"], minimum: 0 },
      wordCount: { type: ["number", "null"], minimum: 0 },
      paid: { type: ["boolean", "null"], description: "Whether access was purchased; null means unreported." },
      price: { type: ["number", "null"], minimum: 0, description: "Upstream chapter price; null means unreported." },
      isMpChapter: { type: ["boolean", "null"] },
      updatedAt: { type: ["string", "null"], format: "date-time" },
    },
    additionalProperties: false,
  },
  notesCounts: {
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
  notesContentScope: {
    type: "object",
    required: ["includes", "excludes", "personalWordsField", "sourceContextFields"],
    properties: {
      includes: { type: "array", items: { type: "string" } },
      excludes: { type: "array", items: { type: "string" } },
      personalWordsField: { type: "string" },
      sourceContextFields: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
  exportedNotes: {
    type: "object",
    required: ["book", "bookId", "counts", "contentScope", "reviewsExhausted", "highlights", "thoughts"],
    properties: {
      book: { $ref: "#/$defs/compactBook" },
      bookId: { type: "string" },
      counts: { $ref: "#/$defs/notesCounts" },
      contentScope: { $ref: "#/$defs/notesContentScope" },
      reviewsExhausted: { type: "boolean", description: "Whether all personal review pages for this book were collected." },
      highlights: { type: "array", items: { $ref: "#/$defs/highlight" } },
      thoughts: { type: "array", items: { $ref: "#/$defs/thought" } },
    },
    additionalProperties: false,
  },
  corpusBook: {
    type: "object",
    required: ["book", "bookId", "counts", "reviewsExhausted", "thoughts"],
    properties: {
      book: { $ref: "#/$defs/compactBook" },
      bookId: { type: "string" },
      counts: { $ref: "#/$defs/notesCounts" },
      reviewsExhausted: { type: "boolean", description: "Whether all personal review pages for this book were collected." },
      highlights: { type: "array", items: { $ref: "#/$defs/highlight" } },
      thoughts: { type: "array", items: { $ref: "#/$defs/thought" } },
    },
    additionalProperties: false,
  },
  popularHighlight: {
    type: "object",
    required: ["bookId", "bookmarkId", "chapterUid", "text", "readerCount", "range"],
    properties: {
      bookId: { type: "string" },
      bookmarkId: { type: "string" },
      chapterUid: { type: "string" },
      text: { type: "string" },
      readerCount: { type: "number", minimum: 0 },
      range: { type: "string" },
      deepLink: { type: "string" },
    },
    additionalProperties: false,
  },
  reviewListPage: reviewPageSchema("reviewListCursorPage"),
  reviewBatchPage: reviewPageSchema("reviewBatchCursorPage"),
  operationPositional: {
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
  operationOption: {
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
      pattern: { type: "string" },
      minItems: { type: "integer", minimum: 0 },
      maxItems: { type: "integer", minimum: 0 },
      uniqueItems: { type: "boolean" },
      acceptsCommaSeparated: { type: "boolean" },
    },
    additionalProperties: false,
  },
  operationInput: {
    type: "object",
    required: ["positionals", "options", "constraints"],
    properties: {
      positionals: { type: "array", items: { $ref: "#/$defs/operationPositional" } },
      options: { type: "array", items: { $ref: "#/$defs/operationOption" } },
      constraints: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
};

const DATA_SCHEMAS: Record<string, JsonSchema> = {
  "operations.list": {
    type: "object",
    required: ["contractVersion", "executable", "operations", "rawEscape"],
    properties: {
      contractVersion: { const: OPERATIONS_CATALOG_VERSION },
      executable: { const: "weread" },
      operations: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "description", "provides", "sideEffects", "pagination", "describeArgv"],
          properties: {
            id: { type: "string" },
            description: { type: "string" },
            provides: { type: "array", items: { type: "string" } },
            sideEffects: { enum: ["none", "gateway-read", "local-config", "local-file-optional"] },
            pagination: { enum: ["none", "all", "cursor", "offset"] },
            describeArgv: {
              type: "array",
              prefixItems: [
                { const: "--json" },
                { const: "operation" },
                { const: "describe" },
                { type: "string" },
              ],
              minItems: 4,
              maxItems: 4,
              items: false,
            },
          },
          additionalProperties: false,
        },
      },
      rawEscape: {
        type: "object",
        required: ["argv", "stability", "responseSchema"],
        properties: {
          argv: { const: ["--raw", "api", "call"] },
          stability: { const: "upstream-shaped" },
          responseSchema: { type: "null" },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  "operation.describe": {
    type: "object",
    required: [
      "contractVersion",
      "id",
      "description",
      "sideEffects",
      "provides",
      "invocation",
      "input",
      "output",
      "pagination",
      "limitations",
    ],
    properties: {
      contractVersion: { const: OPERATIONS_CATALOG_VERSION },
      id: { type: "string" },
      description: { type: "string" },
      sideEffects: { enum: ["none", "gateway-read", "local-config", "local-file-optional"] },
      provides: { type: "array", items: { type: "string" } },
      invocation: {
        type: "object",
        required: ["executable", "argv", "jsonArgv", "helpArgv"],
        properties: {
          executable: { const: "weread" },
          argv: { type: "array", items: { type: "string" } },
          jsonArgv: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          helpArgv: { type: "array", minItems: 1, items: { type: "string" } },
        },
        additionalProperties: false,
      },
      input: { $ref: "#/$defs/operationInput" },
      output: {
        type: "object",
        required: ["mode", "schemaId", "responseSchema", "dataSchemaRef"],
        properties: {
          mode: { const: "json" },
          schemaId: { type: "string" },
          responseSchema: { $ref: "#/$defs/jsonValue" },
          dataSchemaRef: { const: RESPONSE_DATA_SCHEMA_REF },
        },
        additionalProperties: false,
      },
      pagination: {
        type: "object",
        required: ["mode", "pageField", "nextArgsField", "nextArgvField"],
        properties: {
          mode: { enum: ["none", "all", "cursor", "offset"] },
          pageField: { type: ["string", "null"] },
          nextArgsField: { type: ["string", "null"] },
          nextArgvField: { type: ["string", "null"] },
        },
        additionalProperties: false,
      },
      limitations: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
  [INVOCATION_ERROR_OPERATION_ID]: {
    description: "No success data exists for the shared unmatched-invocation error contract.",
    not: {},
  },
  doctor: {
    type: "object",
    required: ["ready", "version", "gatewaySkillVersion", "credential", "config", "gateway"],
    properties: {
      ready: { type: "boolean" },
      version: { type: "string" },
      gatewaySkillVersion: { type: "string" },
      credential: {
        type: "object",
        required: ["configured", "source"],
        properties: {
          configured: { type: "boolean" },
          source: { enum: ["environment", "config", null] },
        },
        additionalProperties: false,
      },
      config: {
        type: "object",
        required: ["path", "hasApiKey"],
        properties: {
          path: { type: "string" },
          hasApiKey: { type: "boolean" },
        },
        additionalProperties: false,
      },
      gateway: {
        type: "object",
        required: ["checked"],
        properties: {
          checked: { type: "boolean" },
          reachable: { type: "boolean" },
          message: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  "config.path": {
    type: "object",
    required: ["path"],
    properties: { path: { type: "string" } },
    additionalProperties: false,
  },
  "config.show": {
    type: "object",
    required: ["path", "hasApiKey"],
    properties: {
      path: { type: "string" },
      hasApiKey: { type: "boolean" },
      apiKey: { type: "string", description: "Redacted credential display value." },
    },
    additionalProperties: false,
  },
  "config.set-key": {
    type: "object",
    required: ["ok", "path", "apiKey"],
    properties: {
      ok: { const: true },
      path: { type: "string" },
      apiKey: { type: "string", description: "Redacted credential display value." },
    },
    additionalProperties: false,
  },
  "config.clear": {
    type: "object",
    required: ["ok", "path"],
    properties: {
      ok: { const: true },
      path: { type: "string" },
    },
    additionalProperties: false,
  },
  search: {
    type: "object",
    required: ["queryResultCount", "page", "books"],
    properties: {
      queryResultCount: { type: "integer", minimum: 0 },
      page: { $ref: "#/$defs/searchCursorPage" },
      books: { type: "array", items: { $ref: "#/$defs/compactBook" } },
    },
    additionalProperties: false,
  },
  "stats.detail": {
    type: "object",
    required: ["period"],
    properties: { period: { $ref: "#/$defs/statsPeriod" } },
    additionalProperties: false,
  },
  "stats.trend": {
    type: "object",
    required: ["timeZone", "historyRange", "periods"],
    properties: {
      timeZone: { const: "Asia/Shanghai" },
      historyRange: {
        type: "object",
        required: ["earliestSupportedYear", "firstNonzeroYear", "lastCompleteYear", "currentYear", "source"],
        properties: {
          earliestSupportedYear: { const: STATS_HISTORY_MIN_YEAR },
          firstNonzeroYear: { type: ["integer", "null"] },
          lastCompleteYear: { type: "integer" },
          currentYear: { type: "integer" },
          source: { const: "stats.trend.overall.buckets" },
        },
        additionalProperties: false,
      },
      periods: { type: "array", items: { $ref: "#/$defs/statsPeriod" } },
    },
    additionalProperties: false,
  },
  "stats.history": {
    type: "object",
    required: ["timeZone", "asOfDate", "historyRange", "fromYear", "toYear", "periods"],
    properties: {
      timeZone: { const: "Asia/Shanghai" },
      asOfDate: { type: "string", format: "date" },
      historyRange: {
        type: "object",
        required: ["earliestSupportedYear", "firstNonzeroYear", "lastCompleteYear", "currentYear", "source"],
        properties: {
          earliestSupportedYear: { const: STATS_HISTORY_MIN_YEAR },
          firstNonzeroYear: { type: ["integer", "null"] },
          lastCompleteYear: { type: "integer" },
          currentYear: { type: "integer" },
          source: { const: "stats.trend.overall.buckets" },
        },
        additionalProperties: false,
      },
      fromYear: { type: "integer" },
      toYear: { type: "integer" },
      periods: { type: "array", items: { $ref: "#/$defs/annualStatsPeriod" } },
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
  "book.info": { $ref: "#/$defs/compactBook" },
  "book.chapters": {
    type: "object",
    required: ["bookId", "count", "syncKey", "updatedAt", "chapters"],
    properties: {
      bookId: { type: "string" },
      count: { type: "integer", minimum: 0 },
      syncKey: { type: ["number", "null"] },
      updatedAt: { type: ["string", "null"], format: "date-time" },
      chapters: { type: "array", items: { $ref: "#/$defs/chapter" } },
    },
    additionalProperties: false,
  },
  "book.progress": { $ref: "#/$defs/progress" },
  "book.inspect": { $ref: "#/$defs/bookInspection" },
  "book.inspect-batch": {
    type: "object",
    required: ["returned", "books"],
    properties: {
      returned: { type: "integer", minimum: 0, maximum: 20 },
      books: { type: "array", maxItems: 20, items: { $ref: "#/$defs/bookInspection" } },
    },
    additionalProperties: false,
  },
  "shelf.summary": {
    type: "object",
    required: ["books", "albums", "mp", "total", "publicCount", "secretCount"],
    properties: Object.fromEntries(
      ["books", "albums", "mp", "total", "publicCount", "secretCount"]
        .map((key) => [key, { type: "integer", minimum: 0 }]),
    ),
    additionalProperties: false,
  },
  "shelf.list": {
    type: "object",
    required: ["returned", "total", "page", "archives", "entries"],
    properties: {
      returned: { type: "integer", minimum: 0 },
      total: { type: "integer", minimum: 0 },
      page: { $ref: "#/$defs/allPage" },
      archives: { type: "array", items: { $ref: "#/$defs/archive" } },
      entries: { type: "array", items: { $ref: "#/$defs/shelfEntry" } },
    },
    additionalProperties: false,
  },
  "notes.notebooks": {
    type: "object",
    required: [
      "returned",
      "totalBookCount",
      "totalNoteCount",
      "syncKey",
      "noBookReviewCount",
      "page",
      "books",
    ],
    properties: {
      returned: { type: "integer", minimum: 0 },
      totalBookCount: { type: "integer", minimum: 0 },
      totalNoteCount: { type: "integer", minimum: 0 },
      syncKey: { type: ["number", "null"], description: "Upstream notebook synchronization key." },
      noBookReviewCount: { type: ["number", "null"], minimum: 0 },
      page: { $ref: "#/$defs/notebookCursorPage" },
      books: { type: "array", items: { $ref: "#/$defs/notebookSummary" } },
    },
    additionalProperties: false,
  },
  "notes.export": {
    oneOf: [
      { $ref: "#/$defs/exportedNotes" },
      {
        type: "object",
        required: ["bookId", "output", "format", "bytes"],
        properties: {
          bookId: { type: "string" },
          output: { type: "string" },
          format: { enum: ["markdown", "json"] },
          bytes: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
    ],
  },
  "notes.corpus": {
    type: "object",
    required: ["view", "selection", "page", "contentScope", "books", "totals"],
    properties: {
      view: { enum: ["full", "thoughts"] },
      selection: {
        type: "object",
        required: ["mode", "requestedBooks", "notebookIndex"],
        properties: {
          mode: { enum: ["explicit-book-ids", "all-notebooks"] },
          requestedBooks: {
            type: "integer",
            minimum: 0,
            maximum: 50,
            description: "Books selected for this invocation: every explicit ID, or the current all-notebooks corpus page.",
          },
          notebookIndex: {
            type: "object",
            required: ["returned", "totalBookCount", "indexExhausted"],
            properties: {
              returned: { type: "integer", minimum: 0, maximum: 50 },
              totalBookCount: { type: "integer", minimum: 0 },
              indexExhausted: {
                type: "boolean",
                description: "Whether traversal of the notebook index used for selection and metadata enrichment was exhausted; for this operation it is the inverse of page.hasMore.",
              },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      page: { $ref: "#/$defs/corpusCursorPage" },
      contentScope: {
        type: "object",
        required: [
          "includes",
          "excludes",
          "personalWordsField",
          "sourceContextFields",
        ],
        properties: {
          includes: { type: "array", items: { type: "string" } },
          excludes: { type: "array", items: { type: "string" } },
          personalWordsField: { const: "books[].thoughts[].content" },
          sourceContextFields: {
            const: ["books[].thoughts[].quotedText", "books[].thoughts[].contextText"],
          },
        },
        additionalProperties: false,
      },
      books: { type: "array", maxItems: 50, items: { $ref: "#/$defs/corpusBook" } },
      totals: {
        type: "object",
        required: [
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
        ],
        properties: {
          books: { type: "integer", minimum: 0, maximum: 50 },
          ...Object.fromEntries([
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
        },
        additionalProperties: false,
      },
    },
    allOf: [
      {
        if: {
          type: "object",
          required: ["view"],
          properties: { view: { const: "full" } },
        },
        then: {
          properties: {
            contentScope: {
              type: "object",
              properties: {
                includes: { const: ["highlights", "personal note/review entries"] },
                excludes: { const: ["bookmark positions"] },
              },
            },
            books: {
              type: "array",
              items: {
                type: "object",
                required: ["highlights"],
                properties: { highlights: { type: "array" } },
              },
            },
          },
        },
        else: {
          properties: {
            contentScope: {
              type: "object",
              properties: {
                includes: { const: ["personal note/review entries"] },
                excludes: { const: ["bookmark positions", "standalone source-book highlights"] },
              },
            },
            books: {
              type: "array",
              items: {
                type: "object",
                properties: { highlights: false },
              },
            },
          },
        },
      },
      {
        if: {
          type: "object",
          required: ["selection"],
          properties: {
            selection: {
              type: "object",
              required: ["mode"],
              properties: { mode: { const: "explicit-book-ids" } },
            },
          },
        },
        then: {
          properties: {
            page: {
              type: "object",
              properties: {
                hasMore: { const: false },
                nextArgs: { type: "null" },
                nextArgv: { type: "null" },
              },
            },
          },
        },
      },
      {
        if: {
          type: "object",
          required: ["page"],
          properties: {
            page: {
              type: "object",
              required: ["hasMore"],
              properties: { hasMore: { const: true } },
            },
          },
        },
        then: {
          properties: {
            selection: {
              type: "object",
              properties: {
                notebookIndex: {
                  type: "object",
                  properties: { indexExhausted: { const: false } },
                },
              },
            },
          },
        },
        else: {
          properties: {
            selection: {
              type: "object",
              properties: {
                notebookIndex: {
                  type: "object",
                  properties: { indexExhausted: { const: true } },
                },
              },
            },
          },
        },
      },
    ],
    additionalProperties: false,
  },
  "notes.popular": {
    type: "object",
    required: ["returned", "items"],
    properties: {
      returned: { type: "integer", minimum: 0, maximum: 20 },
      totalCount: { type: "number", minimum: 0 },
      items: { type: "array", maxItems: 20, items: { $ref: "#/$defs/popularHighlight" } },
    },
    additionalProperties: false,
  },
  "reviews.list": { $ref: "#/$defs/reviewListPage" },
  "reviews.batch": {
    type: "object",
    required: ["batches"],
    properties: {
      batches: { type: "array", items: { $ref: "#/$defs/reviewBatchPage" } },
    },
    additionalProperties: false,
  },
  "discover.recommend": {
    type: "object",
    required: ["returned", "books"],
    properties: {
      returned: { type: "integer", minimum: 0 },
      books: { type: "array", items: { $ref: "#/$defs/recommendationBook" } },
    },
    additionalProperties: false,
  },
  "discover.similar": {
    type: "object",
    required: ["returned", "page", "books"],
    properties: {
      returned: { type: "integer", minimum: 0 },
      page: { $ref: "#/$defs/similarCursorPage" },
      books: { type: "array", items: { $ref: "#/$defs/compactBook" } },
    },
    additionalProperties: false,
  },
};

const EMPTY_INPUT: OperationInput = { positionals: [], options: [], constraints: [] };
const NO_PAGINATION: OperationPagination = {
  mode: "none",
  pageField: null,
  nextArgsField: null,
  nextArgvField: null,
};
const CURSOR_PAGINATION: OperationPagination = {
  mode: "cursor",
  pageField: "data.page",
  nextArgsField: "data.page.nextArgs",
  nextArgvField: "data.page.nextArgv",
};
const ALL_PAGINATION: OperationPagination = {
  mode: "all",
  pageField: "data.page",
  nextArgsField: "data.page.nextArgs",
  nextArgvField: "data.page.nextArgv",
};

function operation(
  definition: Omit<StableOperation, "dataSchema">,
): StableOperation {
  const dataSchema = DATA_SCHEMAS[definition.id];
  if (!dataSchema) {
    throw new Error("Missing data schema for stable operation " + definition.id);
  }
  return { ...definition, dataSchema };
}

export const STABLE_OPERATIONS: StableOperation[] = [
  operation({
    id: "operations.list",
    argv: ["operations"],
    description: "List stable structured operations and the command for describing each one.",
    input: EMPTY_INPUT,
    sideEffects: "none",
    provides: ["operation IDs", "operation descriptions", "descriptor invocations"],
    pagination: NO_PAGINATION,
    limitations: ["The raw API escape hatch is intentionally outside the stable operation registry."],
  }),
  operation({
    id: "operation.describe",
    argv: ["operation", "describe"],
    description: "Describe one stable operation, including its invocation, inputs, and complete response JSON Schema.",
    input: {
      positionals: [{
        name: "operationId",
        type: "string",
        required: true,
        description: "Operation ID returned by operations.list.",
      }],
      options: [],
      constraints: [],
    },
    sideEffects: "none",
    provides: ["invocation", "input contract", "response JSON Schema", "data schema reference", "pagination contract"],
    pagination: NO_PAGINATION,
    limitations: [],
  }),
  operation({
    id: INVOCATION_ERROR_OPERATION_ID,
    argv: [],
    description: "Describe errors from stable JSON argv that does not resolve to a registered operation.",
    input: {
      positionals: [],
      options: [],
      constraints: ["This contract is selected automatically for an unmatched --json or --agent invocation."],
    },
    sideEffects: "none",
    provides: ["structured invocation error", "error schema identity"],
    pagination: NO_PAGINATION,
    limitations: ["This contract has no success response."],
    errorOnly: true,
  }),
  operation({
    id: "doctor",
    argv: ["doctor"],
    description: "Report local credential configuration and gateway reachability.",
    input: EMPTY_INPUT,
    sideEffects: "gateway-read",
    provides: ["CLI version", "credential source", "config path", "gateway readiness"],
    pagination: NO_PAGINATION,
    limitations: ["Gateway reachability is not checked when no credential is configured."],
  }),
  operation({
    id: "config.path",
    argv: ["config", "path"],
    description: "Return the local config file path.",
    input: EMPTY_INPUT,
    sideEffects: "none",
    provides: ["config path"],
    pagination: NO_PAGINATION,
    limitations: [],
  }),
  operation({
    id: "config.show",
    argv: ["config", "show"],
    description: "Return the local config state with any API key redacted.",
    input: EMPTY_INPUT,
    sideEffects: "none",
    provides: ["config path", "credential presence", "redacted credential"],
    pagination: NO_PAGINATION,
    limitations: ["The full API key is never returned."],
  }),
  operation({
    id: "config.set-key",
    argv: ["config", "set-key"],
    description: "Store a WeRead API key in the local config file.",
    input: {
      positionals: [{
        name: "apiKey",
        type: "string",
        required: true,
        description: "WeRead gateway API key beginning with wrk-.",
      }],
      options: [],
      constraints: [],
    },
    sideEffects: "local-config",
    provides: ["config path", "redacted stored credential"],
    pagination: NO_PAGINATION,
    limitations: ["The full API key is never returned."],
  }),
  operation({
    id: "config.clear",
    argv: ["config", "clear"],
    description: "Remove the local WeRead config file.",
    input: EMPTY_INPUT,
    sideEffects: "local-config",
    provides: ["removed config path"],
    pagination: NO_PAGINATION,
    limitations: ["The WEREAD_API_KEY environment variable is not changed."],
  }),
  operation({
    id: "search",
    argv: ["search"],
    description: "Search WeRead and return normalized book records.",
    input: {
      positionals: [{
        name: "keyword",
        type: "string",
        required: true,
        description: "Search keyword.",
      }],
      options: [
        {
          name: "scope",
          flag: "--scope",
          type: "string",
          required: false,
          repeatable: false,
          default: "book",
          enum: ["all", "book", "web-novel", "audio", "author", "fulltext", "booklist", "mp", "article"],
          description: "Search scope.",
        },
        {
          name: "limit",
          flag: "--limit",
          type: "integer",
          required: false,
          repeatable: false,
          default: 10,
          minimum: 1,
          description: "Maximum books to return.",
        },
        {
          name: "maxIdx",
          flag: "--max-idx",
          type: "integer",
          required: false,
          repeatable: false,
          default: 0,
          minimum: 0,
          description: "Continuation index from data.page.nextArgs.",
        },
        {
          name: "sessionId",
          flag: "--session-id",
          type: "string",
          required: false,
          repeatable: false,
          description: "Search session ID from data.page.nextArgs.",
        },
      ],
      constraints: ["When continuing a search, pass every argument returned in data.page.nextArgs."],
    },
    sideEffects: "gateway-read",
    provides: ["book IDs", "book metadata", "continuation arguments"],
    pagination: CURSOR_PAGINATION,
    limitations: ["Result order is the upstream search order."],
  }),
  operation({
    id: "stats.detail",
    argv: ["stats", "detail"],
    description: "Return one normalized reading-statistics period.",
    input: {
      positionals: [],
      options: [
        {
          name: "mode",
          flag: "--mode",
          type: "string",
          required: false,
          repeatable: false,
          default: "monthly",
          enum: ["weekly", "monthly", "annually", "overall"],
          description: "Statistics period mode.",
        },
        {
          name: "baseTime",
          flag: "--base-time",
          type: "integer",
          required: false,
          repeatable: false,
          minimum: 0,
          description: "Unix timestamp inside the target period.",
        },
        {
          name: "date",
          flag: "--date",
          type: "string",
          required: false,
          repeatable: false,
          description: "Date inside the target period in Asia/Shanghai: YYYY, YYYY-MM, or YYYY-MM-DD.",
        },
      ],
      constraints: ["Use at most one of --base-time and --date."],
    },
    sideEffects: "gateway-read",
    provides: ["reading durations", "activity buckets", "book, category, and author summaries", "data-quality facts"],
    pagination: NO_PAGINATION,
    limitations: ["Optional statistics fields are omitted when the upstream response does not report them."],
  }),
  operation({
    id: "stats.trend",
    argv: ["stats", "trend"],
    description: "Return current weekly, monthly, annual, and overall reading-statistics periods.",
    input: EMPTY_INPUT,
    sideEffects: "gateway-read",
    provides: ["four normalized statistics periods", "supported history bound and observed activity facts", "data-quality facts"],
    pagination: NO_PAGINATION,
    limitations: ["The first nonzero year is an observed activity fact derived from overall buckets; it is not the supported lower bound."],
  }),
  operation({
    id: "stats.history",
    argv: ["stats", "history"],
    description: "Return normalized annual reading-statistics periods, using the full supported range when bounds are omitted.",
    input: {
      positionals: [],
      options: [
        {
          name: "from",
          flag: "--from",
          type: "integer",
          required: false,
          repeatable: false,
          minimum: STATS_HISTORY_MIN_YEAR,
          description: `First calendar year, inclusive; defaults to the earliest supported year ${STATS_HISTORY_MIN_YEAR}.`,
        },
        {
          name: "to",
          flag: "--to",
          type: "integer",
          required: false,
          repeatable: false,
          minimum: STATS_HISTORY_MIN_YEAR,
          description: "Last calendar year, inclusive; defaults to the current Asia/Shanghai calendar year.",
        },
      ],
      constraints: [
        "--from must be less than or equal to --to.",
        `Bounds must be ${STATS_HISTORY_MIN_YEAR} or later and may not be later than the current Asia/Shanghai calendar year.`,
      ],
    },
    sideEffects: "gateway-read",
    provides: ["annual statistics periods", "calendar coverage facts", "data-quality facts"],
    pagination: NO_PAGINATION,
    limitations: [
      "The first nonzero year is reported from the overall statistics buckets as an activity fact; it does not change the default lower bound.",
      "The response contains annual aggregates and ranked examples, not a title-by-title or session-level reading ledger.",
      "Upstream annual read counts are period counts and are not defined as unique across years.",
    ],
  }),
  operation({
    id: "book.resolve",
    argv: ["book", "resolve"],
    description: "Resolve a book name to one normalized book record and book ID.",
    input: {
      positionals: [{
        name: "name",
        type: "string",
        required: true,
        description: "Book name to resolve.",
      }],
      options: [],
      constraints: [],
    },
    sideEffects: "gateway-read",
    provides: ["book ID", "book metadata", "match kind"],
    pagination: NO_PAGINATION,
    limitations: ["A non-exact search result is not selected automatically; use search to inspect candidates."],
  }),
  operation({
    id: "book.resolve-batch",
    argv: ["book", "resolve-batch"],
    description: "Resolve up to 20 book names without aborting when individual names are unresolved.",
    input: {
      positionals: [],
      options: [{
        name: "name",
        flag: "--name",
        type: "string[]",
        required: true,
        repeatable: true,
        default: [],
        minItems: 1,
        maxItems: 20,
        uniqueItems: true,
        description: "Book name to resolve.",
      }],
      constraints: ["Provide 1 to 20 unique names."],
    },
    sideEffects: "gateway-read",
    provides: ["resolved books", "unresolved names", "match kinds"],
    pagination: NO_PAGINATION,
    limitations: ["At most 20 unique names are accepted per invocation."],
  }),
  operation({
    id: "book.info",
    argv: ["book", "info"],
    description: "Return normalized metadata for one book.",
    input: bookOrIdInput(),
    sideEffects: "gateway-read",
    provides: ["book ID", "book metadata", "availability codes"],
    pagination: NO_PAGINATION,
    limitations: ["Undocumented upstream codes are preserved without interpretation."],
  }),
  operation({
    id: "book.chapters",
    argv: ["book", "chapters"],
    description: "Return a normalized chapter table for one book.",
    input: bookOrIdInput(),
    sideEffects: "gateway-read",
    provides: ["chapter IDs", "chapter order", "price and purchase facts", "chapter update metadata"],
    pagination: NO_PAGINATION,
    limitations: ["Missing price, purchase, and chapter metadata are returned as null."],
  }),
  operation({
    id: "book.progress",
    argv: ["book", "progress"],
    description: "Return normalized reading, recorded-reading, and listening progress for one book.",
    input: bookOrIdInput(),
    sideEffects: "gateway-read",
    provides: ["reading position", "reading duration", "recorded-reading duration", "listening duration", "timestamps"],
    pagination: NO_PAGINATION,
    limitations: ["Unreported progress fields are returned as null rather than inferred."],
  }),
  operation({
    id: "book.inspect",
    argv: ["book", "inspect"],
    description: "Join one book's metadata, chapters, progress, shelf entry, and notebook summary.",
    input: bookOrIdInput(),
    sideEffects: "gateway-read",
    provides: ["book metadata", "chapter price and purchase counts", "progress", "shelf membership", "notebook membership"],
    pagination: NO_PAGINATION,
    limitations: [
      "The command returns access facts without classifying overall readability or availability.",
      "Chapter metadata, shelf or progress history, and zero-price, positive-price, or purchase counts do not establish full-book entitlement.",
      "A zero chapter price does not by itself prove current preview or openability.",
    ],
  }),
  operation({
    id: "book.inspect-batch",
    argv: ["book", "inspect-batch"],
    description: "Join metadata, chapters, progress, shelf, and notebook facts for up to 20 book IDs.",
    input: {
      positionals: [],
      options: [{
        name: "bookId",
        flag: "--book-id",
        type: "string[]",
        required: true,
        repeatable: true,
        default: [],
        minItems: 1,
        maxItems: 20,
        uniqueItems: true,
        description: "Book ID to inspect.",
      }],
      constraints: ["Provide 1 to 20 unique book IDs."],
    },
    sideEffects: "gateway-read",
    provides: ["joined inspection records"],
    pagination: NO_PAGINATION,
    limitations: [
      "At most 20 unique book IDs are accepted per invocation.",
      "Chapter metadata, shelf or progress history, and zero-price, positive-price, or purchase counts do not establish full-book entitlement.",
      "A zero chapter price does not by itself prove current preview or openability.",
    ],
  }),
  operation({
    id: "shelf.summary",
    argv: ["shelf", "summary"],
    description: "Return shelf counts by resource and privacy state.",
    input: EMPTY_INPUT,
    sideEffects: "gateway-read",
    provides: ["book count", "album count", "article collection count", "public and private counts"],
    pagination: NO_PAGINATION,
    limitations: [],
  }),
  operation({
    id: "shelf.list",
    argv: ["shelf", "list"],
    description: "Return normalized shelf entries and archive membership.",
    input: {
      positionals: [],
      options: [
        {
          name: "limit",
          flag: "--limit",
          type: "integer",
          required: false,
          repeatable: false,
          default: 50,
          minimum: 1,
          description: "Maximum entries when --all is absent.",
        },
        {
          name: "all",
          flag: "--all",
          type: "boolean",
          required: false,
          repeatable: false,
          default: false,
          description: "Return every shelf entry.",
        },
      ],
      constraints: ["--all ignores --limit."],
    },
    sideEffects: "gateway-read",
    provides: ["books", "albums", "article collection", "privacy and completion facts", "archive membership"],
    pagination: ALL_PAGINATION,
    limitations: ["Archive membership is returned separately from visible shelf entries."],
  }),
  operation({
    id: "notes.notebooks",
    argv: ["notes", "notebooks"],
    description: "Return normalized notebook summaries for books with saved items.",
    input: {
      positionals: [],
      options: [
        {
          name: "limit",
          flag: "--limit",
          type: "integer",
          required: false,
          repeatable: false,
          default: 20,
          minimum: 1,
          description: "Maximum books when --all is absent.",
        },
        {
          name: "all",
          flag: "--all",
          type: "boolean",
          required: false,
          repeatable: false,
          default: false,
          description: "Fetch every notebook page.",
        },
        {
          name: "lastSort",
          flag: "--last-sort",
          type: "integer",
          required: false,
          repeatable: false,
          minimum: 0,
          description: "Notebook cursor from data.page.nextArgs.",
        },
      ],
      constraints: ["--all fetches subsequent pages after the optional starting cursor."],
    },
    sideEffects: "gateway-read",
    provides: ["notebook book IDs", "highlight, bookmark, and thought counts", "reading progress", "continuation arguments"],
    pagination: CURSOR_PAGINATION,
    limitations: ["Bookmark positions are counted here but their text is not exposed by notes.export."],
  }),
  operation({
    id: "notes.export",
    argv: ["notes", "export"],
    description: "Return or write personal highlights and thought entries for one book.",
    input: {
      positionals: [{
        name: "bookOrId",
        type: "string",
        required: true,
        description: "Book ID or book name.",
      }],
      options: [
        {
          name: "format",
          flag: "--format",
          type: "string",
          required: false,
          repeatable: false,
          default: "markdown",
          enum: ["markdown", "json"],
          description: "Human or file output format.",
        },
        {
          name: "output",
          flag: "--output",
          type: "string",
          required: false,
          repeatable: false,
          description: "Path to write the export.",
        },
      ],
      constraints: [],
    },
    sideEffects: "local-file-optional",
    provides: ["source highlights", "personal thought entries", "content provenance", "optional file receipt"],
    pagination: NO_PAGINATION,
    limitations: [
      "Bookmark positions are not exposed by the gateway export endpoints.",
      "When --output is present, data is a file receipt instead of the inline note payload.",
    ],
  }),
  operation({
    id: "notes.corpus",
    argv: ["notes", "corpus"],
    description: "Return normalized notes for explicit book IDs or one bounded page of the notebook index.",
    input: {
      positionals: [],
      options: [
        {
          name: "bookId",
          flag: "--book-id",
          type: "string[]",
          required: false,
          repeatable: true,
          default: [],
          minItems: 1,
          maxItems: 50,
          uniqueItems: true,
          description: "Book ID to include; at most 50 unique values, each without whitespace.",
        },
        {
          name: "allNotebooks",
          flag: "--all-notebooks",
          type: "boolean",
          required: false,
          repeatable: false,
          default: false,
          description: "Select one bounded page from the notebook index.",
        },
        {
          name: "view",
          flag: "--view",
          type: "string",
          required: false,
          repeatable: false,
          default: "full",
          enum: ["full", "thoughts"],
          description: "Choose whether standalone source highlights are included.",
        },
        {
          name: "limit",
          flag: "--limit",
          type: "integer",
          required: false,
          repeatable: false,
          default: 10,
          minimum: 1,
          maximum: 50,
          description: "Maximum notebook books returned in one all-notebooks corpus page.",
        },
        {
          name: "cursor",
          flag: "--cursor",
          type: "string",
          required: false,
          repeatable: false,
          pattern: CORPUS_CURSOR_PATTERN,
          description: "Opaque corpus cursor from data.page.nextArgs; pass it through unchanged.",
        },
      ],
      constraints: [
        "Use either one or more unique --book-id values or --all-notebooks, not both.",
        "--cursor is only valid with --all-notebooks.",
        "--limit bounds all-notebooks pages; explicit --book-id values are all returned.",
        "At most 50 unique --book-id values may be requested.",
      ],
    },
    sideEffects: "gateway-read",
    provides: [
      "source highlights",
      "personal thought entries",
      "content provenance",
      "notebook-enriched book metadata",
      "collection counts",
      "whole-book continuation arguments",
    ],
    pagination: CURSOR_PAGINATION,
    limitations: [
      "Bookmark positions are not exposed.",
      "The page bound is measured in whole books, not bytes or individual note items.",
      "The cursor traverses the live notebook index; changes during traversal can alter later pages and are reported in warnings when detected.",
    ],
  }),
  operation({
    id: "notes.popular",
    argv: ["notes", "popular"],
    description: "Return popular public highlights for one book or chapter.",
    input: {
      positionals: [{
        name: "bookOrId",
        type: "string",
        required: true,
        description: "Book ID or book name.",
      }],
      options: [
        {
          name: "chapterUid",
          flag: "--chapter-uid",
          type: "integer",
          required: false,
          repeatable: false,
          minimum: 0,
          description: "Optional chapter UID.",
        },
        {
          name: "limit",
          flag: "--limit",
          type: "integer",
          required: false,
          repeatable: false,
          default: 20,
          minimum: 1,
          maximum: 20,
          description: "Maximum highlights.",
        },
      ],
      constraints: ["The gateway maximum is 20 highlights."],
    },
    sideEffects: "gateway-read",
    provides: ["public highlight text", "reader counts", "source positions"],
    pagination: NO_PAGINATION,
    limitations: ["The gateway returns at most 20 popular highlights."],
  }),
  operation({
    id: "reviews.list",
    argv: ["reviews", "list"],
    description: "Return normalized public reviews for one book and review type.",
    input: {
      positionals: [{
        name: "bookOrId",
        type: "string",
        required: true,
        description: "Book ID or book name.",
      }],
      options: reviewOptions(),
      constraints: ["When continuing, pass every argument returned in data.page.nextArgs."],
    },
    sideEffects: "gateway-read",
    provides: ["public review text", "ratings", "authors", "continuation arguments"],
    pagination: CURSOR_PAGINATION,
    limitations: [],
  }),
  operation({
    id: "reviews.batch",
    argv: ["reviews", "batch"],
    description: "Return the first bounded public-review page for explicit books and review types.",
    input: {
      positionals: [],
      options: [
        {
          name: "bookId",
          flag: "--book-id",
          type: "string[]",
          required: true,
          repeatable: true,
          default: [],
          minItems: 1,
          maxItems: 50,
          uniqueItems: true,
          description: "Book ID to include.",
        },
        {
          name: "type",
          flag: "--type",
          type: "string[]",
          required: false,
          repeatable: true,
          default: ["all"],
          enum: ["all", "recommend", "bad", "latest", "normal"],
          acceptsCommaSeparated: true,
          description: "Review type.",
        },
        {
          name: "limit",
          flag: "--limit",
          type: "integer",
          required: false,
          repeatable: false,
          default: 5,
          minimum: 1,
          description: "Maximum reviews per book and type.",
        },
        {
          name: "maxIdx",
          flag: "--max-idx",
          type: "integer",
          required: false,
          repeatable: false,
          default: 0,
          minimum: 0,
          description: "Continuation index from data.batches[].page.nextArgs.",
        },
        {
          name: "synckey",
          flag: "--synckey",
          type: "integer",
          required: false,
          repeatable: false,
          default: 0,
          minimum: 0,
          description: "Continuation synchronization key from data.batches[].page.nextArgs.",
        },
      ],
      constraints: [
        "Book IDs and review types are deduplicated before requests.",
        "Cursor inputs apply to every requested book and type; continue distinct cursors in separate batch invocations.",
      ],
    },
    sideEffects: "gateway-read",
    provides: ["public review pages for multiple books and types"],
    pagination: {
      mode: "cursor",
      pageField: "data.batches[].page",
      nextArgsField: "data.batches[].page.nextArgs",
      nextArgvField: "data.batches[].page.nextArgv",
    },
    limitations: [
      "At most 50 unique book IDs are accepted per invocation.",
      "Each batch item has an independent cursor; use its nextArgs with the same book ID and review type.",
    ],
  }),
  operation({
    id: "discover.recommend",
    argv: ["discover", "recommend"],
    description: "Return normalized personalized discovery candidates.",
    input: {
      positionals: [],
      options: [{
        name: "limit",
        flag: "--limit",
        type: "integer",
        required: false,
        repeatable: false,
        default: 12,
        minimum: 1,
        description: "Maximum candidates to return.",
      }],
      constraints: [],
    },
    sideEffects: "gateway-read",
    provides: ["personalized book candidates", "upstream recommendation reasons"],
    pagination: NO_PAGINATION,
    limitations: ["The gateway response does not expose reliable continuation metadata for this operation."],
  }),
  operation({
    id: "discover.similar",
    argv: ["discover", "similar"],
    description: "Return normalized books similar to one book.",
    input: {
      positionals: [{
        name: "bookOrId",
        type: "string",
        required: true,
        description: "Book ID or book name.",
      }],
      options: [
        {
          name: "limit",
          flag: "--limit",
          type: "integer",
          required: false,
          repeatable: false,
          default: 12,
          minimum: 1,
          description: "Maximum candidates to return.",
        },
        {
          name: "maxIdx",
          flag: "--max-idx",
          type: "integer",
          required: false,
          repeatable: false,
          default: 0,
          minimum: 0,
          description: "Continuation index from data.page.nextArgs.",
        },
        {
          name: "sessionId",
          flag: "--session-id",
          type: "string",
          required: false,
          repeatable: false,
          description: "Continuation session ID from data.page.nextArgs.",
        },
      ],
      constraints: ["When continuing, pass every argument returned in data.page.nextArgs."],
    },
    sideEffects: "gateway-read",
    provides: ["similar book candidates", "continuation arguments"],
    pagination: CURSOR_PAGINATION,
    limitations: [],
  }),
];

function bookOrIdInput(): OperationInput {
  return {
    positionals: [{
      name: "bookOrId",
      type: "string",
      required: true,
      description: "Book ID or book name.",
    }],
    options: [],
    constraints: [],
  };
}

function reviewOptions(): OperationOption[] {
  const options: OperationOption[] = [
    {
      name: "type",
      flag: "--type",
      type: "string",
      required: false,
      repeatable: false,
      default: "all",
      enum: ["all", "recommend", "bad", "latest", "normal"],
      description: "Review type.",
    },
    {
      name: "limit",
      flag: "--limit",
      type: "integer",
      required: false,
      repeatable: false,
      default: 20,
      minimum: 1,
      description: "Maximum reviews.",
    },
  ];
  options.push(
    {
      name: "maxIdx",
      flag: "--max-idx",
      type: "integer",
      required: false,
      repeatable: false,
      default: 0,
      minimum: 0,
      description: "Continuation index from data.page.nextArgs.",
    },
    {
      name: "synckey",
      flag: "--synckey",
      type: "integer",
      required: false,
      repeatable: false,
      default: 0,
      minimum: 0,
      description: "Continuation synchronization key from data.page.nextArgs.",
    },
  );
  return options;
}

const operationById = new Map(
  STABLE_OPERATIONS.map((entry) => [entry.id, entry]),
);

export function responseSchemaId(operationId: string): string {
  return "urn:weread:response:" + RESPONSE_SCHEMA_VERSION + ":" + operationId;
}

export function dataSchemaId(operationId: string): string {
  return "urn:weread:data:" + RESPONSE_SCHEMA_VERSION + ":" + operationId;
}

export function schemaIdForOperation(
  operationId: string | undefined,
): string | undefined {
  return operationId && operationById.has(operationId)
    ? responseSchemaId(operationId)
    : undefined;
}

export function stableOperationFor(
  operationId: string,
): StableOperation | undefined {
  return operationById.get(operationId);
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
        if (names.has(name)) continue;
        const definition = COMMON_DEFS[name];
        if (!definition) {
          throw new Error("Unknown JSON Schema definition " + name);
        }
        names.add(name);
        visit(definition);
      } else {
        visit(child);
      }
    }
  };

  visit(schema);
  return Object.fromEntries(
    [...names].map((name) => [name, COMMON_DEFS[name]!]),
  );
}

export function dataSchemaFor(
  operationId: string,
): JsonSchema | undefined {
  const registered = stableOperationFor(operationId);
  if (!registered) return undefined;

  const command = registered.argv.join(" ");
  return {
    $schema: JSON_SCHEMA_DIALECT,
    $id: dataSchemaId(operationId),
    title: "weread --json " + command + " data payload",
    ...registered.dataSchema,
    $defs: referencedDefs(registered.dataSchema),
  };
}

export function schemaFor(
  operationId: string,
): JsonSchema | undefined {
  const registered = stableOperationFor(operationId);
  if (!registered) return undefined;

  const dataSchema = registered.dataSchema;
  const schemaId = responseSchemaId(operationId);
  const metaProperties: Record<string, JsonSchema> = {
    schemaVersion: { const: RESPONSE_SCHEMA_VERSION },
    gatewaySkillVersion: { type: "string" },
    complete: {
      type: "boolean",
      description: META_COMPLETE_DESCRIPTION,
    },
    timeZone: { type: "string" },
    operationId: { const: operationId },
    schemaId: { const: schemaId },
  };

  const successSchema: JsonSchema = {
    type: "object",
    required: ["ok", "data", "meta", "warnings"],
    properties: {
      ok: { const: true },
      data: { $ref: RESPONSE_DATA_SCHEMA_REF },
      meta: {
        type: "object",
        required: Object.keys(metaProperties),
        properties: {
          ...metaProperties,
          complete: {
            const: true,
            description: META_COMPLETE_DESCRIPTION,
          },
        },
        additionalProperties: false,
      },
      warnings: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  };
  const errorSchema: JsonSchema = {
    type: "object",
    required: ["ok", "error", "meta", "warnings"],
    properties: {
      ok: { const: false },
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: { $ref: "#/$defs/jsonValue" },
        },
        additionalProperties: false,
      },
      meta: {
        type: "object",
        required: Object.keys(metaProperties),
        properties: {
          ...metaProperties,
          complete: {
            const: false,
            description: META_COMPLETE_DESCRIPTION,
          },
        },
        additionalProperties: false,
      },
      warnings: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  };
  const shared = {
    $schema: JSON_SCHEMA_DIALECT,
    $id: schemaId,
    title: registered.errorOnly
      ? "weread stable invocation error response"
      : "weread --json " + registered.argv.join(" ") + " response",
    description: registered.errorOnly
      ? "Validates errors whose argv did not resolve to a registered stable operation."
      : "Validates the stable success document on stdout or error document on stderr.",
    $defs: {
      data: dataSchema,
      ...referencedDefs(dataSchema),
      jsonValue: COMMON_DEFS.jsonValue,
    },
  };

  return registered.errorOnly
    ? { ...shared, ...errorSchema }
    : { ...shared, oneOf: [successSchema, errorSchema] };
}

export function operationsCatalog() {
  return {
    contractVersion: OPERATIONS_CATALOG_VERSION,
    executable: "weread" as const,
    operations: STABLE_OPERATIONS.map((entry) => ({
      id: entry.id,
      description: entry.description,
      provides: entry.provides,
      sideEffects: entry.sideEffects,
      pagination: entry.pagination.mode,
      describeArgv: ["--json", "operation", "describe", entry.id],
    })),
    rawEscape: {
      argv: ["--raw", "api", "call"],
      stability: "upstream-shaped" as const,
      responseSchema: null,
    },
  };
}

export function describeOperation(operationId: string) {
  const registered = stableOperationFor(operationId);
  if (!registered) return undefined;

  const responseSchema = schemaFor(operationId);
  if (!responseSchema) return undefined;

  return {
    contractVersion: OPERATIONS_CATALOG_VERSION,
    id: registered.id,
    description: registered.description,
    sideEffects: registered.sideEffects,
    provides: registered.provides,
    invocation: {
      executable: "weread" as const,
      argv: registered.argv,
      jsonArgv: ["--json", ...registered.argv],
      helpArgv: [...registered.argv, "--help"],
    },
    input: registered.input,
    output: {
      mode: "json" as const,
      schemaId: responseSchemaId(operationId),
      responseSchema,
      dataSchemaRef: RESPONSE_DATA_SCHEMA_REF,
    },
    pagination: registered.pagination,
    limitations: registered.limitations,
  };
}
