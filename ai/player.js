'use strict';

const { generateMoves, BONUS_LAYOUT } = require('./movegen');

class AIPlayer {
  constructor(trie, alphabet) {
    this.trie = trie;
    this.alphabet = alphabet || null;
  }

  findBestMove(board, rack, bonusLayout) {
    if (!bonusLayout) bonusLayout = BONUS_LAYOUT;
    const moves = generateMoves(board, rack, this.trie, bonusLayout, this.alphabet);
    if (moves.length === 0) return null;
    return moves[0];
  }
}

module.exports = AIPlayer;
