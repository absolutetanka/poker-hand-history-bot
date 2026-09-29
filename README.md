# Discord Poker Hand History Bot (v0.1)

A Discord bot that listens in configured channels and turns a typed or spoken poker hand description into a consistent hand-history format. The architecture spec is in [discord_poker_hand_history_bot_v0.1_openrouter.md](discord_poker_hand_history_bot_v0.1_openrouter.md).

```text
Discord message ─┬─ text ──────────────────────┐
                 └─ voice note → STT adapter ──┤
                                               v
             OpenRouter (openrouter/free, strict JSON schema)
                                               v
                       Zod validation → deterministic formatter → reply
```

**Example.** You post:

> Game no limit holdem stakes one two. I'm BB with king three offsuit. CO opens to two point five big blinds. I call. Flop king nine four rainbow. Turn ace. River two. CO shows eight six suited.

The bot replies:

```text
NLH 1/2 · Effective: ?

Hero (BB): K3o
CO: 86s (shown)

Preflop (1.5bb): CO raises to 2.5bb, Hero calls.
Flop (5.5bb): K94r
Turn: A
River: 2
Showdown: CO shows 86s.

Missing: stacks, postflop action
```

The output follows forum hand-review conventions:
- **Card notation** is standard: `Ks3h`, `K3o`, `86s`, and boards like `Kh 9c 4d` or `K94r`. Suits are never guessed.
- **Positions** are abbreviations (UTG, HJ, CO, BTN, SB, BB), and sizes are in big blinds.
- **The pot at the start of each street** is calculated by the bot, not the LLM. It's shown only when every amount before it is known. Blinds count as posted, and antes and straddles aren't supported yet.
- **The Missing line** is built by the bot from what's actually absent.

While it works, the bot reacts to your message: 👀 while processing, ✅ when parsed, ⚠️ when parsed but information is missing, ❌ when it failed, and ⏳ when a rate limit was hit.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/hand description:… audio:…` | Anyone | Formats a hand from text or an audio file, in any channel. |
| `/setup add #channel` | Manage Server | Watches a channel, so every hand posted there is formatted. |
| `/setup remove #channel`, `/setup list` | Manage Server | Stops watching a channel, or lists watched channels. |
| `/help` | Anyone | Shows usage (only visible to you). |

Slash commands register automatically when the bot starts.

## Setup

1. **Node.js 22.13+** (the settings database uses Node's built-in SQLite), then `npm install`.
2. **Create the Discord bot** at <https://discord.com/developers/applications>:
   - Bot → **Reset Token**, then copy it into `DISCORD_BOT_TOKEN`.
   - Bot → enable the **Message Content Intent**. Watched channels need it; `/hand` works without it.
   - OAuth2 → URL Generator: scopes `bot` and `applications.commands`; permissions **View Channels**, **Send Messages**, **Read Message History**, **Add Reactions**. Open the URL to invite the bot.
3. **Get an OpenRouter key** at <https://openrouter.ai/keys>.
4. Copy `.env.example` to `.env` and fill it in.
5. `npm start`, then run `/setup add #channel` in your server.

### Deploying on Railway

1. **New Project → Deploy from GitHub repo**, then paste your `.env` into the service's **Variables → Raw Editor**.
2. **Add a volume** so `/setup` choices survive redeploys: right-click the service (or use **+ Create → Volume**), then mount it at `/data`.
3. Add the variable `DATA_DIR=/data`.
4. Every push to `main` redeploys automatically.

### Try the parser without Discord

```bash
npm run parse -- "1/2 NL. I'm BB with Ks3h. CO makes it 5, I call. Flop K94r. Turn A. River 2. CO has 86s."
```

Set `SHOW_JSON=1` to print the raw structured JSON as well.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | — | Required |
| `HAND_HISTORY_CHANNEL_IDS` | — | Optional fixed channels, comma-separated. Normally servers use `/setup add`. |
| `DATA_DIR` | `./data` | Folder for the SQLite settings database. Use a persistent volume in production. |
| `RATE_LIMIT_USER_PER_HOUR` | `10` | Hands per user per hour (`0` = unlimited). |
| `RATE_LIMIT_GUILD_PER_DAY` | `200` | Hands per server per day (`0` = unlimited). |
| `OPENROUTER_API_KEY` | — | Required. Never commit or log this. |
| `OPENROUTER_MODEL` | `openrouter/free` | |
| `OPENROUTER_RESPONSE_FORMAT` | `json_schema` | `json_schema` (strict), `json_object`, or `none`. If the free router says no endpoint supports the requested parameters, relax this setting. Zod still validates every response. |
| `OPENROUTER_FALLBACK_MODELS` | — | Comma-separated models to fall back to when the primary is rate-limited or erroring. `openrouter/free` works as a catch-all last entry. |
| `OPENROUTER_REASONING` | `default` | `off` skips slow reasoning ("thinking") models, so a hand parses in a few seconds instead of about 50. Models where reasoning can't be turned off are retried with it allowed. |
| `OPENROUTER_MAX_ATTEMPTS` | `3` | Retries on 429/5xx, invalid JSON, or schema failures, with exponential backoff (`OPENROUTER_RETRY_BASE_DELAY_MS`, default 2000). |
| `OPENROUTER_TIMEOUT_MS` | `60000` | |
| `USE_REACTIONS` | `true` | Set `false` to use the typing indicator only. |
| `STT_PROVIDER` | `none` | `none`, `browser_bridge`, or `openai_whisper` |
| `STT_ENDPOINT` / `STT_API_KEY` / `STT_MODEL` | | See below. |
| `LOG_LEVEL` | `info` | `debug` logs input text and the model OpenRouter picked. |

## Speech-to-text

Voice notes (`audio/ogg`, `mpeg`, `mp4`, `webm`, `wav`) are downloaded and passed to one STT adapter. The transcript then goes through the same pipeline as typed text.

- **`none`**: voice notes get a polite "could not transcribe" reply.
- **`openai_whisper`**: works with any OpenAI-compatible `/audio/transcriptions` endpoint. It defaults to OpenAI (`whisper-1`). For Groq, set `STT_ENDPOINT=https://api.groq.com/openai/v1/audio/transcriptions` and `STT_MODEL=whisper-large-v3`. This is the recommended production option.
- **`browser_bridge`**: POSTs the raw audio to your own browser-based Web Speech worker. The request has `Content-Type: <mime>`, `X-Filename`, and optionally `Authorization: Bearer <STT_API_KEY>`. The worker must answer `{ "transcript": "..." }`. The worker itself isn't part of v0.1 (see spec §18).

To add a provider, extend `SpeechToTextProvider` in `src/stt/` and register it in `src/stt/index.js`.

## Project layout

```text
src/
  index.js                    Discord client wiring
  config.js                   Environment config
  discord/messageHandler.js   Watched-channel messages: reactions, replies, rate limits
  discord/commands.js         Slash commands: /hand, /setup, /help
  discord/shared.js           Shared parse -> validate -> format pipeline and replies
  storage/guildSettings.js    Per-server watched channels (SQLite)
  utils/rateLimiter.js        Per-user and per-server limits
  discord/inputResolver.js    Text vs. voice note → { type, text }
  llm/llmClient.js            OpenRouter adapter: parse(input) → validated hand
  llm/prompt.js               Parser rules sent to the LLM
  llm/handHistorySchema.js    Zod schema + strict JSON Schema (kept in sync by tests)
  stt/                        STT adapter interface + providers
  poker/normalization.js      Standard notation: cards (Ks3h, K3o), boards (K94r), positions (CO)
  poker/handState.js          Replays the action: pot per street, effective stack, missing info
  poker/formatter.js          Deterministic forum-style Discord output
scripts/parse.js              CLI for the text pipeline
test/                         node:test suites (no network)
```

## Tests

```bash
npm test
```

The tests cover the canonical formatter output, schema parity, the OpenRouter request contract, retries and errors, the text and voice pipelines, the ignore rules, and clean failure replies. They mock every network call.

## Design notes

- The LLM only produces JSON. The bot validates it with Zod and formats the reply itself, so the LLM is never the final validator.
- Normalization after validation only rewrites notation. Hand tokens it can't read unambiguously, such as a bare `22` that could be a chip amount, are left as they are.
- Replies turn off all mentions, so text from the LLM or the user can't ping `@everyone`.
- v0.1 leaves out strategy advice, persistence, slash commands, and pot reconstruction (spec §26).
