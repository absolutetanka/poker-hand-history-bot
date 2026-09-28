import { z } from 'zod';

// Application-level validator. The LLM is never trusted as the final validator.
export const HandHistorySchema = z.object({
  game: z.string().nullable(),
  stakes: z.string().nullable(),

  hero: z.object({
    position: z.string().nullable(),
    hand: z.string().nullable()
  }),

  villains: z.array(
    z.object({
      position: z.string().nullable(),
      hand: z.string().nullable()
    })
  ),

  preflop: z.array(z.string()),

  flop: z.object({
    cards: z.array(z.string()).max(3),
    texture: z.string().nullable(),
    actions: z.array(z.string())
  }).nullable(),

  turn: z.object({
    card: z.string().nullable(),
    actions: z.array(z.string())
  }).nullable(),

  river: z.object({
    card: z.string().nullable(),
    actions: z.array(z.string())
  }).nullable(),

  showdown: z.array(z.string()),
  result: z.string().nullable(),
  pot_size: z.string().nullable(),
  effective_stack: z.string().nullable(),
  missing: z.array(z.string())
});

// JSON Schema sent to OpenRouter for structured output. Written by hand so it
// satisfies strict mode: every property required, no additional properties.
// Must stay in sync with HandHistorySchema (enforced by test/schema.test.js).
const nullableString = { type: ['string', 'null'] };
const stringArray = { type: 'array', items: { type: 'string' } };

const player = {
  type: 'object',
  properties: {
    position: nullableString,
    hand: nullableString
  },
  required: ['position', 'hand'],
  additionalProperties: false
};

const laterStreet = (description) => ({
  type: ['object', 'null'],
  description,
  properties: {
    card: nullableString,
    actions: stringArray
  },
  required: ['card', 'actions'],
  additionalProperties: false
});

export const HAND_HISTORY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    game: { ...nullableString, description: "e.g. no-limit hold'em" },
    stakes: { ...nullableString, description: 'e.g. 1/2' },
    hero: { ...player, description: 'The player telling the story.' },
    villains: { type: 'array', items: player },
    preflop: { ...stringArray, description: 'Preflop actions in order.' },
    flop: {
      type: ['object', 'null'],
      description: 'null if the hand never reached the flop.',
      properties: {
        cards: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        texture: nullableString,
        actions: stringArray
      },
      required: ['cards', 'texture', 'actions'],
      additionalProperties: false
    },
    turn: laterStreet('null if the hand never reached the turn.'),
    river: laterStreet('null if the hand never reached the river.'),
    showdown: stringArray,
    result: nullableString,
    pot_size: nullableString,
    effective_stack: nullableString,
    missing: {
      ...stringArray,
      description: 'Important information absent from the description.'
    }
  },
  required: [
    'game',
    'stakes',
    'hero',
    'villains',
    'preflop',
    'flop',
    'turn',
    'river',
    'showdown',
    'result',
    'pot_size',
    'effective_stack',
    'missing'
  ],
  additionalProperties: false
};
