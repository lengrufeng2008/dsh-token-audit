// Before/after comparison for two `dsh-token-audit --format json` reports.
import { formatCny, formatTokens } from './audit.mjs'

const pct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`
const pp = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}pp`

function metrics(r) {
  const t = r?.totals
  if (!t || typeof t.cost !== 'number' || !t.calls) throw new Error('not a dsh-token-audit JSON report (missing totals.calls)')
  const above200 = (r.contextBuckets ?? [])
    .filter((b) => b.min >= 200_000)
    .reduce((a, b) => a + b.calls, 0) / t.calls
  return {
    days: t.days,
    sessions: t.sessions,
    calls: t.calls,
    cost: t.cost,
    costPerDay: t.cost / Math.max(t.days, 1),
    costPerCall: t.cost / t.calls,
    costPerSession: t.cost / Math.max(t.sessions, 1),
    avgCtx: t.avgCtx,
    peakShare: t.cost ? t.peakCost / t.cost : 0,
    above200,
    outShare: t.outCostShare ?? 0,
    cacheShare: t.hitCostShare ?? 0,
  }
}

function pair(before, after, format, lowerIsBetter = true) {
  const abs = after - before
  const p = before ? (abs / before) * 100 : null
  return { before, after, abs, pct: p, format, lowerIsBetter }
}

export function compareReports(beforeReport, afterReport) {
  const b = metrics(beforeReport)
  const a = metrics(afterReport)
  const rows = [
    { key: 'days', label: 'Active days', ...pair(b.days, a.days, String) },
    { key: 'sessions', label: 'Sessions', ...pair(b.sessions, a.sessions, String) },
    { key: 'calls', label: 'Model calls', ...pair(b.calls, a.calls, (v) => v.toLocaleString()) },
    { key: 'cost', label: 'Total cost', ...pair(b.cost, a.cost, formatCny) },
    { key: 'costPerDay', label: 'Cost / active day', ...pair(b.costPerDay, a.costPerDay, formatCny) },
    { key: 'costPerCall', label: 'Cost / call', ...pair(b.costPerCall, a.costPerCall, (v) => `CNY ${v.toFixed(4)}`) },
    { key: 'costPerSession', label: 'Cost / session', ...pair(b.costPerSession, a.costPerSession, formatCny) },
    { key: 'avgCtx', label: 'Avg context', ...pair(b.avgCtx, a.avgCtx, formatTokens) },
    { key: 'peakShare', label: 'Peak-hour share', ...pair(b.peakShare, a.peakShare, (v) => `${(v * 100).toFixed(1)}%`, ) },
    { key: 'above200', label: 'Calls >200k context', ...pair(b.above200, a.above200, (v) => `${(v * 100).toFixed(1)}%`) },
    { key: 'cacheShare', label: 'Cache-read share', ...pair(b.cacheShare, a.cacheShare, (v) => `${(v * 100).toFixed(1)}%`) },
    { key: 'outShare', label: 'Output share', ...pair(b.outShare, a.outShare, (v) => `${(v * 100).toFixed(1)}%`) },
  ]
  // Cost metrics are the verdict; volume metrics explain the cost.
  const perCall = rows.find((r) => r.key === 'costPerCall')
  const callDelta = rows.find((r) => r.key === 'calls')
  let verdict
  if (perCall.pct === null) {
    verdict = 'Before report has zero calls; cannot compare.'
  } else if (perCall.pct < -3 && (callDelta.pct ?? 0) > -20) {
    verdict = `Cost per call fell ${Math.abs(perCall.pct).toFixed(1)}% with work volume roughly stable or higher — the change is real.`
  } else if (perCall.pct < -3 && (callDelta.pct ?? 0) <= -20) {
    verdict = `Total cost fell, but ${Math.abs(callDelta.pct).toFixed(1)}% of that is less work. Cost per call also fell ${Math.abs(perCall.pct).toFixed(1)}%.`
  } else if (perCall.pct > 3) {
    verdict = `Cost per call rose ${perCall.pct.toFixed(1)}% — investigate before keeping the change.`
  } else {
    verdict = 'Cost per call is within ±3%; the change is not distinguishable from noise.'
  }
  return {
    before: b,
    after: a,
    rows,
    verdict,
    generatedAt: new Date().toISOString(),
  }
}

export function renderCompareTerminal(c, { color = true } = {}) {
  const cc = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
  const lines = [cc('1', 'DSH Token Audit — before / after'), '']
  lines.push(`  ${'Metric'.padEnd(26)} ${'before'.padStart(13)} ${'after'.padStart(13)} ${'delta'.padStart(12)}`)
  for (const r of c.rows) {
    const abs = r.key.endsWith('Share') || r.key === 'above200'
      ? pp((r.after - r.before) * 100)
      : (r.pct === null ? 'n/a' : pct(r.pct))
    lines.push(`  ${r.label.padEnd(26)} ${r.format(r.before).padStart(13)} ${r.format(r.after).padStart(13)} ${abs.padStart(12)}`)
  }
  lines.push('')
  lines.push(`  ${cc('1', 'Verdict')}  ${c.verdict}`)
  lines.push('')
  lines.push(cc('2', '  Compare cost per call, not just total: a cheaper week with half the work is not a win.'))
  return `${lines.join('\n')}\n`
}

export function renderCompareMarkdown(c) {
  const rows = c.rows.map((r) => {
    const d = r.key.endsWith('Share') || r.key === 'above200'
      ? pp((r.after - r.before) * 100)
      : (r.pct === null ? 'n/a' : pct(r.pct))
    return `| ${r.label} | ${r.format(r.before)} | ${r.format(r.after)} | ${d} |`
  })
  return [
    '# DSH Token Audit — before / after',
    '',
    '| Metric | Before | After | Delta |',
    '|---|---:|---:|---:|',
    ...rows,
    '',
    `**Verdict:** ${c.verdict}`,
    '',
    'Compare cost per call, not just total: a cheaper week with half the work is not a win.',
    '',
    'Generated by [dsh-token-audit](https://www.npmjs.com/package/dsh-token-audit).',
    '',
  ].join('\n')
}

export function renderCompareHtml(c) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  const rows = c.rows.map((r) => {
    const isShare = r.key.endsWith('Share') || r.key === 'above200'
    const deltaText = isShare ? pp((r.after - r.before) * 100) : (r.pct === null ? 'n/a' : pct(r.pct))
    const good = isShare ? r.after < r.before : (r.pct !== null && r.pct < 0)
    const cls = r.pct === null ? '' : good ? 'good' : (r.pct > 3 ? 'bad' : '')
    return `<tr><td>${esc(r.label)}</td><td class="num">${esc(r.format(r.before))}</td><td class="num">${esc(r.format(r.after))}</td><td class="num ${cls}">${esc(deltaText)}</td></tr>`
  }).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Token Audit — before / after</title>
<style>body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;background:#f8fafc}.wrap{max-width:900px;margin:0 auto;padding:32px 20px}header{background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff;border-radius:14px;padding:24px 28px;margin-bottom:18px}h1{margin:0;font-size:22px}header p{margin:6px 0 0;color:#c7d2fe}.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:9px 8px;border-bottom:1px solid #eef2f7;text-align:left}th{color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em}.num{text-align:right;font-variant-numeric:tabular-nums}.good{color:#047857;font-weight:600}.bad{color:#b91c1c;font-weight:600}.verdict{margin-top:16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px;color:#065f46}.note{color:#64748b;font-size:12px;margin-top:14px}</style></head><body><div class="wrap">
<header><h1>DSH Token Audit — before / after</h1><p>Compare cost per call, not just the total.</p></header>
<div class="card"><table><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Delta</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="verdict"><strong>Verdict:</strong> ${esc(c.verdict)}</div>
<p class="note">Generated by dsh-token-audit · npx dsh-token-audit compare before.json after.json</p>
</div></body></html>`
}
