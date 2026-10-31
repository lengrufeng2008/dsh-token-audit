#!/usr/bin/env node
import { writeFile, readFile, cp, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditSessions, DEFAULT_SESSIONS, formatCny } from '../src/audit.mjs'
import { renderTerminal, renderMarkdown, renderHtml, renderJson } from '../src/report.mjs'
import { compareReports, renderCompareTerminal, renderCompareMarkdown, renderCompareHtml } from '../src/compare.mjs'

const VERSION = '0.2.0'

const HELP = `dsh-token-audit ${VERSION} — find out where your DeepSeek Harness tokens go.

Usage
  dsh-token-audit [options]
  dsh-token-audit compare <before.json> <after.json> [--format html] [--out diff.html]
  dsh-token-audit preset [--out ./dsh-lean-preset] [--threshold 0.45] [--retain 0.07] [--prune 4096]

Options
  --sessions <dir>   Session root (default: $DSH_HOME/sessions or ~/.dsh/sessions)
  --days <n>         Only sessions active in the last n days (default: 30)
  --since <date>     Only calls on/after this Beijing date (YYYY-MM-DD); implies --all
  --until <date>     Only calls on/before this Beijing date (YYYY-MM-DD); implies --all
  --all              Audit every session on disk
  --cwd <text>       Only sessions whose working directory contains <text>
  --session <id>     Only sessions whose id contains <id> (drill into one session)
  --format <fmt>     terminal | markdown | html | json (default: terminal)
  --out <file>       Write the report to a file instead of stdout
  --open             Open an HTML report in the default browser
  --redact           Hide session titles, paths, commands, and file names (for sharing)
  --top <n>          Number of sessions in the terminal table (default: 8)
  --no-color         Disable ANSI colors
  --version          Print the version
  --help             Print this help

Examples
  dsh-token-audit
  dsh-token-audit compare before.json after.json
  dsh-token-audit preset --out ./dsh-lean-preset
  dsh-token-audit --days 7 --format markdown --out report.md
  dsh-token-audit --format html --out dsh-audit.html --open
  dsh-token-audit --all --format json > audit.json

Pricing: official DeepSeek API rates (CNY per million tokens), peak/idle.
Peak = Beijing weekdays 09:00-12:00 and 14:00-18:00, excluding China holidays.
Everything is computed locally; no session data is uploaded.
`

function parseArgs(argv) {
  const opts = { days: 30, format: 'terminal', top: 8, color: true }
  const queue = []
  for (const raw of argv) {
    const eq = raw.indexOf('=')
    if (eq > 0 && raw.startsWith('--')) { queue.push(raw.slice(0, eq), raw.slice(eq + 1)) } else queue.push(raw)
  }
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i]
    const next = () => {
      const v = queue[++i]
      if (v === undefined) throw new Error(`Missing value for ${a}`)
      return v
    }
    switch (a) {
      case '--help': case '-h': opts.help = true; break
      case '--version': case '-v': opts.version = true; break
      case '--sessions': opts.sessions = next(); break
      case '--days': opts.days = Number(next()); break
      case '--since': opts.since = next(); break
      case '--until': opts.until = next(); break
      case '--all': opts.all = true; break
      case '--cwd': opts.cwd = next(); break
      case '--session': opts.session = next(); break
      case '--format': opts.format = next(); break
      case '--out': opts.out = next(); break
      case '--open': opts.open = true; break
      case '--redact': opts.redact = true; break
      case '--top': opts.top = Number(next()); break
      case '--no-color': opts.color = false; break
      default:
        throw new Error(`Unknown option: ${a}`)
    }
  }
  if (!Number.isFinite(opts.days) || opts.days <= 0) throw new Error('--days must be a positive number')
  opts.since = parseDay(opts.since, '--since', false)
  opts.until = parseDay(opts.until, '--until', true)
  if (opts.since && opts.until && opts.since > opts.until) throw new Error('--since must be before --until')
  if (!['terminal', 'markdown', 'md', 'html', 'json'].includes(opts.format)) throw new Error('--format must be terminal, markdown, html, or json')
  return opts
}

function parseDay(value, flag, endOfDay) {
  if (value === undefined) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) throw new Error(`${flag} needs YYYY-MM-DD`)
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 8 * 3600_000
  return endOfDay ? ms + 86400_000 - 1 : ms
}

function inferFormat(opts) {
  if (opts.format !== 'terminal') return opts.format
  if (!opts.out) return 'terminal'
  if (opts.out.endsWith('.html') || opts.out.endsWith('.htm')) return 'html'
  if (opts.out.endsWith('.md') || opts.out.endsWith('.markdown')) return 'markdown'
  if (opts.out.endsWith('.json')) return 'json'
  return 'terminal'
}

async function main() {
  if (process.argv[2] === 'compare') return compareMain(process.argv.slice(3))
  if (process.argv[2] === 'preset') return presetMain(process.argv.slice(3))
  let opts
  try { opts = parseArgs(process.argv.slice(2)) } catch (e) {
    console.error(`dsh-token-audit: ${e.message}\n`)
    console.error(HELP)
    process.exit(2)
  }
  if (opts.help) { process.stdout.write(HELP); return }
  if (opts.version) { process.stdout.write(`${VERSION}\n`); return }

  const root = opts.sessions ?? DEFAULT_SESSIONS
  const format = inferFormat(opts)
  const interactive = process.stderr.isTTY && format !== 'json'

  if (interactive) process.stderr.write(`Scanning ${root} ...\n`)
  let last = 0
  const audit = await auditSessions({
    sessions: root,
    days: opts.days,
    all: opts.all || Boolean(opts.since || opts.until),
    cwd: opts.cwd,
    session: opts.session,
    since: opts.since,
    until: opts.until,
    redact: opts.redact,
    onProgress: (i, n) => {
      if (!interactive) return
      const now = Date.now()
      if (now - last < 120) return
      last = now
      process.stderr.write(`\r  ${i}/${n} files`)
    },
  })
  if (interactive) process.stderr.write('\r' + ' '.repeat(30) + '\r')

  if (!audit.totals.sessions) {
    console.error(`No sessions found in ${root}. Pass --sessions <dir> or run a DSH session first.`)
    process.exit(1)
  }

  let output
  if (format === 'html') output = renderHtml(audit)
  else if (format === 'markdown' || format === 'md') output = renderMarkdown(audit)
  else if (format === 'json') output = renderJson(audit)
  else output = renderTerminal(audit, { color: opts.color && process.stdout.isTTY, top: opts.top })

  if (opts.out) {
    await writeFile(opts.out, output, 'utf8')
    const t = audit.totals
    console.log(`Wrote ${opts.out}  ·  ${formatCny(t.cost)} over ${t.days} active days  ·  ${formatCny(t.projectedMonthly)}/month projected`)
    if (opts.open && format === 'html') openPath(opts.out)
  } else {
    process.stdout.write(output)
  }
}

function openPath(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  try {
    const child = spawn(cmd, [file], { stdio: 'ignore', detached: true })
    child.unref()
  } catch {
    // Opening is best-effort; the file path was already printed.
  }
}

main().catch((e) => {
  console.error(`dsh-token-audit: ${e.stack || e.message}`)
  process.exit(1)
})

async function compareMain(argv) {
  const files = []
  let format = 'terminal'
  let out
  let color = true
  const queue = []
  for (const raw of argv) {
    const eq = raw.indexOf('=')
    if (eq > 0 && raw.startsWith('--')) { queue.push(raw.slice(0, eq), raw.slice(eq + 1)) } else queue.push(raw)
  }
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i]
    if (a === '--format') format = queue[++i]
    else if (a === '--out') out = queue[++i]
    else if (a === '--no-color') color = false
    else if (a === '--help' || a === '-h') { process.stdout.write(HELP); return }
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`)
    else files.push(a)
  }
  if (files.length !== 2) throw new Error('compare needs exactly two JSON reports: before.json after.json')
  let before, after
  try {
    before = JSON.parse(await readFile(files[0], 'utf8'))
    after = JSON.parse(await readFile(files[1], 'utf8'))
  } catch (e) {
    throw new Error(`cannot read report: ${e.message}`)
  }
  if (format === 'terminal' && out) {
    if (out.endsWith('.html')) format = 'html'
    else if (out.endsWith('.md')) format = 'markdown'
    else if (out.endsWith('.json')) format = 'json'
  }
  const c = compareReports(before, after)
  const text = format === 'html' ? renderCompareHtml(c)
    : format === 'markdown' || format === 'md' ? renderCompareMarkdown(c)
    : format === 'json' ? JSON.stringify(c, null, 2)
    : renderCompareTerminal(c, { color: color && process.stdout.isTTY })
  if (out) {
    await writeFile(out, text, 'utf8')
    console.log(`Wrote ${out}`)
  } else {
    process.stdout.write(text)
  }
}

async function presetMain(argv) {
  const opts = { out: './dsh-lean-preset', threshold: 0.45, retain: 0.07, prune: 4096, head: 2048, tail: 512, force: false }
  const queue = []
  for (const raw of argv) {
    const eq = raw.indexOf('=')
    if (eq > 0 && raw.startsWith('--')) { queue.push(raw.slice(0, eq), raw.slice(eq + 1)) } else queue.push(raw)
  }
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i]
    const next = () => {
      const v = queue[++i]
      if (v === undefined) throw new Error(`Missing value for ${a}`)
      return v
    }
    if (a === '--out') opts.out = next()
    else if (a === '--threshold') opts.threshold = Number(next())
    else if (a === '--retain') opts.retain = Number(next())
    else if (a === '--prune') opts.prune = Number(next())
    else if (a === '--head') opts.head = Number(next())
    else if (a === '--tail') opts.tail = Number(next())
    else if (a === '--force') opts.force = true
    else if (a === '--help' || a === '-h') { process.stdout.write(HELP); return }
    else throw new Error(`Unknown option: ${a}`)
  }
  if (!(opts.threshold > 0.2 && opts.threshold < 0.75)) throw new Error('--threshold must be between 0.2 and 0.75')
  if (!(opts.retain > 0.01 && opts.retain < opts.threshold)) throw new Error('--retain must be between 0.01 and --threshold')
  if (!(opts.prune >= 1024 && opts.prune <= 16384)) throw new Error('--prune must be between 1024 and 16384 chars')
  if (!(opts.head >= 256 && opts.head < opts.prune)) throw new Error('--head must be at least 256 and below --prune')
  if (!(opts.tail >= 64 && opts.tail < opts.prune)) throw new Error('--tail must be at least 64 and below --prune')

  const here = dirname(fileURLToPath(import.meta.url))
  const template = join(here, '..', 'templates', 'lean-preset')
  const out = resolve(opts.out)
  if (!opts.force) {
    try { await access(out); throw new Error(`${out} already exists; pass --force to overwrite`) } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
  await cp(template, out, { recursive: true, force: opts.force })
  const patchPath = join(out, 'cordis.patch.yml')
  let patch = await readFile(patchPath, 'utf8')
  patch = patch
    .replaceAll('{{threshold}}', String(opts.threshold))
    .replaceAll('{{retain}}', String(opts.retain))
    .replaceAll('{{prune}}', String(opts.prune))
    .replaceAll('{{head}}', String(opts.head))
    .replaceAll('{{tail}}', String(opts.tail))
  await writeFile(patchPath, patch, 'utf8')
  console.log(`Wrote ${out}`)
  console.log('')
  console.log('Install on the web profile:')
  console.log(`  dsh plugin --profile web add ${out}`)
  console.log('Restart DSH, then choose "Lean" as the agent preset for a new session.')
  console.log('')
  console.log('Verify with:')
  console.log('  dsh-token-audit --format json > before.json   # before switching')
  console.log('  dsh-token-audit --format json > after.json    # after a week of Lean')
  console.log('  dsh-token-audit compare before.json after.json')
}
