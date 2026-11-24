// Which caches are still live and what color they get: shared by the panel and the status bar.
import type { Tone } from 'orca'
import type { CacheSession, Snapshot } from './protocol'

export const MINUTE = 60_000

export type Live = CacheSession & { expiresAt: number }

/** The ones live at read time, soonest to expire first; then the rest, the longest expired last. */
export function split({ sessions, at }: Snapshot): { live: Live[]; rest: CacheSession[] } {
  const isLive = (session: CacheSession): session is Live =>
    session.expiresAt !== null && session.expiresAt > at
  return {
    live: sessions.filter(isLive).sort((a, b) => a.expiresAt - b.expiresAt),
    rest: sessions
      .filter((session) => !isLive(session))
      .sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0))
  }
}

export function urgency(left: number): Tone {
  if (left < 5 * MINUTE) return 'danger'
  if (left < 15 * MINUTE) return 'warning'
  return 'success'
}
