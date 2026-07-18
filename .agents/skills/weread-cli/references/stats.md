# Reading statistics

Use the smallest path that answers the question.

## Current patterns

Run `weread --agent stats trend` once. It returns weekly, monthly, current
annual, and overall periods in one response. Do not also run `stats detail`
unless one period needs fields not already present.

## All-history patterns

1. Read the `stats.trend` data schema, then capture `stats trend` once. Do not
   preload the history schema.
2. Use `historyRange.firstNonzeroYear` and
   `historyRange.lastCompleteYear`. The CLI derives the first value from the
   returned overall buckets; never probe an arbitrary early year.
3. Only when that range contains an earlier full year, read the `stats.history`
   data schema and run `weread --agent stats history --from <first-year> --to
   <last-full-year>` once. Do not request the current year again; reuse the
   current annual period already returned by trend.
4. If there is no earlier full year, skip `stats history` and use trend alone.

Keep the first trend projection narrow. Validate the envelope separately, then
project only the history bounds and current annual evidence:

```bash
jq -e '
  .ok == true and
  .meta.operationId == "stats.trend" and
  .meta.schemaId == "urn:weread:agent:2:stats.trend" and
  .meta.complete == true and
  (.warnings | type == "array")' trend.json > /dev/null
jq -c '
  (.data.periods[] | select(.mode == "annually")) as $current |
  (.data.periods[] | select(.mode == "overall")) as $overall |
  {
    historyRange: .data.historyRange,
    currentAnnual: ($current | {
      totalReadTime,readDays,dayAverageReadTime,counts,
      categories:.categories[:8],topBooks:.topBooks[:8],dataQuality
    }),
    overall: ($overall | {totalReadTime,buckets,dataQuality}),
    warnings
  }' trend.json
```

Do not print weekly/monthly buckets or full ranked lists for an all-history
question. Keep the captured response for later projections.

Project the history response in two separate bounded views. First bring in the
schema-backed annual metrics:

```bash
jq -c '{
  warnings,
  range: {from: .data.fromYear, to: .data.toYear},
  years: [.data.periods[] | {
    year, totalReadTime, readDays, dayAverageReadTime, historyAnalysis,
    counts, dataQuality
  }]
}' history.json
```

Only when monthly inflections or historical topic shifts matter, use the second
projection for that evidence:

```bash
jq -c '{
  years: [.data.periods[] | {
    year, buckets,
    categories: .categories[:3], topBooks: .topBooks[:1]
  }]
}' history.json
```

Do not combine these views into one command output. Narrow the second further
if unusually long titles would make stdout exceed 8,000 bytes.

Use the schema-backed `historyAnalysis` fields for complete-year
year-over-year change, reading-day coverage, and accumulated time per reading
day. The last field's basis is explicitly `reading-day-total-not-session`. Do
not recompute those fields in a dense `jq -n` program. Keep any additional
calculation to one independently checkable expression; collect a filtered
stream into an array before applying `add`.

The upstream annual endpoint can reject unavailable years with HTTP 499/-2956.
A correctly derived range should produce zero failed year probes and no overlap
with the current annual period.

## One period

Use `weread --agent stats detail --mode weekly|monthly|annually|overall` with an
optional `--date` only when the request names one current or historical period.

## Interpretation

- Durations are seconds.
- `dayAverageReadTime` is a natural-calendar-day average, including inactive
  days.
- `compare` is the ratio change in that average; `0.2` means up 20%.
- Bucket size is day for weekly/monthly, month for annually, and year for
  overall.
- Use `totalReadTime` when a warning says read/listen components disagree.
- Period read and finished counts are events, not a cohort completion rate.
- Describe `readDays` only as reading-day count or reading-day coverage, never
  as app-open or reading frequency. Describe total time divided by `readDays`
  only as average accumulated time per reading day, never as time per session,
  a single sitting, or "single-session investment".
- Do not characterize these aggregates as frequent, short-session,
  long-session, fragmented, or concentrated session behavior. Per-reading-day
  duration is only an activity-intensity proxy, not proof of reading depth,
  comprehension, or content difficulty.
- Whenever the answer interprets `readDays`, daily averages, or accumulated
  time per reading day, include this boundary in the answer's language. In
  Chinese, write: "这些数据无法判断打开频率、会话次数或单次阅读长度。"
- A partial current year is not directly comparable to a complete calendar
  year without labeling the difference.
- Statistics alone do not establish motivation, available time, life events,
  systematic learning, or a knowledge structure. Label such explanations as
  hypotheses, or report only the observed behavior.
- Do not call a habit, baseline, or shift permanent from a finite history;
  scope persistence claims to the observed years.
- One complete year followed by a partial current year is not enough to name a
  "new baseline", "new platform", rebuilt pattern, or stable phase. Say only
  that the observed level remains above or below the named comparison years.

Stop after trend plus, when needed, one non-overlapping history call. Once the
trend table and its main inflection points are supported, more category or book
projections are optional rather than a reason to continue fetching.
After the final projection, `unlink` the exact trend/history files and use
`rmdir` for the empty task directory, as described in `contract.md`.
