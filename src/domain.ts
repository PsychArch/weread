import type { JsonObject } from "./client.js";
import { normalizeBookRating } from "./format.js";

export type UnknownRecord = Record<string, unknown>;

export interface GatewayCaller {
  call<T = unknown>(apiName: string, params?: JsonObject): Promise<T>;
}

export interface CompactBook {
  bookId: string;
  title: string;
  author: string;
  category?: string;
  categories?: string[];
  publisher?: string;
  rating?: number;
  ratingScale?: 10;
  intro?: string;
  deepLink?: string;
}

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function compactBook(value: unknown): CompactBook {
  const direct = asRecord(value);
  const nested = asRecord(direct.bookInfo);
  const record = Object.keys(nested).length ? nested : direct;
  const rating = normalizeBookRating(number(direct.newRating) ?? number(record.newRating) ?? number(record.rating));
  const category = text(record.category);
  const categories = asArray(record.categories)
    .map((entry) => text(asRecord(entry).title) || text(entry))
    .filter(Boolean);
  return {
    bookId: text(record.bookId) || String(record.bookId ?? ""),
    title: text(record.title) || text(record.name),
    author: text(record.author) || text(record.authorName),
    ...(category || categories[0] ? { category: category || categories[0] } : {}),
    ...(categories.length ? { categories } : {}),
    ...(text(record.publisher) ? { publisher: text(record.publisher) } : {}),
    ...(rating !== undefined ? { rating, ratingScale: 10 as const } : {}),
    ...(text(record.intro) ? { intro: text(record.intro) } : {}),
    ...(text(record.deepLink) ? { deepLink: text(record.deepLink) } : {}),
  };
}

export function projectSearch(result: unknown, limit: number) {
  const record = asRecord(result);
  const candidates = asArray(record.results).flatMap((group) => asArray(asRecord(group).books));
  const selected = candidates.slice(0, limit);
  const books = selected.map(compactBook);
  const nextMaxIdx = number(asRecord(selected.at(-1)).searchIdx);
  return {
    queryResultCount: books.length,
    hasMore: flag(record.hasMore),
    ...(nextMaxIdx !== undefined ? { nextMaxIdx } : {}),
    ...(text(record.sid) ? { sessionId: text(record.sid) } : {}),
    books,
  };
}

export function projectBookInfo(result: unknown): CompactBook & UnknownRecord {
  const record = asRecord(result);
  const book = compactBook(record);
  return {
    ...book,
    ...(text(record.translator) ? { translator: text(record.translator) } : {}),
    ...(number(record.newRatingCount) !== undefined ? { ratingCount: number(record.newRatingCount) } : {}),
    ...(number(record.wordCount) !== undefined ? { wordCount: number(record.wordCount) } : {}),
    ...(number(record.lastChapterIdx) !== undefined ? { lastChapterIndex: number(record.lastChapterIdx) } : {}),
    ...(number(record.soldout) !== undefined ? { soldOut: number(record.soldout) === 1 } : {}),
  };
}

export function projectChapters(result: unknown, fallbackBookId: string) {
  const record = asRecord(result);
  const bookId = text(record.bookId) || fallbackBookId;
  const chapters = asArray(record.chapters).map((value) => {
    const chapter = asRecord(value);
    return {
      chapterUid: String(chapter.chapterUid ?? ""),
      title: text(chapter.title),
      level: number(chapter.level) ?? 1,
      paid: chapter.paid === 1,
      price: number(chapter.price) ?? -1,
    };
  });
  return { bookId, count: chapters.length, chapters };
}

export function projectProgress(result: unknown, fallbackBookId: string) {
  const record = asRecord(result);
  const nestedBook = asRecord(record.book);
  const book = Object.keys(nestedBook).length ? nestedBook : record;
  const readingSeconds = number(book.readingTime) ?? number(book.recordReadingTime) ?? 0;
  return {
    bookId: text(record.bookId) || fallbackBookId,
    percent: number(book.progress) ?? 0,
    chapterUid: String(book.chapterUid ?? ""),
    readingSeconds,
    updatedAt: timestampIso(book.updateTime),
    ...(number(book.finishTime) !== undefined ? { finishedAt: timestampIso(book.finishTime) } : {}),
  };
}

export function projectShelfEntries(result: unknown, limit: number) {
  const record = asRecord(result);
  const entries: UnknownRecord[] = [];
  for (const value of asArray(record.books)) {
    const item = asRecord(value);
    entries.push({
      type: "book",
      ...compactBook(item),
      secret: item.secret === 1,
      updatedAt: timestampIso(item.readUpdateTime),
    });
  }
  for (const value of asArray(record.albums)) {
    const item = asRecord(value);
    const info = asRecord(item.albumInfo);
    entries.push({
      type: "album",
      albumId: String(info.albumId ?? item.albumId ?? ""),
      title: text(info.name) || text(info.title),
      author: text(info.authorName) || text(info.author),
      trackCount: number(info.trackCount) ?? 0,
      secret: asRecord(item.albumInfoExtra).secret === 1,
    });
  }
  if (record.mp) entries.push({ type: "mp", title: "文章收藏" });
  return {
    returned: Math.min(entries.length, limit),
    total: entries.length,
    hasMore: entries.length > limit,
    entries: entries.slice(0, limit),
  };
}

export function limitShelfRaw(result: unknown, limit: number): UnknownRecord {
  const record = asRecord(result);
  let remaining = limit;
  const books = asArray(record.books).slice(0, remaining);
  remaining -= books.length;
  const albums = asArray(record.albums).slice(0, Math.max(0, remaining));
  remaining -= albums.length;
  return {
    ...record,
    books,
    albums,
    ...(remaining <= 0 ? { mp: undefined } : {}),
  };
}

export function projectNotebooks(result: unknown, limit = Number.POSITIVE_INFINITY) {
  const record = asRecord(result);
  const books = asArray(record.books).slice(0, limit).map((value) => {
    const item = asRecord(value);
    const noteCount = number(item.noteCount) ?? 0;
    const bookmarkCount = number(item.bookmarkCount) ?? 0;
    const thoughtCount = number(item.reviewCount) ?? 0;
    return {
      book: compactBook(item.book),
      highlightCount: noteCount,
      bookmarkCount,
      thoughtCount,
      totalNoteCount: noteCount + bookmarkCount + thoughtCount,
      readingProgress: number(item.readingProgress) ?? 0,
      updatedAt: timestampIso(item.updateTime ?? item.sort),
    };
  });
  return {
    returned: books.length,
    totalBookCount: number(record.totalBookCount) ?? books.length,
    totalNoteCount: number(record.totalNoteCount) ?? books.reduce((sum, item) => sum + item.totalNoteCount, 0),
    hasMore: record.hasMore === 1 || record.hasMore === true,
    books,
  };
}

export async function fetchNotebooks(
  caller: GatewayCaller,
  limit: number,
  all: boolean,
): Promise<UnknownRecord> {
  const books: unknown[] = [];
  let lastSort: number | undefined;
  let page: UnknownRecord = {};
  const seenCursors = new Set<number>();
  const maximum = all ? Number.POSITIVE_INFINITY : limit;

  do {
    const remaining = Number.isFinite(maximum) ? Math.max(1, maximum - books.length) : 100;
    const params: JsonObject = { count: Math.min(remaining, 100) };
    if (lastSort !== undefined) params.lastSort = lastSort;
    page = asRecord(await caller.call("/user/notebooks", params));
    const pageBooks = asArray(page.books);
    books.push(...pageBooks);
    const last = asRecord(pageBooks.at(-1));
    const nextSort = number(last.sort);
    if (books.length >= maximum || !flag(page.hasMore) || nextSort === undefined || seenCursors.has(nextSort)) break;
    seenCursors.add(nextSort);
    lastSort = nextSort;
  } while (true);

  return {
    totalBookCount: page.totalBookCount,
    totalNoteCount: page.totalNoteCount,
    hasMore: flag(page.hasMore) ? 1 : 0,
    books: books.slice(0, maximum),
  };
}

export interface MineReviewsResult extends UnknownRecord {
  reviews: unknown[];
  complete: boolean;
  totalCount?: number;
}

export async function fetchMineReviews(caller: GatewayCaller, bookId: string): Promise<MineReviewsResult> {
  const reviews: unknown[] = [];
  const seenCursors = new Set<number>();
  let synckey = 0;
  let page: UnknownRecord = {};
  let totalCount: number | undefined;

  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    page = asRecord(await caller.call("/review/list/mine", { bookid: bookId, count: 100, synckey }));
    const pageReviews = asArray(page.reviews);
    reviews.push(...pageReviews);
    totalCount = number(page.totalCount) ?? totalCount;
    if (totalCount !== undefined && reviews.length >= totalCount) break;
    if (!flag(page.hasMore) && (totalCount === undefined || reviews.length >= totalCount)) break;

    const next = number(page.synckey) ?? 0;
    if (!next || seenCursors.has(next) || pageReviews.length === 0) break;
    seenCursors.add(next);
    synckey = next;
  }

  const complete = totalCount === undefined ? !flag(page.hasMore) : reviews.length >= totalCount;
  return {
    ...page,
    reviews: totalCount === undefined ? reviews : reviews.slice(0, totalCount),
    complete,
    ...(totalCount !== undefined ? { totalCount } : {}),
  };
}

export async function fetchNotes(caller: GatewayCaller, bookId: string) {
  const [bookmarks, reviews] = await Promise.all([
    caller.call("/book/bookmarklist", { bookId }),
    fetchMineReviews(caller, bookId),
  ]);
  return { bookId, bookmarks, reviews };
}

export function projectNotes(exported: unknown, includeScope = true) {
  const record = asRecord(exported);
  const bookId = text(record.bookId);
  const bookmarks = asRecord(record.bookmarks);
  const mine = asRecord(record.reviews);
  const chapters = new Map<string, string>();
  for (const value of asArray(bookmarks.chapters)) {
    const chapter = asRecord(value);
    chapters.set(String(chapter.chapterUid ?? ""), text(chapter.title));
  }

  const highlights = asArray(bookmarks.updated).map((value) => {
    const mark = asRecord(value);
    const chapterUid = String(mark.chapterUid ?? "");
    const range = text(mark.range);
    return {
      chapterUid,
      chapterTitle: chapters.get(chapterUid) ?? "",
      text: text(mark.markText),
      createdAt: timestampIso(mark.createTime),
      ...(range ? { range } : {}),
      ...(text(mark.deepLink) ? { deepLink: text(mark.deepLink) } : {}),
    };
  });

  const thoughts = asArray(mine.reviews).map((value) => {
    const wrapper = asRecord(value);
    const review = asRecord(wrapper.review);
    const content = cleanText(text(review.content) || text(review.htmlContent));
    const quotedText = cleanText(review.abstract);
    const contextText = cleanText(review.contextAbstract);
    const rawRating = number(review.star);
    const rating = rawRating !== undefined && rawRating >= 0
      ? rawRating > 5 ? rawRating / 20 : rawRating
      : undefined;
    const entryKind = content
      ? quotedText ? "comment-on-text" : "personal-comment"
      : quotedText
        ? "excerpt-only"
        : rating !== undefined
          ? "rating-only"
          : "empty";
    return {
      reviewId: String(review.reviewId ?? wrapper.reviewId ?? ""),
      chapterUid: String(review.chapterUid ?? ""),
      chapterTitle: text(review.chapterName),
      entryKind,
      content,
      ...(quotedText ? { quotedText } : {}),
      ...(contextText ? { contextText } : {}),
      ...(text(review.range) ? { range: text(review.range) } : {}),
      createdAt: timestampIso(review.createTime),
      ...(number(review.type) !== undefined ? { sourceType: number(review.type) } : {}),
      ...(rating !== undefined ? { rating, ratingScale: 5 } : {}),
    };
  });

  const thoughtsWithText = thoughts.filter((entry) => entry.content.length > 0).length;
  const contextOnlyThoughts = thoughts.filter((entry) => entry.entryKind === "excerpt-only").length;
  const ratingOnlyThoughts = thoughts.filter((entry) => entry.entryKind === "rating-only").length;
  const emptyThoughts = thoughts.filter((entry) => entry.entryKind === "empty").length;

  return {
    book: compactBook(bookmarks.book),
    bookId,
    counts: {
      highlights: highlights.length,
      thoughts: thoughts.length,
      thoughtsWithText,
      contextOnlyThoughts,
      ratingOnlyThoughts,
      emptyThoughts,
      total: highlights.length + thoughts.length,
    },
    ...(includeScope ? {
      contentScope: {
        includes: ["highlights", "personal note/review entries"],
        excludes: ["bookmark positions"],
        personalWordsField: "thoughts[].content",
        sourceContextFields: ["thoughts[].quotedText", "thoughts[].contextText"],
      },
    } : {}),
    complete: mine.complete !== false,
    highlights,
    thoughts,
  };
}

export function projectPopularHighlights(result: unknown, limit: number) {
  const record = asRecord(result);
  const items = asArray(record.items).slice(0, limit).map((value) => {
    const mark = asRecord(value);
    return {
      bookId: text(mark.bookId),
      bookmarkId: text(mark.bookmarkId),
      chapterUid: String(mark.chapterUid ?? ""),
      text: text(mark.markText),
      readerCount: number(mark.totalCount) ?? 0,
      range: text(mark.range),
      ...(text(mark.deepLink) ? { deepLink: text(mark.deepLink) } : {}),
    };
  });
  return { returned: items.length, totalCount: number(record.totalCount), items };
}

export function projectReviews(result: unknown, bookId: string, type: string, limit: number, maxContentChars = 800) {
  const record = asRecord(result);
  const selected = asArray(record.reviews).slice(0, limit);
  const items = selected.map((value) => {
    const outer = asRecord(value);
    const first = asRecord(outer.review);
    const review = Object.keys(asRecord(first.review)).length ? asRecord(first.review) : first;
    const author = asRecord(review.author);
    const fullContent = cleanText(text(review.content) || text(review.htmlContent));
    const contentTruncated = fullContent.length > maxContentChars;
    const rawRating = number(review.star);
    const rating = rawRating !== undefined && rawRating >= 0
      ? rawRating > 5 ? rawRating / 20 : rawRating
      : undefined;
    return {
      reviewId: String(review.reviewId ?? first.reviewId ?? outer.reviewId ?? ""),
      author: text(author.name),
      content: contentTruncated ? fullContent.slice(0, maxContentChars) : fullContent,
      contentTruncated,
      ...(rating !== undefined ? { rating, ratingScale: 5 as const } : {}),
      createdAt: timestampIso(review.createTime),
      likeCount: number(review.likeCount) ?? 0,
    };
  });
  const nextMaxIdx = number(asRecord(selected.at(-1)).idx);
  return {
    bookId,
    type,
    returned: items.length,
    totalCount: number(record.reviewsCnt),
    hasMore: flag(record.reviewsHasMore ?? record.hasMore),
    ...(nextMaxIdx !== undefined ? { nextMaxIdx } : {}),
    ...(number(record.synckey) !== undefined ? { synckey: number(record.synckey) } : {}),
    reviews: items,
  };
}

export function projectRecommendations(result: unknown, limit: number) {
  const record = asRecord(result);
  const books = asArray(record.books).slice(0, limit).map((value) => {
    const item = asRecord(value);
    return {
      ...compactBook(item),
      ...(text(item.reason) ? { reason: cleanText(item.reason) } : {}),
    };
  });
  return { returned: books.length, hasMore: flag(record.hasMore), books };
}

export function projectSimilar(result: unknown, limit: number) {
  const similar = asRecord(asRecord(result).booksimilar);
  const selected = asArray(similar.books).slice(0, limit);
  const books = selected.map((value) => {
    const item = asRecord(value);
    const book = asRecord(item.book);
    return compactBook(Object.keys(book).length ? book : item);
  });
  const nextMaxIdx = number(asRecord(selected.at(-1)).idx);
  return {
    returned: books.length,
    hasMore: flag(similar.booksHasMore ?? similar.hasMore),
    ...(text(similar.sessionId) ? { sessionId: text(similar.sessionId) } : {}),
    ...(nextMaxIdx !== undefined ? { nextMaxIdx } : {}),
    books,
  };
}

export function inspectBook(input: {
  bookId: string;
  info: unknown;
  chapters: unknown;
  progress: unknown;
  shelf: unknown;
  notebooks: unknown;
}) {
  const info = projectBookInfo(input.info);
  const chapterData = projectChapters(input.chapters, input.bookId);
  const progress = projectProgress(input.progress, input.bookId);
  const shelfEntries = projectShelfEntries(input.shelf, Number.POSITIVE_INFINITY).entries;
  const notebookEntries = projectNotebooks(input.notebooks).books;
  const shelfEntry = shelfEntries.find((entry) => String(entry.bookId ?? "") === input.bookId);
  const notebook = notebookEntries.find((entry) => entry.book.bookId === input.bookId);
  const soldOut = info.soldOut === true;
  const freeCount = chapterData.chapters.filter((chapter) => chapter.price === 0).length;
  const pricedCount = chapterData.chapters.filter((chapter) => chapter.price > 0).length;
  const purchasedCount = chapterData.chapters.filter((chapter) => chapter.paid).length;
  const unknownPriceCount = chapterData.chapters.filter((chapter) => chapter.price < 0).length;
  const readable = !soldOut && freeCount + purchasedCount > 0;
  return {
    book: info,
    availability: {
      available: !soldOut,
      readable,
      ...(soldOut ? { reason: "sold-out" } : !readable ? { reason: "no-confirmed-readable-chapters" } : {}),
    },
    chapters: {
      count: chapterData.count,
      freeCount,
      pricedCount,
      purchasedCount,
      unknownPriceCount,
    },
    progress,
    shelf: { present: Boolean(shelfEntry), ...(shelfEntry ? { entry: shelfEntry } : {}) },
    notebook: { present: Boolean(notebook), ...(notebook ? { summary: notebook } : {}) },
  };
}

export function timestampIso(value: unknown): string | null {
  const timestamp = number(value);
  if (timestamp === undefined || timestamp <= 0) return null;
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return new Date(milliseconds).toISOString();
}

function cleanText(value: unknown): string {
  return text(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function flag(value: unknown): boolean {
  return value === true || value === 1;
}
