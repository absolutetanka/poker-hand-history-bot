import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';

import { MESSAGES, NO_MENTIONS, errorReply, runHandPipeline, splitForDiscord } from './shared.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('hand')
    .setDescription('Turn a poker hand description into a formatted hand history')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('description')
        .setDescription('e.g. 1/2 NL. I\'m BB with Ks3h. CO opens to 5, I call. Flop K94r...')
        .setMaxLength(2000)
    )
    .addAttachmentOption((o) =>
      o.setName('audio').setDescription('A voice note or audio file describing the hand')
    ),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Choose which channels the bot watches for hands')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Watch a channel: every hand posted there gets formatted')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to watch')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Stop watching a channel')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel to stop watching').setRequired(true)
        )
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show the channels being watched')),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('How to use the hand history bot')
];

export const HELP_TEXT = [
  '**Hand History Bot**',
  'Describe a poker hand in plain words (or a voice note) and I format it for review.',
  '',
  '• `/hand` — format a hand anywhere: type a description or attach audio.',
  '• Watched channels — every text or voice note posted there is formatted automatically.',
  '• `/setup add #channel` — (Manage Server) watch a channel. Also `/setup remove` and `/setup list`.',
  '',
  'Tip: include stakes, positions, stacks, cards, and bet sizes for the most complete history.'
].join('\n');

export function createCommandHandler({ settings, getUserInput, parseHand, rateLimiter = null, logger }) {
  async function handleHand(interaction) {
    const description = interaction.options.getString('description')?.trim() || '';
    const audio = interaction.options.getAttachment('audio');

    if (!description && !audio) {
      await interaction.reply({ content: 'Add a `description` or attach an `audio` file.', ...EPHEMERAL });
      return;
    }

    const limit = rateLimiter?.take(interaction.user.id, interaction.guildId);
    if (limit && !limit.ok) {
      logger.info(`Rate limited ${limit.scope} for /hand ${interaction.id}`);
      await interaction.reply({ content: MESSAGES.rateLimited(limit), ...EPHEMERAL });
      return;
    }

    // LLM parsing takes longer than Discord's 3-second reply window.
    await interaction.deferReply();

    try {
      // Reuse the message input resolver: text wins, otherwise the audio attachment.
      const input = await getUserInput({
        content: description,
        attachments: new Map(audio ? [[audio.id, audio]] : [])
      });
      if (!input) {
        await interaction.editReply({ content: MESSAGES.noInput, allowedMentions: NO_MENTIONS });
        return;
      }

      logger.info(`Parsing ${input.type} hand from /hand ${interaction.id}`);
      const { output } = await runHandPipeline(parseHand, input);

      const [first, ...rest] = splitForDiscord(output);
      await interaction.editReply({ content: first, allowedMentions: NO_MENTIONS });
      for (const chunk of rest) {
        await interaction.followUp({ content: chunk, allowedMentions: NO_MENTIONS });
      }
    } catch (error) {
      const text = errorReply(error, logger, `/hand ${interaction.id}`);
      await interaction.editReply({ content: text, allowedMentions: NO_MENTIONS }).catch(() => {});
    }
  }

  async function handleSetup(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'list') {
      const channels = settings.listChannels(guildId);
      await interaction.reply({
        content: channels.length
          ? `Watching: ${channels.map((id) => `<#${id}>`).join(', ')}`
          : 'No channels are being watched. Use `/setup add` to pick one — `/hand` works anywhere.',
        ...EPHEMERAL
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);

    if (sub === 'add') {
      const me = interaction.guild?.members?.me;
      const perms = me ? channel.permissionsFor?.(me) : null;
      const needed = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ];
      if (perms && !perms.has(needed)) {
        await interaction.reply({
          content: `I can't read and reply in <#${channel.id}>. Give me View Channel, Send Messages, and Read Message History there, then try again.`,
          ...EPHEMERAL
        });
        return;
      }

      const added = settings.addChannel(guildId, channel.id, interaction.user.id);
      logger.info(`Guild ${guildId}: watching channel ${channel.id}`);
      await interaction.reply({
        content: added
          ? `Now watching <#${channel.id}>. Post a hand there and I'll format it.`
          : `Already watching <#${channel.id}>.`,
        ...EPHEMERAL
      });
      return;
    }

    if (sub === 'remove') {
      const removed = settings.removeChannel(guildId, channel.id);
      logger.info(`Guild ${guildId}: stopped watching channel ${channel.id}`);
      await interaction.reply({
        content: removed ? `Stopped watching <#${channel.id}>.` : `<#${channel.id}> wasn't being watched.`,
        ...EPHEMERAL
      });
    }
  }

  return async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand?.()) return;

    try {
      if (interaction.commandName === 'hand') await handleHand(interaction);
      else if (interaction.commandName === 'setup') await handleSetup(interaction);
      else if (interaction.commandName === 'help') {
        await interaction.reply({ content: HELP_TEXT, ...EPHEMERAL });
      }
    } catch (error) {
      logger.error(`Command /${interaction.commandName} failed:`, error);
      const reply = { content: 'Something went wrong running that command.', ...EPHEMERAL };
      if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  };
}
