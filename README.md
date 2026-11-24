# Claude Caches for Orca

An [Orca](https://orca.dev) plugin that lists the live Claude Code sessions on your machine and how
long each one's prompt cache has left, with the one that expires soonest on top.

[Open in Orca](https://orca.dev/plugins/francisvega.claude-cache-panel?catalog=community)

A Claude Code session's prompt cache lasts an hour, and every main-thread request that reads it
renews it. Once the hour runs out, the session's next request processes its whole context again,
uncached. This plugin shows which session is about to lose its cache, so you can get back to it in
time, or let it go.

## What you get

- **A panel** with one row per live session and its countdown: green, amber under 15 min and red
  under 5. Expired sessions and the ones with no data are folded underneath. Pressing a session's
  name opens its workspace.
- **A status bar item** with the cache that expires soonest (`10 min · fix-login-redirect`), in the
  same color, hidden when no cache is live. Pressing it, or running **Claude Caches: Go to the
  session expiring soonest** from the command palette, opens that session's workspace.

The plugin comes in two halves, both in this repository:

| Folder | What it is | Runs in |
| --- | --- | --- |
| `/` (`orca-plugin.json`, `src/`) | The panel, the status bar item and the worker that feeds them | Orca |
| `mods/cache-countdown/` | A mod that records when each session's last request started, and also shows the countdown in Claude Code's status line | Claude Code |

Without the mod, every session shows "no data".

## Install

### 1. The Claude Code mod

At the prompt of a Claude Code terminal session:

```
/plugin install cache-countdown --marketplace FrancisVega/claude-cache-panel
```

Answer `y` to add the marketplace, then pick the user scope so it counts in every session. From a
shell instead:

```sh
claude plugin install cache-countdown --marketplace FrancisVega/claude-cache-panel
```

A session gets its countdown with its next request: sessions started before the mod was
installed, or just compacted, have nothing recorded yet.

### 2. The Orca plugin

Open [its page in Orca's plugin directory](https://orca.dev/plugins/francisvega.claude-cache-panel?catalog=community)
to see it in Orca (Settings → Plugins) and press Install there, or from a terminal:

```sh
orca plugin install FrancisVega/claude-cache-panel
```

Orca asks you to approve what the plugin gets before anything runs:

- **Full access (`trusted-worker`)**: its worker runs in a Node process on your machine. It reads
  the files listed under [How it works](#how-it-works) and checks whether each session's process is
  still running. It makes no network requests.
- **`workspace:read`**: to find the Orca workspace each session runs in.
- **`workspace:write`**: to open that workspace when you press a session.

Needs Orca 1.4.248 or later.

## How it works

Every 5 s the worker reads the sessions, updates the status bar and posts the reading to any open
panel. Orca keeps the worker running while the plugin is enabled, because the plugin has a status
bar item.

- `~/.claude/sessions/<pid>.json`: Claude Code writes one per process, with its `sessionId`, its
  folder and its status. Files left behind by processes that no longer exist are skipped.
- `~/.claude/plugins/store/cache-countdown_*.json`: for each session, the mod saves when its last
  main-thread request that got a response started. Subagents don't count, since they cache their
  own prefix, and compacting clears it, since the context is new. The cache expires 1 h later.
- Orca's workspace list, to name each session after the workspace that contains it. Outside Orca,
  the session's folder is used.

`CLAUDE_CONFIG_DIR` is respected when set.

The countdown assumes the 1-hour cache TTL. The mod uses Claude Code's function hooks, which are in
early access and may change between Claude Code releases.

## Development

```sh
orca plugin test src         # worker and panel tests (`.` would also pick up the mod's tests)
orca plugin check .          # renders the panel in each scenario of src/panel.check.ts
orca plugin dev watch .      # loads it into Orca (asks for approval) and reloads on save
npx -p typescript tsc -p .   # type-check, once `orca plugin types .` has written the typings

claude plugin validate .                   # the marketplace and the mod
claude plugin test mods/cache-countdown    # the mod's tests
claude --plugin-dir mods/cache-countdown   # a Claude Code session with the mod loaded from here
```

`src/node.d.ts` declares the little of Node the worker uses, so the plugin doesn't need
`@types/node`.

## Releasing

1. Bump `version` in `orca-plugin.json`, and in `mods/cache-countdown/.claude-plugin/plugin.json`
   when the mod changed. Run `orca plugin validate .`.
2. Commit, then tag that commit and push the tag: `git tag -a v0.3.0 -m v0.3.0 && git push origin v0.3.0`.
3. Once: give the repository the `orca-plugin` topic (`gh repo edit --add-topic orca-plugin`).

Orca's plugin directory lists the newest `vX.Y.Z` tag, usually within an hour; a moved tag is
never picked up again. <https://orca.dev/plugins/FrancisVega/claude-cache-panel> shows whether it is
listed and, if not, what to fix. Claude Code users get a new version of the mod with
`claude plugin update cache-countdown@claude-cache-panel`.

## License

[MIT](LICENSE). An independent project, not made or endorsed by Anthropic or by Orca's makers.
