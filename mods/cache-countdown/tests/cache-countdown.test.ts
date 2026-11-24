import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const NOW = 1_000_000

const USAGE = {
  input_tokens: 10,
  output_tokens: 10,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  model: 'claude-opus-5-5',
}

// A compaction starts from some message and leaves at least one.
const MESSAGES = [{ role: 'user' as const, text: 'hello', toolUses: [] }]

// Beneath the plugin, standing in for the engine: the clock, the session and
// its id, $.store, the status line and the model. `saved` is what earlier
// processes stored.
async function start($: Engine, on: On, saved: Record<string, number> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { sessions: saved })
  const session = { id: 's1' }
  const shown: (string | undefined)[] = []
  const reply = { usage: USAGE as typeof USAGE | null }

  on('session.id', () => ({ value: session.id }))
  on('ui.status', (_, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.compact', () => ({ messages: MESSAGES }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: reply.usage === null ? null : 'end_turn',
      usage: reply.usage,
    }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const step = async (agentId?: string) => {
    const stream = $.turn.step({
      turnId: 't1',
      index: 0,
      model: 'claude-opus-5-5',
      messageCount: 2,
      ...(agentId === undefined ? {} : { agentId }),
    })
    for await (const _ of stream);
    return stream.result
  }

  return { clock, session, shown, reply, step }
}

test('counts down from the last main-thread request', async ($, on) => {
  const { clock, shown, reply, step } = await start($, on)

  await clock.advance(1000)
  expect(shown).toEqual([])

  await step()
  await clock.advance(1000)
  expect(shown.at(-1)).toBe('⏳ cache 59:59')

  await clock.advance(60_000)
  expect(shown.at(-1)).toBe('⏳ cache 58:59')

  // Neither a subagent nor a request without a response renews the cache.
  await step('a1')
  reply.usage = null
  await step()
  await clock.advance(1000)
  expect(shown.at(-1)).toBe('⏳ cache 58:58')

  reply.usage = USAGE
  await step()
  await clock.advance(1000)
  expect(shown.at(-1)).toBe('⏳ cache 59:59')
})

test('resuming carries on with the countdown saved for that session', async ($, on) => {
  const { clock, session, shown } = await start($, on, {
    s1: NOW - 600_000,
    s2: NOW - 3_599_000,
  })

  await clock.advance(1000)
  expect(shown.at(-1)).toBe('⏳ cache 49:59')

  session.id = 's2'
  await clock.advance(1000)
  expect(shown.at(-1)).toBe('⌛ cache expired')

  // Nothing changed, so it doesn't repaint.
  const calls = shown.length
  await clock.advance(3000)
  expect(shown.length).toBe(calls)
})

test('/clear removes it and /resume brings it back', async ($, on) => {
  const { clock, session, shown, step } = await start($, on)

  await step()
  await clock.advance(1000)
  expect(shown.at(-1)).toBe('⏳ cache 59:59')

  session.id = 's2'
  await clock.advance(1000)
  expect(shown.at(-1)).toBeUndefined()

  session.id = 's1'
  await clock.advance(1000)
  expect(shown.at(-1)).toBe('⏳ cache 59:57')
})

test('compacting the main conversation removes it, also after resuming', async ($, on) => {
  const { clock, session, shown, step } = await start($, on)

  await step()
  await clock.advance(1000)
  expect(shown.at(-1)).toBe('⏳ cache 59:59')

  // Neither a precomputed compaction nor a subagent's changes it.
  await $.session.compact({ trigger: 'precompute', messages: MESSAGES })
  await $.session.compact({ trigger: 'auto', messages: MESSAGES, agentId: 'a1' })
  await clock.advance(1000)
  expect(shown.at(-1)).toBe('⏳ cache 59:58')

  await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  await clock.advance(1000)
  expect(shown.at(-1)).toBeUndefined()

  session.id = 's2'
  await clock.advance(1000)
  session.id = 's1'
  await clock.advance(1000)
  expect(shown.at(-1)).toBeUndefined()
})
