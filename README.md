# weread

An unofficial CLI for reading data from the WeRead Agent Gateway. It provides
human-friendly terminal output, raw gateway JSON for scripts, and compact,
versioned JSON for agents.

The CLI covers book search and metadata, shelf entries, reading progress and
statistics, personal notes and highlights, public reviews, and recommendations.
It is read-only: interpretation stays outside the CLI so callers receive
deterministic data rather than hidden product opinions.

This project is not affiliated with or endorsed by Tencent or WeRead.

## Install

```bash
pnpm add --global @psycharch/weread
```

The installed executable is `weread`. Node.js 20 or newer is required.

## Authenticate

Get a WeRead API key from the
[official WeRead Skills page](https://weread.qq.com/r/weread-skills). For
temporary or automated use, export it in the current process:

```bash
export WEREAD_API_KEY="wrk-..."
weread --agent doctor
```

For persistent local use:

```bash
weread config set-key "wrk-..."
weread doctor
```

`WEREAD_API_KEY` takes precedence over the config file. The CLI never loads
`.env` files automatically, never prints a full key, and stores local config
with user-only permissions. `doctor` exits nonzero unless credentials are
present and the gateway is reachable; structured output also reports
`data.ready`.

## Human commands

```bash
weread search "基因传" --scope book --limit 5
weread book inspect 922224
weread book inspect-batch --book-id 922224 --book-id 3300045871
weread shelf summary
weread shelf list --all
weread stats detail --mode monthly --view summary
weread stats detail --mode annually --date 2025 --view summary
weread notes notebooks --all
weread notes export 922224 --format markdown --output notes.md
weread reviews list 922224 --type recommend --limit 10
weread discover recommend --limit 12
```

Search, public-review, and recommendation commands expose the gateway's
pagination inputs (`--max-idx`, `--synckey`, and `--session-id` where
applicable). Returned links are shown only when the live gateway supplies a
`deepLink`; the CLI does not invent `weread://` URLs.

## Agent commands

Put `--agent` before the command to receive compact normalized JSON:

```bash
weread --agent stats trend
weread --agent book inspect 922224
weread --agent book inspect-batch --book-id 922224 --book-id 3300045871
weread --agent notes corpus --book-id 922224 --book-id 3300045871
weread --agent reviews batch --book-id 922224 --type recommend,latest --limit 3
weread --agent shelf list --all
```

Every successful agent response has the same envelope:

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

Check `ok`, `meta.complete`, and `warnings` before drawing conclusions. A
successful diagnostic command can still report `data.ready=false`. Errors are
JSON on stderr and exit nonzero. Discover the stable command and field surface
with:

```bash
weread capabilities --json
```

## Output contracts

`--json` preserves live gateway response shapes and values for compatibility.
`--agent` selects a smaller, versioned projection: book ratings are normalized
to a 0-10 scale, review ratings to a 0-5 scale, timestamps to ISO strings, and
durations remain seconds. This distinction matters because live gateway fields
can differ from prose documentation.

`stats trend` and agent-mode `stats detail` include a `fieldGuide`. Durations
are seconds, `dayAverageReadTime` is averaged across natural calendar days, and
`compare` is the ratio change in that average (`0.2` means up 20%). Time buckets
are daily for weekly/monthly data, monthly for annual data, and yearly for
overall data. Use `totalReadTime` as authoritative when a warning says the
read/listen breakdown is inconsistent.

`notes notebooks --all` fetches every cursor page. Without `--all`, a bounded
result sets `meta.complete=false` when more pages remain. A notes corpus accepts
at most 50 book IDs per call. It exports highlights and personal note/review
entries, but bookmark positions are not exportable. In compact output, the
reader's own words are in `thoughts[].content`; `quotedText` and `contextText`
are source-book context.

Public-review compact output defaults to 800 characters per review and marks
truncation. Use `--max-content-chars` to adjust it. Personalized discovery is a
candidate source, not evidence of a knowledge gap; verify shortlisted titles
with `book inspect` or `book inspect-batch`.

## Raw gateway access

Use the escape hatch only when a high-level command is missing:

```bash
weread --json api call /store/search --param keyword=基因传 --param scope=10
```

Raw gateway responses may be large. Request metadata (`api_name` and
`skill_version`) is controlled by the CLI and cannot be overridden through
`--param`.

## Reliability

The default gateway protocol is `1.0.5`. Override it with
`WEREAD_SKILL_VERSION` or `--skill-version`; a compatible same-major upgrade is
negotiated once and reported in `warnings`. Read requests retry transient
network errors, HTTP 429/5xx, the gateway's rate-limit response, empty success
bodies, and malformed responses.

## Official API reference and licensing

Protocol semantics are cross-checked against Tencent's
[WeChatReading repository](https://github.com/Tencent/WeChatReading), which is
Copyright © 2026 Tencent and licensed under
[Apache-2.0](https://github.com/Tencent/WeChatReading/blob/main/LICENSE). The
live Agent Gateway remains the canonical source for wire request and response
formats. When its behavior differs from the repository documentation, this CLI
follows the observed gateway behavior and covers it with live validation.

The code in this repository is separately licensed under MIT. References to
WeRead, WeChat, and Tencent are solely to identify compatibility with their
service and do not imply sponsorship or endorsement.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

`verify` type-checks, builds, runs unit and built-CLI tests, creates the npm
artifact, checks its exact file list, and scans it for local paths and API-key
shaped values. See the
[release runbook](https://github.com/PsychArch/weread-cli/blob/main/RELEASING.md)
for the GitHub/npm flow and the
[security policy](https://github.com/PsychArch/weread-cli/blob/main/SECURITY.md)
for private vulnerability reporting.

Maintainers can run the bounded, read-only gateway suite with an exported key:

```bash
WEREAD_API_KEY="wrk-..." pnpm run test:live
```

## License

MIT © PsychArch
