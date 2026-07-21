# weread

English · [简体中文](https://github.com/PsychArch/weread/blob/main/README.zh-CN.md)

An unofficial, read-only CLI that makes WeRead data easier to explore from a
terminal or with an AI agent.

`weread` can search the catalog, inspect a shelf, follow reading progress, read
statistics, and collect notes or public reviews. It provides concise text for
people and a stable, schema-backed JSON interface for programs and agents.

This project is not affiliated with or endorsed by Tencent or WeRead.

## Why we made it

Tencent publishes the official
[WeChatReading](https://github.com/Tencent/WeChatReading) project. It is the
protocol reference for the WeRead Agent Gateway and documents its requests,
responses, pagination rules, and field semantics in Markdown.

Those documents are valuable, and this project depends on them. Markdown is
well suited to explaining an interface to a reader, but it is not the same as a
machine-readable contract such as OpenAPI. A direct caller still has to turn the
prose into code, account for the pagination style of each endpoint, and remember
details that are easy to miss. For example, some durations are expressed in
seconds, and `noteCount` is narrower than its name may suggest.

That is not a shortcoming of the official project; the documentation and this
CLI simply serve different roles. The official repository describes the
gateway. `weread` makes those instructions executable and gives callers a
consistent local interface.

The result is useful for ordinary terminal work, but the main motivation is
agent use. An agent should be able to study several years of reading activity or
a large notebook collection without spending most of its context window on
transport details. It should also know when a result is incomplete instead of
quietly treating the first page as the whole library.

## What it can help with

The CLI can answer direct questions such as “what is on my shelf?” or “how long
did I read this month?” It also provides the evidence for broader analysis:

- how reading habits changed over several years;
- which subjects and authors receive sustained attention;
- what themes recur in highlights and personal thoughts;
- which books may fill a gap in the reader's current interests.

`weread` retrieves and organizes the evidence. Interpretation stays with the
person or agent using it. Gateway operations are read-only, so exploring a
reading history does not alter it.

## Quick start

Node.js 22.12 or newer is required. Install the CLI with pnpm:

```bash
pnpm add --global @psycharch/weread
```

Get an API key from the official
[WeRead Skills page](https://weread.qq.com/r/weread-skills), then export it in
the current process:

```bash
export WEREAD_API_KEY="wrk-..."
weread doctor
```

For persistent local use:

```bash
weread config set-key "wrk-..."
weread doctor
```

`WEREAD_API_KEY` takes precedence over the saved configuration. The CLI does
not load `.env` files automatically, never prints a full key, and stores its
local configuration with user-only permissions.

Once `doctor` reports that the gateway is ready, try a few commands:

```bash
weread search "基因传" --scope book --limit 5
weread shelf summary
weread stats detail --mode annually --date 2025
weread stats history
weread notes export 922224 --format markdown --output notes.md
weread discover recommend --limit 12
```

The default output is intended for a person at a terminal. Dates, durations,
ratings, and progress are formatted for reading rather than preserved merely
because the server happened to return them that way.

## Machine-readable interface

The CLI has three output boundaries:

- no output flag: concise text for a person at a terminal;
- `--json`: stable normalized data in a schema-backed envelope;
- `--raw`: unwrapped legacy or upstream-shaped data with no stability guarantee.

`--agent` remains a silent compatibility alias for `--json`. New integrations
should use `--json`.

The machine interface is discoverable without credentials or a live gateway
request:

```bash
weread operations
weread --json operations
weread --json operation describe stats.trend
```

`operations` is a small catalog. `operation describe` returns one self-contained
descriptor with the command invocation, typed inputs, pagination contract, side
effects, and known limitations. The full response schema is at
`data.output.responseSchema`; `data.output.dataSchemaRef` identifies its data
payload definition (`#/$defs/data`). A caller can therefore construct the
command and its `jq` projection before seeing live user data.
Descriptors are stable for a given build and can be cached by operation ID.

Stable JSON errors carry the same schema identity fields as successes. An error
whose argv did not resolve to a registered leaf uses the cataloged
`invocation.error` contract; argument errors for a known leaf use that leaf's
response schema. Both are available through `operation describe`. Successful
responses are written to stdout; structured failures are written to stderr and
retain a nonzero exit status.

Invoke the advertised command with `--json`:

```bash
weread --json stats trend | jq '.data.periods'
weread --json book inspect 922224 | jq '.data'
weread --json notes notebooks --limit 20 | jq '.data.page'
```

Every successful stable response uses the same envelope:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "schemaVersion": "3",
    "gatewaySkillVersion": "1.0.5",
    "complete": true,
    "timeZone": "Asia/Shanghai",
    "operationId": "stats.trend",
    "schemaId": "urn:weread:response:3:stats.trend"
  },
  "warnings": []
}
```

`meta.complete=true` means the requested command completed successfully. It does
not mean a paginated collection has no more items. Paginated collection results
report breadth and continuation in `data.page`; when `hasMore` is true,
`nextArgv` contains the complete arguments for the next stable request, while
`nextArgs` contains only its cursor flags. Paginated batch results carry these
fields on each item's page, including the corresponding book and filter context
in `nextArgv`. The complete argv also pins the effective gateway protocol
version, so it remains executable even when the first request selected that
version through the environment. Data-quality caveats remain separate in the
operation data and `warnings`.

Book-level note coverage is similarly explicit: `reviewsExhausted` reports
whether every personal-review page for that book was collected. It does not
change the meaning of `meta.complete`.

Stable projections preserve documented facts, normalize recurring wire formats,
and make missing values explicit. Upstream values such as statistics `compare`
remain identifiable and are not expanded into CLI-selected interpretations or
ratios. The CLI does not prescribe how the returned data should be interpreted
or which analysis an agent should perform.

`stats history` needs no guessed start year: omitted bounds cover the supported
range from 2017 through the current Asia/Shanghai year. The first nonzero overall
bucket is still reported as an activity fact, but it does not remove supported
zero years. Each annual period separately reports `periodComplete`,
`throughDate`, and `elapsedDays`, so the current year cannot be confused with
`meta.complete`.

`notes corpus --all-notebooks` traverses the live notebook index and returns
notes at whole-book boundaries in bounded pages (10 books by default). Follow
`data.page.nextArgv` until `hasMore=false`; its opaque cursor should be passed
through unchanged. Use `--limit` to choose a different page size up to 50.
Repeated `--book-id` flags remain a one-shot exact selection and are not
truncated by `--limit` (up to 50 unique IDs).

### Migrating from the v2 interface

| Old interface | Current interface |
| --- | --- |
| Raw, unwrapped `--json` | `--raw` |
| Stable `--agent` response-schema v2 | `--json` or its `--agent` alias, response-schema v3 |
| `capabilities` and `schema get` | `operations` and `operation describe` |
| `meta.complete` described fetch coverage | `meta.complete` reports invocation completion; operation-specific page and period fields report coverage |
| `notes sample` | Removed; compose `notes notebooks` and `notes corpus` |

## Raw gateway access

When a high-level command does not cover an endpoint, the raw gateway remains
available:

```bash
weread --raw api call /store/search --param keyword=基因传 --param scope=10
```

Raw responses may be large. Request metadata such as `api_name` and
`skill_version` is managed by the CLI and cannot be overridden through
`--param`. The generic gateway is intentionally available only in raw mode;
`--json api call` is rejected because there is no stable schema for arbitrary
upstream endpoints.

## Where this project fits

The WeRead community includes SDKs, dashboards, MCP servers, note-sync tools,
and reading-advisor skills. Each is useful for a different kind of work. This
project takes a narrower role: it is a portable data layer for environments
that can run a command and consume its output.

If an application needs an embeddable SDK, a graphical interface, or direct MCP
integration, another project may be a better fit. `weread` is intended for
people who want a composable CLI and for agents that benefit from compact
evidence, explicit completeness, and deterministic behavior.

## Reliability and protocol compatibility

The default gateway protocol is `1.0.5`. It can be overridden with
`WEREAD_SKILL_VERSION` or `--skill-version`. A compatible same-major upgrade is
negotiated once and reported in `warnings`.

Read requests retry transient network errors, HTTP 429/5xx responses, gateway
rate limits, empty success bodies, and malformed responses. `doctor` exits zero
when the diagnostic itself completes, even when `data.ready=false`; scripts can
require readiness with `weread --json doctor | jq -e '.data.ready'`.

Protocol semantics are cross-checked against Tencent's
[WeChatReading](https://github.com/Tencent/WeChatReading) repository. The live
Agent Gateway remains the canonical source for wire behavior. When observed
behavior differs from the prose documentation, this CLI follows the live
response and covers it with validation.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

`verify` type-checks, builds, runs the test suite, creates the npm artifact, and
scans it for unexpected files, local paths, or API-key-shaped values. Release
instructions are in [RELEASING.md](RELEASING.md), and security reports are
covered by [SECURITY.md](SECURITY.md).

Maintainers can run the bounded, read-only gateway suite with an exported key
or the local CLI config:

```bash
pnpm run test:live
```

## License

Tencent's WeChatReading repository is Copyright © 2026 Tencent and licensed
under [Apache-2.0](https://github.com/Tencent/WeChatReading/blob/main/LICENSE).
This project is separately licensed under MIT. References to WeRead, WeChat,
and Tencent identify service compatibility and do not imply sponsorship or
endorsement.

MIT © PsychArch
