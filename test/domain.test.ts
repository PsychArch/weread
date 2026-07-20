import { describe, expect, it, vi } from "vitest";
import {
  fetchCorpusNotebookPage,
  fetchMineReviews,
  fetchNotebooks,
  inspectBook,
  limitShelfRaw,
  projectChapters,
  projectNotebooks,
  projectNotes,
  projectProgress,
  projectRecommendations,
  projectReviews,
  projectSearch,
  projectShelfEntries,
  projectSimilar,
  type GatewayCaller,
} from "../src/domain.js";

describe("bounded domain projections", () => {
  it("normalizes live book ratings and preserves returned deep links", () => {
    const projected = projectSearch({
      hasMore: 1,
      sid: "search-session",
      results: [{
        books: [{
          searchIdx: 7,
          bookInfo: {
            bookId: "922224",
            title: "基因传",
            author: "悉达多·穆克吉",
            newRating: 830,
            deepLink: "https://weread.qq.com/book-detail?v=example",
          },
        }],
      }],
    }, { keyword: "基因传", scope: "book", limit: 1 });

    expect(projected).toMatchObject({
      page: {
        hasMore: true,
        nextArgs: { "--max-idx": 7, "--session-id": "search-session" },
        nextArgv: [
          "--json",
          "search",
          "基因传",
          "--scope",
          "book",
          "--limit",
          "1",
          "--max-idx",
          "7",
          "--session-id",
          "search-session",
        ],
      },
      books: [{ rating: 8.3, ratingScale: 10, deepLink: "https://weread.qq.com/book-detail?v=example" }],
    });
  });

  it("fails closed when another page is reported without a usable cursor", () => {
    expect(() => projectSearch({
      hasMore: 1,
      results: [{ books: [{ searchIdx: 7, bookInfo: { bookId: "1", title: "One" } }] }],
    }, { keyword: "One", scope: "book", limit: 1 })).toThrowError(/without an executable continuation/);
  });

  it("keeps absent chapter and progress facts nullable without collapsing time fields", () => {
    expect(projectChapters({ chapters: [{ chapterUid: 1, title: "One" }] }, "1").chapters[0]).toMatchObject({
      price: null,
      paid: null,
      index: null,
      wordCount: null,
    });
    expect(projectChapters({ chapters: [{ chapterUid: 2, price: -1 }] }, "1").chapters[0]?.price).toBeNull();
    expect(projectProgress({
      bookId: "1",
      book: { progress: 42, readingTime: 86743, recordReadingTime: 120, ttsTime: 30 },
    }, "1")).toMatchObject({
      percent: 42,
      readingSeconds: 86743,
      recordReadingSeconds: 120,
      listeningSeconds: 30,
    });
    expect(projectProgress({ bookId: "2" }, "2")).toMatchObject({
      percent: null,
      readingSeconds: null,
      recordReadingSeconds: null,
      listeningSeconds: null,
    });
  });

  it("returns chapter access facts without classifying overall readability", () => {
    const base = {
      bookId: "1",
      info: { bookId: "1", title: "Book", soldout: 0 },
      progress: { bookId: "1" },
      shelf: { books: [] },
      notebooks: { books: [] },
    };

    const inspection = inspectBook({
      ...base,
      chapters: { chapters: [{ price: 0 }, { price: 10, paid: 1 }, {}] },
    });

    expect(inspection.accessFacts).toEqual({
      soldOut: false,
      returnedChapterCount: 3,
      zeroPriceChapterCount: 1,
      pricedChapterCount: 1,
      purchasedChapterCount: 1,
      unknownPriceChapterCount: 1,
    });
    expect(inspection).not.toHaveProperty("availability");
  });

  it("applies shelf limits to raw-compatible JSON and compact agent output", () => {
    const raw = {
      books: [
        { bookId: "1", title: "One", intro: "large" },
        { bookId: "2", title: "Two", intro: "large" },
      ],
      albums: [{ albumInfo: { albumId: "3", name: "Three" } }],
      mp: { count: 4 },
    };

    expect(limitShelfRaw(raw, 1)).toMatchObject({ books: [{ bookId: "1" }], albums: [] });
    const compact = projectShelfEntries(raw, 1);
    expect(compact).toMatchObject({
      returned: 1,
      total: 4,
      page: {
        hasMore: true,
        nextArgs: { "--all": true },
        nextArgv: ["--json", "shelf", "list", "--all"],
      },
    });
    expect(compact.entries).toEqual([expect.objectContaining({ bookId: "1", title: "One" })]);
  });

  it("preserves shelf state, distinct timestamps, and archives as neutral facts", () => {
    const compact = projectShelfEntries({
      books: [{
        bookId: "1",
        title: "One",
        finishReading: 1,
        secret: 1,
        readUpdateTime: 1_780_243_200,
        updateTime: 1_780_329_600,
      }],
      archive: [{ name: "Archive", bookIds: ["1"], albumIds: [2] }],
    }, 20);

    expect(compact.entries[0]).toMatchObject({
      finished: true,
      private: true,
      lastReadAt: "2026-05-31T16:00:00.000Z",
      upstreamUpdatedAt: "2026-06-01T16:00:00.000Z",
    });
    expect(compact.archives).toEqual([{ name: "Archive", bookIds: ["1"], albumIds: ["2"] }]);
  });

  it("requests enough personal reviews and recovers despite a false hasMore", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({
        totalCount: 22,
        reviews: Array.from({ length: 20 }, (_, index) => ({ review: { reviewId: String(index) } })),
        hasMore: 0,
        synckey: 99,
      })
      .mockResolvedValueOnce({
        totalCount: 22,
        reviews: Array.from({ length: 2 }, (_, index) => ({ review: { reviewId: String(index + 20) } })),
        hasMore: 0,
        synckey: 100,
      });
    const caller = { call } as unknown as GatewayCaller;

    const result = await fetchMineReviews(caller, "922224");

    expect(call).toHaveBeenNthCalledWith(1, "/review/list/mine", { bookid: "922224", count: 100, synckey: 0 });
    expect(result.reviews).toHaveLength(22);
    expect(result.reviewsExhausted).toBe(true);
  });

  it("fetches every notebook page when all is true even if the display limit is 20", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({
        totalBookCount: 3,
        totalNoteCount: 6,
        hasMore: 1,
        books: [{ bookId: "1", sort: 30 }, { bookId: "2", sort: 20 }],
      })
      .mockResolvedValueOnce({
        totalBookCount: 3,
        totalNoteCount: 6,
        hasMore: 0,
        books: [{ bookId: "3", sort: 10 }],
      });
    const caller = { call } as unknown as GatewayCaller;

    const result = await fetchNotebooks(caller, 20, true);

    expect(call).toHaveBeenNthCalledWith(1, "/user/notebooks", { count: 100 });
    expect(call).toHaveBeenNthCalledWith(2, "/user/notebooks", { count: 100, lastSort: 20 });
    expect(result).toMatchObject({ totalBookCount: 3, hasMore: 0 });
    expect(result.books).toHaveLength(3);
  });

  it("uses totalBookCount when hasMore ends before complete notebook coverage", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({
        totalBookCount: 3,
        hasMore: 0,
        books: [{ bookId: "1", sort: 30 }, { bookId: "2", sort: 20 }],
      })
      .mockResolvedValueOnce({
        totalBookCount: 3,
        hasMore: 0,
        books: [{ bookId: "3", sort: 10 }],
      });
    const caller = { call } as unknown as GatewayCaller;

    const result = await fetchNotebooks(caller, 20, true);

    expect(call).toHaveBeenNthCalledWith(2, "/user/notebooks", { count: 100, lastSort: 20 });
    expect(result).toMatchObject({ totalBookCount: 3, hasMore: 0 });
    expect(result.books).toHaveLength(3);
  });

  it("keeps all-notebook coverage incomplete when the total cannot be reached", async () => {
    const page = {
      totalBookCount: 3,
      hasMore: 0,
      books: [{ bookId: "1", sort: 30 }, { bookId: "2", sort: 20 }],
    };
    const call = vi.fn().mockResolvedValue(page);
    const caller = { call } as unknown as GatewayCaller;

    const result = await fetchNotebooks(caller, 20, true);

    expect(call).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ totalBookCount: 3, hasMore: 1 });
    expect(result.books).toHaveLength(2);
  });

  it("does not count notebooks without a usable unique book ID as complete coverage", async () => {
    const page = {
      totalBookCount: 2,
      hasMore: 0,
      books: [{ bookId: "1", sort: 30 }, { sort: 20 }],
    };
    const call = vi.fn().mockResolvedValue(page);
    const caller = { call } as unknown as GatewayCaller;

    const result = await fetchNotebooks(caller, 20, true);

    expect(call).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ totalBookCount: 2, hasMore: 1 });
  });

  it("marks a bounded notebook list incomplete when more pages remain", async () => {
    const call = vi.fn().mockResolvedValue({
      totalBookCount: 30,
      hasMore: 1,
      books: Array.from({ length: 20 }, (_, index) => ({ bookId: String(index), sort: 100 - index })),
    });
    const caller = { call } as unknown as GatewayCaller;

    const result = await fetchNotebooks(caller, 20, false);

    expect(call).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ totalBookCount: 30, hasMore: 1 });
    expect(result.books).toHaveLength(20);
  });

  it("starts notebook continuation from the supplied lastSort cursor", async () => {
    const call = vi.fn().mockResolvedValue({
      totalBookCount: 1,
      hasMore: 0,
      books: [{ bookId: "1", sort: 40 }],
    });
    const caller = { call } as unknown as GatewayCaller;

    await fetchNotebooks(caller, 20, false, 50);

    expect(call).toHaveBeenCalledWith("/user/notebooks", { count: 20, lastSort: 50 });
  });

  it("pages a corpus at whole-book boundaries despite a false upstream hasMore", async () => {
    const entries = [
      { sort: 30, book: { bookId: "1" } },
      { sort: 20, book: { bookId: "2" } },
      { sort: 10, book: { bookId: "3" } },
    ];
    const call = vi.fn(async (_apiName: string, params?: Record<string, unknown>) => {
      const lastSort = params?.lastSort;
      const cursorIndex = lastSort === undefined
        ? -1
        : entries.findIndex((entry) => entry.sort === lastSort);
      const count = Number(params?.count ?? entries.length);
      return {
        totalBookCount: entries.length,
        hasMore: 0,
        books: entries.slice(cursorIndex + 1, cursorIndex + 1 + count),
      };
    });
    const caller = { call } as unknown as GatewayCaller;

    const first = await fetchCorpusNotebookPage(caller, 1);
    const second = await fetchCorpusNotebookPage(caller, 1, first.nextCursorState);
    const third = await fetchCorpusNotebookPage(caller, 1, second.nextCursorState);

    expect(first.result.books).toEqual([entries[0]]);
    expect(first.nextCursorState).toEqual({ lastSort: 30, lastBookId: "1", emitted: 1, totalBookCount: 3 });
    expect(second.result.books).toEqual([entries[1]]);
    expect(second.nextCursorState).toEqual({ lastSort: 20, lastBookId: "2", emitted: 2, totalBookCount: 3 });
    expect(third.result.books).toEqual([entries[2]]);
    expect(third).toMatchObject({ emitted: 3, totalBookCount: 3, indexExhausted: true });
    expect(third.nextCursorState).toBeUndefined();
    expect(call).toHaveBeenNthCalledWith(1, "/user/notebooks", { count: 2 });
    expect(call).toHaveBeenNthCalledWith(2, "/user/notebooks", { count: 2, lastSort: 30 });
    expect(call).toHaveBeenNthCalledWith(3, "/user/notebooks", { count: 2, lastSort: 20 });
  });

  it("fills corpus lookahead from another upstream page and rejects a stalled cursor", async () => {
    const fillCall = vi.fn()
      .mockResolvedValueOnce({ totalBookCount: 3, hasMore: 0, books: [{ sort: 30, book: { bookId: "1" } }] })
      .mockResolvedValueOnce({ totalBookCount: 3, hasMore: 0, books: [{ sort: 20, book: { bookId: "2" } }] });
    const filled = await fetchCorpusNotebookPage({ call: fillCall } as unknown as GatewayCaller, 1);
    expect(filled.result.books).toEqual([{ sort: 30, book: { bookId: "1" } }]);
    expect(filled.nextCursorState?.lastSort).toBe(30);
    expect(fillCall).toHaveBeenNthCalledWith(2, "/user/notebooks", { count: 1, lastSort: 30 });

    const stalledCall = vi.fn().mockResolvedValue({
      totalBookCount: 2,
      hasMore: 0,
      books: [{ sort: 30, book: { bookId: "1" } }],
    });
    await expect(fetchCorpusNotebookPage(
      { call: stalledCall } as unknown as GatewayCaller,
      1,
      { lastSort: 30, lastBookId: "1", emitted: 1, totalBookCount: 2 },
    )).rejects.toThrow(/advancing corpus cursor/);
  });

  it("handles an empty corpus index and rejects notebooks without IDs", async () => {
    const empty = await fetchCorpusNotebookPage({
      call: vi.fn().mockResolvedValue({ totalBookCount: 0, hasMore: 0, books: [] }),
    } as unknown as GatewayCaller, 10);
    expect(empty).toMatchObject({ emitted: 0, totalBookCount: 0, indexExhausted: true });
    expect(empty.result.books).toEqual([]);

    await expect(fetchCorpusNotebookPage({
      call: vi.fn().mockResolvedValue({ totalBookCount: 1, hasMore: 0, books: [{ sort: 1, book: {} }] }),
    } as unknown as GatewayCaller, 10)).rejects.toThrow(/no usable book ID/);
  });

  it("removes bulky bookmark and review metadata from a notes corpus", () => {
    const compact = projectNotes({
      bookId: "922224",
      bookmarks: {
        book: { bookId: "922224", title: "基因传", author: "作者", intro: "long intro", cover: "cover.jpg" },
        chapters: [{ chapterUid: 7, title: "遗传" }],
        updated: [{ chapterUid: 7, markText: "一条划线", range: "1-2", createTime: 1_780_243_200 }],
      },
      reviews: {
        reviewsExhausted: true,
        reviews: [{ review: { reviewId: "r1", chapterUid: 7, chapterName: "遗传", content: "我的想法", createTime: 1_780_243_200, unrelated: "large" } }],
      },
    });

    expect(compact.counts).toEqual({
      highlights: 1,
      thoughts: 1,
      thoughtsWithText: 1,
      contextOnlyThoughts: 0,
      ratingOnlyThoughts: 0,
      emptyThoughts: 0,
      total: 2,
    });
    expect(compact.reviewsExhausted).toBe(true);
    expect(JSON.stringify(compact)).not.toContain("cover.jpg");
    expect(JSON.stringify(compact)).not.toContain("unrelated");

    const unexhausted = projectNotes({
      bookId: "922224",
      bookmarks: { book: { bookId: "922224" }, updated: [] },
      reviews: { reviewsExhausted: false, reviews: [] },
    });
    expect(unexhausted.reviewsExhausted).toBe(false);
  });

  it("preserves notebook categories and keeps sort separate from update time", () => {
    const compact = projectNotebooks({
      totalBookCount: 1,
      totalNoteCount: 3,
      hasMore: 0,
      books: [{
        sort: 1_780_243_200,
        noteCount: 1,
        reviewCount: 1,
        bookmarkCount: 1,
        book: {
          bookId: "1",
          title: "Book",
          categories: [{ title: "文学-散文杂著" }],
        },
      }],
    });

    expect(compact.books[0]).toMatchObject({
      book: { category: "文学-散文杂著", categories: ["文学-散文杂著"] },
      sort: 1_780_243_200,
      updatedAt: null,
    });
  });

  it("separates personal words from quoted context and classifies non-text entries", () => {
    const compact = projectNotes({
      bookId: "1",
      bookmarks: { book: { bookId: "1", title: "Book" }, updated: [] },
      reviews: {
        reviewsExhausted: true,
        reviews: [
          { review: { reviewId: "a", content: "我的判断", abstract: "原文", type: 1 } },
          { review: { reviewId: "b", content: "", abstract: "仅摘录", type: 1 } },
          { review: { reviewId: "c", content: "", star: 100, type: 4 } },
          { review: { reviewId: "d", content: "", type: 4 } },
        ],
      },
    });

    expect(compact.counts).toMatchObject({
      thoughts: 4,
      thoughtsWithText: 1,
      contextOnlyThoughts: 1,
      ratingOnlyThoughts: 1,
      emptyThoughts: 1,
    });
    expect(compact.reviewsExhausted).toBe(true);
    expect(compact.thoughts).toEqual([
      expect.objectContaining({ entryKind: "comment-on-text", content: "我的判断", quotedText: "原文" }),
      expect.objectContaining({ entryKind: "excerpt-only", content: "", quotedText: "仅摘录" }),
      expect.objectContaining({ entryKind: "rating-only", rating: 5, ratingScale: 5 }),
      expect.objectContaining({ entryKind: "empty", content: "" }),
    ]);
  });

  it("preserves public review text and exposes executable continuation arguments", () => {
    const compact = projectReviews({
      reviewsHasMore: 1,
      reviewsCnt: 20,
      synckey: 11,
      reviews: [{ idx: 4, review: { reviewId: "r1", review: { content: "abcdefgh", star: 100 } } }],
    }, "1", "latest", 1);

    expect(compact).toMatchObject({
      totalCount: 20,
      page: {
        hasMore: true,
        nextArgs: { "--max-idx": 4, "--synckey": 11 },
        nextArgv: [
          "--json",
          "reviews",
          "list",
          "1",
          "--type",
          "latest",
          "--limit",
          "1",
          "--max-idx",
          "4",
          "--synckey",
          "11",
        ],
      },
    });
    expect(compact.reviews[0]).toMatchObject({
      reviewId: "r1",
      content: "abcdefgh",
      rating: 5,
      ratingScale: 5,
    });
  });

  it("preserves live similar-book pagination metadata", () => {
    const compact = projectSimilar({
      booksimilar: {
        sessionId: "similar-session",
        booksHasMore: 1,
        books: [{ idx: 9, book: { bookInfo: { bookId: "2", title: "Two" } } }],
      },
    }, "1", 1);

    expect(compact).toMatchObject({
      page: {
        hasMore: true,
        nextArgs: { "--max-idx": 9, "--session-id": "similar-session" },
        nextArgv: [
          "--json",
          "discover",
          "similar",
          "1",
          "--limit",
          "1",
          "--max-idx",
          "9",
          "--session-id",
          "similar-session",
        ],
      },
      books: [{ bookId: "2", title: "Two" }],
    });
  });

  it("does not invent pagination for personalized recommendations", () => {
    const compact = projectRecommendations({ books: [{ bookId: "1", title: "One" }] }, 1);

    expect(compact).toEqual({ returned: 1, books: [{ bookId: "1", title: "One", author: "" }] });
    expect(compact).not.toHaveProperty("page");
  });
});
