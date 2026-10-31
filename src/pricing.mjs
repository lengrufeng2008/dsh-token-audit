// Official DeepSeek API pricing, CNY per million tokens.
// Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ (checked 2026-10-31).
// [cache hit input, cache miss input, output]
export const PRICES = {
  'deepseek-flash': { peak: [0.04, 2, 8], idle: [0.02, 1, 4] },
  'deepseek-v4-flash': { peak: [0.04, 2, 8], idle: [0.02, 1, 4] },
  'deepseek-v4-pro': { peak: [0.3, 9, 27], idle: [0.15, 4.5, 13.5] },
}

export const FALLBACK_MODEL = 'deepseek-flash'

// China statutory holidays that fall on weekdays in the pricing window.
// Extend per year; weekends are always off-peak.
export const CN_HOLIDAYS_2026 = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
  '2026-04-06', '2026-05-01', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-09-25',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
])

const SHANGHAI_OFFSET = 8 * 3600_000

export function beijingParts(ms) {
  const d = new Date(ms + SHANGHAI_OFFSET)
  return {
    day: d.toISOString().slice(0, 10),
    weekday: d.getUTCDay(), // 0 Sunday
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  }
}

export function isPeak(ms, holidays = CN_HOLIDAYS_2026) {
  const { day, weekday, hour } = beijingParts(ms)
  if (weekday === 0 || weekday === 6) return false
  if (holidays.has(day)) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

export function priceFor(model) {
  return PRICES[model] ?? null
}

/**
 * Cost of one assistant call in CNY.
 * `hit` is provider-reported cache-read input; `miss` is uncached input.
 */
export function callCost({ hit = 0, miss = 0, out = 0 }, model, time, holidays) {
  const p = priceFor(model) ?? PRICES[FALLBACK_MODEL]
  const [hitPrice, missPrice, outPrice] = isPeak(time, holidays) ? p.peak : p.idle
  return (hit * hitPrice + miss * missPrice + out * outPrice) / 1e6
}

export function priceTable() {
  return {
    currency: 'CNY',
    unit: 'per million tokens',
    schedule: 'Beijing time; peak = Mon-Fri 09:00-12:00 and 14:00-18:00, excluding China statutory holidays; idle = everything else',
    models: PRICES,
  }
}
