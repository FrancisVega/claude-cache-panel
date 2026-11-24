// `orca plugin check` renders the panel once per scenario, with the worker on a stand-in host.
import { defineCheck, hostError } from 'orca/testing'
import type { CacheSession, Snapshot } from './protocol'

const MINUTE = 60_000
const now = Date.now()

function session(
  pid: number,
  title: string,
  minutesLeft: number | null,
  extra: Partial<CacheSession> = {}
): CacheSession {
  return {
    pid,
    title,
    where: 'acme',
    name: null,
    status: 'idle',
    expiresAt: minutesLeft === null ? null : now + minutesLeft * MINUTE,
    workspaceId: `w${pid}`,
    ...extra
  }
}

const snapshotOf = (sessions: CacheSession[]): Snapshot => ({ sessions, at: now })

export default defineCheck({
  // No stub: the real worker reads this machine's ~/.claude.
  real: {},
  empty: { requests: { 'sessions.list': () => snapshotOf([]) } },
  several: {
    requests: {
      'sessions.list': () =>
        snapshotOf([
          session(1, 'api-rate-limits', 52, { status: 'busy' }),
          session(2, 'fix-login-redirect', 12),
          session(3, 'spike-search-index', 3),
          session(4, 'migrate-to-astro', -545, { name: 'Branch behind main' }),
          session(5, 'scratch', null, { where: '~/scratch', workspaceId: null })
        ])
    }
  },
  error: {
    requests: {
      'sessions.list': () => {
        throw hostError('unavailable', "The worker didn't start")
      }
    }
  }
})
