import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Per-server settings: which channels the bot watches for hands.
 * Backed by SQLite (Node's built-in node:sqlite). Watched channels are cached
 * in memory so the message hot path never touches the database.
 *
 * On hosts with ephemeral disks (e.g. Railway), point DATA_DIR at a
 * persistent volume or settings are lost on redeploy.
 */
export function openGuildSettings({ dataDir, filename = 'bot.sqlite', memory = false } = {}) {
  let location = ':memory:';
  if (!memory) {
    mkdirSync(dataDir, { recursive: true });
    location = path.join(dataDir, filename);
  }

  const db = new DatabaseSync(location);
  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_channels (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      added_by   TEXT,
      added_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, channel_id)
    )
  `);

  const insert = db.prepare(
    'INSERT OR IGNORE INTO watched_channels (guild_id, channel_id, added_by) VALUES (?, ?, ?)'
  );
  const remove = db.prepare('DELETE FROM watched_channels WHERE guild_id = ? AND channel_id = ?');
  const removeGuild = db.prepare('DELETE FROM watched_channels WHERE guild_id = ?');
  const listForGuild = db.prepare(
    'SELECT channel_id FROM watched_channels WHERE guild_id = ? ORDER BY added_at'
  );
  const all = db.prepare('SELECT channel_id FROM watched_channels');

  const watched = new Set(all.all().map((row) => row.channel_id));

  return {
    location,

    /** Returns true if the channel was newly added. */
    addChannel(guildId, channelId, addedBy = null) {
      const { changes } = insert.run(guildId, channelId, addedBy);
      watched.add(channelId);
      return changes > 0;
    },

    /** Returns true if the channel was being watched. */
    removeChannel(guildId, channelId) {
      const { changes } = remove.run(guildId, channelId);
      watched.delete(channelId);
      return changes > 0;
    },

    /** Called when the bot is removed from a server. */
    forgetGuild(guildId) {
      for (const row of listForGuild.all(guildId)) watched.delete(row.channel_id);
      removeGuild.run(guildId);
    },

    listChannels(guildId) {
      return listForGuild.all(guildId).map((row) => row.channel_id);
    },

    isWatched(channelId) {
      return watched.has(channelId);
    },

    close() {
      db.close();
    }
  };
}
