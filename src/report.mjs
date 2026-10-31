// Renderers for dsh-token-audit.
import { formatCny, formatTokens } from './audit.mjs'

const pct = (x) => `${(x * 100).toFixed(1)}%`
const day = (n) => new Date(n + 8 * 3600_000).toISOString().slice(0, 10)
const short = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const bucketLabel = (buckets, i) => {
  const b = buckets[i]
  const next = buckets[i + 1]
  return next ? `${formatTokens(b.min)}–${formatTokens(next.min)}` : `${formatTokens(b.min)}+`
}

export function renderTerminal(a, { color = true, top = 8 } = {}) {
  if (!a.totals.sessions) return 'No DSH sessions found. Pass --sessions <dir> or run a session first.\n'
  const t = a.totals
  const lines = []
  const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
  lines.push(c('1', 'DSH Token Audit'))
  lines.push(`  ${a.root}`)
  lines.push('')
  lines.push(`  Window      ${day(t.start)} → ${day(t.end)}  (${t.days} active days)`)
  lines.push(`  Sessions    ${t.sessions}  ·  ${t.calls.toLocaleString()} model calls`)
  lines.push(`  Total       ${c('1;32', formatCny(t.cost))}  ·  ${formatCny(t.avgPerDay)}/day  ·  ${formatCny(t.projectedMonthly)}/month projected`)
  lines.push('')
  lines.push('  Cost split')
  lines.push(`    cache read   ${formatCny(a.totals.hitCost).padStart(12)}  ${bar(t.hitCostShare)} ${pct(t.hitCostShare)}`)
  lines.push(`    output       ${formatCny(a.totals.outCost).padStart(12)}  ${bar(t.outCostShare)} ${pct(t.outCostShare)}`)
  lines.push(`    cache miss   ${formatCny(a.totals.missCost).padStart(12)}  ${bar(t.missCostShare)} ${pct(t.missCostShare)}`)
  lines.push(`    peak hours   ${formatCny(t.peakCost).padStart(12)}  ${bar(t.peakCost / t.cost)} ${pct(t.peakCost / t.cost)}`)
  lines.push('')
  lines.push(c('1', '  Top sessions'))
  for (const s of a.topSessions.slice(0, top)) {
    const when = day(s.start || s.end)
    const id = /^[0-9a-f]{8}/i.test(s.id) ? `  ${s.id.slice(0, 8)}` : ''
    lines.push(`    ${formatCny(s.cost).padStart(11)}  ${String(s.calls).padStart(5)} calls  max ${formatTokens(s.maxCtx).padStart(6)}  ${when}  ${short(s.title || s.cwd || s.id, 48)}${id}`)
  }
  if (!a.redacted && a.byWorkspace?.length) {
    lines.push('')
    lines.push(c('1', '  Cost by workspace'))
    for (const [ws, w] of a.byWorkspace.slice(0, 5)) {
      lines.push(`    ${formatCny(w.cost).padStart(11)}  ${String(w.sessions).padStart(3)} sess  ${String(w.calls).padStart(5)} calls  ${short(ws, 58)}`)
    }
  }
  lines.push('')
  lines.push(c('1', '  Context distribution'))
  for (let i = 0; i < a.contextBuckets.length; i++) {
    const b = a.contextBuckets[i]
    const label = bucketLabel(a.contextBuckets, i).padEnd(12)
    lines.push(`    ${label} ${String(b.calls).padStart(6)} calls  ${bar(b.calls / t.calls, 24)}`)
  }
  if (a.toolVolume.length) {
    lines.push('')
    lines.push(c('1', '  Tool output entering context'))
    const totalChars = a.toolVolume.reduce((x, [, v]) => x + v, 0)
    for (const [name, chars] of a.toolVolume.slice(0, 5)) {
      lines.push(`    ${name.padEnd(12)} ${(chars / 1e6).toFixed(1).padStart(7)}M chars  ${bar(chars / totalChars, 18)} ${pct(chars / totalChars)}`)
    }
    if (a.readCounts.length) {
      lines.push('')
      lines.push(c('1', '  Most re-read files'))
      for (const [path, n] of a.readCounts.slice(0, 3)) lines.push(`    ${String(n).padStart(4)}x  ${short(path, 70)}`)
    }
  }
  lines.push('')
  lines.push(c('1', '  Savings plan') + c('2', '  (gross; combined overlaps, behavior unchanged)'))
  for (const r of a.savings.caps.filter((x) => [100_000, 150_000, 200_000, 250_000, 300_000].includes(x.cap))) {
    lines.push(`    context cap ${String(r.cap / 1000).padStart(3)}k   save ${formatCny(r.save).padStart(11)}  ${pct(r.pct / 100)}`)
  }
  for (const r of a.savings.output.filter((x) => x.reduce === 0.2)) {
    lines.push(`    output      -20%   save ${formatCny(r.save).padStart(11)}  ${pct(r.pct / 100)}`)
  }
  for (const r of a.savings.offPeak.filter((x) => x.shift === 0.4)) {
    lines.push(`    off-peak     40%   save ${formatCny(r.save).padStart(11)}  ${pct(r.pct / 100)}`)
  }
  const combined = a.savings.combined
  lines.push(`    ${c('1', 'combined lean')}       save ${c('32', formatCny(combined.capSave + combined.outputSave + combined.offPeakSave).padStart(11))}`)
  lines.push('')
  lines.push(c('1', '  What to do first'))
  for (const r of a.recommendations) {
    lines.push(`    • ${r.text}`)
  }
  lines.push('')
  lines.push(c('2', '  Estimates use official DeepSeek pricing (peak/idle) and assume behavior is unchanged.'))
  if (a.redacted) lines.push(c('2', '  Redacted: session titles, paths, commands, and file names were removed.'))
  lines.push(c('2', '  Local-only: this tool never uploads session data.'))
  lines.push(c('2', '  dsh-token-audit · https://www.npmjs.com/package/dsh-token-audit'))
  return `${lines.join('\n')}\n`
}

function bar(ratio, width = 18) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)))
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}]`
}

export function renderMarkdown(a) {
  const t = a.totals
  if (!t.sessions) return '# DSH Token Audit\n\nNo sessions found.\n'
  const rows = [
    `# DSH Token Audit`,
    '',
    `**Window:** ${day(t.start)} → ${day(t.end)} (${t.days} active days) · **Sessions:** ${t.sessions} · **Calls:** ${t.calls.toLocaleString()}`,
    '',
    `## Total: ${formatCny(t.cost)} (${formatCny(t.avgPerDay)}/day, ${formatCny(t.projectedMonthly)}/month projected)`,
    '',
    '| Component | Cost | Share |',
    '|---|---:|---:|',
    `| Cache read | ${formatCny(a.totals.hitCost)} | ${pct(a.totals.hitCostShare)} |`,
    `| Output | ${formatCny(a.totals.outCost)} | ${pct(a.totals.outCostShare)} |`,
    `| Cache miss | ${formatCny(a.totals.missCost)} | ${pct(a.totals.missCostShare)} |`,
    `| Peak hours | ${formatCny(t.peakCost)} | ${pct(t.peakCost / t.cost)} |`,
    '',
    '## Top sessions',
    '',
    '| Cost | Calls | Max context | Date | Session |',
    '|---:|---:|---:|---|---|',
    ...a.topSessions.slice(0, 10).map((s) => `| ${formatCny(s.cost)} | ${s.calls} | ${formatTokens(s.maxCtx)} | ${day(s.start || s.end)} | ${(s.title || s.cwd || s.id).replace(/\|/g, '\\|').slice(0, 70)} |`),
    '',
    ...(a.byWorkspace?.length && !a.redacted ? [
      '## Cost by workspace',
      '',
      '| Cost | Sessions | Calls | Workspace |',
      '|---:|---:|---:|---|',
      ...a.byWorkspace.slice(0, 8).map(([ws, w]) => `| ${formatCny(w.cost)} | ${w.sessions} | ${w.calls} | ${ws.replace(/\|/g, '\\|')} |`),
      '',
    ] : []),
    '## Context distribution',
    '',
    '| Context | Calls |',
    '|---|---:|',
    ...a.contextBuckets.map((b, i) => `| ${bucketLabel(a.contextBuckets, i)} | ${b.calls} |`),
    '',
    '## Tool output entering context',
    '',
    '| Tool | Characters | Share |',
    '|---|---:|---:|',
    ...a.toolVolume.slice(0, 8).map(([name, chars]) => `| ${name} | ${(chars / 1e6).toFixed(1)}M | ${pct(chars / Math.max(a.toolVolume.reduce((x, [, v]) => x + v, 0), 1))} |`),
    '',
    '## Most re-read files',
    '',
    ...a.readCounts.slice(0, 8).map(([p, n]) => `- ${n}× \`${p}\``),
    '',
    '## Savings plan (gross)',
    '',
    '| Change | Saving | % of bill |',
    '|---|---:|---:|',
    ...a.savings.caps.filter((x) => [100_000, 150_000, 200_000, 250_000, 300_000].includes(x.cap)).map((r) => `| Context cap ${r.cap / 1000}k | ${formatCny(r.save)} | ${pct(r.pct / 100)} |`),
    ...a.savings.output.filter((x) => x.reduce === 0.2).map((r) => `| Output -20% | ${formatCny(r.save)} | ${pct(r.pct / 100)} |`),
    ...a.savings.offPeak.filter((x) => x.shift === 0.4).map((r) => `| Off-peak 40% | ${formatCny(r.save)} | ${pct(r.pct / 100)} |`),
    '',
    '## Recommendations',
    '',
    ...a.recommendations.map((r) => `- ${r.text}`),
    '',
    '---',
    '',
    'Estimates use official DeepSeek pricing (peak/idle) and assume behavior is unchanged. Generated locally; no session data left this machine.',
    '',
    a.redacted ? 'Redacted: session titles, paths, commands, and file names were removed.' : '',
    '',
    'Generated by [dsh-token-audit](https://www.npmjs.com/package/dsh-token-audit).',
    '',
  ]
  return rows.join('\n')
}

export function renderHtml(a) {
  const t = a.totals
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  const pctw = (x) => `${Math.max(0, Math.min(100, x * 100)).toFixed(1)}%`
  const maxDay = Math.max(...a.byDay.map(([, v]) => v), 0.001)
  const totalSave = a.savings.combined.capSave + a.savings.combined.outputSave + a.savings.combined.offPeakSave
  const sessionRows = a.topSessions.slice(0, 12).map((s) => `<tr><td class="num">${formatCny(s.cost)}</td><td class="num">${s.calls}</td><td class="num">${formatTokens(s.maxCtx)}</td><td>${day(s.start || s.end)}</td><td class="path">${esc(s.title || s.cwd || s.id)}</td></tr>`).join('')
  const dayBars = a.byDay.slice(-30).map(([d, v]) => `<div class="daybar" title="${d}: ${formatCny(v)}"><div style="height:${Math.max(2, (v / maxDay) * 100)}%"></div><span>${d.slice(5)}</span></div>`).join('')
  const ctxRows = a.contextBuckets.map((b, i) => `<div class="row"><span class="lbl">${bucketLabel(a.contextBuckets, i)}</span><span class="track"><i style="width:${pctw(b.calls / Math.max(t.calls, 1))}"></i></span><span class="num">${b.calls.toLocaleString()}</span></div>`).join('')
  const saveRows = [
    ...a.savings.caps.filter((x) => [100_000, 150_000, 200_000, 250_000, 300_000].includes(x.cap)).map((r) => `<tr><td>Context cap ${r.cap / 1000}k</td><td class="num save">${formatCny(r.save)}</td><td class="num">${pct(r.pct / 100)}</td></tr>`),
    ...a.savings.output.filter((x) => x.reduce === 0.2).map((r) => `<tr><td>Output tokens −20%</td><td class="num save">${formatCny(r.save)}</td><td class="num">${pct(r.pct / 100)}</td></tr>`),
    ...a.savings.offPeak.filter((x) => x.shift === 0.4).map((r) => `<tr><td>Shift 40% of peak work to off-peak</td><td class="num save">${formatCny(r.save)}</td><td class="num">${pct(r.pct / 100)}</td></tr>`),
  ].join('')
  const recs = a.recommendations.map((r, i) => `<div class="rec"><span class="idx">${i + 1}</span><p>${esc(r.text)}</p>${r.saving ? `<span class="pill">up to ${formatCny(r.saving)}</span>` : ''}</div>`).join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Token Audit — ${day(t.start)} to ${day(t.end)}</title>
<style>
:root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff;--blue:#2563eb;--green:#059669;--amber:#d97706;--red:#dc2626}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--bg)}
.wrap{max-width:1040px;margin:0 auto;padding:32px 20px 64px}
header{background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff;border-radius:16px;padding:28px 30px;margin-bottom:20px}
header h1{margin:0 0 6px;font-size:24px;letter-spacing:-.02em}header p{margin:0;color:#c7d2fe;font-size:14px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.kpi .v{font-size:22px;font-weight:700;letter-spacing:-.02em}.kpi .l{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
.card h2{margin:0 0 14px;font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.row{display:flex;align-items:center;gap:10px;margin:8px 0;font-size:13px}
.lbl{width:90px;color:var(--muted)}.track{flex:1;height:10px;background:#eef2f7;border-radius:6px;overflow:hidden}.track i{display:block;height:100%;background:var(--blue);border-radius:6px}
.num{font-variant-numeric:tabular-nums;text-align:right}
.save{color:var(--green);font-weight:600}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td.path{color:var(--muted);max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.days{display:flex;align-items:flex-end;gap:4px;height:110px;padding-top:8px}
.daybar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;position:relative}
.daybar>div{background:linear-gradient(180deg,#60a5fa,#2563eb);border-radius:3px 3px 0 0;min-height:2px}
.daybar span{position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:9px;color:var(--muted);white-space:nowrap}
.card.days-card{padding-bottom:30px}
.rec{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}.rec:last-child{border:0}
.rec .idx{width:22px;height:22px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:700;display:grid;place-items:center;flex:none;margin-top:2px}
.rec p{margin:0;flex:1;font-size:13px}.pill{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:999px;padding:2px 8px;font-size:11px;white-space:nowrap;align-self:center}
.note{color:var(--muted);font-size:12px;margin-top:18px}
@media(max-width:760px){.kpis,.grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){.kpis,.grid{grid-template-columns:1fr}}
@media print{body{background:#fff}.wrap{max-width:none}header{background:#0f172a !important;-webkit-print-color-adjust:exact}}
</style></head><body><div class="wrap">
<header><h1>DSH Token Audit</h1><p>${day(t.start)} → ${day(t.end)} · ${t.sessions} sessions · ${t.calls.toLocaleString()} model calls · generated ${a.generatedAt.slice(0, 10)}</p></header>
<div class="kpis">
<div class="kpi"><div class="l">Total cost</div><div class="v">${formatCny(t.cost)}</div></div>
<div class="kpi"><div class="l">Per active day</div><div class="v">${formatCny(t.avgPerDay)}</div></div>
<div class="kpi"><div class="l">Projected / month</div><div class="v">${formatCny(t.projectedMonthly)}</div></div>
<div class="kpi"><div class="l">Lean-mode saving</div><div class="v" style="color:var(--green)">${formatCny(totalSave)}</div></div>
</div>
<div class="grid">
<div class="card"><h2>Where the money went</h2>
<div class="row"><span class="lbl">Cache read</span><span class="track"><i style="width:${pctw(a.totals.hitCostShare)}"></i></span><span class="num">${formatCny(a.totals.hitCost)}</span></div>
<div class="row"><span class="lbl">Output</span><span class="track"><i style="width:${pctw(a.totals.outCostShare)};background:#059669"></i></span><span class="num">${formatCny(a.totals.outCost)}</span></div>
<div class="row"><span class="lbl">Cache miss</span><span class="track"><i style="width:${pctw(a.totals.missCostShare)};background:#d97706"></i></span><span class="num">${formatCny(a.totals.missCost)}</span></div>
<div class="row"><span class="lbl">Peak hours</span><span class="track"><i style="width:${pctw(t.peakCost / t.cost)};background:#dc2626"></i></span><span class="num">${formatCny(t.peakCost)}</span></div>
<p class="note">Cache read is ${pct(a.totals.hitCostShare)} of spend; each extra 100k tokens of context is re-read on every call.</p></div>
<div class="card"><h2>Context pressure</h2>${ctxRows}<p class="note">${((a.contextBuckets.filter((b) => b.min >= 200_000).reduce((x, b) => x + b.calls, 0) / Math.max(t.calls, 1)) * 100).toFixed(0)}% of calls ran above 200k context.</p></div>
</div>
<div class="card days-card"><h2>Daily cost (last ${Math.min(30, a.byDay.length)} days)</h2><div class="days">${dayBars}</div></div>
<div class="grid" style="margin-top:16px">
<div class="card"><h2>Top sessions</h2><table><thead><tr><th>Cost</th><th>Calls</th><th>Max ctx</th><th>Date</th><th>Session</th></tr></thead><tbody>${sessionRows}</tbody></table></div>
<div class="card"><h2>Savings plan (gross)</h2><table><thead><tr><th>Change</th><th>Saving</th><th>%</th></tr></thead><tbody>${saveRows}</tbody></table><p class="note">Estimates assume behavior is unchanged. Context caps trade memory for money; validate quality before adopting.</p></div>
</div>
${a.byWorkspace?.length && !a.redacted ? `<div class="card" style="margin-bottom:16px"><h2>Cost by workspace</h2><table><thead><tr><th>Cost</th><th>Sessions</th><th>Calls</th><th>Workspace</th></tr></thead><tbody>${a.byWorkspace.slice(0, 8).map(([ws, w]) => `<tr><td class="num">${formatCny(w.cost)}</td><td class="num">${w.sessions}</td><td class="num">${w.calls}</td><td class="path">${esc(ws)}</td></tr>`).join('')}</tbody></table></div>` : ''}
<div class="card" style="margin-bottom:16px"><h2>Tool output entering context</h2><table><thead><tr><th>Tool</th><th>Characters</th><th>Share</th></tr></thead><tbody>${a.toolVolume.slice(0, 8).map(([name, chars]) => `<tr><td>${esc(name)}</td><td class="num">${(chars / 1e6).toFixed(1)}M</td><td class="num">${pct(chars / Math.max(a.toolVolume.reduce((x, [, v]) => x + v, 0), 1))}</td></tr>`).join('')}</tbody></table>${a.readCounts.length ? `<p class="note">Most re-read: ${a.readCounts.slice(0, 3).map(([p, n]) => `${n}× ${esc(p)}`).join(' · ')}</p>` : ''}</div>
<div class="card"><h2>What to do first</h2>${recs}</div>
<p class="note">Pricing: DeepSeek official, peak/idle, CNY per million tokens (2026-10-31). Peak = Beijing weekdays 09:00–12:00 and 14:00–18:00, excluding China statutory holidays. Generated locally from session logs; no data was uploaded.${a.redacted ? ' Redacted for sharing: session titles, paths, commands, and file names were removed.' : ''}</p>
<p class="note">Generated by <a href="https://www.npmjs.com/package/dsh-token-audit">dsh-token-audit</a> · <code>npx dsh-token-audit</code></p>
</div></body></html>`
}

export function renderJson(a) {
  return JSON.stringify({
    generatedAt: a.generatedAt,
    root: a.root,
    window: { start: day(a.totals.start), end: day(a.totals.end), days: a.totals.days },
    totals: a.totals,
    byDay: a.byDay,
    byModel: a.byModel,
    contextBuckets: a.contextBuckets,
    topSessions: a.topSessions.map((s) => ({ id: s.id, cwd: s.cwd, title: s.title, cost: s.cost, calls: s.calls, maxCtx: s.maxCtx, compactions: s.compactions, turns: s.turns })),
    savings: a.savings,
    recommendations: a.recommendations,
    toolVolume: a.toolVolume,
    readCounts: a.readCounts,
    bashCounts: a.bashCounts,
  }, null, 2)
}
