# Agent contract

Read this reference when selecting an unfamiliar operation, deriving `jq`
paths, or validating a response.

## Output model

- Human commands return concise text by default.
- `--agent` is the stable machine interface. It returns a command-specific,
  schema-backed envelope.
- `--json` is raw-compatible and may be upstream-shaped. Do not assume it has a
  stable schema unless capabilities explicitly says so.
- `schema get` returns Draft 2020-12 JSON Schema, compact by default. Add
  `--pretty` only for human inspection.

## Discover one operation

Use an operation-scoped manifest when the ID is known:

```bash
weread capabilities --operation book.inspect-batch --json
```

The manifest itself has a strict schema advertised in its top-level
`schemaCommand`; run `weread schema get capabilities` when a validator needs
it. Version 2 exposes the executable and these operation fields:

- top-level `executable`: prepend this to every advertised argv array
- `operations[0].id`
- `operations[0].command.argv`: complete argv after the `weread` executable,
  including `--agent`
- `operations[0].input`: positionals, options, defaults, repeatability, limits,
  and cross-option constraints
- `operations[0].output.dataSchemaCommand`: schema for `.data`
- `operations[0].output.schemaCommand`: full success/error envelope schema

Do not guess `.command`, `.argv`, or flags. Use these exact fields. Use the full
catalog only when the operation ID itself is unknown:

```bash
weread capabilities --json |
  jq -e '.operations[] | {id, description}'
```

## Read the smallest schema

For ordinary analysis, read only the selected operation's data schema:

```bash
weread schema get stats.history --data
```

That schema describes paths below `.data`. Read the larger full schema only
when an actual JSON Schema validator must validate success and error documents.
The schema's `$id` must match the manifest's `dataSchemaId` or `schemaId`.

## Validate and capture once

A canonical response guard is:

```bash
jq -e '
  .ok == true and
  .meta.operationId == "notes.notebooks" and
  .meta.schemaId == "urn:weread:agent:2:notes.notebooks" and
  (.meta.complete | type == "boolean") and
  (.warnings | type == "array")'
```

Require `.meta.complete == true` only when the conclusion needs complete
pagination. Always inspect warnings and any `.data.*.dataQuality` fields.

For a large response, keep stdout out of model context:

```bash
set -euo pipefail
weread_task_dir="$(mktemp -d)"
weread --agent notes notebooks --all > "$weread_task_dir/notebooks.json"
jq -e '<guard>' "$weread_task_dir/notebooks.json" > /dev/null
jq -c '<bounded projection>' "$weread_task_dir/notebooks.json"
```

When a guard and projection share one shell block, `set -euo pipefail` is
required so the guard aborts the block. Otherwise run the guard as its own
status-bearing tool call. Reuse the captured file for later projections.

After the work, remove only the exact files created by the workflow, then the
empty directory. Run `unlink <exact-file>` once per file, followed by `rmdir
<exact-directory>`; do not use recursive or force deletion. If cleanup is
rejected, report the exact temporary path and stop rather than trying deletion
workarounds. Do not create several temporary directories or repeat cleanup
attempts.

## Failure boundaries

- A missing required field, unknown operation, or mismatched schema ID is a
  binary/contract mismatch, not permission to invent a fallback shape.
- Exit zero means success, including an empty result. Invalid input, auth,
  network, gateway, or schema errors exit nonzero.
- Agent success is written to stdout. Agent errors are JSON on stderr.
- Raw `api call` is a read-only repair hatch with no stable response schema.
  Use it only when no high-level operation exposes the required data.
