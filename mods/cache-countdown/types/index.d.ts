/** Milliseconds since the epoch, as `$.clock.now()` returns them. */
export type EpochMs = number

declare module 'claude-code' {
  interface PluginState {
    'cache-countdown': { lastRequestAt: EpochMs | null }
  }
}
