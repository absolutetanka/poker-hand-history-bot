// Replays a validated hand to resolve players, convert amounts to big blinds,
// compute the pot at the start of each street, and find missing information.
// Pots are only reported when every contributing amount is known.
//
// Assumptions: blinds are posted (a folded SB/BB is dead money); no antes or
// straddles unless the schema grows to include them.

import { normalizeHoleCards, normalizePosition, parseStakes } from './normalization.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river'];

/** Converts an { value, unit } amount to big blinds, or null if impossible. */
export function toBB(amount, stakes) {
  if (!amount) return null;
  if (amount.unit === 'bb') return amount.value;
  return stakes ? amount.value / stakes.bb : null;
}

function buildRoster(hand) {
  const players = (hand.players ?? []).map((p) => ({
    ...p,
    position: normalizePosition(p.position),
    cards: normalizeHoleCards(p.cards)
  }));

  let villainCount = 0;
  for (const p of players) {
    if (p.is_hero) p.key = p.position ?? 'Hero';
    else p.key = p.position ?? `Villain ${++villainCount}`;
    p.label = p.is_hero ? 'Hero' : p.key;
  }

  const hero = players.find((p) => p.is_hero) ?? null;
  const villains = players.filter((p) => !p.is_hero);

  // Resolves a player reference from an action ("Hero", "cutoff", "CO", "villain").
  function resolve(name) {
    const raw = String(name ?? '').trim();
    const lower = raw.toLowerCase();
    if (lower === 'hero' || lower === 'i' || lower === 'me') {
      return hero ?? { key: 'Hero', label: 'Hero' };
    }
    const position = normalizePosition(raw);
    const found = players.find((p) => p.key === position || p.position === position);
    if (found) return found;
    if (/^villain/i.test(raw) && villains.length === 1) return villains[0];
    return { key: position || raw, label: position || raw };
  }

  return { players, hero, villains, resolve };
}

export function analyzeHand(hand) {
  const stakes = parseStakes(hand.stakes);
  const { players, hero, villains, resolve } = buildRoster(hand);

  const sbInBB = stakes ? stakes.sb / stakes.bb : 0.5;

  let potKnown = true;
  let pot = 0;
  let allIn = false;
  const potAtStart = {};
  const streets = {};

  for (const street of STREETS) {
    const data = street === 'preflop' ? { actions: hand.preflop ?? [] } : hand[street];
    if (!data) break;

    const contributions = new Map();
    let currentBet = 0;
    let raises = 0;

    if (street === 'preflop') {
      contributions.set('SB', sbInBB);
      contributions.set('BB', 1);
      pot = sbInBB + 1;
      currentBet = 1;
    }
    potAtStart[street] = potKnown ? pot : null;

    const annotated = [];
    for (const action of data.actions ?? []) {
      const player = resolve(action.player);
      const amountBB = toBB(action.amount, stakes);
      const before = contributions.get(player.key) ?? 0;
      const entry = { ...action, player, amountBB, raiseNumber: 0, limp: false };

      const putIn = (to) => {
        pot += Math.max(0, to - before);
        contributions.set(player.key, Math.max(before, to));
      };

      switch (action.action) {
        case 'call':
          if (street === 'preflop' && raises === 0 && player.key !== 'BB') entry.limp = true;
          putIn(currentBet);
          break;
        case 'bet':
        case 'raise':
          raises++;
          entry.raiseNumber = raises;
          if (amountBB == null) potKnown = false;
          else {
            putIn(amountBB);
            currentBet = amountBB;
          }
          break;
        case 'all-in':
          allIn = true;
          if (amountBB == null) potKnown = false;
          else {
            if (amountBB > currentBet) {
              raises++;
              entry.raiseNumber = raises;
              currentBet = amountBB;
            }
            putIn(amountBB);
          }
          break;
        default:
          break; // fold / check
      }
      annotated.push(entry);
    }

    // A reached street with no recorded action (unless someone is all-in)
    // means betting on it is unknown, so later pots are unknown too.
    const nextStreet = STREETS[STREETS.indexOf(street) + 1];
    if (!annotated.length && !allIn && (hand[nextStreet] || hand.showdown?.length)) {
      potKnown = false;
    }

    streets[street] = { ...data, actions: annotated };
  }

  const finalPot = potKnown ? pot : null;

  // Cards shown at showdown, keyed by player.
  const showdown = (hand.showdown ?? []).map((s) => ({
    player: resolve(s.player),
    cards: normalizeHoleCards(s.cards)
  }));

  return {
    stakes,
    players,
    hero,
    villains,
    streets,
    potAtStart,
    finalPot,
    showdown,
    winner: hand.winner ? resolve(hand.winner) : null,
    effectiveBB: effectiveStack(hand, players, stakes),
    missing: findMissing(hand, { hero, players, streets, stakes })
  };
}

function effectiveStack(hand, players, stakes) {
  if (hand.effective_stack) {
    return { amount: hand.effective_stack, bb: toBB(hand.effective_stack, stakes) };
  }
  // Heads-up with both stacks known: effective = the smaller stack.
  if (players.length === 2 && players.every((p) => p.stack)) {
    const bbs = players.map((p) => toBB(p.stack, stakes));
    if (bbs.every((v) => v != null)) {
      const i = bbs[0] <= bbs[1] ? 0 : 1;
      return { amount: players[i].stack, bb: bbs[i] };
    }
  }
  return null;
}

/** Only reports information that matters for the hand as described. */
function findMissing(hand, { hero, players, streets, stakes }) {
  const missing = [];
  const allActions = STREETS.flatMap((s) => streets[s]?.actions ?? []);

  if (!hand.stakes) missing.push('stakes');
  if (!hero?.position) missing.push('hero position');
  if (!hero?.cards) missing.push('hero cards');
  if (!hand.effective_stack && !players.some((p) => p.stack)) missing.push('stacks');

  const sized = allActions.filter((a) => ['bet', 'raise', 'all-in'].includes(a.action));
  if (sized.some((a) => !a.amount)) missing.push('bet sizes');
  else if (!stakes && sized.some((a) => a.amount?.unit === 'chips')) {
    // Chip amounts can't be converted to big blinds without stakes.
    if (!missing.includes('stakes')) missing.push('stakes');
  }

  if (!hand.preflop?.length && hand.flop) missing.push('preflop action');
  if (hand.flop && (hand.flop.cards?.length ?? 0) < 3) missing.push('flop cards');
  if (hand.turn && !hand.turn.card) missing.push('turn card');
  if (hand.river && !hand.river.card) missing.push('river card');

  const allInHappened = allActions.some((a) => a.action === 'all-in');
  const silentPostflop = ['flop', 'turn', 'river'].some((s, i, arr) => {
    const next = arr[i + 1];
    return hand[s] && !hand[s].actions?.length && (next ? hand[next] : hand.showdown?.length);
  });
  if (silentPostflop && !allInHappened) missing.push('postflop action');

  return missing;
}
