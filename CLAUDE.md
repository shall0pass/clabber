# Clabber

A four-player online Clabber card game (SvelteKit + Automerge CRDT sync). Bots fill empty
seats. Goals and requirements: `docs/PROJECT.md`. Game rules: `artifacts/game_rules.md`.

## Docs to keep current

- `docs/ARCHITECTURE.md` — architectural decisions; update when one is made or changed.
- `docs/TODO.md` — current priorities; update as issues arise or close.
- `docs/USER_MANUAL.md` — player-facing manual; update when a feature is added or changed.

## Commands

- `npm test` — unit tests (vitest, single run)
- `npm run check` — svelte-check / type check
- `npm run lint` — prettier + eslint
- `npm run dev` / `npm run sync:dev` — app / sync server

## Development rules

- Preserve existing behavior unless a change is intentional.
- Players do the work the rules assign them: don't auto-detect, warn about, or resolve
  things like meld or reneges on the player's behalf.
- Measure performance rather than assume it.
- After a change, run the tests and type check relevant to what you touched.

## Agent strategy

The main session does most work itself. A subagent starts cold and has to rebuild
context, so spawn one only when it clearly pays off:

| Agent | Model | Use when |
| --- | --- | --- |
| `scout` | Haiku | A broad search, or a test/log run whose raw output would flood the main context. |
| `engineer` | Sonnet | A well-specified, self-contained implementation task that can run in parallel or in the background. |
| `architect` | Opus | A significant design decision, a bug that has resisted real debugging, or a final review of a large change. |

- Skip the chain for small or medium tasks. Don't run scout → engineer → architect by default.
- Give each agent a complete brief: the goal, the relevant files, constraints, and what
  "done" means. It can't see this conversation.
- Subagents can't spawn other agents. If an engineer reports that it needs architecture
  input, the main session decides whether to call the architect.
