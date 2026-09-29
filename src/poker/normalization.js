// Deterministic poker-notation normalization into standard forum notation:
// cards "Ks3h" / "K3o" / "86s", boards "Kh 9c 4d" / "K94r", positions "CO".
// Only rewrites notation; never changes poker meaning.

const RANK_ORDER = 'AKQJT98765432';
const RANK = '(?:10|[2-9TJQKA])';
const SUIT = '[shdc♠♥♦♣]';

const SUIT_LETTERS = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

const POSITION_ALIASES = {
  bb: 'BB',
  'big blind': 'BB',
  sb: 'SB',
  'small blind': 'SB',
  btn: 'BTN',
  bu: 'BTN',
  button: 'BTN',
  dealer: 'BTN',
  co: 'CO',
  cutoff: 'CO',
  'cut off': 'CO',
  'cut-off': 'CO',
  hj: 'HJ',
  hijack: 'HJ',
  lj: 'LJ',
  lojack: 'LJ',
  utg: 'UTG',
  'under the gun': 'UTG',
  'utg+1': 'UTG+1',
  utg1: 'UTG+1',
  'under the gun +1': 'UTG+1',
  'utg+2': 'UTG+2',
  utg2: 'UTG+2',
  'under the gun +2': 'UTG+2',
  mp: 'MP',
  'middle position': 'MP',
  ep: 'EP',
  'early position': 'EP'
};

const TEXTURE_ALIASES = {
  r: 'rainbow',
  rb: 'rainbow',
  rainbow: 'rainbow',
  tt: 'two-tone',
  fd: 'two-tone',
  'two tone': 'two-tone',
  twotone: 'two-tone',
  'two-tone': 'two-tone',
  mono: 'monotone',
  monotone: 'monotone'
};

function rank(r) {
  const upper = String(r).toUpperCase();
  return upper === '10' ? 'T' : upper;
}

function suit(s) {
  return SUIT_LETTERS[s] ?? s.toLowerCase();
}

const byRankDesc = (a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);

/** "k" -> "K", "10h" -> "Th", "K♠" -> "Ks". Unknown strings pass through trimmed. */
export function normalizeCard(card) {
  if (card == null) return card;
  const value = String(card).trim();
  const match = value.match(new RegExp(`^(${RANK})(${SUIT})?$`, 'i'));
  if (!match) return value;
  return rank(match[1]) + (match[2] ? suit(match[2]) : '');
}

/**
 * Hole cards in standard notation, high card first:
 *   "3h Ks" -> "Ks3h", "3Ko" -> "K3o", "86S" -> "86s", "aa" -> "AA".
 * Anything unrecognized is returned trimmed.
 */
export function normalizeHoleCards(hand) {
  if (hand == null) return hand;
  const value = String(hand).trim().replace(/[\s,\-]+/g, '');

  const exact = value.match(new RegExp(`^(${RANK})(${SUIT})(${RANK})(${SUIT})$`, 'i'));
  if (exact) {
    const cards = [
      { rank: rank(exact[1]), suit: suit(exact[2]) },
      { rank: rank(exact[3]), suit: suit(exact[4]) }
    ].sort(byRankDesc);
    return cards.map((c) => c.rank + c.suit).join('');
  }

  const generic = value.match(new RegExp(`^(${RANK})(${RANK})([so])?$`, 'i'));
  if (generic) {
    const [high, low] = [{ rank: rank(generic[1]) }, { rank: rank(generic[2]) }].sort(byRankDesc);
    const pair = high.rank === low.rank;
    return high.rank + low.rank + (pair || !generic[3] ? '' : generic[3].toLowerCase());
  }

  return String(hand).trim();
}

export function normalizeTexture(texture) {
  if (!texture) return null;
  const trimmed = String(texture).trim();
  return TEXTURE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Board in forum notation:
 *   ["Kh","9c","4d"]            -> "Kh 9c 4d"
 *   ["K","9","4"] + rainbow     -> "K94r"
 *   ["K","9","4"] + two-tone    -> "K94 (two-tone)"
 */
export function formatBoard(cards, texture) {
  const normalized = (cards ?? []).filter(Boolean).map(normalizeCard);
  if (!normalized.length) return '';

  const allSuited = normalized.every((c) => /^[2-9TJQKA][shdc]$/.test(c));
  if (allSuited) return normalized.join(' ');

  const allRanks = normalized.every((c) => /^[2-9TJQKA]$/.test(c));
  const board = allRanks ? normalized.join('') : normalized.join(' ');
  const tex = normalizeTexture(texture);
  if (!tex) return board;
  if (tex === 'rainbow' && allRanks) return `${board}r`;
  return `${board} (${tex})`;
}

/** "cutoff" -> "CO", "big blind" -> "BB". Unknown strings pass through trimmed. */
export function normalizePosition(position) {
  if (position == null) return null;
  const trimmed = String(position).trim();
  const key = trimmed.toLowerCase().replace(/\s+/g, ' ');
  return POSITION_ALIASES[key] ?? POSITION_ALIASES[key.replace(/\s/g, '')] ?? trimmed;
}

/** "no-limit hold'em" -> "NLH", "pot-limit Omaha" -> "PLO". */
export function abbreviateGame(game) {
  if (!game) return null;
  const g = game.toLowerCase().replace(/[’']/g, '');
  const holdem = /hold ?em|holdem|nlh|nlhe|lhe/.test(g);
  const omaha = /omaha|plo/.test(g);
  const noLimit = /no[\s-]?limit|\bnl/.test(g);
  const potLimit = /pot[\s-]?limit|\bpl/.test(g);

  if (holdem && noLimit) return 'NLH';
  if (omaha && potLimit) return 'PLO';
  if (holdem && /limit/.test(g)) return 'LHE';
  if (g === 'nlh' || g === 'nlhe') return 'NLH';
  if (g === 'plo') return 'PLO';
  return game.trim();
}

/** "1/2" -> { sb: 1, bb: 2 }, "$2/$5" -> { sb: 2, bb: 5 }. null if unparseable. */
export function parseStakes(stakes) {
  if (!stakes) return null;
  const match = String(stakes).match(/(\d+(?:\.\d+)?)\s*\/\s*\$?\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const sb = Number(match[1]);
  const bb = Number(match[2]);
  return bb > 0 ? { sb, bb } : null;
}

/** 2.5 -> "2.5", 3 -> "3", 18.333 -> "18.33" */
export function formatNumber(n) {
  return String(Math.round(n * 100) / 100);
}
