# Clabber — Implementation Plan

A 4‑player online Clabber card game. Real humans join with a secret code; empty
seats are played by bots. State is shared between everyone's browser with an
Automerge CRDT, relayed by a self‑hosted sync server. The front end ships as a
static site.

---

## 1. Decisions locked in

| Area               | Decision                                                                                                    | Consequence                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sync transport     | **Self‑hosted Automerge sync server** (small Node/`ws` service in this repo)                                | We run one tiny always‑on process; no dependency on the public demo relay.                                                                       |
| Hidden information | **Trust‑based** — every hand is stored in the doc in plaintext; the UI only renders the local player's hand | Simple and fully CRDT‑native. A determined player could read another hand out of the raw doc. Acceptable for a friendly game; documented in‑app. |
| Front‑end deploy   | **Static site** (`@sveltejs/adapter-static`, SPA mode) hosted on any CDN/Pages                              | No SvelteKit server. The sync server is deployed separately as its own service. The app is handed the sync server URL via a build‑time env var.  |

These three combine cleanly: a static SPA that opens a WebSocket to our own
sync server and keeps a local IndexedDB copy for reconnects.

---

## 2. Tech stack

**Already in the repo:** SvelteKit 2, Svelte 5 (runes forced on), Tailwind 4,
TypeScript, Vitest (browser + node projects), Prettier/ESLint. Drizzle +
`better-sqlite3` are scaffolded but unused by this design — leave them for now,
remove in a later cleanup.

**Added in Phase 0** (exact versions pinned):

| Package                                       | Version | Purpose                                    |
| --------------------------------------------- | ------- | ------------------------------------------ |
| `@automerge/automerge`                        | 3.4.1   | CRDT core (wasm)                           |
| `@automerge/automerge-repo`                   | 2.5.6   | Document repo, sync, `DocHandle`           |
| `@automerge/automerge-repo-network-websocket` | 2.5.6   | Browser ↔ sync‑server transport            |
| `@automerge/automerge-repo-storage-indexeddb` | 2.5.6   | Local persistence / offline reconnect      |
| `vite-plugin-wasm`                            | 3.6.0   | Load the Automerge wasm in the Vite bundle |
| `@sveltejs/adapter-static`                    | 3.0.10  | Static SPA build (replaces `adapter-auto`) |
| `canvas-confetti` / `@types/canvas-confetti`  | 1.9.4   | Winner fireworks                           |

> `vite-plugin-top-level-await` is **not** needed: Vite 8 uses rolldown, which
> emits the top‑level await in Automerge's ESM entry natively (and the plugin's
> hard dependency on `rollup` breaks the build). `@automerge/vite-plugin` does
> not exist on npm.

Sync server (`sync-server/`, its own `package.json`): a ~40‑line wrapper around
`Repo` + `NodeWSServerAdapter` (`@automerge/automerge-repo-network-websocket`) +
`NodeFSStorageAdapter` (`@automerge/automerge-repo-storage-nodefs`) + `ws`. The
published `@automerge/automerge-repo-sync-server` package is stale (0.2.8), so we
own the ~40 lines instead.

---

## 3. Architecture

### 3.1 Networking

```
┌────────────┐   wss://   ┌──────────────────┐   wss://   ┌────────────┐
│ Browser A  │◀──────────▶│  Sync server     │◀──────────▶│ Browser B  │
│ Repo+IDB   │            │  Repo + FS store │            │ Repo+IDB   │
└────────────┘            └──────────────────┘            └────────────┘
        ▲                                                        ▲
        └──────────────── Browser C, Browser D ──────────────────┘
```

- Each browser creates one `Repo` with the WebSocket adapter (URL from
  `PUBLIC_SYNC_URL`) and the IndexedDB storage adapter.
- The sync server is a dumb relay + durable store. It contains **no game
  logic** — it never needs redeploying when rules change.

### 3.2 The secret code ↔ document mapping

Automerge document IDs are random, not chosen. To let a human type a short
friendly code we keep a **directory document** at a well‑known, hard‑coded
Automerge URL (committed as a constant, created once with a one‑off script):

```
directory doc:  { games: { [CODE: string]: AutomergeUrl } }
```

- **Create game:** generate a code (e.g. 4 words / 6 chars, `nanoid`‑style,
  ambiguity‑free alphabet), `repo.create()` a fresh game doc, write
  `directory.games[CODE] = handle.url`.
- **Join game:** look up `directory.games[CODE]`; if present,
  `repo.find(url)`; if absent, show "no game with that code".
- Codes are case‑insensitive, normalised on input. Collisions: regenerate on
  create if the key already exists.

This keeps one shared relay serving many concurrent games with no server code.

### 3.3 Who runs the bots — host election

Bots must be driven by exactly one client or they'd act four times.

- The game doc has `hostActorId`. On load, if `hostActorId` is empty or its
  owner hasn't updated `presence` within ~10 s, the client with the
  lexicographically smallest active `actorId` claims host (CRDT‑safe: writes
  are last‑writer‑wins on a scalar and converge; a brief double‑claim is
  harmless because bot moves are idempotent — see below).
- The host runs a **reconciler**: on every doc change, if
  `state.turn` belongs to a bot seat (or bidding/meld is owed by a bot), it
  computes the move and applies it after a short, humanising delay
  (400–1200 ms).
- **Idempotency:** every mutating action is guarded by a precondition check
  against current doc state (right phase, right seat, card still in hand). Two
  hosts briefly both acting therefore cannot double‑play.

### 3.4 Trust model / limitations (documented in‑app)

- Full hands live in the doc. UI shows only `me`. A small "friendly game —
  don't peek at the raw data" note near the join box.
- No server‑side rules enforcement. Clients validate every local action with
  the shared rules engine; the host also validates bot actions. Malicious
  clients are out of scope.

---

## 4. Game state model (Automerge document)

One document per game. All fields are plain JSON (Automerge‑friendly). Cards are
strings: `"AS" "TS" "KH" "9C"` … (rank ∈ `A K Q J T 9`, suit ∈ `S H D C`).

```ts
type Seat = 0 | 1 | 2 | 3; // 0 bottom (local default), 1 left, 2 top(partner of 0), 3 right
type TeamId = 0 | 1; // team 0 = seats 0 & 2, team 1 = seats 1 & 3

interface PlayerSlot {
	seat: Seat;
	name: string; // editable, pencil icon
	isBot: boolean;
	botName?: string; // "Rainbow Goose", "Michael Jordan", …
	connected: boolean; // derived from presence heartbeats
	actorId?: string; // Automerge actor that "owns" this human seat
	lastSeen: number; // epoch ms heartbeat
}

type Phase =
	| 'lobby'
	| 'dealing'
	| 'bid1' // round 1: play/pass the up-card suit
	| 'bid2' // round 2: choose any other suit, or pass
	| 'redeal' // all passed twice -> same dealer redeals
	| 'meld' // announcements owed on trick 1
	| 'trick' // normal trick play
	| 'handScored' // between hands, show breakdown
	| 'gameOver';

interface GameDoc {
	version: 1;
	code: string;
	createdAt: number;
	hostActorId: string;

	players: PlayerSlot[]; // length 4, one per seat

	phase: Phase;
	dealer: Seat;
	rngSeed: string; // host sets per deal; deterministic shuffle for replay/tests

	hands: Record<Seat, string[]>; // full hands (trust-based)
	upCard: string | null; // dealer's turned-up 6th card during bidding
	trump: 'S' | 'H' | 'D' | 'C' | null;
	maker: TeamId | null; // team that declared trump

	bidding: {
		round: 1 | 2;
		turn: Seat;
		passes: Seat[]; // who has passed this round
		passedSuit: 'S' | 'H' | 'D' | 'C' | null; // suit forbidden in round 2
	} | null;

	trick: {
		number: number; // 1..6
		leader: Seat;
		turn: Seat;
		plays: { seat: Seat; card: string }[];
	} | null;

	tricksWon: Record<Seat, string[][]>; // cards collected, per seat (team totals derived)
	lastTrickWinner: Seat | null;

	melds: {
		// announced on trick 1, shown before trick 2
		declared: Record<Seat, MeldClaim[]>;
		shown: Record<Seat, boolean>;
		resolvedTeam: TeamId | null; // team that scored meld this hand
		bella: Record<Seat, boolean>; // K+Q trump, always scores
	};

	score: {
		running: Record<TeamId, number>; // cumulative toward 500
		hands: HandResult[]; // history for the scoreboard
	};

	winner: TeamId | null;

	log: LogEntry[]; // human-readable event feed (append-only)
}

interface MeldClaim {
	kind: 'dad' | 'fifty' | 'hundred' | 'twohundred' | 'bella';
	cards: string[];
	points: number;
}
interface HandResult {
	dealer: Seat;
	trump: string;
	maker: TeamId;
	trickPoints: Record<TeamId, number>;
	meldPoints: Record<TeamId, number>;
	set: boolean; // maker went set
	awarded: Record<TeamId, number>;
}
```

Presence (heartbeats, "who is looking") uses `automerge-repo`'s ephemeral
messaging **or** a `players[seat].lastSeen` write every 4 s — simplest to keep
it in‑doc and prune on the host.

---

## 5. Rules engine — `src/lib/clabber/` (pure, no Svelte, no Automerge)

Fully unit‑tested pure functions. This is the heart of correctness.

| Module       | Responsibility                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cards.ts`   | 24‑card deck, rank/suit parsing, non‑trump vs trump ordering, point values (Table in the rules).                                                                                                                                                                                                                                                                     |
| `deal.ts`    | Seeded shuffle (`mulberry32`/`seedrandom`), deal 6 each clockwise, set up‑card.                                                                                                                                                                                                                                                                                      |
| `bidding.ts` | `legalBids(doc)`, `applyBid(doc, seat, 'play'                                                                                                                                                                                                                                                                                                                        | 'pass' | {suit})`, round‑1→round‑2→redeal transitions, "must hold ≥1 card of the suit" check, round‑2 forbidden‑suit check. |
| `play.ts`    | `legalMoves(doc, seat)` implementing: follow suit; if void, must trump; must overtrump the highest trump so far (even partner's) when able; else throw off. `applyPlay`, `resolveTrick` (highest trump, else highest of led suit), leader of next trick, last‑trick +10.                                                                                             |
| `meld.ts`    | Detect all melds in a hand (sequences ≥3 in a suit using `9 T J Q K A`; four‑of‑a‑kind; four jacks = 200; bella = K+Q trump). `compareMeld` for "highest meld wins team scoring", equal‑sequence rules (length, then top card, then trump beats non‑trump, else nobody), bella always scores, "dad 'a' belle" 40.                                                    |
| `score.ts`   | End‑of‑hand: trick points per team (+10 last trick, 162 total), add meld, apply **set** rule (maker must strictly out‑score opponents incl. meld or scores 0 and, if set, loses meld unless meld+tricks still outscores), write `HandResult`, update running score, detect ≥500 winner and tie‑break ("both ≥500 → higher total; tie over 500 → play another hand"). |
| `reducer.ts` | `reduce(doc, action, ctx)` — the single entry point every client calls inside `handle.change(...)`. Validates the action against `phase`/`turn`, mutates the draft. All UI and bot code go through this.                                                                                                                                                             |
| `actions.ts` | Action type union: `JoinSeat`, `LeaveSeat`, `RenameSeat`, `ToggleBotFill`, `StartHand`, `Bid`, `AnnounceMeld`, `ShowMeld`, `PlayCard`, `AdvanceAfterHand`, `Heartbeat`, `ClaimHost`.                                                                                                                                                                                 |

Renege handling: keep **light** — the engine simply never offers an illegal
move in `legalMoves`, so honest clients and bots can't renege. A "call renege"
mechanic is out of scope for v1 (noted in §12).

---

## 6. Bot AI — `src/lib/clabber/bot.ts`

Pure `chooseAction(doc, seat): Action`. Heuristic, not search:

- **Bidding:** estimate hand strength for the candidate trump (count trump,
  jacks/nines, aces, bella). Play round 1 if strong; round 2 pick best suit;
  otherwise pass. Never declare a suit it can't legally make.
- **Meld:** always announce everything the detector finds; always show.
- **Trick play:** rule‑restricted candidate list, then:
  - lead: low from long non‑trump, or push trump if holding J/9 trump control;
  - partner winning the trick → throw lowest / dump points onto partner;
  - can win cheaply → do; can't win → slough lowest‑value card;
  - respect the mandatory overtrump rule (engine enforces anyway).
- Humanising delay handled by the host reconciler, not the bot.

Funny name pool lives in `src/lib/clabber/botNames.ts` (Rainbow Goose, Michael
Jordan, Sir Reginald Featherbottom, …). Assigned uniquely when a seat is
bot‑filled.

---

## 7. Card art pipeline

Artifacts: `artifacts/PlayingCards.svg` (Inkscape sprite, viewBox `0 0 832 356`,
each card **64×89**, a **13×4 grid** = 52 cards) and
`artifacts/CardBackscomplete.svg` (backs).

Plan:

1. One‑off build script `scripts/slice-cards.mjs`: rasterise/or split the sprite
   into 24 needed faces + 1 back as individual optimised SVGs (or a single
   cleaned sprite + a JSON coordinate map). Output to
   `src/lib/assets/cards/` (e.g. `AS.svg`, `back.svg`) — committed.
2. First step of the script is a tiny probe that renders the grid with row/col
   labels so we can **confirm the suit/rank ordering** of the sheet before
   trusting the map (rows are most likely the four suits, columns `A 2 … K`).
3. `Card.svelte` takes a `card="AS"` prop → `<img>`/inline SVG, with a
   `faceDown` variant. Sizing via CSS custom property so the table can scale
   cards responsively.

---

## 8. UI / components — `src/lib/components/`

SPA: `src/routes/+layout.ts` sets `export const ssr = false; export const prerender = true;`
Single route `src/routes/+page.svelte` switches on `phase`.

### 8.1 Join screen (`JoinScreen.svelte`)

- Big centred text input for the secret code + "Join".
- "Start a new game" → creates doc, shows the generated code with a copy
  button, drops you into the lobby.
- Small trust‑model note.

### 8.2 Lobby / seating (`Lobby.svelte`, `SeatPicker.svelte`)

- Round green table rendered already (see 8.3) with the 4 seats.
- Empty seat → "Sit here". Occupied seat → shows name + human/bot badge.
- Choose **your team** by choosing a seat (0/2 vs 1/3); partner across the top
  is highlighted.
- Name field with a **pencil icon** to edit your own name.
- "Fill empty seats with computers" toggle → bot names + a little 🖥/robot icon
  next to each bot name. Auto‑fill also triggers automatically on "Deal" if
  seats are open.
- "Deal" enabled once all 4 seats are filled (humans + bots) and ≥1 human.

### 8.3 Table (`Table.svelte`)

- Round table, felt‑green, radial shading; the **local player always at the
  bottom**, partner top, opponents left/right. Seat→screen‑position map rotates
  the doc's fixed seats so "me" is seat‑bottom.
- Each opponent: fanned face‑down cards, name plate, card count, dealer chip,
  "thinking…" indicator when it's their turn (incl. bot delay).
- Center: current trick — up to 4 cards laid toward each player, trump suit
  badge, trick number, running hand points.
- Local hand: fanned, face‑up, sorted (trump grouped, then by rank). Playable
  cards lift on hover and are the only clickable ones (`legalMoves`); illegal
  cards dimmed. **One card at a time** is enforced by `phase==='trick' &&
trick.turn === mySeat`.

### 8.4 Bidding (`BiddingPanel.svelte`)

- Round 1: up‑card shown by the dealer; on your turn, "Play (♦)" / "Pass".
- Round 2: "Pass" plus one button per still‑legal suit (excludes the passed
  suit and suits you hold no card of).
- Live turn indicator around the table; other seats show Play/Pass as it
  happens; log feed on the side.

### 8.5 Meld (`MeldPanel.svelte`)

- On trick 1, before your first card: checkboxes/auto‑detected list of your
  melds with points; "Announce" commits `declared`. Before trick 2 a "Show"
  button commits `shown`. Bella called out separately.
- After trick 1 resolves: banner "Team X scored 50 for meld" from
  `compareMeld`.

### 8.6 Scoreboard (`Scoreboard.svelte`)

- Persistent compact running score (Us vs Them) toward 500.
- `phase==='handScored'` → modal with the full `HandResult` breakdown (trick
  pts, meld, set/no‑set, awarded) and a "Next hand" button (host auto‑advances
  after a timeout too).

### 8.7 End of game (`GameOver.svelte`)

- `canvas-confetti` **fireworks** loop over the winning side of the table.
- Losing side: "tears of sadness" — CSS animated 😢 / falling teardrop
  particles over the two losing seats, desaturated.
- "Play again" resets to lobby keeping seats/names.

### 8.8 Shared state glue — `src/lib/repo/`

- `repo.ts`: singleton `Repo` (WS + IndexedDB), `PUBLIC_SYNC_URL`.
- `directory.ts`: get/create the directory doc, code↔url helpers.
- `gameStore.svelte.ts`: Svelte 5 runes wrapper around a `DocHandle` —
  `$state` doc snapshot, `change(fn)`, derived `me`, `legalMoves`, `myTurn`.
- `presence.ts`: 4 s heartbeat writer + stale‑seat pruning (host only).
- `host.ts`: election + bot reconciler loop.

---

## 9. Directory / file structure (target)

```
scripts/
  slice-cards.mjs           # card art -> src/lib/assets/cards/*
  create-directory-doc.mjs  # one-off: mint the well-known directory doc
sync-server/
  package.json              # its own deployable
  server.mjs                # Repo + NodeWSServerAdapter + FS storage
  Dockerfile
src/lib/
  clabber/                  # PURE rules engine + bot (fully unit tested)
    cards.ts deal.ts bidding.ts play.ts meld.ts score.ts
    reducer.ts actions.ts bot.ts botNames.ts types.ts
    *.spec.ts
  repo/
    repo.ts directory.ts gameStore.svelte.ts presence.ts host.ts
  components/
    Card.svelte Table.svelte Seat.svelte
    JoinScreen.svelte Lobby.svelte SeatPicker.svelte
    BiddingPanel.svelte MeldPanel.svelte Scoreboard.svelte
    GameOver.svelte Fireworks.svelte Tears.svelte
  assets/cards/             # generated card SVGs (committed)
src/routes/
  +layout.ts   (ssr=false, prerender=true)
  +layout.svelte
  +page.svelte             # phase switch
docs/
  implementation-plan.md   # this file
```

---

## 10. Implementation phases

Each phase ends green (`npm run lint`, `npm test`, app builds).

### Phase 0 — Project setup — ✅ done

- [x] Repo already `git init`'d (`main`, "initial commit"). Working tree clean.
- [x] Deps added and pinned (§2). Removed `adapter-auto`; `vite.config.ts` now
      uses `adapter-static` with `fallback: 'index.html'` + `vite-plugin-wasm` + `optimizeDeps.exclude` for the Automerge packages.
- [x] `src/routes/+layout.ts` → `ssr = false`, `prerender = false` (SPA).
- [x] `.env` / `.env.example`: `PUBLIC_SYNC_URL=ws://localhost:3030`.
- [x] `sync-server/` — own `package.json`, `server.mjs` (Repo + `NodeWSServerAdapter` + `NodeFSStorageAdapter`), `Dockerfile`, `README.md`. Root scripts
      `sync`, `sync:dev`, `sync:install`.
- [x] `scripts/smoke-sync.mjs` — two independent repos sync a counter doc
      through the running server (passes).
- [x] `src/lib/repo/wasm.svelte.spec.ts` — Automerge wasm creates/mutates/merges
      docs in headless Chromium (client Vitest project, passes).
- [x] Green gate: `npm run lint`, `npm run check`, `npm test`, `npm run build`
      (emits `build/index.html`), `npm run dev` all pass.
- Notes: `artifacts/`, `CLAUDE.md`, `sync-server/data/` added to
  `.prettierignore` (vendored / runtime).

### Phase 1 — Card rendering

- `scripts/slice-cards.mjs` + ordering probe; generate `src/lib/assets/cards/`.
- `Card.svelte` (+ face‑down); a `/dev` gallery page (dev‑only) showing all 24 +
  back.

### Phase 2 — Rules engine (no UI)

- `types.ts`, `cards.ts`, `deal.ts` with seeded shuffle + tests.
- `bidding.ts`, `play.ts`, `meld.ts`, `score.ts`, `reducer.ts`, `actions.ts`.
- Extensive `*.spec.ts`, including worked examples from the rules doc: 162‑point
  total, set rule, meld comparison ties, bella / "dad 'a' belle" 40, last‑trick
  +10, round‑2 forbidden suit, must‑overtrump.
- A `simulate.ts` test helper that plays full random games with 4 bots to
  assert invariants (points conserved, hands empty after 6 tricks, someone
  reaches 500, no illegal move ever offered).

### Phase 3 — Networking & lobby

- `repo.ts`, `directory.ts`, `create-directory-doc.mjs` (mint + commit the URL).
- `gameStore.svelte.ts`, `presence.ts`.
- `JoinScreen` (join + create), `Lobby` + `SeatPicker`: sit/stand, rename with
  pencil, team choice, bot‑fill toggle with robot icon + funny names.
- Two‑machine manual test: code round‑trips, seating converges.

### Phase 4 — Host & bots

- `host.ts`: election + heartbeat‑based takeover + reconciler with humanised
  delays. `bot.ts` + `botNames.ts`.
- Test: 1 human + 3 bots plays a whole game unattended; drop/rejoin the human
  and a bot mid‑hand, host migrates, no double‑plays.

### Phase 5 — Table & play UI

- `Table.svelte` seat rotation (me at bottom), `Seat.svelte`, opponent fans,
  dealer chip, turn/thinking indicators.
- `BiddingPanel`, `MeldPanel`, in‑hand `legalMoves` gating (one card at a time),
  trick animation, trump badge, log feed.
- `Scoreboard` running + per‑hand modal; host auto‑advance.

### Phase 6 — Win / lose

- `Fireworks.svelte` (canvas‑confetti) on the winners' half; `Tears.svelte`
  crying animation on the losers' half; desaturate losers. "Play again".

### Phase 7 — Polish & deploy

- Reconnect/resume (IndexedDB), stale‑seat cleanup, empty‑seat → bot on
  disconnect (with a grace period), mobile/responsive table scaling,
  a11y (keyboard play, ARIA turn announcements), reduced‑motion fallback for
  fireworks/tears.
- Build static site; deploy `sync-server/` (Docker) to a small always‑on host;
  set `PUBLIC_SYNC_URL` for the production build; smoke test 4 real devices.
- Cleanup: remove unused Drizzle/`better-sqlite3` scaffold if still unused.

---

## 11. Testing strategy

- **Unit (node project):** the entire `src/lib/clabber/` tree. Target: every
  rule in the rules doc has a named test. Deterministic via `rngSeed`.
- **Property/simulation:** thousands of full bot games asserting invariants.
- **Component (browser project):** `Card`, `BiddingPanel` legal‑button set,
  `MeldPanel` detection display, `Scoreboard` breakdown, seat rotation math.
- **Integration:** drive two in‑process `Repo`s wired to an in‑memory network,
  run a scripted 4‑player hand, assert both docs converge and match an expected
  `HandResult`.
- **Manual multi‑device checklist** kept in `docs/` for each release.

---

## 12. Risks & open questions

- **Sprite ordering** unknown until the Phase 1 probe — cheap to resolve.
- **Directory‑doc contention:** many games sharing one directory doc is fine
  (map of small strings) but it grows forever — add a TTL prune on the host, or
  shard by first code letter later.
- **Host election races** on flaky networks — mitigated by idempotent,
  precondition‑guarded actions; worth a focused test.
- **Trust model:** hands are readable in the raw doc. If this ever needs to be
  real, revisit per‑seat encryption (keys derived from the code) — designed
  around but not built.
- **Renege calls** are not implemented (engine just prevents illegal moves).
  Fine for casual play; a "call renege" flow is a future feature.
- **Automerge wasm on static hosts:** ensure the host serves `.wasm` with the
  right MIME type; the Vite plugin inlines/handles this but verify on the CDN.
- **Tie at/over 500 "play another hand"** — implemented in `score.ts`; make sure
  the UI handles a game that doesn't end at exactly the 500 crossing.

## 13. Out of scope for v1

Spectators, chat, reconnect to a _finished_ game's history browser, accounts,
matchmaking/lobby list, mobile app packaging, sound effects, renege calls,
tournament/round‑robin scoring.
