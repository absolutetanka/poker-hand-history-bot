import { findAudioAttachment } from './inputResolver.js';
import { MESSAGES, NO_MENTIONS, errorReply, runHandPipeline, splitForDiscord } from './shared.js';

export { MESSAGES, splitForDiscord };

export const REACTIONS = {
  processing: '👀',
  success: '✅',
  missing: '⚠️',
  failure: '❌',
  rateLimited: '⏳'
};

/**
 * Handles hands posted in watched channels. Knows nothing about which LLM
 * or STT provider is in use.
 *
 * isWatchedChannel(channelId) decides which channels are processed; a plain
 * `channelIds` Set is also accepted.
 */
export function createMessageHandler({
  isWatchedChannel,
  channelIds,
  getUserInput,
  parseHand,
  rateLimiter = null,
  logger,
  useReactions = true
}) {
  const isWatched = isWatchedChannel ?? ((id) => channelIds.has(id));

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
    if (!isWatched(message.channelId)) return;

    // Ignore empty messages and messages with only unsupported attachments
    // (e.g. images) rather than replying to everything posted in the channel.
    const hasText = Boolean(message.content?.trim());
    if (!hasText && !findAudioAttachment(message)) return;

    const limit = rateLimiter?.take(message.author?.id, message.guildId);
    if (limit && !limit.ok) {
      logger.info(`Rate limited ${limit.scope} for message ${message.id}`);
      await react(message, REACTIONS.rateLimited);
      await reply(message, MESSAGES.rateLimited(limit)).catch(() => {});
      return;
    }

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

      const { output, missing } = await runHandPipeline(parseHand, input);

      await reply(message, output);
      await clearProcessing(message);
      await react(message, missing.length ? REACTIONS.missing : REACTIONS.success);
    } catch (error) {
      const text = errorReply(error, logger, `message ${message.id}`);
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
