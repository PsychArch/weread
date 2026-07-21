import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const describeOperationId = "operation.describe";
const responseSchemaVersion = "3";
const describeResponseSchemaId = `urn:weread:response:${responseSchemaVersion}:${describeOperationId}`;
const responseDataSchemaRef = "#/$defs/data";

const descriptors = new Map();
const validators = new Map();
let checks = 0;
let validatedEnvelopes = 0;
let continuationRequests = 0;

// Bootstrap discovery through the same public mechanism an agent receives. The
// descriptor contains its own response schema, so the bootstrap result can be
// validated before it is trusted for every subsequent descriptor response.
const describeBootstrap = json(
  ["operation", "describe", describeOperationId],
  "operation descriptor bootstrap",
);
assertDescribeBootstrap(describeBootstrap);
const describeSchema = describeBootstrap.data.output.responseSchema;
const describeValidator = compileSchema(describeSchema, describeOperationId);
assertValid(describeValidator, describeBootstrap, `${describeOperationId} bootstrap response`);
assertStableEnvelope(describeBootstrap, describeOperationId);
descriptors.set(describeOperationId, describeBootstrap.data);
validators.set(describeOperationId, describeValidator);
validatedEnvelopes += 1;

const operations = stable("operations.list", ["operations"]);
assert(Array.isArray(operations.data.operations), "The operation catalog has no operations array.");
assert(
  operations.data.rawEscape?.argv?.join(" ") === "--raw api call",
  "The operation catalog does not expose the raw API escape hatch.",
);

const expectedOperations = [
  "operations.list",
  describeOperationId,
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
];
const listedOperationIds = new Set(operations.data.operations.map((entry) => entry.id));
for (const operationId of expectedOperations) {
  assert(listedOperationIds.has(operationId), `The operation catalog is missing ${operationId}.`);
}
assert(!listedOperationIds.has("notes.sample"), "The operation catalog still exposes notes.sample.");

// Acquire and compile every stable response schema without invoking operations
// that mutate local configuration.
for (const entry of operations.data.operations) {
  const descriptor = describe(entry.id);
  assert(
    descriptor.invocation?.jsonArgv?.[0] === "--json",
    `The ${entry.id} descriptor has no stable JSON invocation.`,
  );
  assert(
    descriptor.output?.schemaId === descriptor.output?.responseSchema?.$id,
    `The ${entry.id} descriptor response schema ID is inconsistent.`,
  );
  assert(
    descriptor.output?.dataSchemaRef === responseDataSchemaRef
      && isRecord(descriptor.output?.responseSchema?.$defs?.data),
    `The ${entry.id} descriptor has no embedded data-schema reference.`,
  );
  assert(
    descriptor.pagination?.mode === "none"
      ? descriptor.pagination.nextArgvField === null
      : typeof descriptor.pagination?.nextArgvField === "string",
    `The ${entry.id} descriptor has an inconsistent continuation field.`,
  );
}

const doctor = stable("doctor", ["doctor"]);
assert(doctor.data.ready === true, "Doctor did not report data.ready=true.");

const configPath = stable("config.path", ["config", "path"]);
assert(typeof configPath.data.path === "string", "Config path is missing.");
const configShow = stable("config.show", ["config", "show"]);
assert(typeof configShow.data.hasApiKey === "boolean", "Config state is missing credential presence.");

const search = stable("search", [
  "search", "基因传", "--scope", "book", "--limit", "3", "--max-idx", "0",
]);
assertPage(search.data.page, "search");
assert(Array.isArray(search.data.books), "Search did not return a books array.");
const exact = search.data.books.find((item) => item.title === "基因传") ?? search.data.books[0];
const second = search.data.books.find((item) => item.bookId && item.bookId !== exact?.bookId);
const bookId = String(exact?.bookId ?? "");
assert(bookId.length > 0, "Search did not return a usable book ID.");
assert(
  exact.deepLink === undefined || /^https:\/\//.test(exact.deepLink),
  "Search returned an invalid book deep link.",
);
continueIfAvailable("search", search.data.page);

const resolved = stable("book.resolve", ["book", "resolve", "基因传"]);
assert(resolved.data.bookId === bookId, "Book resolution drifted from search.");
assert(resolved.data.match === "exact-title", "Book resolution did not report an exact title match.");

const resolvedBatch = stable("book.resolve-batch", [
  "book", "resolve-batch", "--name", "基因传", "--name", "人类简史",
]);
assert(resolvedBatch.data.requested === 2, "Batch resolution did not accept both names.");
assert(
  resolvedBatch.data.returned + resolvedBatch.data.unresolvedCount === 2,
  "Batch resolution accounting is inconsistent.",
);

const info = stable("book.info", ["book", "info", bookId]);
assert(info.data.bookId === bookId, "Book info returned the wrong book.");

const chapters = stable("book.chapters", ["book", "chapters", bookId]);
assert(chapters.data.bookId === bookId, "Chapter lookup returned the wrong book.");
assert(Array.isArray(chapters.data.chapters), "Chapter lookup has no chapters array.");

const progress = stable("book.progress", ["book", "progress", bookId]);
assert(progress.data.bookId === bookId, "Progress lookup returned the wrong book.");
assert(
  progress.data.readingSeconds === null || typeof progress.data.readingSeconds === "number",
  "Reading duration does not preserve missingness.",
);
assert(
  progress.data.listeningSeconds === null || typeof progress.data.listeningSeconds === "number",
  "Listening duration does not preserve missingness.",
);

const inspection = stable("book.inspect", ["book", "inspect", bookId]);
assert(inspection.data.book?.bookId === bookId, "Book inspection returned the wrong book.");
assert(
  isRecord(inspection.data.accessFacts),
  "Book inspection has no neutral chapter access facts.",
);
assert(
  inspection.data.accessFacts.returnedChapterCount
    === inspection.data.accessFacts.zeroPriceChapterCount
      + inspection.data.accessFacts.pricedChapterCount
      + inspection.data.accessFacts.unknownPriceChapterCount,
  "Book inspection chapter price counts are inconsistent.",
);

if (second?.bookId) {
  const batch = stable("book.inspect-batch", [
    "book", "inspect-batch", "--book-id", bookId, "--book-id", String(second.bookId),
  ]);
  assert(batch.data.returned === 2, "Batch inspection did not return both requested books.");
}

const shelfSummary = stable("shelf.summary", ["shelf", "summary"]);
assert(
  shelfSummary.data.total === shelfSummary.data.books + shelfSummary.data.albums + shelfSummary.data.mp,
  "Shelf resource totals are inconsistent.",
);
assert(
  shelfSummary.data.total === shelfSummary.data.publicCount + shelfSummary.data.secretCount,
  "Shelf privacy totals are inconsistent.",
);

const shelf = stable("shelf.list", ["shelf", "list", "--limit", "2"]);
assertPage(shelf.data.page, "shelf.list");
assert(Array.isArray(shelf.data.entries), "Shelf list has no entries array.");
continueIfAvailable("shelf.list", shelf.data.page);

const stats = stable("stats.detail", ["stats", "detail", "--mode", "monthly"]);
assert(stats.data.period?.mode === "monthly", "Stats detail returned the wrong period mode.");
assert(!Object.hasOwn(stats.data.period, "comparison"), "Stats detail added a CLI comparison interpretation.");
assert(
  ["unavailable", "matches", "mismatch"].includes(stats.data.period?.dataQuality?.durationBreakdown?.status),
  "Stats detail did not expose duration-breakdown status.",
);

const trend = stable("stats.trend", ["stats", "trend"]);
assert(trend.data.periods?.length === 4, "Stats trend did not return all four periods.");
assert(
  trend.data.historyRange?.firstNonzeroYear === null
    || Number.isInteger(trend.data.historyRange.firstNonzeroYear),
  "Stats trend returned an invalid first nonzero history year.",
);
assert(trend.data.historyRange?.earliestSupportedYear === 2017, "Stats trend omitted its supported lower bound.");

const history = stable("stats.history", ["stats", "history"]);
assert(history.data.periods?.length >= 1, "Stats history did not return its supported range.");
assert(
  history.data.fromYear === history.data.historyRange.earliestSupportedYear,
  "Stats history resolved the wrong automatic lower bound.",
);
assert(history.data.toYear === history.data.historyRange.currentYear, "Stats history resolved the wrong automatic upper bound.");
assert(
  history.data.periods.every((period) => !Object.hasOwn(period, "derivedMetrics")),
  "Stats history added CLI-selected derived metrics.",
);
const currentHistoryPeriod = history.data.periods.at(-1);
assert(
  currentHistoryPeriod.year === history.data.historyRange.currentYear
    && currentHistoryPeriod.periodComplete === false
    && currentHistoryPeriod.throughDate === history.data.asOfDate
    && Number.isInteger(currentHistoryPeriod.elapsedDays)
    && currentHistoryPeriod.elapsedDays > 0,
  "Stats history did not distinguish current-period coverage from command completion.",
);

const notebooks = stable("notes.notebooks", ["notes", "notebooks", "--limit", "2"]);
assertPage(notebooks.data.page, "notes.notebooks");
assert(Array.isArray(notebooks.data.books), "Notebook projection has no books array.");
continueIfAvailable("notes.notebooks", notebooks.data.page);

const exported = stable("notes.export", ["notes", "export", bookId, "--format", "json"]);
assert(exported.data.bookId === bookId, "Notes export returned the wrong book.");
assert(isRecord(exported.data.contentScope), "Notes export omitted content provenance.");
assert(typeof exported.data.reviewsExhausted === "boolean", "Notes export omitted review-page coverage.");

const corpus = stable("notes.corpus", [
  "notes", "corpus", "--book-id", bookId, "--view", "thoughts",
]);
assert(corpus.data.totals?.books === 1, "Notes corpus did not return one requested book.");
assert(corpus.data.selection?.mode === "explicit-book-ids", "Notes corpus omitted its selection provenance.");
assertPage(corpus.data.page, "notes.corpus explicit selection");
assert(corpus.data.page.hasMore === false, "Explicit notes corpus unexpectedly returned a continuation.");
assert(
  corpus.data.books.every((entry) => entry.highlights === undefined),
  "Thoughts view returned standalone highlights.",
);
assert(
  corpus.data.totals.returnedItems === corpus.data.totals.returnedThoughts,
  "Thoughts-view item totals are inconsistent.",
);

const corpusPage = stable("notes.corpus", [
  "notes", "corpus", "--all-notebooks", "--view", "thoughts", "--limit", "1",
]);
assertPage(corpusPage.data.page, "notes.corpus all-notebooks");
assert(corpusPage.data.totals?.books <= 1, "Notes corpus exceeded its whole-book page limit.");
assert(
  corpusPage.data.selection?.notebookIndex?.indexExhausted === !corpusPage.data.page.hasMore,
  "Notes corpus notebook-index exhaustion disagrees with corpus pagination.",
);
continueIfAvailable("notes.corpus", corpusPage.data.page);

const popular = stable("notes.popular", ["notes", "popular", bookId, "--limit", "2"]);
assert(popular.data.returned <= 2, "Popular highlights exceeded the requested limit.");

const reviews = stable("reviews.list", [
  "reviews", "list", bookId, "--type", "latest", "--limit", "2",
]);
assertPage(reviews.data.page, "reviews.list");
assert(Array.isArray(reviews.data.reviews), "Public review projection has no reviews array.");

const reviewBatch = stable("reviews.batch", [
  "reviews", "batch", "--book-id", bookId, "--type", "recommend,latest", "--limit", "1",
]);
assert(reviewBatch.data.batches?.length === 2, "Review batch did not return both requested types.");
for (const batch of reviewBatch.data.batches) assertPage(batch.page, "reviews.batch item");
const continuedBatch = reviewBatch.data.batches.find((batch) => batch.page.hasMore);
if (continuedBatch) continueIfAvailable("reviews.batch", continuedBatch.page);

const recommend = stable("discover.recommend", ["discover", "recommend", "--limit", "2"]);
assert(Array.isArray(recommend.data.books), "Recommendation projection has no books array.");
assert(recommend.data.page === undefined, "Recommendations invented pagination metadata.");

const similar = stable("discover.similar", [
  "discover", "similar", bookId, "--limit", "2", "--max-idx", "0",
]);
assertPage(similar.data.page, "discover.similar");
assert(Array.isArray(similar.data.books), "Similar-book projection has no books array.");
continueIfAvailable("discover.similar", similar.data.page);

const apiList = raw(["api", "call", "/_list"], "raw API discovery");
assert(Array.isArray(apiList.apis) && apiList.apis.length > 0, "Raw API discovery returned no APIs.");

console.log(JSON.stringify({
  ok: true,
  checks,
  schemasAcquired: descriptors.size,
  validatedEnvelopes,
  continuationRequests,
  gatewaySkillVersion: doctor.meta.gatewaySkillVersion,
  discoveredApis: apiList.apis.length,
}));

function describe(operationId) {
  const cached = descriptors.get(operationId);
  if (cached) return cached;

  const response = json(
    ["operation", "describe", operationId],
    `descriptor for ${operationId}`,
  );
  assertValid(describeValidator, response, `descriptor response for ${operationId}`);
  assertStableEnvelope(response, describeOperationId);
  assert(response.data.id === operationId, `Descriptor returned the wrong operation for ${operationId}.`);
  assert(isRecord(response.data.output?.responseSchema), `Descriptor has no response schema for ${operationId}.`);

  const validate = compileSchema(response.data.output.responseSchema, operationId);
  descriptors.set(operationId, response.data);
  validators.set(operationId, validate);
  validatedEnvelopes += 1;
  return response.data;
}

function stable(operationId, args) {
  const descriptor = describe(operationId);
  assert(
    descriptor.invocation.argv.every((value, index) => args[index] === value),
    `Invocation does not match the ${operationId} descriptor.`,
  );
  const response = json(args, operationId);
  assertValid(validators.get(operationId), response, `${operationId} response`);
  assertStableEnvelope(response, operationId);
  validatedEnvelopes += 1;
  return response;
}

function continueIfAvailable(operationId, page) {
  if (!page.hasMore) return;
  assert(Array.isArray(page.nextArgv), `${operationId} reported another page without nextArgv.`);
  assert(page.nextArgv[0] === "--json", `${operationId} nextArgv does not request stable JSON.`);
  const continued = stable(operationId, page.nextArgv.slice(1));
  const continuedPage = operationId === "reviews.batch"
    ? continued.data.batches?.[0]?.page
    : continued.data.page;
  assertPage(continuedPage, `${operationId} continuation`);
  continuationRequests += 1;
}

function assertPage(page, label) {
  assert(isRecord(page), `${label} did not return data.page.`);
  assert(typeof page.hasMore === "boolean", `${label} data.page.hasMore is not boolean.`);
  assert(
    page.hasMore ? isRecord(page.nextArgs) : page.nextArgs === null,
    `${label} data.page.nextArgs is inconsistent with hasMore.`,
  );
  assert(
    page.hasMore ? Array.isArray(page.nextArgv) : page.nextArgv === null,
    `${label} data.page.nextArgv is inconsistent with hasMore.`,
  );
}

function assertStableEnvelope(response, operationId) {
  assert(response.ok === true, `${operationId} returned a non-success envelope.`);
  assert(response.meta?.complete === true, `${operationId} did not complete the requested operation.`);
  assert(response.meta?.operationId === operationId, `${operationId} returned the wrong operation ID.`);
  assert(typeof response.meta?.schemaId === "string", `${operationId} returned no schema ID.`);
  assert(Array.isArray(response.warnings), `${operationId} returned no warnings array.`);
}

function assertDescribeBootstrap(response) {
  assert(response?.ok === true, "The operation descriptor bootstrap was not successful.");
  assert(
    response.meta?.operationId === describeOperationId,
    "The operation descriptor bootstrap returned the wrong operation ID.",
  );
  assert(
    response.meta?.schemaVersion === responseSchemaVersion
      && response.meta?.schemaId === describeResponseSchemaId,
    "The operation descriptor bootstrap returned the wrong response schema version or ID.",
  );
  assert(
    response.data?.id === describeOperationId,
    "The operation descriptor bootstrap described the wrong operation.",
  );
  assertRequiredFields(
    response.data?.invocation,
    ["executable", "argv", "jsonArgv", "helpArgv"],
    "operation descriptor bootstrap invocation",
  );
  assertRequiredFields(
    response.data?.output,
    ["mode", "schemaId", "responseSchema", "dataSchemaRef"],
    "operation descriptor bootstrap output",
  );
  assert(
    response.data.output.schemaId === describeResponseSchemaId,
    "The operation descriptor bootstrap output returned the wrong response schema ID.",
  );
  assert(
    response.data.output.dataSchemaRef === responseDataSchemaRef,
    "The operation descriptor bootstrap returned the wrong data schema reference.",
  );
  assert(
    response.data.output.responseSchema?.$id === describeResponseSchemaId,
    "The embedded operation descriptor response schema returned the wrong ID.",
  );
}

function assertRequiredFields(value, fields, label) {
  assert(isRecord(value), `The ${label} is missing.`);
  for (const field of fields) {
    assert(Object.hasOwn(value, field), `The ${label} is missing ${field}.`);
  }
}

function compileSchema(schema, label) {
  try {
    return typeof schema.$id === "string"
      ? (ajv.getSchema(schema.$id) ?? ajv.compile(schema))
      : ajv.compile(schema);
  } catch (error) {
    throw new Error(`Could not compile the discovered response schema for ${label}: ${error.message}`);
  }
}

function assertValid(validate, value, label) {
  assert(typeof validate === "function", `No discovered response validator is available for ${label}.`);
  if (validate(value)) {
    checks += 1;
    return;
  }
  const errors = (validate.errors ?? []).slice(0, 5).map((entry) => ({
    instancePath: entry.instancePath,
    schemaPath: entry.schemaPath,
    keyword: entry.keyword,
    message: entry.message,
  }));
  throw new Error(`Schema validation failed for ${label}: ${JSON.stringify(errors)}`);
}

function json(args, label) {
  return run(["--json", ...args], label);
}

function raw(args, label) {
  return run(["--raw", ...args], label);
}

function run(args, label) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit status ${result.status}${errorCode(result)}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function errorCode(result) {
  try {
    const parsed = JSON.parse(result.stderr || result.stdout);
    return typeof parsed.error?.code === "string" ? ` (${parsed.error.code})` : "";
  } catch {
    return "";
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}
