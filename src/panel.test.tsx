// Mounts the panel with a fake worker and checks what it draws.
import { afterEach, assert, hostError, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import type { CacheSession, Snapshot } from './protocol'

const MINUTE = 60_000

let view: TestPanel | undefined

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

function session(
  pid: number,
  title: string,
  minutesLeft: number | null,
  workspaceId: string | null = `w${pid}`
): CacheSession {
  return {
    pid,
    title,
    where: 'acme',
    name: null,
    status: 'idle',
    expiresAt: minutesLeft === null ? null : Date.now() + minutesLeft * MINUTE,
    workspaceId
  }
}

const snapshotOf = (sessions: CacheSession[]): Snapshot => ({ sessions, at: Date.now() })

test('puts the cache that expires soonest on top and folds the rest', async () => {
  const sessions = [
    session(1, 'later', 50),
    session(2, 'expired', -90),
    session(3, 'soon', 3),
    session(4, 'standalone', null, null)
  ]
  view = await mount(panel, {
    host: mockHost({ requests: { 'sessions.list': () => snapshotOf(sessions) } })
  })

  assert.deepEqual(
    view.findAll({ type: 'Link' }).map((link) => link.text),
    ['soon', 'later']
  )
  assert.deepEqual(
    view.findAll({ type: 'RelativeTime' }).map((time) => time.props.tone),
    ['danger', 'success']
  )
  assert.equal(view.find({ text: 'expired' }), null)

  await view.toggle({ type: 'Collapsible' })
  assert.ok(view.find({ type: 'Link', text: 'expired' }))
  assert.ok(view.find({ type: 'Text', text: '1 h ago' }))
  // Outside Orca there's no workspace to go to: no link.
  assert.equal(view.find({ type: 'Link', text: 'standalone' }), null)
  assert.ok(view.find({ type: 'Text', text: 'standalone' }))
  assert.ok(view.find({ type: 'Text', text: 'no data' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
})

test('pressing a session opens its workspace', async () => {
  const opened: string[] = []
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'sessions.list': () => snapshotOf([session(1, 'soon', 3)]),
        'sessions.open': ({ workspaceId }) => {
          opened.push(workspaceId)
          return { opened: true }
        }
      }
    })
  })

  await view.press({ type: 'Link', text: 'soon' })
  assert.deepEqual(opened, ['w1'])
  assert.equal(view.find({ type: 'Callout' }), null)
})

test("warns when it can't open the workspace", async () => {
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'sessions.list': () => snapshotOf([session(1, 'soon', 3)]),
        'sessions.open': () => {
          throw hostError('action_failed', 'no longer exists')
        }
      }
    })
  })

  await view.press({ type: 'Link', text: 'soon' })
  const callout = view.find({ type: 'Callout' })
  assert.ok(callout)
  assert.match(callout.text, /no longer exists/)
})

test('keeps up with what the worker sends', async () => {
  view = await mount(panel, {
    host: mockHost({ requests: { 'sessions.list': () => snapshotOf([]) } })
  })
  assert.ok(view.find({ type: 'EmptyState', label: 'No live caches' }))

  await view.post('sessions.changed', snapshotOf([session(1, 'new', 30)]))
  assert.ok(view.find({ type: 'Link', text: 'new' }))
  assert.equal(view.find({ type: 'EmptyState' }), null)
})

test("an old reading doesn't overwrite a newer one", async () => {
  view = await mount(panel, {
    host: mockHost({ requests: { 'sessions.list': () => snapshotOf([session(1, 'new', 30)]) } })
  })

  await view.post('sessions.changed', { sessions: [], at: 0 })
  assert.ok(view.find({ type: 'Link', text: 'new' }))
})

test("warns when the worker doesn't answer", async () => {
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'sessions.list': () => {
          throw hostError('unavailable', 'no worker')
        }
      }
    })
  })

  const callout = view.find({ type: 'Callout' })
  assert.ok(callout)
  assert.match(callout.text, /no worker/)
})
