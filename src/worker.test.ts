// Mounts the worker on a temporary CLAUDE_CONFIG_DIR with files like the ones Claude Code writes.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, beforeEach, hostError, mockHost, mountWorker, test } from 'orca/testing'
import type { CacheSession } from './protocol'
import * as main from './worker'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
// Above macOS's highest pid (99998): no process has it.
const DEAD_PID = 999_999

const BUG_1 = {
  id: 'w1',
  kind: 'worktree',
  name: 'BUG-1',
  project: 'acme',
  path: '/w/acme/BUG-1',
  branch: 'bug-1',
  hostId: null
} as const
const API = { ...BUG_1, id: 'w2', name: 'API', path: '/w/acme/API', branch: 'api' }

let dir = ''
let worker: Awaited<ReturnType<typeof mountWorker>> | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'claude-cache-panel-'))
  process.env.CLAUDE_CONFIG_DIR = dir
  await mkdir(join(dir, 'sessions'))
  await mkdir(join(dir, 'plugins', 'store'), { recursive: true })
})

afterEach(async () => {
  // Stops the worker's timer even if the test failed.
  await worker?.deactivate()
  worker = undefined
  delete process.env.CLAUDE_CONFIG_DIR
  await rm(dir, { recursive: true, force: true })
})

function writeJson(path: string, value: unknown): Promise<void> {
  return writeFile(join(dir, path), JSON.stringify(value))
}

const byPid = (sessions: CacheSession[]) => [...sessions].sort((a, b) => a.pid - b.pid)

test('matches the live sessions with the last request the mod saved', async () => {
  await writeJson(`sessions/${process.pid}.json`, {
    pid: process.pid,
    sessionId: 'a',
    cwd: '/w/acme/BUG-1/packages/web',
    status: 'busy',
    name: 'bug-1-22',
    nameSource: 'derived'
  })
  await writeJson(`sessions/${process.ppid}.json`, {
    pid: process.ppid,
    sessionId: 'b',
    cwd: '/srv/standalone',
    status: 'idle',
    name: 'Review',
    nameSource: 'user'
  })
  await writeJson(`sessions/${DEAD_PID}.json`, {
    pid: DEAD_PID,
    sessionId: 'c',
    cwd: '/w/acme/BUG-1',
    status: 'idle'
  })
  await writeFile(join(dir, 'sessions', 'half-written.json'), '{"pid": 1')
  // The maximum in the middle: neither the first nor the last store read holds it.
  await writeJson('plugins/store/cache-countdown_inline-1.json', { sessions: { a: 1_000, c: 5_000 } })
  await writeJson('plugins/store/cache-countdown_inline-2.json', { sessions: { a: 3_000 } })
  await writeJson('plugins/store/cache-countdown_inline-3.json', { sessions: { a: 2_000 } })
  await writeJson('plugins/store/other-mod_inline-1.json', { sessions: { b: 9_000 } })

  const folder = { ...BUG_1, id: 'w0', kind: 'folder', name: 'w', project: null, path: '/w' }
  const host = mockHost({
    results: { 'workspace.list': { workspaces: [folder, BUG_1], truncated: false } }
  })
  worker = await mountWorker(main, { host })

  assert.deepEqual(
    byPid((await worker.request('sessions.list')).sessions),
    byPid([
      {
        pid: process.pid,
        title: 'BUG-1',
        where: 'acme',
        name: null,
        status: 'busy',
        expiresAt: 3_000 + HOUR,
        workspaceId: 'w1'
      },
      {
        pid: process.ppid,
        title: 'standalone',
        where: '/srv/standalone',
        name: 'Review',
        status: 'idle',
        expiresAt: null,
        workspaceId: null
      }
    ])
  )
  assert.deepEqual(worker.refusals, [])
})

test("without Orca's workspace list, names each session after its folder and doesn't open it", async () => {
  const now = Date.now()
  await writeJson(`sessions/${process.pid}.json`, {
    pid: process.pid,
    sessionId: 'a',
    cwd: join(homedir(), 'repos', 'notes'),
    status: 'idle',
    name: 'notes-1',
    nameSource: 'derived'
  })
  await writeJson('plugins/store/cache-countdown_inline-1.json', { sessions: { a: now } })
  const host = mockHost({ results: { 'workspace.list': hostError('unavailable') } })
  worker = await mountWorker(main, { host })

  assert.deepEqual((await worker.request('sessions.list')).sessions, [
    {
      pid: process.pid,
      title: 'notes',
      where: '~/repos/notes',
      name: null,
      status: 'idle',
      expiresAt: now + HOUR,
      workspaceId: null
    }
  ])
  assert.equal(await worker.command('open-next'), "notes isn't in an Orca workspace")
  assert.deepEqual(worker.host.callsOf('workspace.open'), [])
  assert.equal(worker.logs.length, 1)
})

test('hides the status bar item when there are no sessions', async () => {
  await rm(join(dir, 'sessions'), { recursive: true })
  const host = mockHost({ results: { 'workspace.list': { workspaces: [], truncated: false } } })
  worker = await mountWorker(main, { host })

  assert.deepEqual((await worker.request('sessions.list')).sessions, [])
  assert.deepEqual(worker.host.callsOf('statusBar.update'), [{ id: 'next-expiry', visible: false }])
  assert.equal(await worker.command('open-next'), 'No live Claude caches')
})

test('the status bar shows the cache that expires soonest and opens its workspace', async () => {
  const now = Date.now()
  await writeJson(`sessions/${process.pid}.json`, {
    pid: process.pid,
    sessionId: 'a',
    cwd: '/w/acme/BUG-1',
    status: 'idle'
  })
  await writeJson(`sessions/${process.ppid}.json`, {
    pid: process.ppid,
    sessionId: 'b',
    cwd: '/w/acme/API',
    status: 'idle'
  })
  // `a` has 10.5 min left and `b`, 50.
  await writeJson('plugins/store/cache-countdown_inline-1.json', {
    sessions: { a: now - 50 * MINUTE + 30_000, b: now - 10 * MINUTE }
  })
  const host = mockHost({
    results: {
      'workspace.list': { workspaces: [BUG_1, API], truncated: false },
      'workspace.open': { opened: true }
    }
  })
  worker = await mountWorker(main, { host })
  await worker.request('sessions.list')

  assert.deepEqual(worker.host.callsOf('statusBar.update'), [
    {
      id: 'next-expiry',
      visible: true,
      text: '10 min · BUG-1',
      tone: 'warning',
      tooltip: 'Claude cache expiring soonest: BUG-1 (acme)'
    }
  ])
  await worker.command('open-next')
  await worker.request('sessions.open', { workspaceId: 'w2' })
  assert.deepEqual(worker.host.callsOf('workspace.open'), [{ workspaceId: 'w1' }, { workspaceId: 'w2' }])
  assert.deepEqual(worker.refusals, [])
})
