globalThis.fetch = async (_input, init) => {
  const request = JSON.parse(String(init?.body ?? "{}"));
  let payload;

  if (request.api_name === "/user/notebooks") {
    const notebookBooks = [
      {
        sort: 30,
        noteCount: 1,
        reviewCount: 1,
        bookmarkCount: 0,
        book: {
          bookId: "1234",
          title: "Fixture Book",
          author: "Fixture Author",
          category: "Fixture Category",
        },
      },
      {
        sort: 20,
        noteCount: 1,
        reviewCount: 1,
        bookmarkCount: 0,
        book: { bookId: "5678", title: "Second Fixture", author: "Second Author" },
      },
      {
        sort: 10,
        noteCount: 1,
        reviewCount: 1,
        bookmarkCount: 0,
        book: { bookId: "9012", title: "Third Fixture", author: "Third Author" },
      },
    ];
    const cursorIndex = request.lastSort === undefined
      ? -1
      : notebookBooks.findIndex((entry) => entry.sort === request.lastSort);
    const start = cursorIndex < 0 ? 0 : cursorIndex + 1;
    const count = Number(request.count ?? notebookBooks.length);
    payload = {
      totalBookCount: 3,
      totalNoteCount: 6,
      // Deliberately false: the CLI must also use totalBookCount and lookahead.
      hasMore: 0,
      books: notebookBooks.slice(start, start + count),
    };
  } else if (request.api_name === "/book/bookmarklist") {
    const bookId = String(request.bookId ?? "1234");
    payload = {
      book: { bookId },
      chapters: [{ chapterUid: 1, title: "Fixture Chapter" }],
      updated: [{
        chapterUid: 1,
        markText: "SOURCE_HIGHLIGHT_FIXTURE",
        createTime: 1_700_000_000,
      }],
    };
  } else if (request.api_name === "/review/list/mine") {
    payload = {
      totalCount: 1,
      hasMore: 0,
      synckey: 1,
      reviews: [{
        review: {
          reviewId: "fixture-review",
          chapterUid: 1,
          chapterName: "Fixture Chapter",
          content: "PERSONAL_THOUGHT_FIXTURE",
          createTime: 1_700_000_000,
        },
      }],
    };
  } else if (request.api_name === "/review/list") {
    const maxIdx = Number(request.maxIdx ?? 0);
    const nextIdx = maxIdx + 1;
    payload = {
      reviewsCnt: 2,
      reviewsHasMore: nextIdx < 2 ? 1 : 0,
      synckey: Number(request.synckey ?? 0) + 1,
      reviews: [{
        idx: nextIdx,
        review: {
          reviewId: `public-review-${nextIdx}`,
          content: `PUBLIC_REVIEW_FIXTURE_${nextIdx}`,
          author: { name: "Fixture Reviewer" },
        },
      }],
    };
  } else {
    payload = { errcode: 1, errmsg: `Unexpected fixture API: ${request.api_name}` };
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
