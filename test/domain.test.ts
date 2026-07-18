import { describe, expect, it, vi } from "vitest";
import {
  fetchMineReviews,
  fetchNotebooks,
  inspectBook,
  limitShelfRaw,
  projectChapters,
  projectNotebooks,
  projectNotes,
  projectProgress,
  projectReviews,
  projectSearch,
  projectShelfEntries,
  projectSimilar,
  sampleThoughtNotebooks,
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
    }, 1);

    expect(projected).toMatchObject({
      hasMore: true,
      nextMaxIdx: 7,
      sessionId: "search-session",
      books: [{ rating: 8.3, ratingScale: 10, deepLink: "https://weread.qq.com/book-detail?v=example" }],
    });
  });

  it("treats missing chapter prices as unknown and uses live readingTime", () => {
    expect(projectChapters({ chapters: [{ chapterUid: 1, title: "One" }] }, "1").chapters[0]?.price).toBe(-1);
    expect(projectProgress({
      bookId: "1",
      book: { progress: 42, readingTime: 86743, recordReadingTime: 0 },
    }, "1")).toMatchObject({ percent: 42, readingSeconds: 86743 });
    expect(projectProgress({ bookId: "2" }, "2")).toMatchObject({
      percent: null,
      readingSeconds: null,
    });
  });

  it("distinguishes partial chapter access from confirmed full-book access", () => {
    const base = {
      bookId: "1",
      info: { bookId: "1", title: "Book", soldout: 0 },
      progress: { bookId: "1" },
      shelf: { books: [] },
      notebooks: { books: [] },
    };

    expect(inspectBook({
      ...base,
      chapters: { chapters: [{ price: 0 }, { price: 10 }, {}] },
    }).availability).toMatchObject({
      available: true,
      readable: true,
      accessLevel: "some-chapters",
      confirmedReadableChapterCount: 1,
    });

    expect(inspectBook({
      ...base,
      chapters: { chapters: [{ price: 0 }, { price: 10, paid: 1 }] },
    }).availability).toMatchObject({
      accessLevel: "all-chapters",
      confirmedReadableChapterCount: 2,
    });
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
    expect(compact).toMatchObject({ returned: 1, total: 4, hasMore: true });
    expect(compact.entries).toEqual([expect.objectContaining({ bookId: "1", title: "One" })]);
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
    expect(result.complete).toBe(true);
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

  it("removes bulky bookmark and review metadata from a notes corpus", () => {
    const compact = projectNotes({
      bookId: "922224",
      bookmarks: {
        book: { bookId: "922224", title: "基因传", author: "作者", intro: "long intro", cover: "cover.jpg" },
        chapters: [{ chapterUid: 7, title: "遗传" }],
        updated: [{ chapterUid: 7, markText: "一条划线", range: "1-2", createTime: 1_780_243_200 }],
      },
      reviews: {
        complete: true,
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
    expect(JSON.stringify(compact)).not.toContain("cover.jpg");
    expect(JSON.stringify(compact)).not.toContain("unrelated");
  });

  it("preserves notebook categories and uses sort as the update timestamp", () => {
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
      updatedAt: "2026-05-31T16:00:00.000Z",
    });
  });

  it("builds a deterministic, deduplicated thought sample without agent-side jq", () => {
    const index = projectNotebooks({
      totalBookCount: 60,
      totalNoteCount: 1_830,
      hasMore: 0,
      books: Array.from({ length: 60 }, (_, itemIndex) => ({
        sort: 1_700_000_000 + itemIndex,
        reviewCount: 60 - itemIndex,
        book: {
          bookId: String(itemIndex).padStart(2, "0"),
          title: `Book ${itemIndex}`,
          author: "Author",
          categories: [{ title: `Category ${itemIndex}` }],
        },
      })),
    });

    const first = sampleThoughtNotebooks(index);
    const second = sampleThoughtNotebooks(index);

    expect(second).toEqual(first);
    expect(first.bookIds).toHaveLength(50);
    expect(new Set(first.bookIds).size).toBe(50);
    expect(first.selected.filter((entry) => entry.selectedBy === "high-thought-count")).toHaveLength(25);
    expect(first.selected.filter((entry) => entry.selectedBy === "recent-notebook-update")).toHaveLength(15);
    expect(first.selected.filter((entry) => entry.selectedBy === "new-category")).toHaveLength(10);
    expect(first.coverage).toMatchObject({ selectedBooks: 50, requestedIds: 50, uniqueIds: 50 });
  });

  it("separates personal words from quoted context and classifies non-text entries", () => {
    const compact = projectNotes({
      bookId: "1",
      bookmarks: { book: { bookId: "1", title: "Book" }, updated: [] },
      reviews: {
        complete: true,
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
    expect(compact.thoughts).toEqual([
      expect.objectContaining({ entryKind: "comment-on-text", content: "我的判断", quotedText: "原文" }),
      expect.objectContaining({ entryKind: "excerpt-only", content: "", quotedText: "仅摘录" }),
      expect.objectContaining({ entryKind: "rating-only", rating: 5, ratingScale: 5 }),
      expect.objectContaining({ entryKind: "empty", content: "" }),
    ]);
  });

  it("bounds public review text in compact projections", () => {
    const compact = projectReviews({
      reviewsHasMore: 1,
      reviewsCnt: 20,
      synckey: 11,
      reviews: [{ idx: 4, review: { reviewId: "r1", review: { content: "abcdefgh", star: 100 } } }],
    }, "1", "latest", 1, 5);

    expect(compact).toMatchObject({ hasMore: true, totalCount: 20, nextMaxIdx: 4, synckey: 11 });
    expect(compact.reviews[0]).toMatchObject({
      reviewId: "r1",
      content: "abcde",
      contentTruncated: true,
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
    }, 1);

    expect(compact).toMatchObject({
      hasMore: true,
      sessionId: "similar-session",
      nextMaxIdx: 9,
      books: [{ bookId: "2", title: "Two" }],
    });
  });
});
