import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EpochMs } from '../types'

// Every request that reads the prompt cache renews its 1-hour TTL.
const TTL_MS = 60 * 60 * 1000

// Claude Code deletes transcripts older than 30 days (cleanupPeriodDays):
// those sessions can no longer be resumed, so what was saved for them is dead weight.
const KEEP_MS = 30 * 24 * TTL_MS

// When the last main-thread request that got a response started.
const lastRequestAt = atom(
  { plugin: 'cache-countdown', key: 'lastRequestAt' } as const,
  null,
)

// $.state doesn't outlive the process: $.store keeps that time under each
// session's id, which `claude --resume` preserves, so the countdown carries on
// when the session is resumed.
// A managed organization plugin skips mods at classic.SessionStart, so its
// seconds_since_last_response never arrives.
const SESSIONS = 'sessions'
type Saved = Record<string, EpochMs>

async function remember($: EngineInterface, at: EpochMs | null) {
  const session = await $.session.id()
  const now = await $.clock.now()
  const saved = { ...((await $.store.get(SESSIONS)) as Saved | undefined) }
  if (at === null) delete saved[session]
  else saved[session] = at

  const recent = Object.entries(saved).filter(([, t]) => now - t < KEEP_MS)
  await $.store.set(SESSIONS, Object.fromEntries(recent))
  await update($, lastRequestAt, () => at)
}

async function recall($: EngineInterface) {
  const saved = (await $.store.get(SESSIONS)) as Saved | undefined
  const at = saved?.[await $.session.id()] ?? null
  await update($, lastRequestAt, () => at)
}

function label(at: number | null, now: number): string | undefined {
  if (at === null) return undefined

  const left = Math.ceil((at + TTL_MS - now) / 1000)
  if (left <= 0) return '⌛ cache expired'

  return `⏳ cache ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The session whose countdown is shown: none at startup or on reload, and
    // /clear and /resume switch sessions without another session.start.
    let session: string | undefined
    let shown: string | undefined

    $.clock.every(1000, async () => {
      const current = await $.session.id()
      if (current !== session) {
        session = current
        await recall($)
      }

      const text = label(await read($, lastRequestAt), await $.clock.now())
      if (text === shown) return

      shown = text
      $.ui.status(text)
    })

    return next(e)
  })

  // Subagents cache their own prefix: they don't renew the main thread's.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    const startedAt = await $.clock.now()
    const response = yield* next(e)
    if (response.usage !== null) await remember($, startedAt)

    return response
  })

  // After compacting, the context is new and there's no cache left to lose.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    const isCompacted =
      e.agentId === undefined &&
      e.trigger !== 'precompute' &&
      result.skip === undefined
    if (isCompacted) await remember($, null)

    return result
  })
}
