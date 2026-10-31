// Local-only audit of DeepSeek Harness session logs.
import { readdir, readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { decompress } from 'fzstd'
import { callCost, isPeak, priceFor, PRICES, FALLBACK_MODEL } from './pricing.mjs'

export const DEFAULT_SESSIONS = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
export const CONTEXT_BUCKETS = [0, 50_000, 100_000, 150_000, 200_000, 300_000, 400_000, 500_000, 750_000]

export async function findSessionFiles(root) {
  const out = []
  async function walk(dir) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.name.endsWith('.jsonl.zstd') || e.name.endsWith('.jsonl')) out.push(p)
    }
  }
  await walk(root)
  return out.sort()
}

const execFileAsync = promisify(execFile)
let zstdCli = process.platform === 'win32' ? false : null

async function readSessionText(file) {
  if (!file.endsWith('.zstd')) return (await readFile(file)).toString('utf8')
  // zstdcat handles concatenated frames and is much faster than pure JS; fall back to fzstd.
  if (zstdCli !== false) {
    try {
      const { stdout } = await execFileAsync('zstdcat', [file], { maxBuffer: 512 * 1024 * 1024 })
      zstdCli = true
      return stdout
    } catch (e) {
      if (e.code === 'ENOENT') zstdCli = false
      else {
        try { return Buffer.from(decompress(await readFile(file))).toString('utf8') } catch { throw e }
      }
    }
  }
  return Buffer.from(decompress(await readFile(file))).toString('utf8')
}

function parseJson(line) {
  try { return JSON.parse(line) } catch { return null }
}

/**
 * Parse one session log file.
 * Returns null when the file has no assistant usage or is unreadable.
 */
function sessionId(file) {
  const m = file.match(/session-([0-9a-f-]{8,})/i)
  if (m) return m[1]
  const parent = file.split('/').slice(-2, -1)[0] ?? ''
  if (/^[0-9a-f-]{8,}$/i.test(parent)) return parent
  return file.split('/').pop()
}

export async function parseSession(file, { holidays, since, until } = {}) {
  let text
  try { text = await readSessionText(file) } catch { return null }
  const lines = text.split('\n')
  const s = {
    file,
    id: sessionId(file),
    cwd: '',
    title: '',
    start: 0,
    end: 0,
    calls: 0,
    hit: 0,
    miss: 0,
    out: 0,
    cost: 0,
    peakCost: 0,
    maxCtx: 0,
    ctxSum: 0,
    compactions: 0,
    turns: 0,
    toolCalls: 0,
    resultChars: 0,
    firstCall: 0,
    lastCall: 0,
    ctxs: [],
    callCosts: [],
    callTimes: [],
    hitPrices: [],
    hitCost: 0,
    missCost: 0,
    outCost: 0,
    models: new Map(),
    tools: new Map(),
    reads: new Map(),
    bash: new Map(),
  }
  const callNames = new Map()
  const seenUsage = new Set() // retries can repeat the same attempt; dedupe by message id when present

  for (const line of lines) {
    if (!line || line[0] !== '{') continue
    if (!line.includes('"type"')) continue
    const o = parseJson(line)
    if (!o) continue
    switch (o.type) {
      case 'session':
        s.cwd = o.cwd ?? ''
        s.start = o.createdAt ?? 0
        break
      case 'session/title':
        s.title ||= o.data?.title ?? o.data?.text ?? ''
        break
      case 'assistant/message': {
        const u = o.data?.usage
        if (typeof u?.inputTokens !== 'number') break
        if (since && o.time < since) break
        if (until && o.time > until) break
        const msgId = o.data?.message?.id
        if (msgId && seenUsage.has(msgId)) break
        if (msgId) seenUsage.add(msgId)
        const model = o.data?.message?.source?.model ?? 'unknown'
        const hit = u.cacheReadTokens ?? 0
        const miss = u.inputTokens
        const out = u.outputTokens ?? 0
        const cost = callCost({ hit, miss, out }, model, o.time, holidays)
        const p = priceFor(model) ?? PRICES[FALLBACK_MODEL]
        const [hp, mp, op] = isPeak(o.time, holidays) ? p.peak : p.idle
        s.hitCost += (hit * hp) / 1e6
        s.missCost += (miss * mp) / 1e6
        s.outCost += (out * op) / 1e6
        const m = s.models.get(model) ?? { calls: 0, cost: 0, out: 0 }
        m.calls++; m.cost += cost; m.out += out
        s.models.set(model, m)
        s.calls++
        s.hit += hit
        s.miss += miss
        s.out += out
        s.cost += cost
        if (isPeak(o.time, holidays)) s.peakCost += cost
        s.maxCtx = Math.max(s.maxCtx, hit)
        s.ctxSum += hit
        s.ctxs.push(hit)
        s.callCosts.push(cost)
        s.callTimes.push(o.time)
        s.hitPrices.push(hp)
        s.end = Math.max(s.end, o.time)
        s.firstCall = s.firstCall ? Math.min(s.firstCall, o.time) : o.time
        s.lastCall = Math.max(s.lastCall, o.time)
        break
      }
      case 'tool/call': {
        s.toolCalls++
        const id = o.data?.callId
        const name = o.data?.name ?? '?'
        if (id) callNames.set(id, name)
        if (name === 'read') {
          try {
            const a = JSON.parse(o.data.arguments ?? '{}')
            if (a.file_path) s.reads.set(a.file_path, (s.reads.get(a.file_path) ?? 0) + 1)
          } catch {}
        } else if (name === 'bash') {
          try {
            const a = JSON.parse(o.data.arguments ?? '{}')
            const c = (a.command ?? '').trim()
            if (c) s.bash.set(c, (s.bash.get(c) ?? 0) + 1)
          } catch {}
        }
        break
      }
      case 'tool/result': {
        const content = o.data?.message?.content ?? o.data?.content ?? []
        let chars = 0
        for (const b of content) if (typeof b?.text === 'string') chars += b.text.length
        s.resultChars += chars
        const name = callNames.get(o.data?.message?.toolCallId) ?? callNames.get(o.data?.message?.source?.callId) ?? '?'
        s.tools.set(name, (s.tools.get(name) ?? 0) + chars)
        break
      }
      case 'compaction/end':
        s.compactions++
        break
      case 'turn/start':
        s.turns++
        break
    }
  }
  if (!s.calls) return null
  return s
}

function sessionRecency(ms) {
  return Number.isFinite(ms) ? ms : 0
}

export async function auditSessions(options = {}) {
  const root = options.sessions ?? DEFAULT_SESSIONS
  const days = options.days ?? 30
  const since = options.since ?? 0
  const until = options.until ?? Infinity
  const cutoff = options.all ? 0 : Date.now() - days * 86400_000
  const allFiles = await findSessionFiles(root)
  const files = []
  for (const file of allFiles) {
    if (!options.all) {
      try {
        const st = await stat(file)
        // Session files are appended to; skip clearly old files cheaply.
        if (st.mtimeMs < cutoff - 2 * 86400_000) continue
      } catch { /* keep going */ }
    }
    files.push(file)
  }
  let done = 0
  const started = Date.now()
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, files.length))
  const results = new Array(files.length).fill(null)
  let next = 0
  async function worker() {
    for (;;) {
      const i = next++
      if (i >= files.length) return
      const s = await parseSession(files[i], { holidays: options.holidays, since, until }).catch(() => null)
      results[i] = s
      done++
      if (options.onProgress) options.onProgress(done, files.length, Date.now() - started)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const sessions = results.filter((s) => {
    if (!s) return false
    if (since && s.end && s.end < since) return false
    if (until !== Infinity && s.start && s.start > until) return false
    if (!options.all && s.end && s.end < cutoff) return false
    if (options.cwd && !s.cwd.includes(options.cwd)) return false
    if (options.session && !s.id.includes(options.session)) return false
    return true
  })
  if (options.redact) {
    sessions.forEach((s, i) => {
      s.title = `Session ${i + 1}`
      s.cwd = ''
      s.id = `session-${i + 1}`
      s.file = 'redacted'
      s.reads = new Map()
      s.bash = new Map()
    })
  }
  const audit = aggregate(sessions, { days, root })
  audit.redacted = Boolean(options.redact)
  return audit
}

function add(map, key, value) {
  map.set(key, (map.get(key) ?? 0) + value)
}

export function aggregate(sessions, { days = 30, root } = {}) {
  const totals = {
    sessions: sessions.length,
    calls: 0,
    hit: 0,
    miss: 0,
    out: 0,
    cost: 0,
    hitCost: 0,
    missCost: 0,
    outCost: 0,
    turns: 0,
    compactions: 0,
    toolCalls: 0,
    resultChars: 0,
    peakCost: 0,
    idleCost: 0,
    start: Infinity,
    end: 0,
  }
  const byDay = new Map()
  const byModel = new Map()
  const byWorkspace = new Map()
  const contextBuckets = CONTEXT_BUCKETS.map((min) => ({ min, calls: 0 }))
  const allCalls = []

  for (const s of sessions) {
    totals.calls += s.calls
    totals.hit += s.hit
    totals.miss += s.miss
    totals.out += s.out
    totals.cost += s.cost
    totals.hitCost += s.hitCost
    totals.missCost += s.missCost
    totals.outCost += s.outCost
    totals.turns += s.turns
    totals.compactions += s.compactions
    totals.toolCalls += s.toolCalls
    totals.resultChars += s.resultChars
    totals.peakCost += s.peakCost
    totals.start = Math.min(totals.start, sessionRecency(s.firstCall || s.start))
    totals.end = Math.max(totals.end, s.lastCall || s.end)
    const ws = s.cwd || '(unknown)'
    const w = byWorkspace.get(ws) ?? { sessions: 0, calls: 0, cost: 0 }
    w.sessions++; w.calls += s.calls; w.cost += s.cost
    byWorkspace.set(ws, w)
    for (let i = 0; i < s.calls; i++) {
      const ctx = s.ctxs[i]
      const cost = s.callCosts[i]
      const bucket = contextBuckets.reduce((acc, b) => (ctx >= b.min ? b : acc), contextBuckets[0])
      bucket.calls++
      const day = new Date(s.callTimes[i] + 8 * 3600_000).toISOString().slice(0, 10)
      byDay.set(day, (byDay.get(day) ?? 0) + cost)
      allCalls.push({ ctx, cost, time: s.callTimes[i], hitPrice: s.hitPrices[i] })
    }
  }
  totals.idleCost = totals.cost - totals.peakCost
  totals.outCostShare = totals.cost ? totals.outCost / totals.cost : 0
  totals.hitCostShare = totals.cost ? totals.hitCost / totals.cost : 0
  totals.missCostShare = totals.cost ? totals.missCost / totals.cost : 0
  const avgCalls = Math.max(totals.calls, 1)
  const activeDays = byDay.size || 1
  const last7 = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7)

  const savings = simulate(allCalls, totals)
  const maps = mergeToolMaps(sessions)
  const topSessions = [...sessions].sort((a, b) => b.cost - a.cost).slice(0, 15)
  const recommendations = buildRecommendations({ totals, sessions, savings, byDay, maps })

  return {
    root,
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      days: activeDays,
      avgPerDay: totals.cost / activeDays,
      avgPerCall: totals.cost / avgCalls,
      avgCtx: totals.hit / avgCalls,
      last7Cost: last7.reduce((a, [, c]) => a + c, 0),
      projectedMonthly: (totals.cost / activeDays) * 30,
    },
    days: days,
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)),
    byModel: mergeModelMaps(sessions),
    byWorkspace: [...byWorkspace.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 12),
    contextBuckets,
    topSessions,
    savings,
    recommendations,
    toolVolume: maps.tools.slice(0, 20),
    readCounts: maps.reads.slice(0, 15),
    bashCounts: maps.bash.slice(0, 15),
  }
}

function simulate(calls, totals) {
  const caps = [50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 400_000, 500_000]
  const capRows = caps.map((cap) => {
    let saved = 0
    for (const c of calls) saved += (Math.max(c.ctx - cap, 0) * c.hitPrice) / 1e6
    return { cap, cost: totals.cost - saved, save: saved, pct: (saved / totals.cost) * 100 }
  })
  const outputCost = totals.outCost
  const outputRows = [0.1, 0.2, 0.3, 0.5].map((r) => ({ reduce: r, save: outputCost * r, pct: (outputCost * r / totals.cost) * 100 }))
  const offPeakRows = [0.2, 0.4, 0.6, 1].map((r) => ({ shift: r, save: totals.peakCost * r * 0.5, pct: (totals.peakCost * r * 0.5 / totals.cost) * 100 }))
  return {
    caps: capRows,
    output: outputRows,
    offPeak: offPeakRows,
    combined: {
      cap: 250_000,
      capSave: capRows.find((r) => r.cap === 250_000)?.save ?? 0,
      outputSave: outputCost * 0.2,
      offPeakSave: totals.peakCost * 0.4 * 0.5,
    },
  }
}

function buildRecommendations({ totals, sessions, savings, byDay, maps }) {
  const recs = []
  const above200 = sessions.reduce((a, s) => a + s.ctxs.filter((c) => c > 200_000).length, 0)
  const above200Pct = totals.calls ? (above200 / totals.calls) * 100 : 0
  if (above200Pct > 30) {
    recs.push({
      id: 'context',
      saving: savings.caps.find((r) => r.cap === 250_000)?.save ?? 0,
      text: `${above200Pct.toFixed(0)}% of calls ran above 200k context. Lower the compaction trigger (thresholdRatio 0.45-0.55) and retention (retainRatio 0.08), or start a fresh session per task. A 250k cap is worth about CNY ${(savings.caps.find((r) => r.cap === 250_000)?.save ?? 0).toFixed(0)} in this window.`,
    })
  }
  const peakShare = totals.cost ? totals.peakCost / totals.cost : 0
  if (peakShare > 0.3) {
    recs.push({
      id: 'offpeak',
      saving: savings.offPeak.find((r) => r.shift === 0.4)?.save ?? 0,
      text: `${(peakShare * 100).toFixed(0)}% of spend landed in peak hours (09-12, 14-18 Beijing). Move batch jobs, backtests and long agent runs after 18:00 or before 09:00; idle prices are half.`,
    })
  }
  if ((totals.outCostShare ?? 0) > 0.3) {
    recs.push({
      id: 'output',
      saving: savings.output.find((r) => r.reduce === 0.2)?.save ?? 0,
      text: `Output is ${((totals.outCostShare ?? 0) * 100).toFixed(0)}% of cost. Use reasoningEffort "high" instead of "max" for routine steps, cap answer length, and avoid restating plans in the final answer.`,
    })
  }
  const toolTotal = maps.tools.reduce((a, [, v]) => a + v, 0)
  const bashChars = maps.tools.find(([k]) => k === 'bash')?.[1] ?? 0
  if (toolTotal > 20e6) {
    recs.push({
      id: 'tools',
      saving: 0,
      text: `Tool results added ${(toolTotal / 1e6).toFixed(0)}M characters to context${bashChars ? `, ${((bashChars / toolTotal) * 100).toFixed(0)}% from bash` : ''}. Pipe long commands through tail/head, use quiet flags, and redirect raw logs to files instead of printing them.`,
    })
  }
  const top10 = sessions.slice(0, 10).reduce((a, s) => a + s.cost, 0)
  if (totals.cost && top10 / totals.cost > 0.35) {
    recs.push({
      id: 'sessions',
      saving: 0,
      text: `The 10 most expensive sessions are ${((top10 / totals.cost) * 100).toFixed(0)}% of spend. Audit those first: trim their tool output, compact earlier, and split independent tasks into fresh sessions.`,
    })
  }
  if (!recs.length) {
    recs.push({ id: 'ok', saving: 0, text: 'No single dominant waste pattern. Spend is distributed; focus on the top sessions and off-peak scheduling.' })
  }
  return recs
}

export function formatCny(n) {
  return `CNY ${n.toFixed(2)}`
}

export function formatTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

export { priceFor, FALLBACK_MODEL }


function mergeModelMaps(sessions) {
  const out = new Map()
  for (const s of sessions) {
    for (const [model, m] of s.models) {
      const cur = out.get(model) ?? { calls: 0, cost: 0, out: 0 }
      cur.calls += m.calls; cur.cost += m.cost; cur.out += m.out
      out.set(model, cur)
    }
  }
  return [...out.entries()].sort((a, b) => b[1].cost - a[1].cost)
}

export function mergeToolMaps(sessions) {
  const tools = new Map(), reads = new Map(), bash = new Map()
  for (const s of sessions) {
    for (const [k, v] of s.tools) tools.set(k, (tools.get(k) ?? 0) + v)
    for (const [k, v] of s.reads) reads.set(k, (reads.get(k) ?? 0) + v)
    for (const [k, v] of s.bash) bash.set(k, (bash.get(k) ?? 0) + v)
  }
  return {
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1]),
    reads: [...reads.entries()].sort((a, b) => b[1] - a[1]),
    bash: [...bash.entries()].sort((a, b) => b[1] - a[1]),
  }
}
