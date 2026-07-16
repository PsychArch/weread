---
name: weread-cli
description: Inspect and analyze a user's WeRead reading statistics, shelf, progress, notes, highlights, comments, public reviews, and recommendations through the local `weread` CLI. Use when a request asks for evidence-grounded reading insights, knowledge-gap analysis, book recommendations, note/comment synthesis, reading trends, or WeRead book availability checks.
---

# WeRead CLI

Use the installed `weread` command as the data layer, then perform
interpretation in the response. Prefer compact high-level commands over raw
gateway payloads.

## Start safely

1. Verify installation with `command -v weread`; if missing, install it with
   `pnpm add --global @psycharch/weread`. Inspect
   `weread capabilities --json` when command discovery is needed.
2. Run `weread --agent doctor` before reading user data and require both outer
   `ok=true` and `data.ready=true`. Authentication comes from `WEREAD_API_KEY`
   first, then the local config written by `weread config set-key`.
3. Keep all operations read-only. Do not invoke a live mutation or store
   credentials unless the user explicitly requests it.
4. Check `ok`, `meta.complete`, and `warnings` in every agent envelope before
   treating the data as complete.
5. Run `weread capabilities --json` when a workflow needs batching,
   full-library coverage, or field semantics. `meta.complete` describes the
   requested fetch or pagination; data-quality caveats can still appear in
   `warnings` and `dataQuality`.

## Choose the smallest data command

- Reading patterns: use `weread --agent stats trend`. Its `fieldGuide` defines
  units and comparison semantics. Use `stats detail` with
  `--mode weekly|monthly|annually|overall` and an optional `--date` when one
  current or historical period needs closer inspection. Agent output is already
  compact and does not need `--view summary`.
- One book: resolve ambiguous names with `book resolve`, then use
  `weread --agent book inspect <bookId>` to verify availability, progress, shelf
  presence, and note presence.
- Several candidate books: resolve names first, then use
  `weread --agent book inspect-batch` with at most 20 repeatable `--book-id`
  values. This shares shelf and notebook fetches and is preferred for
  availability-filtered recommendations.
- Personal notes and comments: use `weread --agent notes notebooks --all` to
  discover every notebook, then select a bounded, representative set for
  `notes corpus`. One corpus call accepts at most 50 repeatable `--book-id`
  values. `highlights[].text` is source text. Only `thoughts[].content` is the
  reader's own wording; `quotedText` and `contextText` are book context.
  `excerpt-only`, `rating-only`, and `empty` entries must not be interpreted as
  personal claims. Bookmark positions count toward notebook totals but are not
  exportable in a corpus.
- Public reception: use `weread --agent reviews batch` with bounded, explicit
  book IDs, review types, and low limits (usually 1-3). Public reviews are other
  readers' views, never the user's own notes.
- Recommendations: start with `discover recommend` or `discover similar`, then
  verify every shortlisted title with `book inspect` before recommending it as
  readable.
- Raw fallback: use
  `weread --json api call <api-name> --param key=value` only when no high-level
  command exposes the required read-only data. Treat that response as
  upstream-shaped and potentially large.

Use IDs after resolution so repeated calls cannot drift to a different title.
`shelf list --all` and `notes notebooks --all` provide full collection coverage;
a bounded list intentionally sets `meta.complete=false`. Never source arbitrary
`.env` files; use an already-exported environment variable or the CLI config.

For a very large notes library, do not immediately fetch every note. Start from
the complete notebook index, stratify by topic, recency, note density, and
reading progress, and state the sample coverage. If the user explicitly requires
a full corpus, run sequential batches of at most 50 books. The CLI retries the
gateway's rate-limit response with backoff, but repeated full-corpus calls can
still need a pause; keep successful batches and do not restart them.

## Interpret the evidence

Base conclusions on multiple signals where possible: time trends,
completed/in-progress books, category and author concentration, and recurring
concepts in personal notes. For statistics, durations are seconds;
`dayAverageReadTime` is a natural-calendar-day average; `compare` is its change
ratio; bucket granularity varies by mode. Use `totalReadTime` when a warning says
the read/listen breakdown is inconsistent. Never turn period "read" and
"finished" counts into a cohort completion rate.

Label uncertainty when coverage is incomplete or an upstream ranked item is
unidentified. Treat personalized discovery as a candidate generator: it often
reinforces the reader's dominant categories. Knowledge-gap recommendations must
fill a demonstrated gap, exclude already-covered material where appropriate,
consider evidence quality, and be verified as currently readable.

## Examples

```bash
weread --agent stats trend
```

```bash
weread --agent notes corpus --book-id 922224 --book-id 3300045871
```

```bash
weread --agent reviews batch --book-id 922224 --type recommend,latest --limit 10
```
