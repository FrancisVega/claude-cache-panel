// The plugin's worker. Every 5 s it reads the live Claude Code sessions from disk and, from the
// cache-countdown mod (mods/cache-countdown), when each one's last main-thread request started.
// With that it updates the status bar and the open panels. Orca keeps it running for as long as
// the plugin is enabled, because the plugin has a status bar item.
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { MINUTE, split, urgency } from './expiry'
import type { CacheSession, Snapshot } from './protocol'

// Every request that reads the prompt cache renews its 1-hour TTL, as the mod counts it.
const TTL_MS = 60 * MINUTE
const TICK_MS = 5_000
// Workspaces change rarely: no need to ask Orca on every reading.
const WORKSPACES_TTL_MS = 30_000
const STATUS_ITEM = 'next-expiry'
// How much of the name fits in the status bar.
const STATUS_TITLE_MAX = 24

// What is used from sessions/<pid>.json, the file Claude Code leaves per process.
type Registered = {
  pid: number
  sessionId: string
  cwd: string
  status?: string
  name?: string
  nameSource?: string
}
type Workspace = { id: string; name: string; project?: string | null; path: string }

let timer: ReturnType<typeof setInterval> | undefined

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    // A session that closes deletes its file between readdir and readFile.
    return undefined
  }
}

async function readJsonFiles(dir: string, accept: (name: string) => boolean): Promise<unknown[]> {
  const names = await readdir(dir).catch((): string[] => [])
  return Promise.all(names.filter(accept).map((name) => readJson(join(dir, name))))
}

function isRegistered(value: unknown): value is Registered {
  const session = value as Partial<Registered> | undefined
  return (
    typeof session?.pid === 'number' &&
    typeof session.sessionId === 'string' &&
    typeof session.cwd === 'string'
  )
}

// A session's file outlives its process if the process dies without closing.
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM'
  }
}

// Start of each session's last request, according to the mod's stores.
async function lastRequests(claudeDir: string): Promise<Record<string, number>> {
  const stores = await readJsonFiles(
    join(claudeDir, 'plugins', 'store'),
    (name) => name.startsWith('cache-countdown_') && name.endsWith('.json')
  )
  const last: Record<string, number> = {}
  for (const store of stores) {
    const sessions = (store as { sessions?: Record<string, number> } | undefined)?.sessions ?? {}
    for (const [id, at] of Object.entries(sessions)) last[id] = Math.max(last[id] ?? 0, at)
  }
  return last
}

// The deepest workspace that contains the session's folder.
function workspaceOf(cwd: string, workspaces: Workspace[]): Workspace | undefined {
  return workspaces
    .filter((workspace) => cwd === workspace.path || cwd.startsWith(workspace.path + sep))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

async function listSessions(workspaces: Workspace[]): Promise<CacheSession[]> {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const [registered, last] = await Promise.all([
    readJsonFiles(join(claudeDir, 'sessions'), (name) => name.endsWith('.json')),
    lastRequests(claudeDir)
  ])
  const home = homedir()

  return registered
    .filter(isRegistered)
    .filter((session) => isAlive(session.pid))
    .map((session) => {
      const workspace = workspaceOf(session.cwd, workspaces)
      const at = last[session.sessionId]
      return {
        pid: session.pid,
        title: workspace?.name ?? basename(session.cwd),
        where:
          workspace?.project ??
          (session.cwd.startsWith(home) ? `~${session.cwd.slice(home.length)}` : session.cwd),
        name: session.nameSource === 'derived' ? null : (session.name ?? null),
        status: session.status ?? 'idle',
        expiresAt: at === undefined ? null : at + TTL_MS,
        workspaceId: workspace?.id ?? null
      }
    })
}

function shorten(text: string): string {
  return text.length <= STATUS_TITLE_MAX ? text : `${text.slice(0, STATUS_TITLE_MAX - 1)}…`
}

function minutesLeft(left: number): string {
  return left < MINUTE ? '<1 min' : `${Math.floor(left / MINUTE)} min`
}

export default function activate(orca: OrcaWorkerApi): void {
  let workspaces: { list: Workspace[]; at: number } | undefined
  let shown: string | undefined

  async function currentWorkspaces(): Promise<Workspace[]> {
    if (workspaces !== undefined && Date.now() - workspaces.at < WORKSPACES_TTL_MS) {
      return workspaces.list
    }
    try {
      workspaces = { list: (await orca.host.call('workspace.list')).workspaces, at: Date.now() }
    } catch (error) {
      // Keeps the last good list; with none, each session is named after its folder.
      orca.log(`workspace.list: ${(error as Error).message}`)
      workspaces = { list: workspaces?.list ?? [], at: Date.now() }
    }
    return workspaces.list
  }

  // The cache that expires soonest, in the status bar; hidden when none is live.
  async function showNext(snapshot: Snapshot): Promise<void> {
    const next = split(snapshot).live[0]
    const item =
      next === undefined
        ? { id: STATUS_ITEM, visible: false }
        : {
            id: STATUS_ITEM,
            visible: true,
            text: `${minutesLeft(next.expiresAt - snapshot.at)} · ${shorten(next.title)}`,
            tone: urgency(next.expiresAt - snapshot.at),
            tooltip: `Claude cache expiring soonest: ${next.title} (${next.where})`
          }
    const key = JSON.stringify(item)
    if (key === shown) return
    try {
      await orca.host.call('statusBar.update', item)
      shown = key
    } catch (error) {
      orca.log(`statusBar.update: ${(error as Error).message}`)
    }
  }

  async function refresh(): Promise<Snapshot> {
    const snapshot = { sessions: await listSessions(await currentWorkspaces()), at: Date.now() }
    await showNext(snapshot)
    orca.panels.post('sessions.changed', snapshot)
    return snapshot
  }

  let latest: Promise<Snapshot>
  const tick = () => {
    latest = refresh()
    latest.catch((error: Error) => orca.log(`refresh: ${error.message}`))
  }
  tick()
  timer = setInterval(tick, TICK_MS)

  orca.panels.handle('sessions.list', () => latest)
  orca.panels.handle('sessions.open', async ({ workspaceId }) => {
    await orca.host.call('workspace.open', { workspaceId })
    return { opened: true }
  })
  // What runs when the status bar item is pressed.
  orca.commands.register('open-next', async () => {
    const next = split(await latest).live[0]
    if (next === undefined) return 'No live Claude caches'
    if (next.workspaceId === null) return `${next.title} isn't in an Orca workspace`
    await orca.host.call('workspace.open', { workspaceId: next.workspaceId })
  })
}

export function deactivate(): void {
  clearInterval(timer)
}
