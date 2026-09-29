import { analyzeHand, toBB } from './handState.js';
import { abbreviateGame, formatBoard, formatNumber, normalizeCard } from './normalization.js';

// Deterministically renders a validated hand in forum review style:
//
//   NLH 1/2 · Effective: 100bb
//
//   Hero (BB): K3o
//   CO: 86s (shown)
//
//   Preflop (1.5bb): CO raises to 2.5bb, Hero calls.
//   Flop (5.5bb): K94r · Hero checks, CO bets 3bb, Hero calls.
//   ...
//
// The LLM never writes the final response.

const bbText = (bb) => `${formatNumber(bb)}bb`;

function amountText(amount, bb) {
  if (bb != null) return bbText(bb);
  return amount ? formatNumber(amount.value) : null;
}

function potLabel(pot) {
  return pot == null ? '' : ` (${bbText(pot)})`;
}

function ordinalBet(n) {
  return n <= 1 ? 'raises' : `${n + 1}-bets`;
}

function describeAction(entry, street) {
  const who = entry.player.label;
  const size = amountText(entry.amount, entry.amountBB);

  switch (entry.action) {
    case 'fold':
      return `${who} folds`;
    case 'check':
      return `${who} checks`;
    case 'call':
      return `${who} ${entry.limp ? 'limps' : 'calls'}`;
    case 'bet':
      return size ? `${who} bets ${size}` : `${who} bets`;
    case 'raise': {
      const verb = street === 'preflop' ? ordinalBet(entry.raiseNumber) : 'raises';
      return size ? `${who} ${verb} to ${size}` : `${who} ${verb}`;
    }
    case 'all-in':
      return size ? `${who} goes all-in for ${size}` : `${who} goes all-in`;
    default:
      return `${who} ${entry.action}`;
  }
}

function actionsText(actions, street) {
  return actions.length ? `${actions.map((a) => describeAction(a, street)).join(', ')}.` : '';
}

function headerLine(hand, analysis) {
  const game = [abbreviateGame(hand.game), hand.stakes].filter(Boolean).join(' ');
  let effective = '?';
  if (analysis.effectiveBB) {
    const { amount, bb } = analysis.effectiveBB;
    effective = amount.unit === 'bb' || bb == null
      ? amountText(amount, bb)
      : `${formatNumber(amount.value)} (${bbText(bb)})`;
  }
  return [game, `Effective: ${effective}`].filter(Boolean).join(' · ');
}

function playerLine(player, analysis) {
  const details = [];
  if (player.is_hero && player.position) details.push(player.position);
  if (player.stack) details.push(amountText(player.stack, toBB(player.stack, analysis.stakes)));

  const name = player.is_hero ? 'Hero' : player.key;
  const label = details.length ? `${name} (${details.join(', ')})` : name;

  const shown = analysis.showdown.find((s) => s.player.key === player.key && s.cards);
  const cards = player.cards ?? shown?.cards ?? null;
  if (!cards) return label;
  return `${label}: ${cards}${shown?.cards ? ' (shown)' : ''}`;
}

function streetLine(name, board, pot, actions) {
  const parts = [board, actions].filter(Boolean);
  return `${name}${potLabel(pot)}: ${parts.join(' · ') || '?'}`;
}

export function formatHandHistory(hand) {
  const analysis = analyzeHand(hand);
  const { streets, potAtStart } = analysis;
  const lines = [headerLine(hand, analysis), ''];

  const ordered = [
    ...analysis.players.filter((p) => p.is_hero),
    ...analysis.players.filter((p) => !p.is_hero)
  ];
  for (const player of ordered) lines.push(playerLine(player, analysis));
  if (ordered.length) lines.push('');

  if (streets.preflop.actions.length) {
    lines.push(streetLine('Preflop', '', potAtStart.preflop, actionsText(streets.preflop.actions, 'preflop')));
  }

  if (streets.flop) {
    const board = formatBoard(streets.flop.cards, streets.flop.texture) || '?';
    lines.push(streetLine('Flop', board, potAtStart.flop, actionsText(streets.flop.actions, 'flop')));
  }
  for (const street of ['turn', 'river']) {
    const data = streets[street];
    if (!data) continue;
    const card = data.card ? normalizeCard(data.card) : '?';
    const name = street[0].toUpperCase() + street.slice(1);
    lines.push(streetLine(name, card, potAtStart[street], actionsText(data.actions, street)));
  }

  const shows = analysis.showdown.map((s) =>
    s.cards ? `${s.player.label} shows ${s.cards}` : `${s.player.label} mucks`
  );
  const winner = analysis.winner ? `${analysis.winner.label} wins.` : '';
  if (shows.length) {
    lines.push(`Showdown${potLabel(analysis.finalPot)}: ${[`${shows.join(', ')}.`, winner].filter(Boolean).join(' ')}`);
  } else if (winner) {
    lines.push(`Result: ${winner}`);
  }

  if (analysis.missing.length) {
    lines.push('');
    lines.push(`Missing: ${analysis.missing.join(', ')}`);
  }

  return tidyBlankLines(lines).join('\n');
}

// Drop leading/trailing blank lines and collapse repeated blanks.
function tidyBlankLines(lines) {
  const out = [];
  for (const line of lines) {
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}
