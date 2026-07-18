# Recommendations and availability

Choose the narrow path that matches the request.

Known operation IDs are `notes.sample`, `notes.corpus`, `stats.trend`,
`search`, `discover.recommend`, `discover.similar`, `book.resolve-batch`, and
`book.inspect-batch`. Do not fetch the full capabilities catalog for them; use
an operation-scoped contract only when an invocation detail is unknown.
`notes.sample` and `stats.trend` take no task flags, so go straight to their
data schemas. The batch forms used below are complete:

```bash
weread --agent notes corpus --view thoughts --book-id <id>   # repeat to 50
weread --agent book resolve-batch --name <title>              # repeat to 20
weread --agent book inspect-batch --book-id <id>              # repeat to 20
```

## Availability-only

If the user supplies titles or only asks whether books are readable, do not
fetch history, the full shelf, or a notes corpus. Resolve all names in one
`book.resolve-batch`, collect at most 20 unique IDs, and run one final
`book.inspect-batch`.

## General recommendations

Use search, `discover recommend`, or `discover similar` only to generate a
bounded candidate set. Personalized discovery can reinforce dominant
categories, so do not present its ranking as analysis. Deduplicate at most 20
exact candidate IDs, then run one final `book.inspect-batch`.

## Knowledge-gap recommendations

WeRead history and notes establish observed coverage, not what the reader knows
or can do. Even when asked for a "knowledge gap", default to a scoped coverage
gap or candidate supplement direction. Direct personal wording may justify
priority; sparse mentions cannot diagnose competence or a personal deficit.
Keep zero-match adjacent topics visibly weaker than supported directions.

- Start with one deterministic `notes.sample` response.
- Read the bounded notes workflow when viewpoint-level evidence is necessary.
- Add `stats trend` only if time or category evolution could materially change
  the recommendation.
- Do not make full history, full shelf, and a corpus mandatory for every gap
  question.

Use the same narrow `notes.sample` projection from `notes.md`; never print
`.data.selected` or `.data.selected[]`. If `stats trend` is needed, keep its
first projection to the current annual and overall evidence only. Run the
sample and trend projections as separate tool calls so their combined stdout
cannot cross the per-call context bound:

```bash
jq -c '
  (.data.periods[] | select(.mode == "annually")) as $current |
  (.data.periods[] | select(.mode == "overall")) as $overall |
  {
    warnings,
    historyRange: .data.historyRange,
    currentAnnual: ($current | {
      totalReadTime, readDays, preferCategoryWord, counts,
      categories: .categories[:8], topBooks: .topBooks[:5], dataQuality
    }),
    overall: ($overall | {
      totalReadTime, preferCategoryWord,
      categories: .categories[:8], topBooks: .topBooks[:5], dataQuality
    })
  }' trend.json
```

Do not print weekly or monthly periods, full ranked lists, or the full sample
manifest merely to decide whether a corpus is needed.
Category `count` and `readTime` are different metrics. Name the metric used for
every category ranking, and do not collapse them into phrases such as
"阅读量和时长居首" unless the projected values independently prove both claims.

After identifying the gaps, draft 8–12 candidate names locally and resolve all
of them in one `book.resolve-batch`. Do not issue per-title search commands.
Prefer `match=exact-title`; omit an ambiguous `first-search-result` unless its
returned title and author clearly identify the intended book. If discovery has
already supplied exact IDs, skip resolution.

Describe an absence as "not found in indexed titles/categories or sampled
notes" unless the full relevant corpus was classified. Do not seed the current
candidate list from an old recommendation answer.

Regexes only retrieve candidates: read each excerpt, discard false positives,
and never turn hit counts or labels into recommendation axes. Without verified
personal wording, report only an indexed or sampled title/category absence.
Upgrade "candidate supplement direction" to a gap only when direct text shows
the adjacent need, corpus-wide review finds little coverage, and a
counterexample check does not overturn it. Two related notes do not prove a
gap. Reuse supported directions instead of inventing more. Use at most two
corpus projections: one counterexample view and one view of at most eight
personal excerpts.

For a recommendation axis to be described as a repeated or cross-book sample
pattern, require direct personal wording about the same proposition from at
least two different books. Multiple excerpts from one book support only a
single-book-triggered candidate extension. Do not infer that the reader was
"active", motivated, capable, or incapable from the wording of a note. Do not
describe sampled title/category coverage as stable or systematic coverage.

In a Chinese final answer, use the exact label "本次样本内的候选补充方向" for
the recommendation framing. Do not use "最值得补齐", "填补覆盖缺口", "你的缺口",
"你需要补上", or equivalent language that turns bounded evidence into a real
personal deficit. Keep single-book evidence explicitly labeled as a
"单书触发的候选延伸".

## Verify the final shortlist

- Prefer `book.inspect-batch` for several titles. Deduplicate first, inspect
  exactly one final batch, and state inspected versus recommended counts.
- `all-chapters` confirms every returned chapter as free or purchased;
  `some-chapters` is partial, `unconfirmed` has no confirmed readable chapter,
  and `unavailable` is sold out.
- `availability.readable=true` only means at least one chapter is confirmed
  readable.
- `progress.percent=null` means progress was not reported; do not rewrite it as
  zero.

After the final batch, use at most two local projections to filter and format
the shortlist, then answer with the gap each title fills, current access level,
existing shelf/progress/note state, and any uncertainty.

Live data proves availability and user state. Label unfetched book knowledge as
recommendation rationale. For a fetched `book.intro`, attribute only what it
states and separate inference: "简介说明……；因此本次推荐理由是……". Do not place
extra concepts such as evidence evaluation or suitability inside "简介说明".
