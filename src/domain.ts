import type { JsonObject } from "./client.js";
import type { CorpusCursorState } from "./corpus-cursor.js";
import { CliError } from "./errors.js";
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
  translator?: string;
  ratingCount?: number;
  soldOut?: boolean;
  payTypeCode?: number;
  resourceTypeCode?: number;
  bookStatusCode?: number;
  format?: string;
  price?: number;
  version?: number;
  readingCount?: number;
  searchIndex?: number;
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
  const ratingCount = number(record.newRatingCount);
  const soldOutCode = number(record.soldout);
  const payTypeCode = number(record.payType);
  const resourceTypeCode = number(record.type);
  const bookStatusCode = number(record.bookStatus);
  const price = number(record.price);
  const version = number(record.version);
  const readingCount = number(direct.readingCount);
  const searchIndex = number(direct.searchIdx);
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
    ...(text(record.translator) ? { translator: text(record.translator) } : {}),
    ...(ratingCount !== undefined ? { ratingCount } : {}),
    ...(soldOutCode !== undefined ? { soldOut: soldOutCode === 1 } : {}),
    ...(payTypeCode !== undefined ? { payTypeCode } : {}),
    ...(resourceTypeCode !== undefined ? { resourceTypeCode } : {}),
    ...(bookStatusCode !== undefined ? { bookStatusCode } : {}),
    ...(text(record.format) ? { format: text(record.format) } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(readingCount !== undefined ? { readingCount } : {}),
    ...(searchIndex !== undefined ? { searchIndex } : {}),
  };
}

export function projectSearch(
  result: unknown,
  input: { keyword: string; scope: string; limit: number },
) {
  const record = asRecord(result);
  const candidates = asArray(record.results).flatMap((group) => asArray(asRecord(group).books));
  const selected = candidates.slice(0, input.limit);
  const books = selected.map(compactBook);
  const nextMaxIdx = number(asRecord(selected.at(-1)).searchIdx);
  const sessionId = text(record.sid);
  const hasMore = flag(record.hasMore) || candidates.length > selected.length;
  return {
    queryResultCount: books.length,
    page: pagination(
      hasMore,
      nextMaxIdx === undefined || !sessionId
        ? undefined
        : {
            "--max-idx": nextMaxIdx,
            "--session-id": sessionId,
          },
      nextMaxIdx === undefined || !sessionId
        ? undefined
        : [
            "--json",
            "search",
            input.keyword,
            "--scope",
            input.scope,
            "--limit",
            String(input.limit),
            "--max-idx",
            String(nextMaxIdx),
            "--session-id",
            sessionId,
          ],
    ),
    books,
  };
}

export function projectBookInfo(result: unknown): CompactBook & UnknownRecord {
  const record = asRecord(result);
  const book = compactBook(record);
  return {
    ...book,
    ...(number(record.wordCount) !== undefined ? { wordCount: number(record.wordCount) } : {}),
    ...(number(record.lastChapterIdx) !== undefined ? { lastChapterIndex: number(record.lastChapterIdx) } : {}),
  };
}

export function projectChapters(result: unknown, fallbackBookId: string) {
  const record = asRecord(result);
  const bookId = text(record.bookId) || fallbackBookId;
  const chapters = asArray(record.chapters).map((value) => {
    const chapter = asRecord(value);
    const paid = number(chapter.paid);
    const isMpChapter = number(chapter.isMPChapter);
    const price = number(chapter.price);
    return {
      chapterUid: String(chapter.chapterUid ?? ""),
      title: text(chapter.title),
      level: number(chapter.level) ?? 1,
      index: number(chapter.chapterIdx) ?? null,
      wordCount: number(chapter.wordCount) ?? null,
      paid: paid === undefined ? null : paid === 1,
      price: price !== undefined && price >= 0 ? price : null,
      isMpChapter: isMpChapter === undefined ? null : isMpChapter === 1,
      updatedAt: timestampIso(chapter.updateTime),
    };
  });
  return {
    bookId,
    count: chapters.length,
    syncKey: number(record.synckey) ?? null,
    updatedAt: timestampIso(record.chapterUpdateTime),
    chapters,
  };
}

export function projectProgress(result: unknown, fallbackBookId: string) {
  const record = asRecord(result);
  const nestedBook = asRecord(record.book);
  const book = Object.keys(nestedBook).length ? nestedBook : record;
  const started = number(book.isStartReading);
  return {
    bookId: text(record.bookId) || text(book.bookId) || fallbackBookId,
    percent: number(book.progress) ?? null,
    chapterUid: book.chapterUid === undefined || book.chapterUid === null ? null : String(book.chapterUid),
    chapterOffset: number(book.chapterOffset) ?? null,
    readingSeconds: number(book.readingTime) ?? null,
    recordReadingSeconds: number(book.recordReadingTime) ?? null,
    listeningSeconds: number(book.ttsTime) ?? null,
    started: started === undefined ? null : started === 1,
    startedAt: timestampIso(book.startReadingTime),
    updatedAt: timestampIso(book.updateTime),
    serverTimestamp: timestampIso(record.timestamp),
    ...(text(book.reviewId) ? { reviewId: text(book.reviewId) } : {}),
    ...(number(book.bookVersion) !== undefined ? { bookVersion: number(book.bookVersion) } : {}),
    ...(number(book.finishTime) !== undefined ? { finishedAt: timestampIso(book.finishTime) } : {}),
  };
}

export function projectShelfEntries(result: unknown, limit: number) {
  const record = asRecord(result);
  const entries: UnknownRecord[] = [];
  for (const value of asArray(record.books)) {
    const item = asRecord(value);
    const finishReading = number(item.finishReading);
    entries.push({
      type: "book",
      ...compactBook(item),
      private: item.secret === 1,
      finished: finishReading === undefined ? null : finishReading === 1,
      lastReadAt: timestampIso(item.readUpdateTime),
      upstreamUpdatedAt: timestampIso(item.updateTime),
    });
  }
  for (const value of asArray(record.albums)) {
    const item = asRecord(value);
    const info = asRecord(item.albumInfo);
    const extra = asRecord(item.albumInfoExtra);
    const finish = number(info.finish) ?? number(item.finish);
    entries.push({
      type: "album",
      albumId: String(info.albumId ?? item.albumId ?? ""),
      title: text(info.name) || text(info.title),
      author: text(info.authorName) || text(info.author),
      trackCount: number(info.trackCount) ?? 0,
      private: extra.secret === 1,
      finished: finish === undefined ? null : finish === 1,
      finishStatus: text(info.finishStatus) || text(item.finishStatus) || null,
      payTypeCode: number(info.payType) ?? number(item.payType) ?? null,
      off: number(info.off) === undefined ? null : number(info.off) === 1,
      free: number(info.free) === undefined ? null : number(info.free) === 1,
      pinned: typeof extra.isTop === "boolean" ? extra.isTop : number(extra.isTop) === undefined ? null : number(extra.isTop) === 1,
      lastReadAt: timestampIso(extra.lectureReadUpdateTime),
      upstreamUpdatedAt: timestampIso(info.updateTime ?? item.updateTime),
    });
  }
  if (record.mp) {
    const mp = asRecord(record.mp);
    const mpBook = asRecord(mp.book);
    entries.push({
      type: "mp",
      title: text(mpBook.title),
      archiveId: number(mp.archiveId) ?? null,
      shown: number(mp.show) === undefined ? null : number(mp.show) === 1,
      book: compactBook(mpBook),
      private: number(mpBook.secret) === undefined ? null : number(mpBook.secret) === 1,
      pinned: typeof mpBook.isTop === "boolean" ? mpBook.isTop : number(mpBook.isTop) === undefined ? null : number(mpBook.isTop) === 1,
      lastReadAt: timestampIso(mpBook.readUpdateTime),
      upstreamUpdatedAt: timestampIso(mpBook.updateTime),
    });
  }
  const archives = asArray(record.archive).map((value) => {
    const archive = asRecord(value);
    return {
      name: text(archive.name),
      bookIds: identifiers(archive.bookIds),
      albumIds: identifiers(archive.albumIds),
    };
  });
  return {
    returned: Math.min(entries.length, limit),
    total: entries.length,
    page: pagination(
      entries.length > limit,
      entries.length > limit ? { "--all": true } : undefined,
      entries.length > limit ? ["--json", "shelf", "list", "--all"] : undefined,
    ),
    archives,
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
  const candidates = asArray(record.books);
  const selected = candidates.slice(0, limit);
  const books = selected.map((value) => {
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
      readingProgress: number(item.readingProgress) ?? null,
      markedStatus: number(item.markedStatus) ?? null,
      sort: number(item.sort) ?? null,
      updatedAt: timestampIso(item.updateTime),
    };
  });
  const hasMore = flag(record.hasMore) || candidates.length > selected.length;
  const nextLastSort = number(asRecord(selected.at(-1)).sort) ?? number(record.nextLastSort);
  return {
    returned: books.length,
    totalBookCount: number(record.totalBookCount) ?? books.length,
    totalNoteCount: number(record.totalNoteCount) ?? books.reduce((sum, item) => sum + item.totalNoteCount, 0),
    syncKey: number(record.synckey) ?? null,
    noBookReviewCount: number(record.noBookReviewCount) ?? null,
    page: pagination(
      hasMore,
      nextLastSort === undefined ? undefined : { "--last-sort": nextLastSort },
      nextLastSort === undefined
        ? undefined
        : Number.isFinite(limit)
          ? [
              "--json",
              "notes",
              "notebooks",
              "--limit",
              String(limit),
              "--last-sort",
              String(nextLastSort),
            ]
          : ["--json", "notes", "notebooks", "--all", "--last-sort", String(nextLastSort)],
    ),
    books,
  };
}

export async function fetchNotebooks(
  caller: GatewayCaller,
  limit: number,
  all: boolean,
  initialLastSort?: number,
): Promise<UnknownRecord> {
  const books: unknown[] = [];
  const seenBookIds = new Set<string>();
  let lastSort = initialLastSort;
  let page: UnknownRecord = {};
  let totalBookCount: unknown;
  let totalNoteCount: unknown;
  let syncKey: unknown;
  let noBookReviewCount: unknown;
  const seenCursors = new Set<number>();
  const maximum = all ? Number.POSITIVE_INFINITY : limit;

  do {
    const remaining = Number.isFinite(maximum) ? Math.max(1, maximum - books.length) : 100;
    const params: JsonObject = { count: Math.min(remaining, 100) };
    if (lastSort !== undefined) params.lastSort = lastSort;
    page = asRecord(await caller.call("/user/notebooks", params));
    totalBookCount = page.totalBookCount ?? totalBookCount;
    totalNoteCount = page.totalNoteCount ?? totalNoteCount;
    syncKey = page.synckey ?? syncKey;
    noBookReviewCount = page.noBookReviewCount ?? noBookReviewCount;
    const pageBooks = asArray(page.books);
    for (const value of pageBooks) {
      const item = asRecord(value);
      const bookId = text(asRecord(item.book).bookId) || text(item.bookId);
      if (bookId && seenBookIds.has(bookId)) continue;
      if (bookId) seenBookIds.add(bookId);
      books.push(value);
    }
    const last = asRecord(pageBooks.at(-1));
    const nextSort = number(last.sort);
    const expectedTotal = initialLastSort === undefined ? number(totalBookCount) : undefined;
    const needsMore = flag(page.hasMore)
      || (expectedTotal !== undefined && seenBookIds.size < expectedTotal);
    if (books.length >= maximum
      || !needsMore
      || pageBooks.length === 0
      || nextSort === undefined
      || seenCursors.has(nextSort)) break;
    seenCursors.add(nextSort);
    lastSort = nextSort;
  } while (true);

  const returnedBooks = books.slice(0, maximum);
  const expectedTotal = initialLastSort === undefined ? number(totalBookCount) : undefined;
  const returnedBookIds = new Set(returnedBooks
    .map((value) => {
      const item = asRecord(value);
      return text(asRecord(item.book).bookId) || text(item.bookId);
    })
    .filter(Boolean));
  const hasMore = flag(page.hasMore)
    || books.length > returnedBooks.length
    || (expectedTotal !== undefined && returnedBookIds.size < expectedTotal);
  const nextLastSort = number(asRecord(returnedBooks.at(-1)).sort);
  return {
    totalBookCount,
    totalNoteCount,
    synckey: syncKey,
    noBookReviewCount,
    hasMore: hasMore ? 1 : 0,
    ...(hasMore && nextLastSort !== undefined
      ? { nextLastSort }
      : {}),
    books: returnedBooks,
  };
}

export interface CorpusNotebookPageResult {
  result: UnknownRecord;
  emittedBefore: number;
  emitted: number;
  totalBookCount: number;
  indexExhausted: boolean;
  indexChanged: boolean;
  nextCursorState?: CorpusCursorState;
}

export async function fetchCorpusNotebookPage(
  caller: GatewayCaller,
  limit: number,
  cursor?: CorpusCursorState,
): Promise<CorpusNotebookPageResult> {
  const target = limit + 1;
  const books: unknown[] = [];
  const seenBookIds = new Set<string>();
  const seenCursors = new Set<number>();
  if (cursor) seenCursors.add(cursor.lastSort);

  const emittedBefore = cursor?.emitted ?? 0;
  let requestLastSort = cursor?.lastSort;
  let knownTotal = cursor?.totalBookCount;
  let totalNoteCount: unknown;
  let syncKey: unknown;
  let noBookReviewCount: unknown;
  let page: UnknownRecord = {};
  let indexChanged = false;
  let exhaustedLoop = true;

  for (let pageNumber = 0; pageNumber < 100 && books.length < target; pageNumber += 1) {
    const params: JsonObject = { count: target - books.length };
    if (requestLastSort !== undefined) params.lastSort = requestLastSort;
    page = asRecord(await caller.call("/user/notebooks", params));

    const reportedTotal = number(page.totalBookCount);
    if (knownTotal === undefined && reportedTotal !== undefined) knownTotal = reportedTotal;
    else if (reportedTotal !== undefined && knownTotal !== reportedTotal) indexChanged = true;
    totalNoteCount = page.totalNoteCount ?? totalNoteCount;
    syncKey = page.synckey ?? syncKey;
    noBookReviewCount = page.noBookReviewCount ?? noBookReviewCount;

    const pageBooks = asArray(page.books);
    for (const value of pageBooks) {
      const item = asRecord(value);
      const bookId = notebookBookId(item);
      const sort = number(item.sort);
      if (cursor && bookId === cursor.lastBookId && sort === cursor.lastSort) continue;
      if (!bookId) {
        throw new CliError("INCOMPLETE_RESULT", "A notebook in the corpus page had no usable book ID.");
      }
      if (seenBookIds.has(bookId)) continue;
      seenBookIds.add(bookId);
      books.push(value);
      if (books.length >= target) break;
    }

    if (books.length >= target) {
      exhaustedLoop = false;
      break;
    }

    const totalSuggestsMore = knownTotal !== undefined
      && emittedBefore + books.length < knownTotal;
    if (!flag(page.hasMore) && !totalSuggestsMore) {
      exhaustedLoop = false;
      break;
    }
    if (!pageBooks.length) {
      throw new CliError("INCOMPLETE_RESULT", "Notebook pagination ended before the corpus page could advance.");
    }
    const nextSort = number(asRecord(pageBooks.at(-1)).sort);
    if (!nonNegativeSafeInteger(nextSort) || seenCursors.has(nextSort)) {
      throw new CliError("INCOMPLETE_RESULT", "Notebook pagination did not provide an advancing corpus cursor.");
    }
    seenCursors.add(nextSort);
    requestLastSort = nextSort;
  }

  if (exhaustedLoop && books.length < target) {
    throw new CliError("INCOMPLETE_RESULT", "Notebook pagination exceeded the corpus page safety bound.");
  }

  const selected = books.slice(0, limit);
  const emitted = emittedBefore + selected.length;
  const hasMore = books.length > selected.length
    || flag(page.hasMore)
    || (knownTotal !== undefined && emitted < knownTotal);
  const totalBookCount = Math.max(knownTotal ?? 0, emitted + (hasMore ? 1 : 0));
  let nextCursorState: CorpusCursorState | undefined;
  if (hasMore) {
    const boundary = asRecord(selected.at(-1));
    const lastBookId = notebookBookId(boundary);
    const lastSort = number(boundary.sort);
    if (!lastBookId || !nonNegativeSafeInteger(lastSort) || !selected.length) {
      throw new CliError("INCOMPLETE_RESULT", "The corpus page ended without a usable whole-book continuation boundary.");
    }
    if (cursor && lastBookId === cursor.lastBookId && lastSort === cursor.lastSort) {
      throw new CliError("INCOMPLETE_RESULT", "The corpus page did not advance beyond its input cursor.");
    }
    nextCursorState = { lastSort, lastBookId, emitted, totalBookCount };
  }

  return {
    result: {
      totalBookCount,
      totalNoteCount,
      synckey: syncKey,
      noBookReviewCount,
      hasMore: hasMore ? 1 : 0,
      books: selected,
    },
    emittedBefore,
    emitted,
    totalBookCount,
    indexExhausted: !hasMore,
    indexChanged,
    ...(nextCursorState ? { nextCursorState } : {}),
  };
}

export interface MineReviewsResult extends UnknownRecord {
  reviews: unknown[];
  reviewsExhausted: boolean;
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

  const reviewsExhausted = totalCount === undefined ? !flag(page.hasMore) : reviews.length >= totalCount;
  return {
    ...page,
    reviews: totalCount === undefined ? reviews : reviews.slice(0, totalCount),
    reviewsExhausted,
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
      createdDate: timestampShanghaiDate(mark.createTime),
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
      createdDate: timestampShanghaiDate(review.createTime),
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
    reviewsExhausted: mine.reviewsExhausted !== false,
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

export function projectReviews(
  result: unknown,
  bookId: string,
  type: string,
  limit: number,
  operation: "list" | "batch" = "list",
) {
  const record = asRecord(result);
  const candidates = asArray(record.reviews);
  const selected = candidates.slice(0, limit);
  const items = selected.map((value) => {
    const outer = asRecord(value);
    const first = asRecord(outer.review);
    const review = Object.keys(asRecord(first.review)).length ? asRecord(first.review) : first;
    const author = asRecord(review.author);
    const content = cleanText(text(review.content) || text(review.htmlContent));
    const rawRating = number(review.star);
    const rating = rawRating !== undefined && rawRating >= 0
      ? rawRating > 5 ? rawRating / 20 : rawRating
      : undefined;
    return {
      reviewId: String(review.reviewId ?? first.reviewId ?? outer.reviewId ?? ""),
      author: text(author.name),
      content,
      ...(rating !== undefined ? { rating, ratingScale: 5 as const } : {}),
      createdAt: timestampIso(review.createTime),
      likeCount: number(review.likeCount) ?? 0,
    };
  });
  const nextMaxIdx = number(asRecord(selected.at(-1)).idx);
  const syncKey = number(record.synckey);
  const hasMore = flag(record.reviewsHasMore ?? record.hasMore) || candidates.length > selected.length;
  return {
    bookId,
    type,
    returned: items.length,
    totalCount: number(record.reviewsCnt),
    page: pagination(
      hasMore,
      nextMaxIdx === undefined || syncKey === undefined
        ? undefined
        : {
            "--max-idx": nextMaxIdx,
            "--synckey": syncKey,
          },
      nextMaxIdx === undefined || syncKey === undefined
        ? undefined
        : [
            "--json",
            "reviews",
            operation,
            ...(operation === "list" ? [bookId] : ["--book-id", bookId]),
            "--type",
            type,
            "--limit",
            String(limit),
            "--max-idx",
            String(nextMaxIdx),
            "--synckey",
            String(syncKey),
          ],
    ),
    reviews: items,
  };
}

export function projectRecommendations(result: unknown, limit: number) {
  const record = asRecord(result);
  const selected = asArray(record.books).slice(0, limit);
  const books = selected.map((value) => {
    const item = asRecord(value);
    return {
      ...compactBook(item),
      ...(text(item.reason) ? { reason: cleanText(item.reason) } : {}),
    };
  });
  return {
    returned: books.length,
    books,
  };
}

export function projectSimilar(result: unknown, bookId: string, limit: number) {
  const resultRecord = asRecord(result);
  const similar = asRecord(resultRecord.booksimilar);
  const candidates = asArray(similar.books);
  const selected = candidates.slice(0, limit);
  const books = selected.map((value) => {
    const item = asRecord(value);
    const book = asRecord(item.book);
    return compactBook(Object.keys(book).length ? book : item);
  });
  const nextMaxIdx = number(asRecord(selected.at(-1)).idx);
  const sessionId = text(similar.sessionId);
  const hasMore = flag(similar.booksHasMore ?? similar.hasMore) || candidates.length > selected.length;
  return {
    returned: books.length,
    page: pagination(
      hasMore,
      nextMaxIdx === undefined || !sessionId
        ? undefined
        : {
            "--max-idx": nextMaxIdx,
            "--session-id": sessionId,
          },
      nextMaxIdx === undefined || !sessionId
        ? undefined
        : [
            "--json",
            "discover",
            "similar",
            bookId,
            "--limit",
            String(limit),
            "--max-idx",
            String(nextMaxIdx),
            "--session-id",
            sessionId,
          ],
    ),
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
  const zeroPriceCount = chapterData.chapters.filter((chapter) => chapter.price === 0).length;
  const pricedCount = chapterData.chapters.filter((chapter) => chapter.price !== null && chapter.price > 0).length;
  const purchasedCount = chapterData.chapters.filter((chapter) => chapter.paid === true).length;
  const unknownPriceCount = chapterData.chapters.filter((chapter) => chapter.price === null).length;
  return {
    book: info,
    accessFacts: {
      soldOut: info.soldOut ?? null,
      returnedChapterCount: chapterData.count,
      zeroPriceChapterCount: zeroPriceCount,
      pricedChapterCount: pricedCount,
      purchasedChapterCount: purchasedCount,
      unknownPriceChapterCount: unknownPriceCount,
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

export function timestampShanghaiDate(value: unknown): string | null {
  const timestamp = number(value);
  if (timestamp === undefined || timestamp <= 0) return null;
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(milliseconds));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function pagination(
  hasMore: boolean,
  nextArgs?: Record<string, string | number | boolean>,
  nextArgv?: string[],
) {
  if (hasMore && (!nextArgs || !nextArgv)) {
    throw new CliError(
      "INCOMPLETE_RESULT",
      "The gateway reported another page without an executable continuation.",
    );
  }
  return {
    hasMore,
    nextArgs: hasMore && nextArgs ? nextArgs : null,
    nextArgv: hasMore && nextArgv ? nextArgv : null,
  };
}

function notebookBookId(item: UnknownRecord): string {
  return text(asRecord(item.book).bookId) || text(item.bookId);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function cleanText(value: unknown): string {
  return text(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function identifiers(value: unknown): string[] {
  return asArray(value).flatMap((entry) => (
    typeof entry === "string" || typeof entry === "number" ? [String(entry)] : []
  ));
}

function flag(value: unknown): boolean {
  return value === true || value === 1;
}
