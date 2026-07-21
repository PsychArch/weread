---
name: weread-cli
description: Retrieve a user's WeRead reading statistics, shelf, progress, notes, highlights, comments, public reviews, discovery results, and book metadata through the local `weread` CLI. Use when Codex needs read-only WeRead data or a stable JSON contract for programmatic CLI access.
---

# WeRead CLI

Use the CLI as a read-only data interface.

## Select the executable

Examples below use `weread`. In the `@psycharch/weread` source checkout, use
`node dist/cli.js` instead; run `pnpm run build` after source changes before
using it. Outside the checkout, use the PATH-installed `weread`.

## Use stable operations

Invoke a known operation directly:

```bash
weread --json <command> [arguments]
```

Discovery is only needed when the operation ID is unknown:

```bash
weread operations
weread --json operations
```

Before guessing unfamiliar flags, response paths, pagination, or limitations,
fetch that operation's descriptor once:

```bash
operation_id=notes.notebooks
descriptor_file=$(mktemp)
weread --json operation describe "$operation_id" >"$descriptor_file"

jq '{
  id: .data.id,
  jsonArgv: .data.invocation.jsonArgv,
  input: .data.input,
  pagination: .data.pagination,
  limitations: .data.limitations,
  schemaId: .data.output.schemaId,
  dataRequired: .data.output.responseSchema["$defs"].data.required,
  dataProperties: (.data.output.responseSchema["$defs"].data.properties | keys)
}' "$descriptor_file"
```

The exact success-and-error schema is at `data.output.responseSchema`.
`data.output.dataSchemaRef` is the JSON Schema reference to the success
`data` payload. Use bracket notation for `"$defs"` in `jq`, as shown
above. The descriptor is self-contained; use its singular `input` field and
schema instead of probing a live response with `keys` or fallback field names.

Cache the descriptor per operation ID for the selected executable. Refresh it
after rebuilding or changing the executable, or when a response's
`meta.schemaId` differs.

For pagination, `data.page.nextArgv` is the complete argument array to pass
after the executable. Execute that array unchanged. `nextArgs` contains only
the continuation values. Paginated batch results expose the same pair on each
batch item's page. Treat opaque cursors as pass-through values; do not decode
or reconstruct them.

Live operations check their own credentials and gateway preconditions. Use
`weread --json doctor` only when a separate readiness diagnostic is useful;
operation discovery and description are fully offline.

Capture an expensive live response once, then apply every local `jq`
projection to that saved stdout. Keep stderr separate and preserve the CLI
status:

```bash
stdout_file=$(mktemp)
stderr_file=$(mktemp)
if weread --json notes notebooks --limit 20 >"$stdout_file" 2>"$stderr_file"; then
  jq -e '
    .ok == true and
    .meta.operationId == "notes.notebooks" and
    (.meta.schemaId | type == "string") and
    (.warnings | type == "array")
  ' "$stdout_file" >/dev/null
  jq '.data.books' "$stdout_file"
else
  exit_code=$?
  jq -e '.ok == false and (.error.code | type == "string")' "$stderr_file" >&2 ||
    printf 'weread process failure\n' >&2
  exit "$exit_code"
fi
```

A zero exit writes the `ok=true` response to stdout. A nonzero exit writes the
schema-backed `ok=false` response to stderr. Unmatched argv uses
`invocation.error`; argument errors for a known leaf use that leaf's response
contract. Treat non-JSON stderr as a process failure.

On success, inspect `meta.complete`, `warnings`, and operation-specific
quality, coverage, or continuation fields. `meta.complete` means that the
invocation completed; collection and period coverage have separate fields in
the descriptor schema. Full JSON Schema validation is optional when the task
needs it.

## Stable and raw boundaries

- Default output is concise text for humans.
- `--json` is the stable, schema-backed machine interface.
- `--raw` exposes legacy or upstream-shaped JSON with no stable schema. Use it
  only when no stable operation exposes the required read-only data, and do
  not infer a durable response contract from it.
- Access the generic gateway only through the explicit raw escape hatch:

  ```bash
  weread --raw api call <api-name> [--param key=value]
  ```

This skill covers read-only access. Do not use the raw gateway to synthesize a
mutation.
