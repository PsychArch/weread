# Personal notes and viewpoint analysis

## Fetch once

1. Capture `weread --agent notes sample` once. It fetches the complete notebook
   index and returns one schema-backed, deterministic sample manifest.
2. Use its deduplicated `.data.bookIds` directly; do not reimplement sampling in
   ad-hoc `jq`, Node, or Python.
3. Capture one `weread --agent notes corpus --view thoughts ...` response for
   those IDs.

These two invocations and their limits are complete in this reference. Do not
run capabilities or `--help` for `notes.sample` or `notes.corpus`; go directly
to each data schema and then its one live call. Do not inspect CLI source to
reconstruct repeatable flags. Build the corpus argv directly from the sample:

```bash
book_args=()
while IFS= read -r book_id; do
  book_args+=(--book-id "$book_id")
done < <(jq -r '.data.bookIds[]' sample.json)
weread --agent notes corpus --view thoughts "${book_args[@]}" > corpus.json
```

Before fetching the corpus, bring only the sample manifest into model context:

```bash
jq -c '{
  meta,
  warnings,
  index: .data.index,
  selectionRule: .data.selectionRule,
  coverage: .data.coverage,
  bookIds: .data.bookIds
}' sample.json
```

Do not print `.data.selected` or iterate `.data.selected[]`. The corpus already
returns the selected books needed for local evidence aggregation; printing all
50 sample records adds no evidence needed at this stage.

After the corpus guard, bring only corpus-level coverage into context:

```bash
jq -c '{
  meta,
  warnings,
  contentScope: .data.contentScope,
  totals: .data.totals,
  coverage: {
    returnedBooks: (.data.books | length),
    completeBooks: ([.data.books[] | select(.complete)] | length),
    incompleteBookIds: [.data.books[] | select(.complete | not) | .bookId][:10]
  }
}' corpus.json
```

Do not print a 50-book metadata summary. Select titles and counts only inside
the later bounded evidence aggregation.

`notes.sample` uses all thought-bearing books when there are at most 50.
Otherwise the CLI alone applies 25 high-thought-count books, 15 recent notebook
updates, 10 books that maximize new-category coverage, stable tie-breakers, and
a deterministic fill. Report the returned `selectionRule`; do not paraphrase a
different algorithm.

Describe `updatedAt` accurately as notebook-update recency, not thought
creation-time coverage. If a dimension cannot be implemented from available
fields, do not claim it.

## Report coverage

For every named sampling dimension, report the selection rule and actual
counts. At minimum report:

- `coverage.selectedBooks` / `index.booksWithThoughts`;
- `coverage.selectedThoughtCount` / `index.totalThoughtCount`;
- `coverage.requestedIds` / `coverage.uniqueIds`;
- `coverage.selectedCategories` / `index.totalCategories` and
  `coverage.notebookUpdateYears`, if claimed.

This quantifies a bounded sample; it does not prove coverage of every belief.

## Attribute text correctly

- `thoughts[].content`: reader's own words.
- `highlights[].text`: source-book text.
- `quotedText` and `contextText`: source context.
- `excerpt-only`, `rating-only`, and `empty`: not personal claims.
- Bookmark positions count toward notebook totals but are not exportable in a
  corpus.
- In corpus totals, `source*` describes the fetched source corpus and
  `returned*` describes arrays actually serialized for the selected view.

Use local aggregation first, then bring one stratified set of at most eight
complete personal excerpts into model context. Select complete notes whose
content is at most 240 characters; include direct evidence and a genuine
counterexample across books rather than emitting separate example arrays for
every regex theme. Keep the whole projection below 8,000 UTF-8 bytes and do not
print the corpus.

Treat regex/keyword counts as retrieval signals, not validated theme
frequencies or cross-book evidence. Make "these sampled notes"—not "you"—the
subject of every synthesized pattern. Do not write unqualified claims such as
"you like", "you tend to", "you often", "your thinking habit", or "the most
stable trait". In a Chinese answer, include this boundary explicitly:
"以下结论只描述这批抽样笔记中的文本模式，不是对用户稳定人格、偏好或长期倾向的判断。"
Also avoid user-level Chinese formulations such as "你喜欢", "你偏好", "你往往",
"你常常", "你的思维习惯", and "最稳定的特征"; use "这批笔记呈现" or
"样本中出现" instead, including in headings. Do not put regex hit counts in
the final answer unless every hit was semantically reviewed. Call a pattern
"repeated" only when at least two verified personal excerpts from different
books support the same proposition; otherwise label it a single-note clue.
Prefer three or four well-supported sample patterns to a longer list of keyword
categories.
Do not run or print an unbounded n-gram, token-frequency, or keyword-frequency
table. A lexical retrieval projection may return at most eight candidate
personal excerpts, with title and content, for semantic review. It must not
print a vocabulary, every match, or bulk counts. Read every returned candidate
before using it; discard false positives and keep lexical counts out of the
answer unless every matching excerpt was reviewed.
Do not turn praise or criticism of an author's argument into the reader's own
preference, and do not add concepts absent from the cited personal text. A
counterexample must address the same proposition; call a nearby boundary or
different topic a qualification, not a counterexample. Call a viewpoint change
only when the same proposition has direct evidence in at least two years;
otherwise label it a time-sequence clue or hypothesis.

Only fetch `reviews batch` when public reception is part of the request. Public
reviews are never evidence of the user's own view.

If the user explicitly requests a full corpus, use `notes.notebooks --all` and
run sequential disjoint batches of at most 50 books, preserving successful
batches and backing off on rate limits. Otherwise stop after one `notes.sample`
and one corpus call. Scope negative claims to indexed titles/categories and
sampled notes.
