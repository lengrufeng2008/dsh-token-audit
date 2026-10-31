# DSH Token Audit — fixed-scope optimization

The audit is free and open source. This page is for teams and heavy users who want the changes made and verified, not just a report.

## Who this is for

- You run DSH every day and spend CNY 300+ / month on tokens.
- Sessions reach 200k–700k context and you are not sure compaction is helping.
- You want a before/after number, not another dashboard.

## Packages

| Package | Scope | Price |
|---|---|---|
| **Audit** | Run the audit on your logs, 30-minute review, written findings. No changes. | Free |
| **Lean setup** | Apply compaction/pruner/effort/off-peak changes to one profile; 7-day verification report with before/after cost. | CNY 299 |
| **Team** | Up to 5 workspaces or users; per-project attribution; budget policy; 30 days of support. | CNY 999 |
| **Custom plugin** | A scoped DSH plugin or integration, spec agreed upfront. | from CNY 1,500 |

Prices are for the first engagement; repeat work is quoted per scope. Payment after the audit report, before the change window. No savings claim without a measured before/after.

## Process

1. **Free audit.** Run `npx dsh-token-audit --format html --redact --out audit.html` and share the report. `--redact` removes session titles, paths, commands, and file names; keep the numbers. Keep a `--format json` baseline for the comparison.
2. **Scope.** We agree on the target (one profile, one workspace, or a team) and the change list.
3. **Change.** I produce a patch/preset and a rollback path. You apply it; nothing is edited silently.
4. **Verify.** After 7 days, run `dsh-token-audit --format json > after.json` and `dsh-token-audit compare before.json after.json`. Judge cost per call and per successful task, not total cost alone. If the change did not help, roll back.
5. **Report.** A one-page before/after with the remaining levers.

## What I will not do

- Upload or copy your session data anywhere.
- Touch credentials, API keys, or billing accounts.
- Promise a percentage before seeing your logs.
- Keep a change that cannot be rolled back.

## Contact

Open an issue on the repository with the `service` label, or email the address in the repository profile. Include the audit summary (not the raw logs).
