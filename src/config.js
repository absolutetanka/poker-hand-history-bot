import 'dotenv/config';

function parseIdList(value) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

// Allows 0 (disables a limit), unlike `Number(x) || fallback`.
function numberOr(value, fallback) {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

export const config = {
  discordToken: process.env.DISCORD_BOT_TOKEN,
  // Optional fixed channels (in addition to those chosen with /setup).
  channelIds: parseIdList(process.env.HAND_HISTORY_CHANNEL_IDS),
  // Where the SQLite settings database lives. Use a persistent volume in production.
  dataDir: process.env.DATA_DIR || './data',
  rateLimits: {
    perUserPerHour: numberOr(process.env.RATE_LIMIT_USER_PER_HOUR, 10),
    perGuildPerDay: numberOr(process.env.RATE_LIMIT_GUILD_PER_DAY, 200)
  },
  useReactions: (process.env.USE_REACTIONS ?? 'true').toLowerCase() !== 'false',

  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    endpoint:
      process.env.OPENROUTER_ENDPOINT ||
      'https://openrouter.ai/api/v1/chat/completions',
    model: process.env.OPENROUTER_MODEL || 'openrouter/free',
    // Tried in order by OpenRouter when the primary model errors or is rate-limited.
    fallbackModels: (process.env.OPENROUTER_FALLBACK_MODELS ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    // off = skip slow reasoning/"thinking" models (reasoning.enabled=false) | default
    reasoning: (process.env.OPENROUTER_REASONING || 'default').toLowerCase(),
    retryBaseDelayMs: Number(process.env.OPENROUTER_RETRY_BASE_DELAY_MS) || 2_000,
    httpReferer: process.env.OPENROUTER_HTTP_REFERER || '',
    appName: process.env.OPENROUTER_APP_NAME || '',
    // json_schema (strict structured output) | json_object | none
    responseFormat: process.env.OPENROUTER_RESPONSE_FORMAT || 'json_schema',
    timeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS) || 60_000,
    maxAttempts: Number(process.env.OPENROUTER_MAX_ATTEMPTS) || 3
  },

  stt: {
    // browser_bridge | openai_whisper | none
    provider: process.env.STT_PROVIDER || 'none',
    endpoint: process.env.STT_ENDPOINT || '',
    apiKey: process.env.STT_API_KEY || '',
    model: process.env.STT_MODEL || 'whisper-1',
    timeoutMs: Number(process.env.STT_TIMEOUT_MS) || 60_000,
    maxAudioBytes: Number(process.env.STT_MAX_AUDIO_BYTES) || 25 * 1024 * 1024
  },

  logLevel: process.env.LOG_LEVEL || 'info'
};

export function assertRequiredConfig(cfg = config) {
  const missing = [];
  if (!cfg.discordToken) missing.push('DISCORD_BOT_TOKEN');
  if (!cfg.openRouter.apiKey) missing.push('OPENROUTER_API_KEY');

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
