# weread

English · [简体中文](https://github.com/PsychArch/weread/blob/main/README.zh-CN.md)

An unofficial, read-only CLI that makes WeRead data easier to explore from a
terminal or with an AI agent.

`weread` can search the catalog, inspect a shelf, follow reading progress, read
statistics, and collect notes or public reviews. Its agent mode goes a step
further: instead of forwarding an entire gateway response, it returns a smaller
versioned projection built for analysis.

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
weread stats detail --mode annually --date 2025 --view summary
weread notes export 922224 --format markdown --output notes.md
weread discover recommend --limit 12
```

The default output is intended for a person at a terminal. Dates, durations,
ratings, and progress are formatted for reading rather than preserved merely
because the server happened to return them that way.

## Agent mode

Place `--agent` before a command to receive compact normalized JSON:

```bash
weread --agent stats trend
weread --agent book inspect 922224
weread --agent shelf list --all
weread --agent notes corpus --book-id 922224 --book-id 3300045871
weread --agent reviews batch --book-id 922224 --type recommend,latest --limit 3
```

Agent mode is not just raw JSON without terminal colors. It extracts fields that
matter for analysis, normalizes awkward values, and combines requests for common
workflows. Every successful response uses the same envelope:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "schemaVersion": "2",
    "gatewaySkillVersion": "1.0.5",
    "complete": true,
    "timeZone": "Asia/Shanghai"
  },
  "warnings": []
}
```

Before drawing conclusions, an agent should inspect `ok`, `meta.complete`, and
`warnings`. A request may succeed while still carrying a pagination limit or a
data-quality caveat.

The complete command surface and field guidance are discoverable without
reading this README:

```bash
weread capabilities --json
```

### Reading trends

```bash
weread --agent stats trend
weread --agent stats detail --mode annually --date 2025
```

`stats trend` prepares several periods for comparison. Statistical responses
include a `fieldGuide` that explains units and comparison semantics, leaving
less room for an agent to infer meaning from field names alone.

### Notes and personal thoughts

Start with the full notebook index, then choose a relevant set of books for the
corpus:

```bash
weread --agent notes notebooks --all
weread --agent notes corpus --book-id 922224 --book-id 3300045871
```

The compact corpus distinguishes quoted book text from the reader's own words.
This matters when an agent is looking for recurring ideas or describing the
reader's point of view.

### Recommendations with verification

Personalized discovery is useful as a source of candidates:

```bash
weread --agent discover recommend --limit 12
```

Before presenting a shortlist, inspect the books together:

```bash
weread --agent book inspect-batch --book-id 922224 --book-id 3300045871
```

Inspection checks availability, shelf presence, progress, and note presence.
The final recommendation remains an agent decision, where the reader's goals
and existing knowledge can be considered.

## Output and data boundaries

Without a structured-output flag, `weread` prints concise terminal text.
`--json` preserves the live gateway response shape for compatibility and
debugging. `--agent` selects the smaller versioned contract described above.
The raw response remains available; it simply does not need to attend every
conversation.

Book ratings in agent mode use a 0–10 scale, review ratings use 0–5, timestamps
are converted to ISO strings, and durations remain seconds. Statistics include
their own field guidance. In particular, `dayAverageReadTime` is based on
natural calendar days rather than active reading days, and `compare` is the
ratio change in that average. A value of `0.2` means an increase of 20%.

`notes notebooks --all` follows every cursor page. A bounded result sets
`meta.complete=false` when more pages remain. One notes corpus accepts up to 50
book IDs. Bookmark positions contribute to WeRead's notebook counts but are not
exportable as note content. In compact output, `thoughts[].content` contains the
reader's wording; `quotedText` and `contextText` come from the book.

Public-review output for agents is bounded and reports truncation. Returned
links are included only when the gateway supplies a `deepLink`; the CLI does not
construct `weread://` links on its own.

## Raw gateway access

When a high-level command does not cover an endpoint, the raw gateway remains
available:

```bash
weread --json api call /store/search --param keyword=基因传 --param scope=10
```

Raw responses may be large. Request metadata such as `api_name` and
`skill_version` is managed by the CLI and cannot be overridden through
`--param`.

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
rate limits, empty success bodies, and malformed responses. `doctor` exits
nonzero unless credentials are present and the gateway is reachable;
structured output also reports `data.ready`.

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

Maintainers can run the bounded, read-only gateway suite with an exported key:

```bash
WEREAD_API_KEY="wrk-..." pnpm run test:live
```

## License

Tencent's WeChatReading repository is Copyright © 2026 Tencent and licensed
under [Apache-2.0](https://github.com/Tencent/WeChatReading/blob/main/LICENSE).
This project is separately licensed under MIT. References to WeRead, WeChat,
and Tencent identify service compatibility and do not imply sponsorship or
endorsement.

MIT © PsychArch
