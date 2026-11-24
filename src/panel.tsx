// Panel: the live Claude Code sessions, with the cache that expires soonest on top. The worker
// sends a new reading every 5 s and the countdown ticks on its own in between.
import {
  atom,
  Box,
  Callout,
  Collapsible,
  EmptyState,
  Link,
  plugin,
  read,
  RelativeTime,
  set,
  Spinner,
  Stack,
  Text,
  update,
  type OrcaNode,
  type PanelContext
} from 'orca'
import { MINUTE, split, urgency } from './expiry'
import type { CacheSession, Snapshot } from './protocol'

/** The worker's latest reading; null until the first one. */
const snapshot = atom<Snapshot | null>(null)
/** Why the first reading failed; null if it went fine. */
const failure = atom<string | null>(null)
/** Why the last workspace pressed couldn't be opened; null if it opened. */
const openFailure = atom<string | null>(null)

// A response that arrives late doesn't overwrite a newer reading.
function keep(next: Snapshot): void {
  update(snapshot, (previous) => (previous !== null && previous.at > next.at ? previous : next))
  set(failure, null)
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('sessions.changed', keep))
  plugin.request('sessions.list').then(keep, (error: Error) => set(failure, error.message))
}

async function open(workspaceId: string): Promise<void> {
  try {
    await plugin.request('sessions.open', { workspaceId })
    set(openFailure, null)
  } catch (error) {
    set(openFailure, (error as Error).message)
  }
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / MINUTE)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`
}

function details(session: CacheSession): string {
  const status =
    session.status === 'busy' ? 'working' : session.status === 'idle' ? null : session.status
  return [session.name, session.where, status].filter(Boolean).join(' · ')
}

function row(session: CacheSession, aside: OrcaNode, muted = false): OrcaNode {
  const { workspaceId } = session
  return (
    <Box key={String(session.pid)} direction="row" align="center" gap="sm">
      <Box grow minWidth={0}>
        <Text weight="medium" muted={muted} truncate>
          {workspaceId === null ? (
            session.title
          ) : (
            <Link onPress={() => open(workspaceId)}>{session.title}</Link>
          )}
        </Text>
        <Text size="xs" muted truncate>
          {details(session)}
        </Text>
      </Box>
      <Box shrink={false}>{aside}</Box>
    </Box>
  )
}

export default function Panel() {
  const current = read(snapshot)
  const error = read(failure)
  const openError = read(openFailure)

  if (current === null) {
    return error === null ? (
      <Spinner label="Reading Claude sessions" />
    ) : (
      <Callout tone="danger" title="Couldn't read the sessions">
        {error}
      </Callout>
    )
  }

  const { live, rest } = split(current)

  return (
    <Stack gap="md">
      {openError === null ? null : (
        <Callout tone="warning" title="Couldn't open the workspace">
          {openError}
        </Callout>
      )}
      {live.length === 0 ? (
        <EmptyState
          icon="gauge"
          title="No live caches"
          description="No Claude session has made a request in the last hour."
        />
      ) : (
        <Stack gap="sm">
          {live.map((session) =>
            row(
              session,
              <Text weight="semibold">
                <RelativeTime
                  at={session.expiresAt}
                  format="duration"
                  tone={urgency(session.expiresAt - current.at)}
                />
              </Text>
            )
          )}
        </Stack>
      )}
      {rest.length === 0 ? null : (
        <Collapsible title={`Expired or no data (${rest.length})`}>
          <Stack gap="sm">
            {rest.map((session) =>
              row(
                session,
                <Text size="xs" muted>
                  {session.expiresAt === null ? 'no data' : ago(current.at - session.expiresAt)}
                </Text>,
                true
              )
            )}
          </Stack>
        </Collapsible>
      )}
    </Stack>
  )
}
