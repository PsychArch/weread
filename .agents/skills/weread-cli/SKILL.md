---
name: weread-cli
description: Inspect and analyze a user's WeRead reading statistics, shelf, progress, notes, highlights, comments, public reviews, and recommendations through the local `weread` CLI. Use when a request asks for evidence-grounded reading insights, knowledge-gap analysis, book recommendations, note/comment synthesis, reading trends, or WeRead book availability checks.
---

# WeRead CLI

Use the executable selected below as the read-only data layer. Interpret the
evidence yourself; do not treat a large export as the answer.

## Start

1. Choose one executable for the whole run. Inside the `@psycharch/weread`
   source checkout, use `node dist/cli.js` wherever this skill shows `weread`;
   the checkout is authoritative over a PATH-installed package. If `dist/cli.js`
   is absent, run `pnpm run build` once first. Outside the source checkout, use
   the installed `weread` command.
2. Check readiness once:

   ```bash
   weread --agent doctor
   ```

   Require `ok=true`, `data.ready=true`, `meta.complete=true`, the expected
   `meta.operationId` and `meta.schemaId`, and an array-valued `warnings`. If
   the command is missing or schema metadata is absent, update the installed
   package or, in this repository, run `pnpm run build` and use
   `node dist/cli.js`.
3. Read the one task reference that matches the request:

   - Reading patterns or history: read [references/stats.md](references/stats.md).
   - Personal notes or viewpoint insight: read [references/notes.md](references/notes.md).
   - Recommendations or availability: read [references/recommendations.md](references/recommendations.md).
4. In addition to the task reference, read
   [references/contract.md](references/contract.md) before the first JSON
   Schema lookup, new `jq` projection, or unfamiliar operation. Task routing
   and contract loading are not alternatives. Read the task reference and
   contract in separate tool calls; do not concatenate their output.
5. Keep all operations read-only. Do not store credentials or invoke a live
   mutation unless the user explicitly requests it.

## Use the machine contract only when needed

Common operation IDs are named in the task references. For a known operation,
read its compact data schema directly before writing a new `jq` projection:

```bash
weread schema get notes.notebooks --data
```

Do not fetch the full capabilities catalog first. If invocation details are
unknown, fetch only that operation:

```bash
weread capabilities --operation notes.notebooks --json
```

Use the full `weread capabilities --json` catalog only to discover an unknown
operation ID. Read at most one data schema for each operation actually used;
never load schemas speculatively or reread one to answer a local projection
question.

## Bound tool and context use

- Capture each live response once. Reuse it for every local filter, count, and
  excerpt selection; do not refetch a shelf, notebook index, corpus, or history
  merely to change `jq`.
- Redirect responses likely to exceed 8 KB to one task-specific `mktemp -d`
  directory. Bring only bounded projections into model context. Do not print a
  whole shelf, schema collection, or corpus.
- Keep each local projection below 8,000 UTF-8 bytes and at most eight full
  note/review excerpts unless the user asks for exhaustive output. Character
  count is not a byte-size check for Chinese text.
- Prefer one batched data command over repeated per-item commands. Deduplicate
  IDs before the request.
- Make guards fail closed: use `jq -e`, and start every multi-command capture
  block with `set -euo pipefail`. `set -o pipefail` alone does not stop a later
  successful projection from masking a failed guard. A guard may instead run
  as its own status-bearing tool call.
- Treat live responses as authoritative. Prior recommendations or old counts
  may suggest questions, but must not anchor the current candidate list or be
  reported as current evidence.

## Preserve evidence boundaries

- Check `ok`, `meta.complete`, `warnings`, and command-level `dataQuality`.
  Completeness describes requested fetch coverage; it does not erase caveats.
- Only `thoughts[].content` is the reader's own wording. Highlights,
  `quotedText`, and `contextText` are source-book text.
- Public reviews are other readers' views, never the user's notes.
- `availability.readable` means at least one chapter is confirmed readable.
  Report `accessLevel`; do not promote partial access to full-book access.
- Scope absence claims to what was actually indexed or sampled.

## Stop when the answer is supported

Stop collecting evidence as soon as the requested conclusion has the minimum
necessary signals, coverage is quantified, quality warnings are handled, and
remaining uncertainty can be stated honestly. After the last necessary live
response, use at most two bounded local projections, then answer. Do not widen
the analysis merely because more operations exist.
