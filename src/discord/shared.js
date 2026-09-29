import { HandHistorySchema } from '../llm/handHistorySchema.js';
import { formatHandHistory } from '../poker/formatter.js';
import { analyzeHand } from '../poker/handState.js';
import { describeWait } from '../utils/rateLimiter.js';

export const MESSAGES = {
  noInput: 'I could not find any text or supported voice note to parse.',
  parseFailed: 'I could not parse that hand. Please try again or provide a little more detail.',
  sttFailed: 'I could not transcribe that voice note. Please try again or type the hand instead.',
  sttDisabled: "Voice notes aren't enabled on this bot yet. Please type the hand instead.",
  rateLimited: (limit) =>
    limit.scope === 'guild'
      ? `This server has reached its daily hand limit. Try again in ${describeWait(limit.retryAfterMs)}.`
      : `You've reached the hourly hand limit. Try again in ${describeWait(limit.retryAfterMs)}.`
};

const DISCORD_MAX_LENGTH = 2000;

// Never let LLM- or user-derived text ping @everyone, roles, or users.
export const NO_MENTIONS = { parse: [], repliedUser: false };

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
 * The shared pipeline for channel messages and /hand:
 * LLM parse -> final validation -> deterministic format.
 */
export async function runHandPipeline(parseHand, input) {
  const parsedHand = await parseHand(input);
  const hand = HandHistorySchema.parse(parsedHand);
  return {
    output: formatHandHistory(hand),
    missing: analyzeHand(hand).missing
  };
}

/** Maps a pipeline error to a user-facing message, logging appropriately. */
export function errorReply(error, logger, context) {
  if (error?.code === 'STT_DISABLED') {
    logger.info(`Voice note in ${context} ignored: STT_PROVIDER=none`);
    return MESSAGES.sttDisabled;
  }
  logger.error(`Failed to process ${context}:`, error);
  return error?.name === 'SpeechToTextError' ? MESSAGES.sttFailed : MESSAGES.parseFailed;
}
