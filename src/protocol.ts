// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.

/** A live Claude Code session and when its prompt cache expires. */
export type CacheSession = {
  /** The Claude Code process; identifies the row. */
  pid: number
  /** The Orca workspace it runs in, or its folder when it runs outside Orca. */
  title: string
  /** The workspace's project, or the session's path when it runs outside Orca. */
  where: string
  /** The name set by hand or by Claude; null when it's only the one derived from the folder. */
  name: string | null
  /** What Claude Code reports: `idle`, `busy`, `shell`… */
  status: string
  /** Start of the last main-thread request + 1 h; null when the mod hasn't saved it. */
  expiresAt: number | null
  /** The Orca workspace that contains it; null when it runs outside Orca. */
  workspaceId: string | null
}

/** The sessions the worker read and when it read them. */
export type Snapshot = { sessions: CacheSession[]; at: number }

declare module 'orca' {
  interface PluginRequests {
    /** The latest reading of the live Claude Code sessions on this machine. */
    'sessions.list': { output: Snapshot }
    /** Shows a session's workspace in Orca. */
    'sessions.open': { input: { workspaceId: string }; output: { opened: boolean } }
  }
  interface PluginPanelEvents {
    /** Every new reading from the worker, every 5 s. */
    'sessions.changed': Snapshot
  }
}
