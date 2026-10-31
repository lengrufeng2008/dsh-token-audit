// DSH Host plugin: registers one read-only audit tool.
// Deliberately no dependency on @deepseek-ai packages, so the bundle resolves
// from a profile link or an npm install without peer-resolution surprises.
import { auditSessions } from '../src/audit.mjs'
import { renderMarkdown } from '../src/report.mjs'

export const name = 'token-audit'
export const inject = ['tools']

const description = [
  'Audit DeepSeek Harness session logs and report where tokens and money went.',
  'Use when the user asks about token spend, cost, an expensive session, or how to cut their bill.',
  'Reads local session files only; no network. Returns a markdown report plus totals.',
].join(' ')

export function apply(ctx) {
  ctx.tools.register({
    name: 'token_audit',
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        days: { type: 'number', description: 'Only include sessions active in the last N days. Default 30.' },
        sessions: { type: 'string', description: 'Optional session root directory. Defaults to $DSH_HOME/sessions.' },
        cwd: { type: 'string', description: 'Optional substring filter on the session working directory.' },
        redact: { type: 'boolean', description: 'Hide session titles, paths, commands, and file names before returning the report.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          markdown: { type: 'string', description: 'Full markdown report.' },
          totalCost: { type: 'number', description: 'Estimated cost in CNY.' },
          sessions: { type: 'number', description: 'Sessions included.' },
          calls: { type: 'number', description: 'Model calls included.' },
          monthly: { type: 'number', description: 'Projected monthly cost in CNY.' },
        },
        required: ['markdown', 'totalCost', 'sessions', 'calls', 'monthly'],
      },
      render: (_args, value) => [{ type: 'text', text: value.markdown }],
    },
    timeoutMs: 180_000,
    async execute(args = {}) {
      const audit = await auditSessions({
        days: typeof args.days === 'number' && args.days > 0 ? args.days : 30,
        sessions: typeof args.sessions === 'string' && args.sessions ? args.sessions : undefined,
        cwd: typeof args.cwd === 'string' && args.cwd ? args.cwd : undefined,
        redact: args.redact === true,
      })
      const t = audit.totals
      if (!t.sessions) {
        return {
          markdown: 'No DSH sessions found. Pass `sessions` as an absolute path to the session root, or run a session first.',
          totalCost: 0, sessions: 0, calls: 0, monthly: 0,
        }
      }
      return {
        markdown: renderMarkdown(audit),
        totalCost: Number(t.cost.toFixed(4)),
        sessions: t.sessions,
        calls: t.calls,
        monthly: Number(t.projectedMonthly.toFixed(2)),
      }
    },
  })
}
