import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { auditSessions } from '../src/audit.mjs'
import { isPeak, callCost } from '../src/pricing.mjs'

// 2026-10-31 20:00 Beijing = 12:00Z (Saturday, idle).
const IDLE = Date.UTC(2026, 9, 31, 12, 0, 0)
// 2026-11-02 10:00 Beijing = 02:00Z (Monday, peak).
const PEAK = Date.UTC(2026, 10, 2, 2, 0, 0)

test('peak schedule', () => {
  assert.equal(isPeak(IDLE), false)
  assert.equal(isPeak(PEAK), true)
  // Saturday 10:00 Beijing is idle.
  assert.equal(isPeak(Date.UTC(2026, 9, 31, 2, 0, 0)), false)
  // National Day 2026-10-05 10:00 Beijing is a holiday.
  assert.equal(isPeak(Date.UTC(2026, 9, 5, 2, 0, 0)), false)
})

test('call cost uses peak and idle rates', () => {
  assert.equal(callCost({ hit: 1_000_000, miss: 0, out: 0 }, 'deepseek-flash', IDLE), 0.02)
  assert.equal(callCost({ hit: 1_000_000, miss: 0, out: 0 }, 'deepseek-flash', PEAK), 0.04)
  assert.equal(callCost({ hit: 0, miss: 1_000_000, out: 0 }, 'deepseek-v4-pro', IDLE), 4.5)
})

test('audit aggregates a synthetic session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
  try {
    const lines = [
      { type: 'session', id: 's-demo', createdAt: IDLE, cwd: '/tmp/demo' },
      { type: 'session/title', data: { title: 'Demo' } },
      { type: 'turn/start', time: IDLE },
      {
        type: 'assistant/message', time: IDLE,
        data: { usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50000 }, message: { id: 'm1', source: { model: 'deepseek-flash' } } },
      },
      { type: 'tool/call', time: IDLE, data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } },
      { type: 'tool/result', time: IDLE, data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'hello' }] } } },
      {
        type: 'assistant/message', time: PEAK,
        data: { usage: { inputTokens: 0, outputTokens: 100, cacheReadTokens: 100000 }, message: { id: 'm2', source: { model: 'deepseek-flash' } } },
      },
      { type: 'compaction/end', time: PEAK },
      { type: 'turn/start', time: PEAK },
    ]
    await writeFile(join(dir, 'session.v4.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    const audit = await auditSessions({ sessions: dir, all: true })
    assert.equal(audit.totals.sessions, 1)
    assert.equal(audit.totals.calls, 2)
    assert.equal(audit.totals.turns, 2)
    assert.equal(audit.totals.compactions, 1)
    assert.equal(audit.totals.hit, 150000)
    assert.equal(audit.totals.miss, 1000)
    assert.equal(audit.totals.out, 300)
    // 0.0028 idle + 0.0048 peak = 0.0076
    assert.ok(Math.abs(audit.totals.cost - 0.0076) < 1e-9, `cost ${audit.totals.cost}`)
    assert.equal(audit.topSessions[0].title, 'Demo')
    assert.equal(audit.readCounts.length, 0)
    assert.equal(audit.toolVolume[0][0], 'bash')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
