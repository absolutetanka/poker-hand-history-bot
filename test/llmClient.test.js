import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRequestBody, createLLMParser, extractJson } from '../src/llm/llmClient.js';
import { createLogger } from '../src/utils/logger.js';
import { canonicalHand } from './fixtures.js';

const orConfig = {
  apiKey: 'test-key',
  endpoint: 'https://openrouter.test/api/v1/chat/completions',
  model: 'openrouter/free',
  httpReferer: '',
  appName: 'Test App',
  responseFormat: 'json_schema',
  timeoutMs: 5000,
  maxAttempts: 2,
  retryBaseDelayMs: 1,
  fallbackModels: []
};

const silent = createLogger('silent');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function completion(content) {
  return jsonResponse({ model: 'some/free-model', choices: [{ message: { content } }] });
}

test('request body sends user text + schema to openrouter/free with structured output', () => {
  const body = buildRequestBody('CO opens, I call', orConfig);
  assert.equal(body.model, 'openrouter/free');
  assert.equal(body.temperature, 0);
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[1].content, /^USER_TEXT:\nCO opens, I call\n\nHAND_HISTORY_SCHEMA:\n\{/);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.type, 'object');
  assert.deepEqual(body.provider, { require_parameters: true });
});

test('response_format can be relaxed for providers without json_schema support', () => {
  assert.deepEqual(buildRequestBody('x', { ...orConfig, responseFormat: 'json_object' }).response_format, {
    type: 'json_object'
  });
  const none = buildRequestBody('x', { ...orConfig, responseFormat: 'none' });
  assert.equal(none.response_format, undefined);
  assert.equal(none.provider, undefined);
});

test('parses and validates a structured response', async () => {
  let captured;
  const parse = createLLMParser({
    orConfig,
    logger: silent,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return completion(JSON.stringify(canonicalHand));
    }
  });

  const hand = await parse({ type: 'text', text: 'some hand' });
  assert.deepEqual(hand, canonicalHand);
  assert.equal(captured.url, orConfig.endpoint);
  assert.equal(captured.init.headers.Authorization, 'Bearer test-key');
  assert.equal(captured.init.headers['X-Title'], 'Test App');
});

test('tolerates markdown-fenced JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here you go: {"a":1} hope that helps'), { a: 1 });
  assert.throws(() => extractJson('no json here'));
});

test('retries once on invalid output, then succeeds', async () => {
  let calls = 0;
  const parse = createLLMParser({
    orConfig,
    logger: silent,
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? completion('{"game": 42}') : completion(JSON.stringify(canonicalHand));
    }
  });
  assert.deepEqual(await parse('hand'), canonicalHand);
  assert.equal(calls, 2);
});

test('falls back to looser response formats when no endpoint supports json_schema', async () => {
  const noEndpoints = () =>
    jsonResponse({ error: { message: 'No endpoints found that can handle the requested parameters.', code: 404 } }, 404);
  const formatsSent = [];
  const parse = createLLMParser({
    orConfig,
    logger: silent,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      formatsSent.push(body.response_format?.type ?? 'none');
      return body.response_format ? noEndpoints() : completion(JSON.stringify(canonicalHand));
    }
  });

  assert.deepEqual(await parse('hand'), canonicalHand);
  assert.deepEqual(formatsSent, ['json_schema', 'json_object', 'none']);

  // The working format is remembered for later requests.
  await parse('another hand');
  assert.deepEqual(formatsSent.slice(3), ['none']);
});

test('sends fallback models for OpenRouter model routing', () => {
  const body = buildRequestBody('x', {
    ...orConfig,
    model: 'qwen/qwen3.8-27b:free',
    fallbackModels: ['other/model:free', 'qwen/qwen3.8-27b:free', 'openrouter/free']
  });
  assert.equal(body.model, 'qwen/qwen3.8-27b:free');
  assert.deepEqual(body.models, ['qwen/qwen3.8-27b:free', 'other/model:free', 'openrouter/free']);
  assert.equal(buildRequestBody('x', orConfig).models, undefined);
});

test('reasoning off asks OpenRouter to skip thinking-only models', () => {
  const body = buildRequestBody('x', { ...orConfig, responseFormat: 'none', reasoning: 'off' });
  assert.deepEqual(body.reasoning, { enabled: false });
  assert.deepEqual(body.provider, { require_parameters: true });
  assert.equal(buildRequestBody('x', orConfig).reasoning, undefined);
});

test('a timeout while waiting for the response body is a clean, retryable error', async () => {
  let calls = 0;
  const parse = createLLMParser({
    orConfig,
    logger: silent,
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        json: async () => {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        }
      };
    }
  });
  await assert.rejects(parse('hand'), { name: 'LLMParseError', message: /timed out after 5s/ });
  assert.equal(calls, 2);
});

test('retries rate limits (429) with backoff', async () => {
  let calls = 0;
  const parse = createLLMParser({
    orConfig: { ...orConfig, maxAttempts: 3 },
    logger: silent,
    fetchImpl: async () => {
      calls++;
      return calls < 3
        ? jsonResponse({ error: { message: 'Provider returned error', code: 429 } }, 429)
        : completion(JSON.stringify(canonicalHand));
    }
  });
  assert.deepEqual(await parse('hand'), canonicalHand);
  assert.equal(calls, 3);
});

test('fails cleanly on non-retryable HTTP errors', async () => {
  let calls = 0;
  const parse = createLLMParser({
    orConfig,
    logger: silent,
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ error: { message: 'bad key' } }, 401);
    }
  });
  await assert.rejects(parse('hand'), { name: 'LLMParseError', message: /401/ });
  assert.equal(calls, 1);
});

test('surfaces upstream errors returned with HTTP 200', async () => {
  const parse = createLLMParser({
    orConfig: { ...orConfig, maxAttempts: 1 },
    logger: silent,
    fetchImpl: async () => jsonResponse({ error: { message: 'provider down' } })
  });
  await assert.rejects(parse('hand'), /upstream error/);
});
