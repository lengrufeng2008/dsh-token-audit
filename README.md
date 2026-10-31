# dsh-token-audit

**Find out where your DeepSeek Harness tokens went — and what to change first.**

`dsh-token-audit` reads your local DSH session logs, prices every model call with the official DeepSeek peak/idle rates, and prints a ranked savings plan. It is a one-shot audit, not another dashboard: no plugin required, no config, no upload.

```bash
npx dsh-token-audit
```

```
DSH Token Audit
  /home/you/.dsh/sessions

  Window      2026-09-22 → 2026-10-31  (22 active days)
  Sessions    345  ·  59,823 model calls
  Total       CNY 778.78  ·  CNY 35.40/day  ·  CNY 1,061.98/month projected

  Cost split
    cache read      CNY 390.83  [##########........] 50.2%
    output          CNY 297.36  [########..........] 38.2%
    cache miss       CNY 90.59  [##................] 11.6%
    peak hours      CNY 281.49  [#######...........] 36.1%

  Context distribution
    0–50.0k          140 calls  [........................]
    ...
    500.0k–750.0k   2143 calls  [#######.................]

  Savings plan  (gross; combined overlaps, behavior unchanged)
    context cap 150k   save   CNY 210.20  27.0%
    context cap 250k   save   CNY 118.90  15.3%
    output      -20%   save    CNY 59.47   7.6%
    off-peak     40%   save    CNY 56.30   7.2%

  What to do first
    • 64% of calls ran above 200k context. Lower the compaction trigger ...
    • 36% of spend landed in peak hours (09-12, 14-18 Beijing) ...
```

A synthetic example report is in [docs/demo.html](docs/demo.html); open it in a browser to see the full layout.

## Why this exists

DSH is good at keeping a long conversation alive; that also makes it easy to spend far more than you expect. The official DSH surface shows context pressure and token counts, but not **which calls cost the most, which hours were expensive, or what to change**. This tool answers those three questions from the logs you already have.

It is deliberately not a dashboard:

- **One shot.** Run it monthly, or after an expensive week.
- **Exact accounting.** Uses provider-reported usage from `assistant/message` events, including cache reads, cache misses, and output.
- **Official prices.** DeepSeek `deepseek-flash` and `deepseek-v4-pro`, peak and idle, in CNY per million tokens (as of 2026-10-31).
- **Actionable.** Ranks context caps, output discipline, off-peak scheduling, and tool-output bloat by the money they would save.

## Install

```bash
# zero-install
npx dsh-token-audit

# or globally
npm i -g dsh-token-audit
dsh-token-audit --days 7
```

Node.js 20+. If `zstdcat` is on `PATH` it is used to decode logs quickly; otherwise a pure-JS decoder is bundled. On Windows, the pure-JS path is used.

## Install as a DSH plugin

The npm package is also a DSH bundle. It adds one read-only agent tool, `token_audit`:

```bash
dsh plugin --profile web add dsh-token-audit
```

Then ask the agent: *"Audit my token spend for the last 30 days and tell me what to change."* The tool returns the same report. It never sends session data anywhere.

## Usage

```bash
dsh-token-audit                              # last 30 days, terminal
dsh-token-audit --days 7                     # last week
dsh-token-audit --since 2026-10-01 --until 2026-10-31   # calendar month (Beijing dates)
dsh-token-audit --all                        # every session on disk
dsh-token-audit --cwd Miner                  # one workspace
dsh-token-audit --session 4160cf07           # drill into one expensive session
dsh-token-audit --format markdown --out report.md
dsh-token-audit --format html --out report.html --open
dsh-token-audit --format json > audit.json
```

| Option | Meaning |
|---|---|
| `--sessions <dir>` | Session root. Default `$DSH_HOME/sessions` or `~/.dsh/sessions`. |
| `--days <n>` | Only sessions active in the last N days. Default 30. |
| `--since <date>` | Only calls on/after this Beijing date (`YYYY-MM-DD`); implies `--all`. |
| `--until <date>` | Only calls on/before this Beijing date (`YYYY-MM-DD`); implies `--all`. |
| `--all` | Ignore the time window. |
| `--cwd <text>` | Only sessions whose working directory contains the text. |
| `--session <id>` | Only sessions whose id contains the text; drill into one expensive session. |
| `--format <fmt>` | `terminal` (default), `markdown`, `html`, `json`. |
| `--out <file>` | Write the report to a file. Format is inferred from the extension. |
| `--open` | Open an HTML report in the default browser. |
| `--redact` | Hide session titles, paths, commands, and file names; safe to share. |
| `--top <n>` | Rows in the terminal session table. Default 8. |
| `--no-color` | Disable ANSI colors. |

## Verify a change (before / after)

Save a baseline JSON report, make one change, wait a comparable window, then compare:

```bash
dsh-token-audit --format json > before.json
# ... change compaction / effort / scheduling for a week ...
dsh-token-audit --format json > after.json
dsh-token-audit compare before.json after.json
```

The comparison leads with **cost per call**, not just total cost: a cheaper week with half the work is not a win. It also shows context, peak share, cache/output composition, and a verdict.

## Generate a Lean preset

The audit tells you the shape of the problem; the preset applies a first fix:

```bash
dsh-token-audit preset --out ./dsh-lean-preset
dsh plugin --profile web add ./dsh-lean-preset
```

It keeps the standard toolset, moves the compaction trigger from 80% to 45%, shrinks the retained tail, prunes tool results at 4k chars, and adds a cost-discipline persona. Tune with `--threshold 0.5 --retain 0.08 --prune 6144`. Choose **Lean** for a new session; existing sessions keep their preset.

## What the numbers mean

Every `assistant/message` in a DSH session log carries provider-reported usage:

- `cacheReadTokens` — input served from the prompt cache (cheap)
- `inputTokens` — uncached input (expensive)
- `outputTokens` — generated tokens, including reasoning (most expensive)

Cost is computed per call, using the call's Beijing timestamp to pick peak or idle pricing:

| Model | Cache hit | Cache miss | Output |
|---|---:|---:|---:|
| `deepseek-flash` idle | 0.02 | 1.00 | 4.00 |
| `deepseek-flash` peak | 0.04 | 2.00 | 8.00 |
| `deepseek-v4-pro` idle | 0.15 | 4.50 | 13.50 |
| `deepseek-v4-pro` peak | 0.30 | 9.00 | 27.00 |

Peak = Beijing weekdays 09:00–12:00 and 14:00–18:00, excluding China statutory holidays. Unknown models fall back to Flash rates and are flagged in the report.

## Savings estimates are gross, not promises

The `Savings plan` assumes behavior stays the same. Capping context at 250k means older history is compacted earlier; the model may lose detail and take more steps. Treat each row as an upper bound, then verify on a real task. The report labels the combined row as overlapping for the same reason.

The most reliable levers we have measured on real logs:

1. **Context size.** Cache-read cost is proportional to context length on every call. A 250k cap is often 15–25% of the bill.
2. **Output discipline.** On `reasoningEffort: max`, output can be 35–40% of cost. Use `high` for routine work.
3. **Off-peak scheduling.** Idle prices are half. Move batch jobs after 18:00 or before 09:00 Beijing time.
4. **Tool output.** `bash` is usually the largest source of context bloat; `tail`/`head`/quiet flags and redirecting logs to files are free.

## Privacy

Everything runs locally. The tool reads `~/.dsh/sessions/**`, computes in memory, and writes only the report you ask for. There is no network call, no telemetry, and no upload. The plugin tool is read-only.

Use `--redact` before sharing a report with anyone: it removes session titles, working directories, bash commands, and file names while keeping every number.

## Limitations

- This is an **estimate**, not your invoice. Subscription plans, credits, refunds, and provider discounts are not visible in session logs.
- Peak/idle holidays are hardcoded for China 2026. Weekends are always idle.
- Third-party providers are priced at Flash rates until a catalog is added.
- Session logs must be readable (`.jsonl` or `.jsonl.zstd`).
- Context caps are a trade-off; quality is not modeled.

## Development

```bash
git clone <repo>
cd dsh-token-audit
npm install
npm test
node bin/dsh-token-audit.mjs --days 3
```

The audit engine (`src/audit.mjs`) is independent of the CLI and can be imported. Pricing lives in `src/pricing.mjs`; renderers in `src/report.mjs`.

## Need this applied to your setup?

The audit is free. If you want the configuration work done for you — compaction thresholds, pruner settings, model routing, off-peak scheduling, and a before/after verification — see [docs/service.md](docs/service.md). Fixed scope, fixed price, pay only after the report.

## License

MIT. Pricing data belongs to DeepSeek; this project is unofficial.
