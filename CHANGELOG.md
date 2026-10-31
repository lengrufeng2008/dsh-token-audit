# Changelog

## 0.2.0 — 2026-10-31

- `compare` subcommand: before/after reports with cost-per-call verdict.
- `preset` subcommand: generate an installable Lean preset from a template.
- `--redact` for shareable reports (titles, paths, commands, file names).
- Cost by workspace attribution.
- Report attribution footer and demo report.
- Plugin tool gains a `redact` option; package root now exports the plugin.
- Tests: 5.

## 0.1.0 — 2026-10-31

- Initial audit CLI for DSH session logs.
- Official DeepSeek peak/idle pricing, per-call cost, context distribution,
  tool-output volume, ranked savings plan.
- Terminal, Markdown, HTML, and JSON reports.
- DSH bundle with a read-only `token_audit` tool.
