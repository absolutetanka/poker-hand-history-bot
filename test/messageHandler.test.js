import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createInputResolver } from '../src/discord/inputResolver.js';
import { MESSAGES, REACTIONS, createMessageHandler, splitForDiscord } from '../src/discord/messageHandler.js';
import { SpeechToTextError } from '../src/stt/SpeechToTextProvider.js';
import { createLogger } from '../src/utils/logger.js';
import { canonicalHand, canonicalOutput } from './fixtures.js';

const CHANNEL = '111';
const silent = createLogger('silent');

function fakeMessage({ content = '', channelId = CHANNEL, bot = false, attachments = [] } = {}) {
  const replies = [];
  const reactions = [];
  const map = new Map(attachments.map((a, i) => [String(i), a]));
  return {
    id: 'msg-1',
    content,
    channelId,
    author: { bot },
    attachments: map,
    client: { user: { id: 'bot-id' } },
    reactions: { cache: new Map() },
    channel: { sendTyping: async () => {}, send: async (m) => replies.push(m.content) },
    reply: async (m) => replies.push(m.content),
    react: async (emoji) => reactions.push(emoji),
    replies,
    reactionsAdded: reactions
  };
}

function setup({ parseHand = async () => canonicalHand, transcribe } = {}) {
  const calls = { parse: [], transcribe: [] };
  const speechToText = {
    transcribe: async (args) => {
      calls.transcribe.push(args);
      if (transcribe) return transcribe(args);
      return 'transcribed hand';
    }
  };
  const fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]));
  const handler = createMessageHandler({
    channelIds: new Set([CHANNEL]),
    getUserInput: createInputResolver({ speechToText, fetchImpl }),
    parseHand: async (input) => {
      calls.parse.push(input);
      return parseHand(input);
    },
    logger: silent
  });
  return { handler, calls };
}

const voiceNote = {
  url: 'https://cdn.discordapp.test/voice-message.ogg',
  name: 'voice-message.ogg',
  contentType: 'audio/ogg; codecs=opus',
  size: 3
};

test('text hand in configured channel -> formatted reply', async () => {
  const { handler, calls } = setup();
  const message = fakeMessage({ content: 'CO opens, I call from BB' });
  await handler(message);

  assert.deepEqual(calls.parse, [{ type: 'text', text: 'CO opens, I call from BB' }]);
  assert.deepEqual(message.replies, [canonicalOutput]);
  assert.deepEqual(message.reactionsAdded, [REACTIONS.processing, REACTIONS.missing]);
});

test('voice note goes through STT and the same pipeline', async () => {
  const { handler, calls } = setup();
  const message = fakeMessage({ attachments: [voiceNote] });
  await handler(message);

  assert.equal(calls.transcribe.length, 1);
  assert.equal(calls.transcribe[0].mimeType, 'audio/ogg');
  assert.equal(calls.transcribe[0].filename, 'voice-message.ogg');
  assert.ok(Buffer.isBuffer(calls.transcribe[0].buffer));
  assert.deepEqual(calls.parse, [{ type: 'voice', text: 'transcribed hand' }]);
  assert.deepEqual(message.replies, [canonicalOutput]);
});

test('ignores bots, other channels, empty messages, and unsupported attachments', async () => {
  const { handler, calls } = setup();
  const messages = [
    fakeMessage({ content: 'hand', bot: true }),
    fakeMessage({ content: 'hand', channelId: '999' }),
    fakeMessage({ content: '   ' }),
    fakeMessage({ attachments: [{ url: 'x', name: 'pic.png', contentType: 'image/png', size: 1 }] })
  ];
  for (const m of messages) await handler(m);

  assert.equal(calls.parse.length, 0);
  for (const m of messages) {
    assert.deepEqual(m.replies, []);
    assert.deepEqual(m.reactionsAdded, []);
  }
});

test('LLM failure produces a clean error reply', async () => {
  const { handler } = setup({
    parseHand: async () => {
      throw new Error('OpenRouter request failed (503)');
    }
  });
  const message = fakeMessage({ content: 'hand' });
  await handler(message);

  assert.deepEqual(message.replies, [MESSAGES.parseFailed]);
  assert.equal(message.reactionsAdded.at(-1), REACTIONS.failure);
});

test('invalid LLM output is rejected by final validation', async () => {
  const { handler } = setup({ parseHand: async () => ({ game: 'nlh' }) });
  const message = fakeMessage({ content: 'hand' });
  await handler(message);
  assert.deepEqual(message.replies, [MESSAGES.parseFailed]);
});

test('STT failure produces a clean voice-specific error reply', async () => {
  const { handler, calls } = setup({
    transcribe: async () => {
      throw new SpeechToTextError('bridge down');
    }
  });
  const message = fakeMessage({ attachments: [voiceNote] });
  await handler(message);

  assert.equal(calls.parse.length, 0);
  assert.deepEqual(message.replies, [MESSAGES.sttFailed]);
  assert.equal(message.reactionsAdded.at(-1), REACTIONS.failure);
});

test('complete hand with nothing missing gets a success reaction', async () => {
  const { handler } = setup({ parseHand: async () => ({ ...canonicalHand, missing: [] }) });
  const message = fakeMessage({ content: 'hand' });
  await handler(message);
  assert.equal(message.reactionsAdded.at(-1), REACTIONS.success);
});

test('long output is split under the Discord limit', () => {
  const text = Array.from({ length: 100 }, (_, i) => `Line ${i} ${'x'.repeat(40)}`).join('\n');
  const chunks = splitForDiscord(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 2000));
  assert.equal(chunks.join('\n'), text);
});
