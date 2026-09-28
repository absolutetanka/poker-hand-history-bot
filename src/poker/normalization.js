// Deterministic poker-notation normalization applied to validated LLM output.
// Only rewrites notation; never changes poker meaning.

const RANK_NAMES = {
  A: 'Ace',
  K: 'King',
  Q: 'Queen',
  J: 'Jack',
  T: '10',
  '10': '10'
};

const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };

const POSITION_NAMES = {
  BB: 'big blind',
  SB: 'small blind',
  BTN: 'button',
  BU: 'button',
  CO: 'cutoff',
  HJ: 'hijack',
  LJ: 'lojack',
  UTG: 'under the gun',
  'UTG+1': 'under the gun +1',
  'UTG+2': 'under the gun +2',
  UTG1: 'under the gun +1',
  UTG2: 'under the gun +2',
  MP: 'middle position',
  EP: 'early position',
  LP: 'late position'
};

const TEXTURE_NAMES = {
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

const RANK = '(?:10|[AKQJT2-9])';

export function rankName(rank) {
  const upper = String(rank).toUpperCase();
  return RANK_NAMES[upper] ?? upper;
}

/** "K" -> "King", "Kh" -> "King♥", "10c" -> "10♣". Unknown strings pass through. */
export function formatCard(card) {
  if (!card) return card;
  const match = String(card).trim().match(new RegExp(`^(${RANK})([shdc])?$`, 'i'));
  if (!match) return card;
  const [, rank, suit] = match;
  return `${rankName(rank)}${suit ? SUIT_SYMBOLS[suit.toLowerCase()] : ''}`;
}

export function formatBoard(cards) {
  return (cards ?? []).filter(Boolean).map(formatCard).join('-');
}

/**
 * Hole cards:
 *   "K3o"  -> "King-3 offsuit"
 *   "86s"  -> "8-6 suited"
 *   "AA"   -> "Ace-Ace"
 *   "Ks3h" -> "King♠-3♥"
 * Anything else is returned unchanged.
 */
export function formatHoleCards(hand) {
  if (!hand) return hand;
  const value = String(hand).trim().replace(/\s+/g, '');

  const exact = value.match(new RegExp(`^(${RANK})([shdc])(${RANK})([shdc])$`, 'i'));
  if (exact) {
    const [, r1, s1, r2, s2] = exact;
    return `${formatCard(r1 + s1)}-${formatCard(r2 + s2)}`;
  }

  const generic = value.match(new RegExp(`^(${RANK})(${RANK})([so])?$`, 'i'));
  if (generic) {
    const [, r1, r2, suitedness] = generic;
    const base = `${rankName(r1)}-${rankName(r2)}`;
    if (!suitedness) return base;
    return `${base} ${suitedness.toLowerCase() === 's' ? 'suited' : 'offsuit'}`;
  }

  return hand;
}

export function normalizePosition(position) {
  if (!position) return position;
  const trimmed = String(position).trim();
  return POSITION_NAMES[trimmed.toUpperCase()] ?? trimmed;
}

export function normalizeTexture(texture) {
  if (!texture) return texture;
  const trimmed = String(texture).trim();
  return TEXTURE_NAMES[trimmed.toLowerCase()] ?? trimmed;
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Normalizes notation inside a free-text action/showdown sentence:
 *   "CO shows 86s"       -> "Cutoff shows 8-6 suited"
 *   "BB bets 2.5bb"      -> "Big blind bets 2.5 big blinds"
 *   "Hero shows AsKd"    -> "Hero shows Ace♠-King♦"
 * Only unambiguous tokens are rewritten (uppercase position abbreviations,
 * hole cards with an explicit s/o marker or exact suits).
 */
export function normalizeActionText(text) {
  if (!text) return text;

  let result = String(text).trim().replace(/[.\s]+$/, '');

  result = result.replace(
    new RegExp(`\\b(${RANK}[shdc]${RANK}[shdc])\\b`, 'g'),
    (token) => formatHoleCards(token)
  );
  result = result.replace(
    new RegExp(`\\b(${RANK}${RANK}[so])\\b`, 'g'),
    (token) => formatHoleCards(token)
  );

  result = result.replace(/(\d+(?:\.\d+)?)\s*bbs?\b/gi, (_, amount) =>
    `${amount} ${Number(amount) === 1 ? 'big blind' : 'big blinds'}`
  );

  result = result.replace(/\b(UTG\+?[12]?|BTN|BU|CO|HJ|LJ|MP|EP|LP|BB|SB)\b/g, (token) =>
    POSITION_NAMES[token] ?? token
  );

  return capitalize(result);
}

/** Returns a copy of a validated hand with display notation normalized. */
export function normalizeHand(hand) {
  const street = (s) =>
    s && { ...s, actions: (s.actions ?? []).map(normalizeActionText).filter(Boolean) };

  return {
    ...hand,
    hero: {
      position: normalizePosition(hand.hero?.position ?? null),
      hand: formatHoleCards(hand.hero?.hand ?? null)
    },
    villains: (hand.villains ?? []).map((v) => ({
      position: normalizePosition(v.position),
      hand: formatHoleCards(v.hand)
    })),
    preflop: (hand.preflop ?? []).map(normalizeActionText).filter(Boolean),
    flop: hand.flop && {
      ...street(hand.flop),
      cards: hand.flop.cards ?? [],
      texture: normalizeTexture(hand.flop.texture)
    },
    turn: street(hand.turn),
    river: street(hand.river),
    showdown: (hand.showdown ?? []).map(normalizeActionText).filter(Boolean),
    missing: [...new Set((hand.missing ?? []).map((m) => m.trim()).filter(Boolean))]
  };
}
