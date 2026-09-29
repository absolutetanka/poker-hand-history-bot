const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * In-memory sliding-window limits that protect the shared LLM/STT quotas:
 * per user per hour and per server per day. Counters reset on restart,
 * which is acceptable for quota protection. A limit of 0 disables it.
 */
export function createRateLimiter({ perUserPerHour = 10, perGuildPerDay = 200, now = Date.now } = {}) {
  const users = new Map();
  const guilds = new Map();

  function recent(map, key, windowMs) {
    const cutoff = now() - windowMs;
    const hits = (map.get(key) ?? []).filter((t) => t > cutoff);
    map.set(key, hits);
    return hits;
  }

  function check(hits, limit, windowMs) {
    if (!limit || hits.length < limit) return null;
    return hits[0] + windowMs - now();
  }

  return {
    /**
     * Records a request if allowed.
     * @returns {{ ok: true } | { ok: false, scope: 'user' | 'guild', retryAfterMs: number }}
     */
    take(userId, guildId) {
      const userHits = recent(users, userId, HOUR);
      const guildHits = guildId ? recent(guilds, guildId, DAY) : [];

      const userWait = check(userHits, perUserPerHour, HOUR);
      if (userWait != null) return { ok: false, scope: 'user', retryAfterMs: userWait };

      const guildWait = guildId ? check(guildHits, perGuildPerDay, DAY) : null;
      if (guildWait != null) return { ok: false, scope: 'guild', retryAfterMs: guildWait };

      const t = now();
      userHits.push(t);
      if (guildId) guildHits.push(t);
      return { ok: true };
    }
  };
}

/** 90_000 -> "2 minutes", 7_200_000 -> "2 hours" */
export function describeWait(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
