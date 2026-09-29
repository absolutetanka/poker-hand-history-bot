import assert from 'node:assert/strict';
import { test } from 'node:test';

import { commandDefinitions, createCommandHandler, HELP_TEXT } from '../src/discord/commands.js';
import { createInputResolver } from '../src/discord/inputResolver.js';
import { MESSAGES } from '../src/discord/shared.js';
import { openGuildSettings } from '../src/storage/guildSettings.js';
import { createLogger } from '../src/utils/logger.js';
import { createRateLimiter } from '../src/utils/rateLimiter.js';
import { canonicalHand, canonicalOutput } from './fixtures.js';

const silent = createLogger('silent');

function fakeInteraction({ command, sub = null, strings = {}, channel = null, attachment = null, canPost = true }) {
  const calls = { reply: [], editReply: [], followUp: [], deferred: 0 };
  const interaction = {
    id: 'i-1',
    commandName: command,
    guildId: 'g1',
    user: { id: 'u1' },
    guild: { members: { me: { id: 'bot' } } },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => sub,
      getString: (name) => strings[name] ?? null,
      getAttachment: () => attachment,
      getChannel: () => channel && { ...channel, permissionsFor: () => ({ has: () => canPost }) }
    },
    reply: async (r) => {
      interaction.replied = true;
      calls.reply.push(r);
    },
    deferReply: async () => {
      interaction.deferred = true;
      calls.deferred++;
    },
    editReply: async (r) => calls.editReply.push(r),
    followUp: async (r) => calls.followUp.push(r),
    calls
  };
  return interaction;
}

function setup({ parseHand = async () => canonicalHand, rateLimiter = null } = {}) {
  const settings = openGuildSettings({ memory: true });
  const parsed = [];
  const handler = createCommandHandler({
    settings,
    getUserInput: createInputResolver({ speechToText: { transcribe: async () => 'spoken hand' } }),
    parseHand: async (input) => {
      parsed.push(input);
      return parseHand(input);
    },
    rateLimiter,
    logger: silent
  });
  return { handler, settings, parsed };
}

test('defines /hand, /setup, and /help', () => {
  assert.deepEqual(commandDefinitions.map((c) => c.name), ['hand', 'setup', 'help']);
  const setupJson = commandDefinitions[1].toJSON();
  assert.equal(setupJson.default_member_permissions, String(1n << 5n)); // Manage Server
});

test('/hand formats a typed hand publicly', async () => {
  const { handler, parsed } = setup();
  const i = fakeInteraction({ command: 'hand', strings: { description: 'CO opens, I call' } });
  await handler(i);

  assert.equal(i.calls.deferred, 1);
  assert.deepEqual(parsed, [{ type: 'text', text: 'CO opens, I call' }]);
  assert.equal(i.calls.editReply[0].content, canonicalOutput);
});

test('/hand accepts an audio attachment', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2]));
  try {
    const { handler, parsed } = setup();
    const i = fakeInteraction({
      command: 'hand',
      attachment: { id: 'a1', url: 'https://cdn.test/a.ogg', name: 'a.ogg', contentType: 'audio/ogg', size: 2 }
    });
    await handler(i);
    assert.deepEqual(parsed, [{ type: 'voice', text: 'spoken hand' }]);
  } finally {
    globalThis.fetch = original;
  }
});

test('/hand without input asks for one (privately)', async () => {
  const { handler, parsed } = setup();
  const i = fakeInteraction({ command: 'hand' });
  await handler(i);
  assert.equal(parsed.length, 0);
  assert.match(i.calls.reply[0].content, /description/);
  assert.ok(i.calls.reply[0].flags);
});

test('/hand failures become a clean error reply', async () => {
  const { handler } = setup({
    parseHand: async () => {
      throw new Error('OpenRouter down');
    }
  });
  const i = fakeInteraction({ command: 'hand', strings: { description: 'hand' } });
  await handler(i);
  assert.equal(i.calls.editReply[0].content, MESSAGES.parseFailed);
});

test('/hand respects rate limits', async () => {
  const { handler, parsed } = setup({ rateLimiter: createRateLimiter({ perUserPerHour: 1 }) });
  await handler(fakeInteraction({ command: 'hand', strings: { description: 'hand 1' } }));
  const second = fakeInteraction({ command: 'hand', strings: { description: 'hand 2' } });
  await handler(second);

  assert.equal(parsed.length, 1);
  assert.match(second.calls.reply[0].content, /hourly hand limit/);
});

test('/setup add, list, and remove channels', async () => {
  const { handler, settings } = setup();
  const channel = { id: 'c1' };

  const add = fakeInteraction({ command: 'setup', sub: 'add', channel });
  await handler(add);
  assert.match(add.calls.reply[0].content, /Now watching <#c1>/);
  assert.ok(settings.isWatched('c1'));

  const list = fakeInteraction({ command: 'setup', sub: 'list' });
  await handler(list);
  assert.match(list.calls.reply[0].content, /Watching: <#c1>/);

  const remove = fakeInteraction({ command: 'setup', sub: 'remove', channel });
  await handler(remove);
  assert.match(remove.calls.reply[0].content, /Stopped watching/);
  assert.ok(!settings.isWatched('c1'));
});

test('/setup add refuses channels the bot cannot post in', async () => {
  const { handler, settings } = setup();
  const i = fakeInteraction({ command: 'setup', sub: 'add', channel: { id: 'c9' }, canPost: false });
  await handler(i);
  assert.match(i.calls.reply[0].content, /can't read and reply/);
  assert.ok(!settings.isWatched('c9'));
});

test('/help replies privately', async () => {
  const { handler } = setup();
  const i = fakeInteraction({ command: 'help' });
  await handler(i);
  assert.equal(i.calls.reply[0].content, HELP_TEXT);
});
