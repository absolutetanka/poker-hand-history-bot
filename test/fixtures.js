// Canonical v0.1 example (spec §30) as the LLM should return it.
export const canonicalHand = {
  game: "no-limit hold'em",
  stakes: '1/2',
  hero: { position: 'big blind', hand: 'K3o' },
  villains: [{ position: 'cutoff', hand: '86s' }],
  preflop: ['Cutoff opens to 2.5 big blinds', 'Big blind calls'],
  flop: { cards: ['K', '9', '4'], texture: 'rainbow', actions: [] },
  turn: { card: 'A', actions: [] },
  river: { card: '2', actions: [] },
  showdown: ['Cutoff shows 86s'],
  result: null,
  pot_size: null,
  effective_stack: null,
  missing: ['pot size', 'stack sizes']
};

export const canonicalOutput = `Game: no-limit hold'em
Stakes: 1/2

Hero: big blind — King-3 offsuit
Villain: cutoff — 8-6 suited

Preflop: Cutoff opens to 2.5 big blinds. Big blind calls.
Flop: King-9-4, rainbow
Turn: Ace
River: 2
Showdown: Cutoff shows 8-6 suited

Missing: pot size, stack sizes`;
