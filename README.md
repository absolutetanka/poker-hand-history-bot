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
Game: no-limit hold'em
Stakes: 1/2

Hero: big blind — King-3 offsuit
Villain: cutoff — 8-6 suited

Preflop: Cutoff opens to 2.5 big blinds. Big blind calls.
Flop: King-9-4, rainbow
Turn: Ace
River: 2
Showdown: Cutoff shows 8-6 suited

Missing: pot size, stack sizes
```

While it works, the bot reacts to your message: 👀 while processing, ✅ when parsed, ⚠️ when parsed but information is missing, and ❌ when it failed.

## Setup

1. **Node.js 20+**, then `npm install`.
2. **Create the Discord bot** at <https://discord.com/developers/applications>:
   - Bot → **Reset Token**, then copy it into `DISCORD_BOT_TOKEN`.
   - Bot → enable the **Message Content Intent**. This is required, because without it the bot sees empty messages.
   - OAuth2 → URL Generator: scope `bot`; permissions **View Channels**, **Send Messages**, **Read Message History**, **Add Reactions**. Open the URL to invite the bot.
3. **Get channel IDs.** Turn on Developer Mode in Discord, right-click the channel, and choose **Copy Channel ID**.
4. **Get an OpenRouter key** at <https://openrouter.ai/keys>.
5. Copy `.env.example` to `.env` and fill it in.
6. `npm start`

### Try the parser without Discord

```bash
npm run parse -- "1/2 NL. I'm BB with Ks3h. CO makes it 5, I call. Flop K94r. Turn A. River 2. CO has 86s."
```

Set `SHOW_JSON=1` to print the raw structured JSON as well.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | — | Required |
| `HAND_HISTORY_CHANNEL_IDS` | — | Required. Comma-separated. |
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
  discord/messageHandler.js   Channel filter, reactions, replies, error handling
  discord/inputResolver.js    Text vs. voice note → { type, text }
  llm/llmClient.js            OpenRouter adapter: parse(input) → validated hand
  llm/prompt.js               Parser rules sent to the LLM
  llm/handHistorySchema.js    Zod schema + strict JSON Schema (kept in sync by tests)
  stt/                        STT adapter interface + providers
  poker/normalization.js      Deterministic notation normalization (K3o → King-3 offsuit)
  poker/formatter.js          Deterministic Discord output
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
