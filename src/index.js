import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';

import { assertRequiredConfig, config } from './config.js';
import { createInputResolver } from './discord/inputResolver.js';
import { createMessageHandler } from './discord/messageHandler.js';
import { parseHandWithLLM } from './llm/llmClient.js';
import { createSpeechToText } from './stt/index.js';
import { logger } from './utils/logger.js';

assertRequiredConfig(config);

const speechToText = createSpeechToText(config.stt);

const handleMessage = createMessageHandler({
  channelIds: config.channelIds,
  getUserInput: createInputResolver({
    speechToText,
    maxAudioBytes: config.stt.maxAudioBytes
  }),
  parseHand: parseHandWithLLM,
  logger,
  useReactions: config.useReactions
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // privileged: enable in the Developer Portal
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, (readyClient) => {
  logger.info(`Logged in as ${readyClient.user.tag}`);
  logger.info(`Listening in ${config.channelIds.size} channel(s): ${[...config.channelIds].join(', ')}`);
  logger.info(`LLM model: ${config.openRouter.model} | STT provider: ${config.stt.provider}`);
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(message).catch((error) => logger.error('Unhandled message error:', error));
});

client.on(Events.Error, (error) => logger.error('Discord client error:', error));

process.on('unhandledRejection', (error) => logger.error('Unhandled rejection:', error));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, shutting down`);
    await client.destroy();
    process.exit(0);
  });
}

await client.login(config.discordToken);
