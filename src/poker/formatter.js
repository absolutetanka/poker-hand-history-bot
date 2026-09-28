import { formatBoard, formatCard, normalizeHand } from './normalization.js';

function sentences(actions) {
  return actions?.length ? `. ${actions.join('. ')}.` : '';
}

/**
 * Deterministically renders a validated hand-history object for Discord.
 * The LLM never writes the final response.
 */
export function formatHandHistory(rawHand) {
  const hand = normalizeHand(rawHand);
  const lines = [];

  if (hand.game) lines.push(`Game: ${hand.game}`);
  if (hand.stakes) lines.push(`Stakes: ${hand.stakes}`);
  if (hand.effective_stack) lines.push(`Effective stack: ${hand.effective_stack}`);

  lines.push('');

  if (hand.hero?.position || hand.hero?.hand) {
    const heroParts = [hand.hero.position, hand.hero.hand].filter(Boolean);
    lines.push(`Hero: ${heroParts.join(' — ')}`);
  }

  for (const villain of hand.villains ?? []) {
    const villainParts = [villain.position, villain.hand].filter(Boolean);
    lines.push(`Villain: ${villainParts.join(' — ') || 'unknown'}`);
  }

  lines.push('');

  if (hand.preflop?.length) {
    lines.push(`Preflop: ${hand.preflop.join('. ')}.`);
  }

  if (hand.flop) {
    const board = formatBoard(hand.flop.cards) || 'unknown';
    const texture = hand.flop.texture ? `, ${hand.flop.texture}` : '';
    lines.push(`Flop: ${board}${texture}${sentences(hand.flop.actions)}`);
  }

  if (hand.turn) {
    lines.push(`Turn: ${formatCard(hand.turn.card) ?? 'unknown'}${sentences(hand.turn.actions)}`);
  }

  if (hand.river) {
    lines.push(`River: ${formatCard(hand.river.card) ?? 'unknown'}${sentences(hand.river.actions)}`);
  }

  if (hand.showdown?.length) {
    lines.push(`Showdown: ${hand.showdown.join('. ')}`);
  }

  if (hand.pot_size) {
    lines.push(`Pot: ${hand.pot_size}`);
  }

  if (hand.result) {
    lines.push(`Result: ${hand.result}`);
  }

  if (hand.missing?.length) {
    lines.push('');
    lines.push(`Missing: ${hand.missing.join(', ')}`);
  }

  return tidyBlankLines(lines).join('\n');
}

// Drop leading/trailing blank lines and collapse repeated blanks
// (e.g. when game/stakes or players are unknown).
function tidyBlankLines(lines) {
  const out = [];
  for (const line of lines) {
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}
