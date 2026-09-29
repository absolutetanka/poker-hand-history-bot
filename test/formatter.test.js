import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatHandHistory } from '../src/poker/formatter.js';
import { analyzeHand } from '../src/poker/handState.js';
import {
  abbreviateGame,
  formatBoard,
  normalizeCard,
  normalizeHoleCards,
  normalizePosition,
  parseStakes
} from '../src/poker/normalization.js';
import { canonicalHand, canonicalOutput, fullHand, fullOutput } from './fixtures.js';

const act = (player, action, amount = null) => ({ player, action, amount });
const bb = (value) => ({ value, unit: 'bb' });

test('formats the canonical hand in forum style', () => {
  assert.equal(formatHandHistory(canonicalHand), canonicalOutput);
});

test('formats a complete hand with pots on every street', () => {
  assert.equal(formatHandHistory(fullHand), fullOutput);
  assert.deepEqual(analyzeHand(fullHand).missing, []);
});

test('pots stop being shown once any size is unknown', () => {
  const hand = {
    ...canonicalHand,
    preflop: [act('CO', 'raise'), act('Hero', 'call')]
  };
  const output = formatHandHistory(hand);
  assert.match(output, /^Preflop \(1\.5bb\): CO raises, Hero calls\.$/m);
  assert.match(output, /^Flop: K94r$/m);
  assert.ok(analyzeHand(hand).missing.includes('bet sizes'));
});

test('preflop raise ladder, limps, and folds', () => {
  const hand = {
    ...canonicalHand,
    players: [
      { position: 'BTN', is_hero: true, cards: 'AA', stack: null },
      { position: 'CO', is_hero: false, cards: null, stack: null },
      { position: 'UTG', is_hero: false, cards: null, stack: null }
    ],
    preflop: [
      act('UTG', 'call'),
      act('CO', 'raise', bb(4)),
      act('Hero', 'raise', bb(12)),
      act('CO', 'raise', bb(30)),
      act('UTG', 'fold'),
      act('Hero', 'all-in', bb(100)),
      act('CO', 'call')
    ],
    flop: null,
    turn: null,
    river: null,
    showdown: []
  };
  assert.match(
    formatHandHistory(hand),
    /^Preflop \(1\.5bb\): UTG limps, CO raises to 4bb, Hero 3-bets to 12bb, CO 4-bets to 30bb, UTG folds, Hero goes all-in for 100bb, CO calls\.$/m
  );
});

test('an all-in makes later streets without action fine', () => {
  const hand = {
    ...canonicalHand,
    preflop: [act('CO', 'all-in', bb(50)), act('Hero', 'call')]
  };
  const { potAtStart, finalPot, missing } = analyzeHand(hand);
  assert.equal(potAtStart.flop, 100.5); // 50 + 50 + dead SB
  assert.equal(potAtStart.river, 100.5);
  assert.equal(finalPot, 100.5);
  assert.ok(!missing.includes('postflop action'));
});

test('player stacks, heads-up effective stack, and winner without showdown', () => {
  const hand = {
    ...canonicalHand,
    players: [
      { position: 'BB', is_hero: true, cards: 'K3o', stack: bb(80) },
      { position: 'CO', is_hero: false, cards: null, stack: bb(120) }
    ],
    flop: { cards: ['K', '9', '4'], texture: 'r', actions: [act('Hero', 'check'), act('CO', 'bet', bb(3)), act('Hero', 'fold')] },
    turn: null,
    river: null,
    showdown: [],
    winner: 'cutoff'
  };
  const output = formatHandHistory(hand);
  assert.match(output, /^NLH 1\/2 · Effective: 80bb$/m);
  assert.match(output, /^Hero \(BB, 80bb\): K3o$/m);
  assert.match(output, /^CO \(120bb\)$/m);
  assert.match(output, /^Flop \(5\.5bb\): K94r · Hero checks, CO bets 3bb, Hero folds\.$/m);
  assert.match(output, /^Result: CO wins\.$/m);
});

test('chip amounts without stakes stay in chips and flag stakes', () => {
  const hand = {
    ...canonicalHand,
    game: null,
    stakes: null,
    preflop: [act('CO', 'raise', { value: 5, unit: 'chips' }), act('Hero', 'call')]
  };
  const output = formatHandHistory(hand);
  assert.match(output, /^Effective: \?$/m);
  assert.match(output, /CO raises to 5, Hero calls\./);
  assert.match(output, /^Flop: K94r$/m);
  assert.ok(analyzeHand(hand).missing.includes('stakes'));
});

test('standard card notation', () => {
  assert.equal(normalizeHoleCards('Ks3h'), 'Ks3h');
  assert.equal(normalizeHoleCards('3h Ks'), 'Ks3h');
  assert.equal(normalizeHoleCards('K♠3♥'), 'Ks3h');
  assert.equal(normalizeHoleCards('10s9s'), 'Ts9s');
  assert.equal(normalizeHoleCards('3Ko'), 'K3o');
  assert.equal(normalizeHoleCards('86S'), '86s');
  assert.equal(normalizeHoleCards('aa'), 'AA');
  assert.equal(normalizeHoleCards('K3'), 'K3');
  assert.equal(normalizeHoleCards('something odd'), 'something odd');
  assert.equal(normalizeCard('10h'), 'Th');
  assert.equal(normalizeCard('k'), 'K');
});

test('board notation', () => {
  assert.equal(formatBoard(['Kh', '9c', '4d'], 'rainbow'), 'Kh 9c 4d');
  assert.equal(formatBoard(['K', '9', '4'], 'rainbow'), 'K94r');
  assert.equal(formatBoard(['K', '9', '4'], 'fd'), 'K94 (two-tone)');
  assert.equal(formatBoard(['K', '9', '4'], null), 'K94');
  assert.equal(formatBoard(['10', 'J', 'Q'], 'monotone'), 'TJQ (monotone)');
});

test('positions, game, and stakes', () => {
  assert.equal(normalizePosition('cutoff'), 'CO');
  assert.equal(normalizePosition('Big Blind'), 'BB');
  assert.equal(normalizePosition('button'), 'BTN');
  assert.equal(normalizePosition('UTG+1'), 'UTG+1');
  assert.equal(abbreviateGame("no-limit hold'em"), 'NLH');
  assert.equal(abbreviateGame('pot-limit Omaha'), 'PLO');
  assert.equal(abbreviateGame("limit hold'em"), 'LHE');
  assert.deepEqual(parseStakes('$2/$5'), { sb: 2, bb: 5 });
  assert.equal(parseStakes('one two'), null);
});
