import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatHandHistory } from '../src/poker/formatter.js';
import {
  formatBoard,
  formatHoleCards,
  normalizeActionText,
  normalizePosition,
  normalizeTexture
} from '../src/poker/normalization.js';
import { canonicalHand, canonicalOutput } from './fixtures.js';

test('formats the canonical v0.1 example exactly', () => {
  assert.equal(formatHandHistory(canonicalHand), canonicalOutput);
});

test('formats street actions as sentences', () => {
  const output = formatHandHistory({
    ...canonicalHand,
    flop: { cards: ['K', '9', '4'], texture: 'r', actions: ['Hero checks', 'CO bets 3bb', 'Hero calls.'] }
  });
  assert.match(output, /^Flop: King-9-4, rainbow\. Hero checks\. Cutoff bets 3 big blinds\. Hero calls\.$/m);
});

test('supports multiple villains, unknown hands, and omits unreached streets', () => {
  const output = formatHandHistory({
    ...canonicalHand,
    game: null,
    stakes: null,
    villains: [
      { position: 'CO', hand: null },
      { position: 'button', hand: 'AQs' }
    ],
    flop: null,
    turn: null,
    river: null,
    showdown: [],
    missing: []
  });
  assert.equal(
    output,
    [
      'Hero: big blind — King-3 offsuit',
      'Villain: cutoff',
      'Villain: button — Ace-Queen suited',
      '',
      'Preflop: Cutoff opens to 2.5 big blinds. Big blind calls.'
    ].join('\n')
  );
});

test('prints pot, effective stack, and result when known', () => {
  const output = formatHandHistory({
    ...canonicalHand,
    effective_stack: '100 big blinds',
    pot_size: '$42',
    result: 'Hero wins'
  });
  assert.match(output, /^Effective stack: 100 big blinds$/m);
  assert.match(output, /^Pot: \$42$/m);
  assert.match(output, /^Result: Hero wins$/m);
});

test('hole-card notation', () => {
  assert.equal(formatHoleCards('K3o'), 'King-3 offsuit');
  assert.equal(formatHoleCards('86s'), '8-6 suited');
  assert.equal(formatHoleCards('AA'), 'Ace-Ace');
  assert.equal(formatHoleCards('Ks3h'), 'King♠-3♥');
  assert.equal(formatHoleCards('T9s'), '10-9 suited');
  assert.equal(formatHoleCards('something odd'), 'something odd');
});

test('board, position, and texture notation', () => {
  assert.equal(formatBoard(['K', '9', '4']), 'King-9-4');
  assert.equal(formatBoard(['Kh', 'Tc', '4d']), 'King♥-10♣-4♦');
  assert.equal(normalizePosition('BTN'), 'button');
  assert.equal(normalizePosition('UTG+1'), 'under the gun +1');
  assert.equal(normalizePosition('big blind'), 'big blind');
  assert.equal(normalizeTexture('r'), 'rainbow');
  assert.equal(normalizeTexture('monotone'), 'monotone');
});

test('action text normalization does not change meaning', () => {
  assert.equal(normalizeActionText('CO shows 86s'), 'Cutoff shows 8-6 suited');
  assert.equal(normalizeActionText('BB 3-bets to 10bb.'), 'Big blind 3-bets to 10 big blinds');
  assert.equal(normalizeActionText('Hero shows AsKd'), 'Hero shows Ace♠-King♦');
  // Chip amounts stay chip amounts; unknown sizes stay unknown.
  assert.equal(normalizeActionText('Cutoff opens to $5'), 'Cutoff opens to $5');
  assert.equal(normalizeActionText('Cutoff opens'), 'Cutoff opens');
  // Bare pairs are ambiguous with chip amounts, so they are left alone.
  assert.equal(normalizeActionText('Hero bets 22'), 'Hero bets 22');
});
