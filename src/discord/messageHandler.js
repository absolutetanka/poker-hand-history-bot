import { HandHistorySchema } from '../llm/handHistorySchema.js';
import { formatHandHistory } from '../poker/formatter.js';
import { analyzeHand } from '../poker/handState.js';
import { findAudioAttachment } from './inputResolver.js';

export const REACTIONS = {
  processing: '👀',
  success: '✅',
  missing: '⚠️',
  failure: '❌'
};

export const MESSAGES = {
  noInput: 'I could not find any text or supported voice note to parse.',
  parseFailed: 'I could not parse that hand. Please try again or provide a little more detail.',
  sttFailed: 'I could not transcribe that voice note. Please try again or type the hand instead.',
  sttDisabled: "Voice notes aren't enabled on this bot yet. Please type the hand instead."
};

const DISCORD_MAX_LENGTH = 2000;

// Never let LLM- or user-derived text ping @everyone, roles, or users.
const NO_MENTIONS = { parse: [], repliedUser: false };

export function splitForDiscord(text, max = DISCORD_MAX_LENGTH) {
  if (text.length <= max) return [text];

  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    // A single line longer than the limit gets hard-wrapped.
    let rest = line;
    while (rest.length > max) {
      chunks.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    current = rest;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Wires Discord input to the parsing pipeline. Knows nothing about which LLM
 * or STT provider is in use.
 */
export function createMessageHandler({
  channelIds,
  getUserInput,
  parseHand,
  logger,
  useReactions = true
}) {
  async function react(message, emoji) {
    if (!useReactions) return;
    try {
      await message.react(emoji);
    } catch (error) {
      logger.debug(`Could not add reaction ${emoji}: ${error.message}`);
    }
  }

  async function clearProcessing(message) {
    if (!useReactions) return;
    try {
      const botId = message.client?.user?.id;
      const reaction = message.reactions?.cache?.get(REACTIONS.processing);
      if (botId && reaction) await reaction.users.remove(botId);
    } catch (error) {
      logger.debug(`Could not remove processing reaction: ${error.message}`);
    }
  }

  async function reply(message, content) {
    const [first, ...rest] = splitForDiscord(content);
    await message.reply({ content: first, allowedMentions: NO_MENTIONS });
    for (const chunk of rest) {
      await message.channel.send({ content: chunk, allowedMentions: NO_MENTIONS });
    }
  }

  return async function handleMessage(message) {
    if (message.author?.bot) return; // covers the bot itself and other bots
    if (!channelIds.has(message.channelId)) return;

    // Ignore empty messages and messages with only unsupported attachments
    // (e.g. images) rather than replying to everything posted in the channel.
    const hasText = Boolean(message.content?.trim());
    if (!hasText && !findAudioAttachment(message)) return;

    try {
      await react(message, REACTIONS.processing);
      await message.channel.sendTyping?.().catch(() => {});

      const input = await getUserInput(message);

      if (!input) {
        await reply(message, MESSAGES.noInput);
        await clearProcessing(message);
        return;
      }

      logger.info(`Parsing ${input.type} hand from message ${message.id}`);
      logger.debug('Input text:', input.text);

      const parsedHand = await parseHand(input);
      const validatedHand = HandHistorySchema.parse(parsedHand);
      const output = formatHandHistory(validatedHand);

      await reply(message, output);
      await clearProcessing(message);
      await react(message, analyzeHand(validatedHand).missing.length ? REACTIONS.missing : REACTIONS.success);
    } catch (error) {
      let text = MESSAGES.parseFailed;
      if (error?.code === 'STT_DISABLED') {
        logger.info(`Voice note in message ${message.id} ignored: STT_PROVIDER=none`);
        text = MESSAGES.sttDisabled;
      } else {
        logger.error(`Failed to process message ${message.id}:`, error);
        if (error?.name === 'SpeechToTextError') text = MESSAGES.sttFailed;
      }
      try {
        await reply(message, text);
      } catch (replyError) {
        logger.error('Failed to send error reply:', replyError);
      }
      await clearProcessing(message);
      await react(message, REACTIONS.failure);
    }
  };
}
