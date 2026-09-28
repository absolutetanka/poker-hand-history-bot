import { config } from '../config.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { HandHistorySchema, HAND_HISTORY_JSON_SCHEMA } from './handHistorySchema.js';
import { PARSER_INSTRUCTIONS, buildUserMessage } from './prompt.js';

export class LLMParseError extends Error {
  constructor(message, { retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = 'LLMParseError';
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ordered strictest -> loosest.
const RESPONSE_FORMAT_FALLBACKS = ['json_schema', 'json_object', 'none'];

function buildResponseFormat(mode) {
  if (mode === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'poker_hand_history',
        strict: true,
        schema: HAND_HISTORY_JSON_SCHEMA
      }
    };
  }
  if (mode === 'json_object') return { type: 'json_object' };
  return undefined;
}

export function buildRequestBody(text, orConfig = config.openRouter) {
  const responseFormat = buildResponseFormat(orConfig.responseFormat);

  const fallbacks = (orConfig.fallbackModels ?? []).filter((m) => m !== orConfig.model);
  // Reasoning ("thinking") models can take ~50s per hand. With reasoning off and
  // require_parameters, OpenRouter skips models where reasoning is mandatory.
  const reasoningOff = orConfig.reasoning === 'off';

  return {
    model: orConfig.model,
    // OpenRouter model routing: tries each in order if the previous one errors.
    ...(fallbacks.length ? { models: [orConfig.model, ...fallbacks] } : {}),
    messages: [
      { role: 'system', content: PARSER_INSTRUCTIONS },
      { role: 'user', content: buildUserMessage(text) }
    ],
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(reasoningOff ? { reasoning: { enabled: false } } : {}),
    ...(responseFormat || reasoningOff ? { provider: { require_parameters: true } } : {}),
    temperature: 0
  };
}

// Some free models wrap JSON in markdown fences or add prose despite instructions.
export function extractJson(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new SyntaxError('No JSON object found');
  }
}

/**
 * Creates the LLM parser. Contract: parse(input) -> validated hand-history object.
 * Swapping OpenRouter for another provider only requires replacing this module.
 */
export function createLLMParser({
  orConfig = config.openRouter,
  fetchImpl = globalThis.fetch,
  logger = defaultLogger
} = {}) {
  // Free models often can't honor strict structured output. When OpenRouter
  // finds no endpoint for the requested parameters, step down to a looser
  // format and remember it for later requests. Zod still validates everything.
  const formatChain = RESPONSE_FORMAT_FALLBACKS.slice(
    Math.max(0, RESPONSE_FORMAT_FALLBACKS.indexOf(orConfig.responseFormat))
  );
  let formatIndex = 0;

  async function attempt(text, reasoningOff) {
    const responseFormat = formatChain[formatIndex];
    const reasoning = reasoningOff ? 'off' : 'default';
    let response;
    try {
      response = await fetchImpl(orConfig.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orConfig.apiKey}`,
          ...(orConfig.httpReferer ? { 'HTTP-Referer': orConfig.httpReferer } : {}),
          ...(orConfig.appName ? { 'X-Title': orConfig.appName } : {})
        },
        body: JSON.stringify(buildRequestBody(text, { ...orConfig, responseFormat, reasoning })),
        signal: AbortSignal.timeout(orConfig.timeoutMs)
      });
    } catch (error) {
      throw new LLMParseError(`OpenRouter request failed: ${error.message}`, {
        retryable: true,
        cause: error
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 400 && /reasoning is mandatory/i.test(body) && reasoningOff) {
        const error = new LLMParseError('Model requires reasoning; retrying with reasoning allowed');
        error.reasoningRequired = true;
        throw error;
      }
      if (response.status === 404 && /no endpoints found/i.test(body)) {
        const error = new LLMParseError(
          `No OpenRouter endpoint supports response format "${responseFormat}"`
        );
        error.unsupportedParameters = true;
        throw error;
      }
      const error = new LLMParseError(
        `OpenRouter request failed (${response.status}): ${body.slice(0, 500)}`,
        { retryable: response.status === 429 || response.status >= 500 }
      );
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      if (retryAfterSeconds > 0) error.retryAfterMs = retryAfterSeconds * 1000;
      throw error;
    }

    // The timeout also covers reading the body: OpenRouter sends headers
    // immediately and holds the connection open while the model generates.
    let data;
    try {
      data = await response.json();
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new LLMParseError(
        timedOut
          ? `OpenRouter timed out after ${orConfig.timeoutMs / 1000}s waiting for the model`
          : `OpenRouter returned an unreadable response: ${error.message}`,
        { retryable: true, cause: error }
      );
    }

    // OpenRouter can return 200 with an error object when the upstream model fails.
    if (data?.error) {
      throw new LLMParseError(`OpenRouter upstream error: ${JSON.stringify(data.error).slice(0, 500)}`, {
        retryable: true
      });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new LLMParseError('OpenRouter returned no assistant content', { retryable: true });
    }

    logger.info(`LLM answered with ${data?.model}`);

    let parsed;
    try {
      parsed = extractJson(content);
    } catch (error) {
      throw new LLMParseError('OpenRouter returned invalid JSON', { retryable: true, cause: error });
    }

    // Final application-level validation.
    const result = HandHistorySchema.safeParse(parsed);
    if (!result.success) {
      throw new LLMParseError(
        `LLM output failed schema validation: ${result.error.message}`,
        { retryable: true, cause: result.error }
      );
    }

    return result.data;
  }

  return async function parseHandWithLLM(input) {
    const text = typeof input === 'string' ? input : input?.text;
    if (!text?.trim()) throw new LLMParseError('No text to parse');

    // A model that can't disable reasoning gets a retry with reasoning allowed.
    let reasoningOff = orConfig.reasoning === 'off';

    let lastError;
    for (let i = 1; i <= orConfig.maxAttempts; i++) {
      try {
        return await attempt(text, reasoningOff);
      } catch (error) {
        lastError = error;
        if (error.reasoningRequired) {
          reasoningOff = false;
          logger.warn(error.message);
          i--; // a routing rejection doesn't count as an attempt
          continue;
        }
        if (error.unsupportedParameters && formatIndex < formatChain.length - 1) {
          formatIndex++;
          logger.warn(`${error.message}; falling back to "${formatChain[formatIndex]}"`);
          i--; // a routing rejection doesn't count as an attempt
          continue;
        }
        if (!error.retryable || i === orConfig.maxAttempts) break;
        // Exponential backoff (2s, 4s, ...) so rate-limited free pools can recover,
        // honoring Retry-After when provided (capped at 30s).
        const delayMs = Math.min(
          error.retryAfterMs ?? (orConfig.retryBaseDelayMs ?? 2_000) * 2 ** (i - 1),
          30_000
        );
        logger.warn(`LLM attempt ${i} failed, retrying in ${delayMs / 1000}s: ${error.message}`);
        await sleep(delayMs);
      }
    }
    throw lastError;
  };
}

export const parseHandWithLLM = createLLMParser();
