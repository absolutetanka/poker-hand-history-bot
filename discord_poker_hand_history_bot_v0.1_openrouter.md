# Discord Poker Hand History Bot — v0.1 Architecture (OpenRouter)

## 1. Purpose

Build a Node.js Discord bot that listens to one or more configured Discord channels and converts an unstructured poker hand description into a consistent, readable hand-history format.

The bot accepts either:

1. **Typed text** posted directly in the Discord channel.
2. **Discord voice notes / audio attachments**, which are converted to text before parsing.

The resulting transcript/text is sent to an AI LLM along with the **required hand-history structure**. The LLM transforms the user's input into structured hand-history data. The bot validates the result, formats it deterministically, and posts it back into the Discord channel.

For v0.1, the LLM layer is implemented with **OpenRouter** using the `openrouter/free` router. The public model page is `https://openrouter.ai/openrouter/free`; API calls themselves use the OpenRouter Chat Completions endpoint at `https://openrouter.ai/api/v1/chat/completions`.

---

## 2. Example Input

A user might type or say:

> No limit hold'em, one two. I'm in the big blind with king three of spades. Cutoff opens to two and a half big blinds and I call. Flop is king nine four rainbow. Turn ace. River two. Cutoff shows eight six suited.

The bot should return something similar to:

```text
Game: no-limit hold'em
Stakes: one-two

Hero: big blind King-3 offsuit
Villain: cutoff

Preflop: Cutoff opens to 2.5 big blinds. Big blind calls.
Flop: King-9-4, rainbow
Turn: Ace
River: 2
Showdown: cutoff shows 8-6 suited

Missing: pot size, stack sizes
```

---

## 3. High-Level Flow

```text
Discord Message Created
        |
        v
Is message in configured hand-history channel?
        |
        v
+-------------------------+
| Determine Input Type    |
+-------------------------+
   |                  |
   | text             | voice/audio
   v                  v
Use message text    Download attachment
                      |
                      v
                  STT Adapter
                      |
                      v
                 Transcript
   \                  /
    \                /
     v              v
       Normalize Input
            |
            v
     Send to LLM Parser
       - user text
       - schema/format
            |
            v
       Structured JSON
            |
            v
     Validate / Normalize
            |
            v
       Format Response
            |
            v
     Post in Discord Chat
```

---

## 4. Recommended Stack

- **Runtime:** Node.js 20+
- **Discord library:** `discord.js` v14
- **Validation:** `zod`
- **HTTP:** native `fetch()`
- **Environment variables:** `dotenv`
- **Logging:** `pino` or a lightweight console logger for v0.1
- **LLM integration:** OpenRouter Chat Completions API using `openrouter/free`
- **STT integration:** adapter interface so transcription can be replaced without changing the Discord or hand-history logic

---

## 5. Important Note About Browser Web Speech API

The browser Web Speech API is primarily a **browser-side microphone speech-recognition API**. A normal Node.js Discord bot cannot simply pass a Discord `.ogg` or `.mp3` voice-note file directly into `SpeechRecognition`.

For that reason, the bot should treat STT as a replaceable adapter:

```text
SpeechToTextProvider
    transcribe(audioBuffer, mimeType) -> string
```

### Preferred production architecture

Use a server-side STT API/provider for Discord voice notes.

### Browser Web Speech API option

If Browser Web Speech API is mandatory, use a separate browser-based STT worker/bridge. The Node bot sends the audio job to that worker and receives the resulting transcript.

This keeps the rest of the bot unchanged if the STT method later changes.

---

# 6. Discord Behavior

## Channel Listener

The bot should only process messages from explicitly configured channels.

Example environment variable:

```env
HAND_HISTORY_CHANNEL_IDS=123456789012345678,234567890123456789
```

### Ignore

The bot should ignore:

- its own messages
- other Discord bots
- unsupported attachments
- messages outside configured channels
- empty messages with no usable text/audio

---

## 7. Supported Input Types

### 7.1 Text

Use `message.content` directly.

Example:

```text
1/2 NL. I'm BB with Ks3h. CO makes it 5, I call. Flop K94r. Turn A. River 2. CO has 86s.
```

### 7.2 Discord Voice Note

Detect audio attachments using Discord attachment metadata and/or MIME type.

Common accepted MIME types may include:

```text
audio/ogg
audio/mpeg
audio/mp4
audio/webm
audio/wav
```

Pipeline:

```text
Discord attachment URL
        -> download audio
        -> STT adapter
        -> transcript string
        -> normal parsing pipeline
```

---

# 8. Core Hand History Schema

The AI should return structured JSON rather than free-form Markdown.

This gives the bot control over formatting and makes the output reliable.

## Suggested JSON Shape

```json
{
  "game": "no-limit hold'em",
  "stakes": "1/2",
  "hero": {
    "position": "big blind",
    "hand": "K3o"
  },
  "villains": [
    {
      "position": "cutoff",
      "hand": "86s"
    }
  ],
  "preflop": [
    "Cutoff opens to 2.5 big blinds",
    "Big blind calls"
  ],
  "flop": {
    "cards": ["K", "9", "4"],
    "texture": "rainbow",
    "actions": []
  },
  "turn": {
    "card": "A",
    "actions": []
  },
  "river": {
    "card": "2",
    "actions": []
  },
  "showdown": [
    "Cutoff shows 86s"
  ],
  "result": null,
  "pot_size": null,
  "effective_stack": null,
  "missing": [
    "pot size",
    "stack sizes"
  ]
}
```

---

# 9. Zod Validation Model

Suggested schema:

```js
import { z } from 'zod';

export const HandHistorySchema = z.object({
  game: z.string().nullable(),
  stakes: z.string().nullable(),

  hero: z.object({
    position: z.string().nullable(),
    hand: z.string().nullable()
  }),

  villains: z.array(
    z.object({
      position: z.string().nullable(),
      hand: z.string().nullable()
    })
  ),

  preflop: z.array(z.string()),

  flop: z.object({
    cards: z.array(z.string()).max(3),
    texture: z.string().nullable(),
    actions: z.array(z.string())
  }).nullable(),

  turn: z.object({
    card: z.string().nullable(),
    actions: z.array(z.string())
  }).nullable(),

  river: z.object({
    card: z.string().nullable(),
    actions: z.array(z.string())
  }).nullable(),

  showdown: z.array(z.string()),
  result: z.string().nullable(),
  pot_size: z.string().nullable(),
  effective_stack: z.string().nullable(),
  missing: z.array(z.string())
});
```

---

# 10. LLM Request Contract

The LLM receives exactly two conceptual inputs:

## Thing 1 — User Text

This is either:

- the Discord text message, or
- the transcript produced from a Discord voice note.

Example:

```text
Game no limit holdem one two. Hero big blind king three offsuit. Cutoff opens two and a half blinds, I call. Flop king nine four rainbow. Turn ace. River two. Cutoff shows eight six suited.
```

## Thing 2 — Required Hand-History Structure

Send the JSON schema/shape and parsing rules with the request.

The LLM should be instructed:

```text
Transform USER_TEXT into the supplied HAND_HISTORY_SCHEMA.

Rules:
- Never invent information.
- Use null when a scalar value is unknown.
- Use [] when an action list has no known actions.
- Add important absent information to `missing`.
- Normalize common poker terminology.
- Preserve meaningful action sizes exactly when possible.
- Distinguish chip amounts from big-blind amounts when the user makes that distinction.
- Do not calculate missing pot sizes unless every required action/amount is known and calculation is explicitly enabled.
- Return JSON only.
```

---

# 11. OpenRouter LLM Configuration

The project will use OpenRouter's **Free Models Router**.

The user-facing OpenRouter model page is:

```text
https://openrouter.ai/openrouter/free
```

The actual API request should be sent to:

```text
POST https://openrouter.ai/api/v1/chat/completions
```

Use this model slug:

```text
openrouter/free
```

OpenRouter will route the request to an available free model. Because this bot depends on structured data, the request should ask for structured output and require providers to honor the request parameters.

Recommended conceptual payload:

```json
{
  "model": "openrouter/free",
  "messages": [
    {
      "role": "system",
      "content": "You are a poker hand-history parser. Convert the user's description into the supplied hand-history schema. Never invent missing information."
    },
    {
      "role": "user",
      "content": "USER_TEXT: ...\n\nHAND_HISTORY_SCHEMA: ..."
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "poker_hand_history",
      "strict": true,
      "schema": {}
    }
  },
  "provider": {
    "require_parameters": true
  }
}
```

`schema` should contain the bot's real JSON Schema, not an empty object. The Zod schema can remain the application's final validation layer even when OpenRouter structured output is enabled.

### Why both structured output and Zod?

```text
OpenRouter structured output
        -> improves model response reliability
        -> JSON.parse()
        -> Zod validation
        -> deterministic formatter
```

The LLM must never be trusted as the final validator.

---

# 12. Poker Normalization Rules

The LLM may normalize common poker language.

Examples:

```text
BB              -> big blind
SB              -> small blind
BTN             -> button
CO              -> cutoff
UTG             -> under the gun
NLH             -> no-limit hold'em
PLO             -> pot-limit Omaha
2.5bb            -> 2.5 big blinds
K3o             -> King-3 offsuit
86s             -> 8-6 suited
K94r            -> King-9-4, rainbow
```

Do not normalize in a way that changes poker meaning.

---

# 13. Discord Output Format

The bot should format validated JSON itself rather than asking the LLM to generate the final Discord response.

Example:

```text
Game: no-limit hold'em
Stakes: 1/2

Hero: big blind — King-3 offsuit
Villain: cutoff

Preflop: Cutoff opens to 2.5 big blinds. Big blind calls.
Flop: King-9-4, rainbow
Turn: Ace
River: 2
Showdown: Cutoff shows 8-6 suited

Missing: pot size, stack sizes
```

If street actions are known:

```text
Flop: King-9-4, rainbow. Hero checks. Cutoff bets 3bb. Hero calls.
```

---

# 14. Formatter Function

Suggested shape:

```js
export function formatHandHistory(hand) {
  const lines = [];

  if (hand.game) lines.push(`Game: ${hand.game}`);
  if (hand.stakes) lines.push(`Stakes: ${hand.stakes}`);

  lines.push('');

  if (hand.hero?.position || hand.hero?.hand) {
    const heroParts = [hand.hero.position, hand.hero.hand].filter(Boolean);
    lines.push(`Hero: ${heroParts.join(' — ')}`);
  }

  for (const villain of hand.villains ?? []) {
    const villainParts = [villain.position, villain.hand].filter(Boolean);
    lines.push(`Villain: ${villainParts.join(' — ')}`);
  }

  lines.push('');

  if (hand.preflop?.length) {
    lines.push(`Preflop: ${hand.preflop.join('. ')}.`);
  }

  if (hand.flop) {
    const board = hand.flop.cards?.join('-');
    const texture = hand.flop.texture ? `, ${hand.flop.texture}` : '';
    const actions = hand.flop.actions?.length
      ? `. ${hand.flop.actions.join('. ')}.`
      : '';

    lines.push(`Flop: ${board}${texture}${actions}`);
  }

  if (hand.turn) {
    const actions = hand.turn.actions?.length
      ? `. ${hand.turn.actions.join('. ')}.`
      : '';
    lines.push(`Turn: ${hand.turn.card ?? 'unknown'}${actions}`);
  }

  if (hand.river) {
    const actions = hand.river.actions?.length
      ? `. ${hand.river.actions.join('. ')}.`
      : '';
    lines.push(`River: ${hand.river.card ?? 'unknown'}${actions}`);
  }

  if (hand.showdown?.length) {
    lines.push(`Showdown: ${hand.showdown.join('. ')}`);
  }

  if (hand.result) {
    lines.push(`Result: ${hand.result}`);
  }

  if (hand.missing?.length) {
    lines.push('');
    lines.push(`Missing: ${hand.missing.join(', ')}`);
  }

  return lines.join('\n');
}
```

---

# 15. Discord Message Handler

Pseudo-implementation:

```js
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!HAND_HISTORY_CHANNEL_IDS.has(message.channelId)) return;

  try {
    await message.channel.sendTyping();

    const input = await getUserInput(message);

    if (!input) {
      await message.reply('I could not find any text or supported voice note to parse.');
      return;
    }

    const parsedHand = await parseHandWithLLM(input);
    const validatedHand = HandHistorySchema.parse(parsedHand);
    const output = formatHandHistory(validatedHand);

    await message.reply(output);
  } catch (error) {
    logger.error(error);
    await message.reply('I could not parse that hand. Please try again or provide a little more detail.');
  }
});
```

---

# 16. Input Resolver

```js
async function getUserInput(message) {
  const text = message.content?.trim();

  if (text) {
    return {
      type: 'text',
      text
    };
  }

  const audio = [...message.attachments.values()].find((attachment) => {
    return attachment.contentType?.startsWith('audio/');
  });

  if (!audio) return null;

  const audioResponse = await fetch(audio.url);
  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

  const transcript = await speechToText.transcribe({
    buffer: audioBuffer,
    mimeType: audio.contentType,
    filename: audio.name
  });

  return {
    type: 'voice',
    text: transcript
  };
}
```

---

# 17. STT Adapter Interface

```js
export class SpeechToTextProvider {
  async transcribe({ buffer, mimeType, filename }) {
    throw new Error('Not implemented');
  }
}
```

This lets the project support:

```text
/stt
  BrowserSpeechBridgeProvider.js
  OpenAIWhisperProvider.js
  DeepgramProvider.js
  LocalWhisperProvider.js
```

Only one provider needs to be enabled at a time.

---

# 18. Browser Web Speech Bridge Design

If Browser Web Speech API must be used, isolate it from the Discord bot.

```text
Discord Bot
   |
   | HTTP / WebSocket STT job
   v
Browser STT Worker
   |
   v
SpeechRecognition / webkitSpeechRecognition
   |
   v
Transcript
   |
   v
Discord Bot
```

Potential worker stack:

- Chromium
- Playwright
- small local web page
- WebSocket/HTTP bridge

However, feeding arbitrary Discord audio into browser microphone recognition can require virtual-audio routing and can be platform-dependent. For v0.1, this should remain behind the STT adapter so the transcription implementation can be changed without touching the rest of the bot.

---

# 19. OpenRouter LLM Adapter

OpenRouter uses an OpenAI-compatible Chat Completions endpoint.

```js
const OPENROUTER_ENDPOINT =
  process.env.OPENROUTER_ENDPOINT ||
  'https://openrouter.ai/api/v1/chat/completions';

const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ||
  'openrouter/free';

export async function parseHandWithLLM(input) {
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,

      // Optional OpenRouter attribution headers:
      ...(process.env.OPENROUTER_HTTP_REFERER
        ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
        : {}),
      ...(process.env.OPENROUTER_APP_NAME
        ? { 'X-Title': process.env.OPENROUTER_APP_NAME }
        : {})
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: 'system',
          content: PARSER_INSTRUCTIONS
        },
        {
          role: 'user',
          content: [
            'USER_TEXT:',
            input.text,
            '',
            'HAND_HISTORY_SCHEMA:',
            JSON.stringify(HAND_HISTORY_JSON_SCHEMA)
          ].join('\n')
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'poker_hand_history',
          strict: true,
          schema: HAND_HISTORY_JSON_SCHEMA
        }
      },
      provider: {
        require_parameters: true
      },
      temperature: 0
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenRouter request failed (${response.status}): ${body}`
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenRouter returned no assistant content');
  }

  let parsed;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('OpenRouter returned invalid JSON');
  }

  // Final application-level validation.
  return HandHistorySchema.parse(parsed);
}
```

### Adapter contract

The rest of the application should still treat this as a simple parser:

```text
parseHandWithLLM(input) -> validated hand-history object
```

This means OpenRouter could later be replaced without changing the Discord listener, STT layer, or formatter.

---

# 20. Suggested Project Structure

```text
poker-hand-history-bot/
|
|-- src/
|   |-- index.js
|   |
|   |-- discord/
|   |   |-- messageHandler.js
|   |   `-- inputResolver.js
|   |
|   |-- llm/
|   |   |-- llmClient.js
|   |   |-- prompt.js
|   |   `-- handHistorySchema.js
|   |
|   |-- stt/
|   |   |-- SpeechToTextProvider.js
|   |   `-- BrowserSpeechBridgeProvider.js
|   |
|   |-- poker/
|   |   |-- formatter.js
|   |   `-- normalization.js
|   |
|   `-- utils/
|       `-- logger.js
|
|-- .env
|-- .env.example
|-- package.json
`-- README.md
```

---

# 21. Environment Variables

```env
DISCORD_BOT_TOKEN=
HAND_HISTORY_CHANNEL_IDS=

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_ENDPOINT=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_MODEL=openrouter/free

# Optional OpenRouter attribution
OPENROUTER_HTTP_REFERER=
OPENROUTER_APP_NAME=Discord Poker Hand History Bot

# Speech-to-text
STT_PROVIDER=browser_bridge
STT_ENDPOINT=
STT_API_KEY=

LOG_LEVEL=info
```

Never commit `.env` to source control. In particular, never expose `OPENROUTER_API_KEY` in Discord messages, client-side JavaScript, logs, or a public repository.

---

# 22. Processing States

For a good Discord experience, the bot may react to the original message while processing.

Suggested behavior:

```text
👀 = received / processing
✅ = successfully parsed
⚠️ = parsed but important information is missing
❌ = failed to parse
```

Alternatively, only use Discord's typing indicator to keep v0.1 lightweight.

---

# 23. Missing Information Logic

The parser should identify poker information that is normally important but absent.

Common examples:

```text
stack sizes
effective stack
pot size
hero position
villain position
stakes
preflop action
flop cards
turn card
river card
bet sizes
showdown cards
hand result
```

Do **not** flood the user with every theoretically possible missing field.

Only report missing fields that are relevant to the hand as described.

Example:

```text
Missing: pot size, stack sizes
```

---

# 24. Do Not Hallucinate

This is one of the most important parser rules.

If the user says:

```text
CO opened and I called.
```

but never provides the open size, the bot should produce:

```json
{
  "preflop": [
    "Cutoff opens",
    "Hero calls"
  ]
}
```

It should **not** assume the cutoff opened to 2.5bb.

Likewise, do not infer:

- stack sizes
- suit combinations
- pot size
- bet sizes
- winner
- position
- effective stack

unless the information is explicitly supplied or can be deterministically calculated from complete known information.

---

# 25. Multi-Villain Support

Although the initial example contains one villain, the data model should support multiple players from day one.

Example:

```json
"villains": [
  {
    "position": "cutoff",
    "hand": null
  },
  {
    "position": "button",
    "hand": "AQs"
  }
]
```

This prevents a future schema rewrite for multiway pots.

---

# 26. Recommended v0.1 Scope

Include:

- Discord channel listener
- text input
- voice-note input through an STT adapter
- LLM structured parsing
- schema validation
- deterministic formatter
- missing-information list
- one or multiple villains
- Texas Hold'em support
- no-limit / limit / pot-limit string support
- common position normalization
- common card notation normalization
- basic error handling

Do not include yet:

- poker strategy recommendations
- solver integration
- automatic equity calculation
- database persistence
- user statistics
- hand-history editing UI
- hand replay visualization
- OCR/screenshot parsing
- automatic pot reconstruction from incomplete actions

---

# 27. Recommended v0.2

After v0.1 is stable:

- database persistence
- unique hand IDs
- edit/correct command
- `/hand` slash command
- thread-per-hand mode
- strategy-analysis LLM after formatting
- automatic pot-size calculation when enough information exists
- stack-to-pot ratio calculations
- hand tags
- tournament support
- ante / straddle fields
- currency/chip normalization
- PokerStars/GGPoker/WSOP raw history import
- export to JSON/Markdown

---

# 28. Success Criteria for v0.1

The version is complete when all of the following work:

1. User posts a text hand in the configured Discord channel.
2. Bot extracts the text.
3. Bot sends the user text + hand-history schema to OpenRouter using `openrouter/free`.
4. LLM returns structured JSON.
5. Bot validates the JSON.
6. Bot converts it to the standardized hand-history layout.
7. Bot replies to the user's message with the formatted hand.
8. User posts a supported voice note.
9. Bot transcribes the note through the configured STT adapter.
10. The transcript runs through the exact same parsing pipeline as typed text.
11. Missing information is explicitly listed rather than invented.
12. LLM or STT failure produces a clean Discord error instead of crashing the bot.

---

# 29. Core Architectural Principle

Keep the bot separated into four independent pieces:

```text
Discord Input
     |
     v
Speech/Text Normalization
     |
     v
LLM Structured Parser
     |
     v
Poker Hand Formatter
```

The Discord integration should not care which LLM is used.

The LLM parser should not care whether the input came from text or voice.

The STT layer should not care how the hand will eventually be formatted.

The formatter should not depend on the LLM provider.

That separation makes it possible to replace Discord, STT, or the AI endpoint independently without rewriting the entire system.

---

# 30. Final v0.1 Output Example

Input:

```text
Game no limit holdem stakes one two. I'm BB with king three offsuit. CO opens to two point five big blinds. I call. Flop king nine four rainbow. Turn ace. River two. CO shows eight six suited.
```

Output:

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

This should be the canonical behavior for the first implementation.
