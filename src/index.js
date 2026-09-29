import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';

import { assertRequiredConfig, config } from './config.js';
import { commandDefinitions, createCommandHandler } from './discord/commands.js';
import { createInputResolver } from './discord/inputResolver.js';
import { createMessageHandler } from './discord/messageHandler.js';
import { parseHandWithLLM } from './llm/llmClient.js';
import { openGuildSettings } from './storage/guildSettings.js';
import { createSpeechToText } from './stt/index.js';
import { logger } from './utils/logger.js';
import { createRateLimiter } from './utils/rateLimiter.js';

assertRequiredConfig(config);

const settings = openGuildSettings({ dataDir: config.dataDir });
const rateLimiter = createRateLimiter(config.rateLimits);
const getUserInput = createInputResolver({
  speechToText: createSpeechToText(config.stt),
  maxAudioBytes: config.stt.maxAudioBytes
});

const handleMessage = createMessageHandler({
  // Channels chosen with /setup, plus any fixed HAND_HISTORY_CHANNEL_IDS.
  isWatchedChannel: (id) => settings.isWatched(id) || config.channelIds.has(id),
  getUserInput,
  parseHand: parseHandWithLLM,
  rateLimiter,
  logger,
  useReactions: config.useReactions
});

const handleInteraction = createCommandHandler({
  settings,
  getUserInput,
  parseHand: parseHandWithLLM,
  rateLimiter,
  logger
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // privileged: enable in the Developer Portal
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, async (readyClient) => {
  logger.info(`Logged in as ${readyClient.user.tag} (in ${readyClient.guilds.cache.size} server(s))`);
  logger.info(`Settings database: ${settings.location}`);
  if (config.channelIds.size) {
    logger.info(`Fixed channels from env: ${[...config.channelIds].join(', ')}`);
  }
  logger.info(`LLM model: ${config.openRouter.model} | STT provider: ${config.stt.provider}`);

  try {
    await readyClient.application.commands.set(commandDefinitions.map((c) => c.toJSON()));
    logger.info(`Registered slash commands: ${commandDefinitions.map((c) => `/${c.name}`).join(', ')}`);
  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(message).catch((error) => logger.error('Unhandled message error:', error));
});

client.on(Events.InteractionCreate, (interaction) => {
  handleInteraction(interaction).catch((error) => logger.error('Unhandled interaction error:', error));
});

client.on(Events.GuildCreate, (guild) => logger.info(`Added to server ${guild.id} (${guild.memberCount} members)`));
client.on(Events.GuildDelete, (guild) => {
  settings.forgetGuild(guild.id);
  logger.info(`Removed from server ${guild.id}; settings cleared`);
});

client.on(Events.Error, (error) => logger.error('Discord client error:', error));

process.on('unhandledRejection', (error) => logger.error('Unhandled rejection:', error));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, shutting down`);
    await client.destroy();
    settings.close();
    process.exit(0);
  });
}

await client.login(config.discordToken);
