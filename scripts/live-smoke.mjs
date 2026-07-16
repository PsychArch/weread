import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.WEREAD_API_KEY) {
  throw new Error("Set WEREAD_API_KEY before running the live smoke suite.");
}

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const capabilities = json(["capabilities"]);
assert(capabilities.safety?.gatewayOperations === "read-only", "Capabilities do not report a read-only gateway.");

const doctor = agent(["doctor"]);
assert(doctor.data.ready === true, "Doctor did not report data.ready=true.");

const search = json(["search", "基因传", "--scope", "book", "--limit", "3", "--max-idx", "0"]);
const searchItems = (search.results ?? []).flatMap((group) => group.books ?? []);
const exact = searchItems.find((item) => item.bookInfo?.title === "基因传") ?? searchItems[0];
const second = searchItems.find((item) => item.bookInfo?.bookId && item.bookInfo.bookId !== exact?.bookInfo?.bookId);
const bookId = String(exact?.bookInfo?.bookId ?? "");
assert(bookId, "Search did not return a usable bookId.");
assert(/^https:\/\//.test(exact?.bookInfo?.deepLink ?? ""), "Search did not return the observed HTTPS deepLink shape.");

const resolved = agent(["book", "resolve", "基因传"]);
assert(resolved.data.bookId === bookId, "Book resolution drifted from search.");

const info = json(["book", "info", bookId]);
assert(info.bookId === bookId && typeof info.title === "string", "Book info shape is invalid.");

const chapters = json(["book", "chapters", bookId]);
assert(Array.isArray(chapters.chapters) && chapters.chapters.length > 0, "Chapter list is empty or invalid.");

const progress = json(["book", "progress", bookId]);
assert(progress.book && typeof progress.book === "object", "Progress response has no book object.");

const inspection = agent(["book", "inspect", bookId]);
assert(inspection.data.book?.bookId === bookId, "Book inspection returned the wrong book.");
assert(
  inspection.data.book.rating === undefined || (inspection.data.book.rating > 0 && inspection.data.book.rating <= 10),
  "Compact book rating is not normalized to 0-10.",
);
assert(typeof inspection.data.progress?.readingSeconds === "number", "Compact progress has no readingSeconds.");

if (second?.bookInfo?.bookId) {
  const batch = agent([
    "book", "inspect-batch",
    "--book-id", bookId,
    "--book-id", String(second.bookInfo.bookId),
  ]);
  assert(batch.data.returned === 2, "Batch inspection did not return both requested books.");
}

const shelfSummary = json(["shelf", "summary"]);
assert(shelfSummary.total === shelfSummary.books + shelfSummary.albums + shelfSummary.mp, "Shelf total contract is inconsistent.");
const shelf = agent(["shelf", "list", "--limit", "2"]);
assert(Array.isArray(shelf.data.entries), "Shelf list projection is invalid.");

const stats = agent(["stats", "detail", "--mode", "monthly"]);
assert(stats.data.fieldGuide?.durationUnit === "seconds", "Stats detail is missing its field guide.");
const trend = agent(["stats", "trend"]);
assert(trend.data.periods?.length === 4, "Stats trend did not return all four periods.");

const notebooks = agent(["notes", "notebooks", "--limit", "2"]);
assert(Array.isArray(notebooks.data.books), "Notebook projection is invalid.");
const exported = agent(["notes", "export", bookId, "--format", "json"]);
assert(exported.data.bookId === bookId, "Notes export returned the wrong book.");
const corpus = agent(["notes", "corpus", "--book-id", bookId]);
assert(corpus.data.totals?.books === 1, "Notes corpus did not return one requested book.");
const popular = agent(["notes", "popular", bookId, "--limit", "2"]);
assert(popular.data.returned <= 2, "Popular highlights exceeded the requested limit.");

const reviews = agent(["reviews", "list", bookId, "--type", "latest", "--limit", "2"]);
assert(Array.isArray(reviews.data.reviews), "Public review projection is invalid.");
assert(
  reviews.data.reviews.every((review) => review.rating === undefined || (review.rating >= 0 && review.rating <= 5)),
  "Compact review rating is not normalized to 0-5.",
);
const reviewBatch = agent(["reviews", "batch", "--book-id", bookId, "--type", "recommend,latest", "--limit", "1"]);
assert(reviewBatch.data.batches?.length === 2, "Review batch did not return both requested types.");

const recommend = agent(["discover", "recommend", "--limit", "2", "--max-idx", "0"]);
assert(Array.isArray(recommend.data.books), "Recommendation projection is invalid.");
const similar = agent(["discover", "similar", bookId, "--limit", "2", "--max-idx", "0"]);
assert(Array.isArray(similar.data.books), "Similar-book projection is invalid.");

const apiList = json(["api", "call", "/_list"]);
assert(Array.isArray(apiList.apis) && apiList.apis.length > 0, "Raw gateway escape hatch did not return API discovery data.");

console.log(JSON.stringify({
  ok: true,
  checks: 20,
  gatewaySkillVersion: doctor.meta.gatewaySkillVersion,
  discoveredApis: apiList.apis.length,
}));

function json(args) {
  return run(["--json", ...args]);
}

function agent(args) {
  const result = run(["--agent", ...args]);
  assert(result.ok === true, `Agent command failed: ${args.join(" ")}`);
  assert(result.meta?.complete !== undefined, `Agent command has no completeness metadata: ${args.join(" ")}`);
  assert(Array.isArray(result.warnings), `Agent command has no warnings array: ${args.join(" ")}`);
  return result;
}

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`weread ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`weread ${args.join(" ")} returned invalid JSON: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
