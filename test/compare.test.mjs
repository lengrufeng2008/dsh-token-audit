import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareReports, renderCompareTerminal } from '../src/compare.mjs'

const report = (o) => ({
  totals: {
    sessions: o.s, calls: o.c, cost: o.cost, days: 10, avgCtx: o.ctx,
    peakCost: o.peak, hitCost: o.cost * 0.5, missCost: o.cost * 0.12, outCost: o.cost * 0.38,
    hitCostShare: 0.5, outCostShare: 0.38,
  },
  contextBuckets: [{ min: 0, calls: o.low }, { min: 200_000, calls: o.high }],
})

test('compareReports computes per-call delta and verdict', () => {
  const c = compareReports(
    report({ s: 100, c: 10000, cost: 500, ctx: 300000, peak: 200, low: 1000, high: 9000 }),
    report({ s: 60, c: 9000, cost: 350, ctx: 180000, peak: 70, low: 6000, high: 3000 }),
  )
  const perCall = c.rows.find((r) => r.key === 'costPerCall')
  assert.ok(Math.abs(perCall.pct - (-22.222)) < 0.01)
  assert.match(c.verdict, /real/)
  assert.match(renderCompareTerminal(c, { color: false }), /Verdict/)
})

test('compareReports refuses a zero-call baseline', () => {
  assert.throws(() => compareReports({ totals: { cost: 0, calls: 0 } }, report({ s: 1, c: 1, cost: 1, ctx: 1, peak: 0, low: 1, high: 0 })))
})
