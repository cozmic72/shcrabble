'use strict';

const { generateMoves, BONUS_LAYOUT } = require('./movegen');

const BOARD_SIZE = 15;

const TIERS = {
  beginner: {
    name: 'Beginner',
    vocabSize: 5000,
    topN: 5,
    rackLeaveWeight: 0.0,
    defenseWeight: 0.0,
    endgameThreshold: 0,
    endgameBias: 0.0,
    exchangeThreshold: 0,
  },
  casual: {
    name: 'Casual',
    vocabSize: 15000,
    topN: 3,
    rackLeaveWeight: 0.2,
    defenseWeight: 0.0,
    endgameThreshold: 10,
    endgameBias: 0.2,
    exchangeThreshold: 0,
  },
  intermediate: {
    name: 'Intermediate',
    vocabSize: 35000,
    topN: 2,
    rackLeaveWeight: 0.4,
    defenseWeight: 0.0,
    endgameThreshold: 15,
    endgameBias: 0.4,
    exchangeThreshold: 0,
  },
  expert: {
    name: 'Expert',
    vocabSize: 0,
    topN: 1,
    rackLeaveWeight: 0.7,
    defenseWeight: 0.0,
    endgameThreshold: 20,
    endgameBias: 0.7,
    exchangeThreshold: 8,
  },
};

class AIPlayer {
  constructor(trie, config, alphabet) {
    this.trie = trie;
    this.config = config;
    this.alphabet = alphabet;
    this.vowels = alphabet.vowels || new Set();
  }

  findBestMove(board, rack, tileBagSize) {
    const moves = generateMoves(board, rack, this.trie, BONUS_LAYOUT, this.alphabet.letters);
    if (moves.length === 0) return null;

    const scored = [];
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const effective = this.computeEffectiveScore(move, board, rack, tileBagSize);
      scored.push({ move, effective });
    }

    scored.sort((a, b) => b.effective - a.effective);

    const topN = Math.min(this.config.topN, scored.length);
    const pick = scored[Math.floor(Math.random() * topN)];

    // Expert exchange: if best move is weak and bag has tiles, prefer exchanging
    if (this.config.exchangeThreshold > 0 && tileBagSize >= 7 && pick.move.score < this.config.exchangeThreshold) {
      return { exchange: true, indices: this.worstTileIndices(rack) };
    }

    return pick.move;
  }

  worstTileIndices(rack) {
    const indexed = rack.map((tile, i) => ({ i, badness: tile.isBlank ? -100 : tile.points }));
    indexed.sort((a, b) => b.badness - a.badness);
    return indexed.slice(0, Math.min(4, rack.length)).map(t => t.i);
  }

  computeEffectiveScore(move, board, rack, tileBagSize) {
    let effective = move.score;

    if (this.config.rackLeaveWeight > 0) {
      const penalty = this.computeRackLeavePenalty(move, rack);
      effective -= this.config.rackLeaveWeight * penalty;
    }

    if (this.config.defenseWeight > 0) {
      const penalty = this.computeDefensePenalty(move, board);
      effective -= this.config.defenseWeight * penalty;
    }

    if (this.config.endgameBias > 0 && tileBagSize <= this.config.endgameThreshold) {
      const wordLength = move.placements.length;
      effective -= this.config.endgameBias * (wordLength - 2) * 3;
    }

    return effective;
  }

  computeRackLeavePenalty(move, rack) {
    const placedLetters = new Map();
    for (const p of move.placements) {
      if (p.isBlank) {
        placedLetters.set('__blank__', (placedLetters.get('__blank__') || 0) + 1);
      } else {
        const key = p.primaryLetter || p.letter;
        placedLetters.set(key, (placedLetters.get(key) || 0) + 1);
      }
    }

    const remaining = [];
    const rackCopy = new Map();
    for (const tile of rack) {
      if (tile.isBlank) {
        rackCopy.set('__blank__', (rackCopy.get('__blank__') || 0) + 1);
      } else {
        rackCopy.set(tile.letter, (rackCopy.get(tile.letter) || 0) + 1);
      }
    }

    for (const [key, count] of placedLetters) {
      const have = rackCopy.get(key) || 0;
      rackCopy.set(key, have - count);
    }

    for (const tile of rack) {
      const key = tile.isBlank ? '__blank__' : tile.letter;
      const left = rackCopy.get(key) || 0;
      if (left > 0) {
        remaining.push(tile);
        rackCopy.set(key, left - 1);
      }
    }

    if (remaining.length === 0) return 0;

    let tileDifficultyPenalty = 0;
    for (const tile of remaining) {
      tileDifficultyPenalty += tile.points;
    }

    let vowelCount = 0;
    const letterCounts = new Map();
    for (const tile of remaining) {
      if (!tile.isBlank) {
        if (this.vowels.has(tile.letter)) vowelCount++;
        letterCounts.set(tile.letter, (letterCounts.get(tile.letter) || 0) + 1);
      }
    }

    const nonBlankCount = remaining.filter(t => !t.isBlank).length;
    const vowelFraction = nonBlankCount > 0 ? vowelCount / nonBlankCount : 0.4;
    const imbalancePenalty = Math.abs(vowelFraction - 0.4) * 20 * remaining.length;

    let duplicatePenalty = 0;
    for (const count of letterCounts.values()) {
      if (count > 1) duplicatePenalty += (count - 1) * 5;
    }

    return tileDifficultyPenalty + imbalancePenalty + duplicatePenalty;
  }

  computeDefensePenalty(move, board) {
    let penalty = 0;
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const p of move.placements) {
      for (const [dr, dc] of directions) {
        const nr = p.row + dr;
        const nc = p.col + dc;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        if (board[nr][nc].letter !== null) continue;

        const bonus = board[nr][nc].bonus;
        if (bonus === 'TW') penalty += 15;
        else if (bonus === 'DW') penalty += 8;
      }
    }

    return penalty;
  }
}

module.exports = { AIPlayer, TIERS };
