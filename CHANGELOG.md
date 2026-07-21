# Changelog

All notable changes to this project will be documented here.

## 0.1.1 - 2026-07-21

- Make `--json` the stable, schema-backed machine interface and keep `--agent`
  as a compatibility alias. Existing unwrapped JSON consumers should use
  `--raw`.
- Replace `capabilities` and `schema get` with offline `operations` and
  self-contained `operation describe` discovery.
- Give unmatched stable invocations a cataloged, error-only
  `invocation.error` response schema while preserving leaf schemas for known
  command argument errors.
- Put each data schema once at `data.output.responseSchema.$defs.data`, expose
  its `$ref` at `data.output.dataSchemaRef`, and define `meta.complete` as
  invocation completion in response-schema version 3. Operation-specific page
  and period fields report coverage.
- Remove `notes sample`; notebook selection and corpus retrieval remain
  composable through `notes notebooks` and `notes corpus`.
- Expose pagination, missingness, provenance, and operation-specific coverage
  facts in the structured contracts without adding CLI-selected analysis ratios.
- Return full executable `nextArgv` continuations alongside cursor-only
  `nextArgs`, including per-item context for paginated batch results and the
  effective gateway protocol version selected by flags or environment.
- Let `stats history` default to every supported year from 2017 through the
  current year, report first-nonzero activity separately, and distinguish
  calendar-period state from command completion.
- Page `notes corpus --all-notebooks` at whole-book boundaries with executable
  `nextArgv` continuations and a validated opaque cursor, while preserving
  one-shot explicit book IDs, notebook metadata, and Asia/Shanghai note dates.
- Separate `reviewsExhausted` and `indexExhausted` collection facts from
  invocation-level `meta.complete`.
- Keep the companion skill focused on discovery, descriptor caching, structured
  stderr recovery, and stable/raw transport boundaries rather than analysis
  policy.

## 0.1.0 - 2026-07-16

- Add human, raw JSON, and compact agent output modes.
- Cover search, books, shelf, statistics, notes, reviews, and discovery.
- Add bounded pagination, retry handling, gateway protocol negotiation, and
  read-only raw API access.
- Add a companion Codex skill and npm/GitHub release automation.
