// Canonical v0.1 example (spec §30) as the LLM should return it.
export const canonicalHand = {
  game: "no-limit hold'em",
  stakes: '1/2',
  effective_stack: null,
  players: [
    { position: 'BB', is_hero: true, cards: 'K3o', stack: null },
    { position: 'CO', is_hero: false, cards: null, stack: null }
  ],
  preflop: [
    { player: 'CO', action: 'raise', amount: { value: 2.5, unit: 'bb' } },
    { player: 'Hero', action: 'call', amount: null }
  ],
  flop: { cards: ['K', '9', '4'], texture: 'rainbow', actions: [] },
  turn: { card: 'A', actions: [] },
  river: { card: '2', actions: [] },
  showdown: [{ player: 'CO', cards: '86s' }],
  winner: null
};

// Pot 1.5 (blinds) + 2.5 (CO) + 1.5 (Hero completes) = 5.5bb at the flop.
// Flop action is unknown, so later pots are not shown.
export const canonicalOutput = `NLH 1/2 · Effective: ?

Hero (BB): K3o
CO: 86s (shown)

Preflop (1.5bb): CO raises to 2.5bb, Hero calls.
Flop (5.5bb): K94r
Turn: A
River: 2
Showdown: CO shows 86s.

Missing: stacks, postflop action`;

// A complete hand with chip amounts at 2/5 (SB = 0.4bb).
export const fullHand = {
  game: 'NLH',
  stakes: '2/5',
  effective_stack: { value: 300, unit: 'chips' },
  players: [
    { position: 'BTN', is_hero: true, cards: 'Qs As', stack: null },
    { position: 'under the gun', is_hero: false, cards: null, stack: null }
  ],
  preflop: [
    { player: 'UTG', action: 'raise', amount: { value: 15, unit: 'chips' } },
    { player: 'Hero', action: 'raise', amount: { value: 45, unit: 'chips' } },
    { player: 'UTG', action: 'call', amount: null }
  ],
  flop: {
    cards: ['Qh', '7c', '2d'],
    texture: 'rainbow',
    actions: [
      { player: 'UTG', action: 'check', amount: null },
      { player: 'Hero', action: 'bet', amount: { value: 50, unit: 'chips' } },
      { player: 'UTG', action: 'call', amount: null }
    ]
  },
  turn: {
    card: '5s',
    actions: [
      { player: 'UTG', action: 'check', amount: null },
      { player: 'Hero', action: 'check', amount: null }
    ]
  },
  river: {
    card: 'Kc',
    actions: [
      { player: 'UTG', action: 'bet', amount: { value: 120, unit: 'chips' } },
      { player: 'Hero', action: 'call', amount: null }
    ]
  },
  showdown: [{ player: 'UTG', cards: 'Qc Kd' }],
  winner: 'UTG'
};

// 1.4 -> +3 +9 +6 = 19.4 -> +10 +10 = 39.4 -> +24 +24 = 87.4
export const fullOutput = `NLH 2/5 · Effective: 300 (60bb)

Hero (BTN): AsQs
UTG: KdQc (shown)

Preflop (1.4bb): UTG raises to 3bb, Hero 3-bets to 9bb, UTG calls.
Flop (19.4bb): Qh 7c 2d · UTG checks, Hero bets 10bb, UTG calls.
Turn (39.4bb): 5s · UTG checks, Hero checks.
River (39.4bb): Kc · UTG bets 24bb, Hero calls.
Showdown (87.4bb): UTG shows KdQc. UTG wins.`;
