import { z } from 'zod';

// Application-level validator. The LLM is never trusted as the final validator.
// Actions are structured (not sentences) so the bot can compute pots and
// render standard forum-style notation deterministically.

export const ACTION_TYPES = ['fold', 'check', 'call', 'bet', 'raise', 'all-in'];

const AmountSchema = z.object({
  value: z.number().nonnegative(),
  unit: z.enum(['bb', 'chips'])
});

const ActionSchema = z.object({
  player: z.string(),
  action: z.enum(ACTION_TYPES),
  amount: AmountSchema.nullable()
});

export const HandHistorySchema = z.object({
  game: z.string().nullable(),
  stakes: z.string().nullable(),
  effective_stack: AmountSchema.nullable(),

  players: z.array(
    z.object({
      position: z.string().nullable(),
      is_hero: z.boolean(),
      cards: z.string().nullable(),
      stack: AmountSchema.nullable()
    })
  ),

  preflop: z.array(ActionSchema),

  flop: z.object({
    cards: z.array(z.string()).max(3),
    texture: z.string().nullable(),
    actions: z.array(ActionSchema)
  }).nullable(),

  turn: z.object({
    card: z.string().nullable(),
    actions: z.array(ActionSchema)
  }).nullable(),

  river: z.object({
    card: z.string().nullable(),
    actions: z.array(ActionSchema)
  }).nullable(),

  showdown: z.array(
    z.object({
      player: z.string(),
      cards: z.string().nullable()
    })
  ),

  winner: z.string().nullable()
});

// JSON Schema sent to OpenRouter for structured output. Written by hand so it
// satisfies strict mode: every property required, no additional properties.
// Must stay in sync with HandHistorySchema (enforced by test/schema.test.js).
const nullableString = { type: ['string', 'null'] };

const amount = {
  type: 'object',
  properties: {
    value: { type: 'number' },
    unit: { type: 'string', enum: ['bb', 'chips'] }
  },
  required: ['value', 'unit'],
  additionalProperties: false
};
const nullableAmount = { ...amount, type: ['object', 'null'] };

const action = {
  type: 'object',
  properties: {
    player: { type: 'string', description: 'Position abbreviation (e.g. "CO") or "Hero".' },
    action: { type: 'string', enum: ACTION_TYPES },
    amount: {
      ...nullableAmount,
      description: 'bet/raise/all-in: TOTAL amount put in on this street ("raises to"). null for fold/check/call or when unstated.'
    }
  },
  required: ['player', 'action', 'amount'],
  additionalProperties: false
};
const actions = { type: 'array', items: action };

const laterStreet = (description) => ({
  type: ['object', 'null'],
  description,
  properties: {
    card: nullableString,
    actions
  },
  required: ['card', 'actions'],
  additionalProperties: false
});

export const HAND_HISTORY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    game: { ...nullableString, description: "e.g. no-limit hold'em" },
    stakes: { ...nullableString, description: 'e.g. 1/2' },
    effective_stack: { ...nullableAmount, description: 'Only if stated.' },
    players: {
      type: 'array',
      description: 'Every player mentioned in the hand, including Hero.',
      items: {
        type: 'object',
        properties: {
          position: { ...nullableString, description: 'Abbreviation: UTG, UTG+1, UTG+2, LJ, HJ, CO, BTN, SB, BB, MP, EP' },
          is_hero: { type: 'boolean' },
          cards: { ...nullableString, description: 'e.g. "Ks3h", "K3o", "86s", "AA"' },
          stack: { ...nullableAmount, description: 'Only if stated.' }
        },
        required: ['position', 'is_hero', 'cards', 'stack'],
        additionalProperties: false
      }
    },
    preflop: { ...actions, description: 'Preflop actions in order. Do not include blind posts.' },
    flop: {
      type: ['object', 'null'],
      description: 'null if the hand never reached the flop.',
      properties: {
        cards: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        texture: nullableString,
        actions
      },
      required: ['cards', 'texture', 'actions'],
      additionalProperties: false
    },
    turn: laterStreet('null if the hand never reached the turn.'),
    river: laterStreet('null if the hand never reached the river.'),
    showdown: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          player: { type: 'string' },
          cards: nullableString
        },
        required: ['player', 'cards'],
        additionalProperties: false
      }
    },
    winner: { ...nullableString, description: 'Only if stated.' }
  },
  required: [
    'game',
    'stakes',
    'effective_stack',
    'players',
    'preflop',
    'flop',
    'turn',
    'river',
    'showdown',
    'winner'
  ],
  additionalProperties: false
};
