#!/usr/bin/env node
// Build a synthetic, non-private demo report for the repository.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { auditSessions } from '../src/audit.mjs'
import { renderHtml } from '../src/report.mjs'

let seed = 20261031
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = (a) => a[Math.floor(rnd() * a.length)]

const SESSIONS = [
  { title: 'Refactor the parser', calls: 380, base: 90_000, growth: 1_700, out: 900, bash: 0.7 },
  { title: 'Nightly backtest campaign', calls: 520, base: 180_000, growth: 1_100, out: 700, bash: 0.85 },
  { title: 'Fix flaky integration tests', calls: 240, base: 60_000, growth: 2_400, out: 1_100, bash: 0.6 },
  { title: 'Write the migration guide', calls: 160, base: 45_000, growth: 1_300, out: 1_400, bash: 0.2 },
  { title: 'Profile the ingest pipeline', calls: 300, base: 120_000, growth: 900, out: 800, bash: 0.75 },
  { title: 'Review the release diff', calls: 120, base: 35_000, growth: 800, out: 600, bash: 0.3 },
]

const BASH = [
  'cargo test --release 2>&1 | tail -40',
  'psql -h 127.0.0.1 -U postgres -d app -c "select count(*) from runs"',
  'git status --short && git diff --stat',
  'python3 scripts/bench.py --n 5000',
  'tail -n 80 /var/log/app/worker.log',
  'ls -la && du -sh .',
]
const FILES = [
  'src/parser.rs', 'src/engine.rs', 'src/ingest.rs', 'docs/ARCHITECTURE.md',
  'tests/integration.rs', 'scripts/bench.py', 'src/config.rs',
]

function sessionLines(s, index, start) {
  const lines = []
  const push = (o) => lines.push(JSON.stringify(o))
  push({ type: 'session', version: 4, id: `demo-${index + 1}`, createdAt: start, cwd: '/demo/workspace', agentPreset: 'standard' })
  push({ type: 'session/title', time: start, data: { title: s.title } })
  let ctx = s.base
  for (let j = 0; j < s.calls; j++) {
    const time = start + j * 95_000
    // Work happens in bursts; every 90 calls the context is compacted.
    if (j > 0 && j % 90 === 0) {
      push({ type: 'compaction/end', time, data: { freedTokens: Math.round(ctx * 0.55) } })
      ctx = Math.round(ctx * 0.35)
    }
    ctx = Math.min(760_000, ctx + s.growth * (0.5 + rnd()))
    const out = Math.round(s.out * (0.4 + rnd() * 1.6))
    const miss = Math.round(400 + rnd() * 2_500)
    push({
      type: 'assistant/message', time,
      data: {
        usage: { inputTokens: miss, outputTokens: out, cacheReadTokens: ctx, totalTokens: ctx + miss + out },
        message: { id: `m-${index}-${j}`, source: { kind: 'model', provider: 'deepseek', model: 'deepseek-flash' } },
      },
    })
    if (rnd() < 0.55) {
      const callId = `c-${index}-${j}`
      const isBash = rnd() < s.bash
      const name = isBash ? 'bash' : 'read'
      const args = isBash ? { command: pick(BASH) } : { file_path: pick(FILES), offset: 1, limit: 120 }
      push({ type: 'tool/call', time: time + 1_000, data: { turn: 1, step: j, callId, name, arguments: JSON.stringify(args) } })
      const chars = isBash ? Math.round(2_000 + rnd() * 9_000) : Math.round(3_000 + rnd() * 12_000)
      push({ type: 'tool/result', time: time + 2_000, data: { turn: 1, step: j, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: 'x'.repeat(chars) }] } } })
    }
    push({ type: 'turn/start', time: time + 3_000 })
  }
  return lines
}

const dir = await mkdtemp(join(tmpdir(), 'dsh-audit-demo-'))
try {
  const start = Date.UTC(2026, 8, 28, 1, 0, 0) // 2026-09-28 09:00 Beijing
  for (let i = 0; i < SESSIONS.length; i++) {
    const sub = join(dir, `session-demo-${i + 1}`)
    await mkdir(sub, { recursive: true })
    await writeFile(join(sub, 'session.v4.jsonl'), sessionLines(SESSIONS[i], i, start + i * 86400_000).join('\n') + '\n')
  }
  const audit = await auditSessions({ sessions: dir, all: true })
  const html = renderHtml(audit)
  await writeFile(new URL('../docs/demo.html', import.meta.url), html)
  console.log(`demo sessions=${audit.totals.sessions} calls=${audit.totals.calls} cost=CNY ${audit.totals.cost.toFixed(2)} -> docs/demo.html`)
} finally {
  await rm(dir, { recursive: true, force: true })
}
