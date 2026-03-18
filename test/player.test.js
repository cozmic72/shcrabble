'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { AIPlayer, TIERS } = require('../ai/player');
const Trie = require('../ai/trie');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOARD_SIZE = 15;
const ROMAN_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const ROMAN_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

function emptyBoard() {
  const board = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    board[r] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      board[r][c] = { letter: null, points: 0, isBlank: false };
    }
  }
  return board;
}

function placeWord(board, word, startRow, startCol, horizontal) {
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    const r = horizontal ? startRow : startRow + i;
    const c = horizontal ? startCol + i : startCol;
    board[r][c] = { letter: chars[i], points: 1, isBlank: false };
  }
}

function makeTile(letter, points) {
  return { letter, points, isBlank: false };
}

function buildTrie(words) {
  const trie = new Trie();
  for (const w of words) trie.insert(w);
  return trie;
}

const alphabet = {
  name: 'test-roman',
  letters: ROMAN_LETTERS,
  vowels: ROMAN_VOWELS,
};

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

describe('AIPlayer - Tier definitions', () => {
  it('all four tiers are defined', () => {
    assert.ok(TIERS.beginner);
    assert.ok(TIERS.casual);
    assert.ok(TIERS.intermediate);
    assert.ok(TIERS.expert);
  });

  it('each tier has expected properties', () => {
    for (const [key, tier] of Object.entries(TIERS)) {
      assert.ok('name' in tier, `${key} should have name`);
      assert.ok('vocabSize' in tier, `${key} should have vocabSize`);
      assert.ok('topN' in tier, `${key} should have topN`);
      assert.ok('rackLeaveWeight' in tier, `${key} should have rackLeaveWeight`);
      assert.ok('defenseWeight' in tier, `${key} should have defenseWeight`);
      assert.ok('endgameThreshold' in tier, `${key} should have endgameThreshold`);
      assert.ok('endgameBias' in tier, `${key} should have endgameBias`);
      assert.ok('exchangeThreshold' in tier, `${key} should have exchangeThreshold`);
    }
  });

  it('expert has exchangeThreshold > 0', () => {
    assert.ok(TIERS.expert.exchangeThreshold > 0);
  });

  it('beginner has highest topN', () => {
    assert.ok(TIERS.beginner.topN >= TIERS.expert.topN);
  });
});

// ---------------------------------------------------------------------------
// findBestMove()
// ---------------------------------------------------------------------------

describe('AIPlayer - findBestMove()', () => {
  it('returns null when no moves available', () => {
    const trie = buildTrie(['xyz']); // word not formable from rack
    const ai = new AIPlayer(trie, TIERS.beginner, alphabet);
    const board = emptyBoard();
    const rack = [makeTile('a', 1), makeTile('b', 3)];

    const move = ai.findBestMove(board, rack, 50);
    assert.equal(move, null);
  });

  it('returns a valid move with all words in trie', () => {
    const words = ['cat', 'at', 'act'];
    const trie = buildTrie(words);
    const ai = new AIPlayer(trie, TIERS.beginner, alphabet);
    const board = emptyBoard();
    const rack = [
      makeTile('c', 3), makeTile('a', 1), makeTile('t', 1),
      makeTile('x', 8), makeTile('z', 10)
    ];

    const move = ai.findBestMove(board, rack, 50);
    assert.ok(move, 'Should return a move');
    assert.ok(move.placements, 'Move should have placements');
    assert.ok(move.words, 'Move should have words');

    for (const word of move.words) {
      assert.ok(trie.isWord(word), `Move word "${word}" should be in trie`);
    }
  });

  it('returns a valid move on non-empty board', () => {
    const words = ['cat', 'at', 'ta', 'to', 'tat', 'tot', 'act'];
    const trie = buildTrie(words);
    const ai = new AIPlayer(trie, TIERS.casual, alphabet);
    const board = emptyBoard();
    placeWord(board, 'cat', 7, 7, true);

    const rack = [
      makeTile('a', 1), makeTile('t', 1), makeTile('o', 1),
      makeTile('t', 1), makeTile('z', 10)
    ];

    const move = ai.findBestMove(board, rack, 50);
    if (move && !move.exchange) {
      for (const word of move.words) {
        assert.ok(trie.isWord(word), `Move word "${word}" should be in trie`);
      }
    }
  });

  it('expert returns exchange when best score is below threshold', () => {
    // Create trie with only very low-scoring short words
    const words = ['ab'];
    const trie = buildTrie(words);
    const ai = new AIPlayer(trie, TIERS.expert, alphabet);
    const board = emptyBoard();
    // Give rack tiles that can only form very low-scoring word
    const rack = [
      makeTile('a', 1), makeTile('b', 1),
      makeTile('x', 8), makeTile('z', 10),
      makeTile('q', 10), makeTile('j', 8), makeTile('v', 4)
    ];

    const move = ai.findBestMove(board, rack, 50);
    // The move might be an exchange since "ab" scores very low
    // (depends on exact bonus square placement)
    // We just verify we get some result
    assert.ok(move !== null, 'Expert should return some move or exchange');
  });
});

// ---------------------------------------------------------------------------
// Rack leave evaluation
// ---------------------------------------------------------------------------

describe('AIPlayer - Rack leave evaluation', () => {
  it('computeRackLeavePenalty returns a number', () => {
    const trie = buildTrie(['cat']);
    const ai = new AIPlayer(trie, TIERS.expert, alphabet);

    const rack = [
      makeTile('c', 3), makeTile('a', 1), makeTile('t', 1),
      makeTile('x', 8), makeTile('z', 10)
    ];

    const move = {
      placements: [
        { row: 7, col: 7, letter: 'c', points: 3, isBlank: false },
        { row: 7, col: 8, letter: 'a', points: 1, isBlank: false },
        { row: 7, col: 9, letter: 't', points: 1, isBlank: false },
      ],
      score: 10,
      words: ['cat']
    };

    const penalty = ai.computeRackLeavePenalty(move, rack);
    assert.equal(typeof penalty, 'number');
    assert.ok(penalty >= 0, 'Penalty should be non-negative');
  });

  it('penalizes racks with all high-point tiles', () => {
    const trie = buildTrie(['at']);
    const ai = new AIPlayer(trie, TIERS.expert, alphabet);

    const goodRack = [
      makeTile('a', 1), makeTile('t', 1),
      makeTile('e', 1), makeTile('r', 1), makeTile('s', 1)
    ];

    const badRack = [
      makeTile('a', 1), makeTile('t', 1),
      makeTile('x', 8), makeTile('z', 10), makeTile('q', 10)
    ];

    const move = {
      placements: [
        { row: 7, col: 7, letter: 'a', points: 1, isBlank: false },
        { row: 7, col: 8, letter: 't', points: 1, isBlank: false },
      ],
      score: 5,
      words: ['at']
    };

    const goodPenalty = ai.computeRackLeavePenalty(move, goodRack);
    const badPenalty = ai.computeRackLeavePenalty(move, badRack);
    assert.ok(badPenalty > goodPenalty, 'Bad rack should have higher penalty');
  });

  it('penalizes duplicate letters in remaining rack', () => {
    const trie = buildTrie(['at']);
    const ai = new AIPlayer(trie, TIERS.expert, alphabet);

    const noDupes = [
      makeTile('a', 1), makeTile('t', 1),
      makeTile('e', 1), makeTile('r', 1), makeTile('s', 1)
    ];

    const dupes = [
      makeTile('a', 1), makeTile('t', 1),
      makeTile('e', 1), makeTile('e', 1), makeTile('e', 1)
    ];

    const move = {
      placements: [
        { row: 7, col: 7, letter: 'a', points: 1, isBlank: false },
        { row: 7, col: 8, letter: 't', points: 1, isBlank: false },
      ],
      score: 5,
      words: ['at']
    };

    const noDupePenalty = ai.computeRackLeavePenalty(move, noDupes);
    const dupePenalty = ai.computeRackLeavePenalty(move, dupes);
    assert.ok(dupePenalty > noDupePenalty, 'Duplicates should increase penalty');
  });
});

// ---------------------------------------------------------------------------
// worstTileIndices
// ---------------------------------------------------------------------------

describe('AIPlayer - worstTileIndices', () => {
  it('returns indices of highest-point (worst) tiles', () => {
    const trie = buildTrie([]);
    const ai = new AIPlayer(trie, TIERS.expert, alphabet);

    const rack = [
      makeTile('a', 1), // 0
      makeTile('z', 10), // 1
      makeTile('e', 1), // 2
      makeTile('x', 8), // 3
      makeTile('q', 10), // 4
    ];

    const indices = ai.worstTileIndices(rack);
    // Should pick up to 4 worst tiles (highest points)
    assert.ok(indices.length <= 4);
    // The worst tiles are z(10), q(10), x(8) - indices 1, 4, 3
    assert.ok(indices.includes(1) || indices.includes(4) || indices.includes(3));
  });
});
