# I audited 345 DSH sessions: where the money actually went

> A real DeepSeek Harness installation, 2026-09-22 to 2026-10-31. Token costs only; no project content is included. The audit tool is open source, runs locally, and never uploads session logs.

## The short version

**CNY 778.78 over 22 active days — CNY 35.40/day, about CNY 1,062/month.** Half of it was cache-read input, 38% was output, and 36% landed in peak hours. The driver is not "asking too much"; it is **carrying a very long context into every call**.

## The bill

| Component | Cost | Share |
|---|---:|---:|
| Cache-read input | CNY 390.83 | 50.2% |
| Output (including reasoning) | CNY 297.36 | 38.2% |
| Cache-miss input | CNY 90.59 | 11.6% |
| Peak hours | CNY 281.49 | 36.1% |

Cache reads are the cheapest line per million tokens (CNY 0.02 idle), but they are **re-billed on every call**. The longer the context, the more it behaves like rent.

## One more number: 98% of spend came from a single workspace

It is not spread evenly across projects. Audit the most expensive workspace first; that is where a Lean preset pays off most.

## Two numbers that surprised me

**1. 60% of calls ran above 200k context.**

| Context range | Calls |
|---|---:|
| 0–50k | 4,042 |
| 50–100k | 5,666 |
| 100–150k | 6,921 |
| 150–200k | 7,220 |
| 200–300k | 14,315 |
| 300–400k | 8,712 |
| 400–500k | 5,448 |
| 500k+ | 7,507 |

Compaction was enabled. The default trigger is 80% of the window; by the time it fires, the conversation has already been expensive for a long time.

**2. 78% of tool output came from bash.**

| Tool | Characters | Share |
|---|---:|---:|
| bash | 63.8M | 78.2% |
| read | 13.0M | 16.0% |
| other | 4.6M | 5.8% |

Test runs, `psql`, `tail -1`, `ls -la`, cluster logs. Individual results were pruned to 4k/1k chars, but there were simply too many. This is not a model problem; it is an output-budget problem.

## Four changes, ranked by money

| Change | Estimated saving | Share |
|---|---:|---:|
| 250k context cap | CNY 118.90 | 15.3% |
| 20% less output | CNY 59.47 | 7.6% |
| Shift 40% of peak work off-peak | CNY 56.30 | 7.2% |
| Bash output budget | not priced separately | — |

Together roughly **25–30%**, or CNY 250–320/month. These are gross estimates with behavior held constant: earlier compaction can lose detail, shorter output can cost an extra step. Validate on real tasks.

## Split the month in half

| Metric | Oct 1–15 | Oct 16–31 | Change |
|---|---:|---:|---:|
| Cost | CNY 308.83 | CNY 470.75 | +52.4% |
| Calls | 25,095 | 34,811 | +38.7% |
| Cost / call | CNY 0.0123 | CNY 0.0135 | **+9.9%** |
| Avg context | 236.2k | 293.4k | **+24.2%** |
| Peak share | 28.3% | 41.1% | +12.7pp |

The second half was not more expensive per token. It carried more context into more peak-hour calls. Total cost alone says "spent more"; cost per call alone misses the peak shift. You need both to pick the next change.

## What I built

A zero-config CLI that reads `~/.dsh/sessions`, prices every call at official peak/idle rates, and prints a terminal, Markdown, or HTML report:

```bash
npx dsh-token-audit
npx dsh-token-audit --format html --out audit.html --open
```

It is also a DSH bundle with a read-only `token_audit` tool:

```bash
dsh plugin --profile web add dsh-token-audit
```

It can also generate the Lean preset (`dsh-token-audit preset`) and verify a change with `dsh-token-audit compare before.json after.json`. Everything is local. No network, no telemetry.

## Three honest limits

1. It is an estimate, not an invoice. Subscriptions, credits, and provider discounts are invisible in logs.
2. Peak/idle holidays are hardcoded for China 2026.
3. Context caps trade quality for money; the tool does not model quality.

## What next

Run the free audit, change the top three items, and measure again next week. If you want the configuration done and verified, the repo's `docs/service.md` describes a fixed-scope engagement: report first, payment after.

Repository: `https://github.com/lengrufeng2008/dsh-token-audit` (replace after publishing).
