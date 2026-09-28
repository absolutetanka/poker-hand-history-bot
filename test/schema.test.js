import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HAND_HISTORY_JSON_SCHEMA, HandHistorySchema } from '../src/llm/handHistorySchema.js';
import { canonicalHand } from './fixtures.js';

// Walks the Zod schema and the JSON Schema in parallel to make sure they agree
// on every object's keys and that strict-mode requirements hold.
function unwrap(zodType) {
  let t = zodType;
  while (t?._def?.innerType) t = t._def.innerType;
  return t;
}

function compare(zodType, jsonSchema, path) {
  const t = unwrap(zodType);
  const typeName = t._def.typeName;

  if (typeName === 'ZodObject') {
    const zodKeys = Object.keys(t.shape).sort();
    const jsonKeys = Object.keys(jsonSchema.properties).sort();
    assert.deepEqual(jsonKeys, zodKeys, `property mismatch at ${path}`);
    assert.deepEqual([...jsonSchema.required].sort(), zodKeys, `required mismatch at ${path}`);
    assert.equal(jsonSchema.additionalProperties, false, `additionalProperties at ${path}`);
    for (const key of zodKeys) compare(t.shape[key], jsonSchema.properties[key], `${path}.${key}`);
  } else if (typeName === 'ZodArray') {
    compare(t._def.type, jsonSchema.items, `${path}[]`);
  }
}

test('JSON Schema mirrors the Zod schema (strict-mode compatible)', () => {
  compare(HandHistorySchema, HAND_HISTORY_JSON_SCHEMA, '$');
});

test('canonical hand validates', () => {
  assert.doesNotThrow(() => HandHistorySchema.parse(canonicalHand));
});

test('rejects malformed hands', () => {
  assert.throws(() => HandHistorySchema.parse({ ...canonicalHand, villains: undefined }));
  assert.throws(() =>
    HandHistorySchema.parse({ ...canonicalHand, flop: { cards: ['A', 'K', 'Q', 'J'], texture: null, actions: [] } })
  );
});
