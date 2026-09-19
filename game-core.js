'use strict';

const SUITS = [
  { key: 'spades', symbol: '♠', strength: 4 },
  { key: 'hearts', symbol: '♥', strength: 3 },
  { key: 'diamonds', symbol: '♦', strength: 2 },
  { key: 'clubs', symbol: '♣', strength: 1 }
];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const RANK_STRENGTH = Object.fromEntries(RANKS.map((r, i) => [r, i + 1]));
const VALUE = { A: 11, J: 10, Q: 10, K: 10 };

function createDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) {
    deck.push({ rank, suit: suit.key, symbol: suit.symbol, value: VALUE[rank] || Number(rank) });
  }
  return deck;
}

function shuffle(deck) {
  const a = [...deck];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function scoreHand(hand) {
  let total = 0, aces = 0;
  for (const c of hand) { total += c.value; if (c.rank === 'A') aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0, bust: total > 21 };
}

function isNatural21(hand) { return hand.length === 2 && scoreHand(hand).total === 21; }

function cardTieCompare(a, b) {
  const rank = RANK_STRENGTH[b.rank] - RANK_STRENGTH[a.rank];
  if (rank) return rank;
  return (b.suitStrength || 0) - (a.suitStrength || 0);
}

function resolve21Tie(a, b) {
  if (a.length !== b.length) return a.length < b.length ? 'a' : 'b';
  const aa = [...a].sort((x,y) => RANK_STRENGTH[y.rank] - RANK_STRENGTH[x.rank]);
  const bb = [...b].sort((x,y) => RANK_STRENGTH[y.rank] - RANK_STRENGTH[x.rank]);
  for (let i = 0; i < aa.length; i++) {
    const ar = RANK_STRENGTH[aa[i].rank], br = RANK_STRENGTH[bb[i].rank];
    if (ar !== br) return ar > br ? 'a' : 'b';
    const as = SUITS.find(s => s.key === aa[i].suit)?.strength || 0;
    const bs = SUITS.find(s => s.key === bb[i].suit)?.strength || 0;
    if (as !== bs) return as > bs ? 'a' : 'b';
  }
  return 'draw';
}

function resolveDuel(aHand, bHand) {
  const a = scoreHand(aHand), b = scoreHand(bHand);
  if (a.bust && b.bust) return { result: 'draw', reason: 'both-bust' };
  if (a.bust) return { result: 'b-wins', reason: 'a-bust' };
  if (b.bust) return { result: 'a-wins', reason: 'b-bust' };
  if (a.total !== b.total) return { result: a.total > b.total ? 'a-wins' : 'b-wins', reason: 'higher-total' };
  if (a.total < 21) return { result: 'draw', reason: 'same-total-below-21' };
  const tie = resolve21Tie(aHand, bHand);
  return { result: tie === 'a' ? 'a-wins' : tie === 'b' ? 'b-wins' : 'draw', reason: tie === 'draw' ? 'true-draw-21' : '21-tiebreak' };
}

function dealerPlay(deck, hand, hitSoft17 = false) {
  while (true) {
    const s = scoreHand(hand);
    if (s.total > 17) break;
    if (s.total === 17 && !(s.soft && hitSoft17)) break;
    if (!deck.length) break;
    hand.push(deck.pop());
  }
  return hand;
}

function botShouldHit(hand, personality = 'standard') {
  const { total, soft } = scoreHand(hand);
  if (personality === 'aggressive') return total < 18 || (soft && total < 19);
  if (personality === 'cautious') return total < 16 || (soft && total < 18);
  if (personality === 'professional') return total < 17 || (soft && total < 18);
  return total < 17 || (soft && total < 18);
}

function betSettlement(bet, outcome, natural = false) {
  if (outcome === 'win') return bet + Math.round(bet * (natural ? 1.5 : 1));
  if (outcome === 'draw') return bet;
  return 0;
}

function withSuitStrength(card) {
  return { ...card, suitStrength: SUITS.find(s => s.key === card.suit)?.strength || 0 };
}

module.exports = { SUITS, RANKS, createDeck, shuffle, scoreHand, isNatural21, resolveDuel, dealerPlay, botShouldHit, betSettlement, withSuitStrength };
