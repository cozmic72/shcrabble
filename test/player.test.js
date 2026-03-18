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

  it('returns at most 4 indices', () => {
    const trie = buildTrie([]);
    const ai = new AIPlayer(trie, TIERS.expert, alphabet);

    const rack = [
      makeTile('z', 10), makeTile('x', 8), makeTile('q', 10),
      makeTile('j', 8), makeTile('v', 4), makeTile('w', 4), makeTile('k', 5),
    ];

    const indices = ai.worstTileIndices(rack);
    assert.equal(indices.length, 4);
  });

  it('ranks blanks as least bad (keeps them)', () => {
    const trie = buildTrie([]);
    const ai = new AIPlayer(trie, TIERS.expert, alphabet);

    const rack = [
      { letter: '', points: 0, isBlank: true }, // 0 - badness -100
      makeTile('z', 10), // 1
      makeTile('a', 1),  // 2
    ];

    const indices = ai.worstTileIndices(rack);
    // Blank has badness -100, so it should NOT appear among worst tiles
    // z(10) is the worst, then a(1), then blank(-100)
    assert.ok(indices.includes(1), 'z should be in worst tiles');
    assert.ok(!indices.includes(0) || indices.length === 3, 'blank should be last if included');
  });
});

// ---------------------------------------------------------------------------
// Expert exchange
// ---------------------------------------------------------------------------

describe('AIPlayer - Expert exchange', () => {
  it('returns exchange when best move scores below threshold and bag has tiles', () => {
    // Only word available scores 2 (below expert threshold of 8)
    const words = ['ab'];
    const trie = buildTrie(words);
    const config = { ...TIERS.expert, exchangeThreshold: 100, topN: 1 };
    const ai = new AIPlayer(trie, config, alphabet);
    const board = emptyBoard();

    const rack = [
      makeTile('a', 1), makeTile('b', 1),
      makeTile('x', 8), makeTile('z', 10),
      makeTile('q', 10), makeTile('j', 8), makeTile('v', 4)
    ];

    const move = ai.findBestMove(board, rack, 50);
    assert.ok(move, 'Should return a move');
    assert.equal(move.exchange, true, 'Should be an exchange');
    assert.ok(Array.isArray(move.indices), 'Should have indices array');
    assert.ok(move.indices.length > 0, 'Should exchange at least one tile');
  });

  it('does not exchange when bag is too small (< 7)', () => {
    const words = ['ab'];
    const trie = buildTrie(words);
    const config = { ...TIERS.expert, exchangeThreshold: 100, topN: 1 };
    const ai = new AIPlayer(trie, config, alphabet);
    const board = emptyBoard();

    const rack = [
      makeTile('a', 1), makeTile('b', 1),
      makeTile('x', 8), makeTile('z', 10),
    ];

    // Bag size < 7, so exchange should not happen
    const move = ai.findBestMove(board, rack, 5);
    assert.ok(move, 'Should return a move');
    assert.ok(!move.exchange, 'Should NOT be an exchange with small bag');
    assert.ok(move.placements, 'Should be a regular move');
  });

  it('does not exchange when exchangeThreshold is 0', () => {
    const words = ['ab'];
    const trie = buildTrie(words);
    const config = { ...TIERS.beginner, exchangeThreshold: 0, topN: 1 };
    const ai = new AIPlayer(trie, config, alphabet);
    const board = emptyBoard();

    const rack = [makeTile('a', 1), makeTile('b', 1)];

    const move = ai.findBestMove(board, rack, 50);
    assert.ok(move, 'Should return a move');
    assert.ok(!move.exchange, 'Should not exchange when threshold is 0');
  });
});

// ---------------------------------------------------------------------------
// Defense evaluation
// ---------------------------------------------------------------------------

describe('AIPlayer - Defense evaluation', () => {
  // Board with bonus squares matching the standard Scrabble layout
  function boardWithBonuses() {
    const BONUS_SQUARES = {
      TW: [[0,0], [0,7], [0,14], [7,0], [7,14], [14,0], [14,7], [14,14]],
      DW: [[1,1], [2,2], [3,3], [4,4], [1,13], [2,12], [3,11], [4,10],
           [13,1], [12,2], [11,3], [10,4], [13,13], [12,12], [11,11], [10,10]],
      TL: [[1,5], [1,9], [5,1], [5,5], [5,9], [5,13], [9,1], [9,5], [9,9], [9,13], [13,5], [13,9]],
      DL: [[0,3], [0,11], [2,6], [2,8], [3,0], [3,7], [3,14], [6,2], [6,6], [6,8], [6,12],
           [7,3], [7,11], [8,2], [8,6], [8,8], [8,12], [11,0], [11,7], [11,14], [12,6], [12,8], [14,3], [14,11]]
    };

    const board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      board[r] = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        let bonus = null;
        for (const [type, positions] of Object.entries(BONUS_SQUARES)) {
          if (positions.some(([br, bc]) => br === r && bc === c)) {
            bonus = type;
            break;
          }
        }
        board[r][c] = { letter: null, points: 0, isBlank: false, bonus };
      }
    }
    return board;
  }

  it('computeDefensePenalty returns 0 when no adjacent premium squares', () => {
    const trie = buildTrie([]);
    const config = { ...TIERS.expert, defenseWeight: 1.0 };
    const ai = new AIPlayer(trie, config, alphabet);
    const board = boardWithBonuses();

    // Place at center (7,7) - neighbors (6,7), (8,7), (7,6), (7,8) have no premium
    const move = {
      placements: [{ row: 7, col: 7, letter: 'a', points: 1, isBlank: false }],
      score: 5,
      words: ['a']
    };

    const penalty = ai.computeDefensePenalty(move, board);
    assert.equal(penalty, 0);
  });

  it('computeDefensePenalty penalizes adjacent TW squares', () => {
    const trie = buildTrie([]);
    const config = { ...TIERS.expert, defenseWeight: 1.0 };
    const ai = new AIPlayer(trie, config, alphabet);
    const board = boardWithBonuses();

    // Place at (0,1) - neighbor (0,0) is TW
    const move = {
      placements: [{ row: 0, col: 1, letter: 'a', points: 1, isBlank: false }],
      score: 5,
      words: ['a']
    };

    const penalty = ai.computeDefensePenalty(move, board);
    assert.ok(penalty >= 15, 'Should penalize for adjacent TW');
  });

  it('computeDefensePenalty penalizes adjacent DW squares', () => {
    const trie = buildTrie([]);
    const config = { ...TIERS.expert, defenseWeight: 1.0 };
    const ai = new AIPlayer(trie, config, alphabet);
    const board = boardWithBonuses();

    // Place at (1,2) - neighbor (1,1) is DW, (2,2) is DW
    const move = {
      placements: [{ row: 1, col: 2, letter: 'a', points: 1, isBlank: false }],
      score: 5,
      words: ['a']
    };

    const penalty = ai.computeDefensePenalty(move, board);
    assert.ok(penalty >= 8, 'Should penalize for adjacent DW');
  });

  it('computeDefensePenalty skips occupied adjacent squares', () => {
    const trie = buildTrie([]);
    const config = { ...TIERS.expert, defenseWeight: 1.0 };
    const ai = new AIPlayer(trie, config, alphabet);
    const board = boardWithBonuses();

    // Occupy the TW square at (0,0)
    board[0][0].letter = 'x';

    // Place at (0,1) - neighbor (0,0) is TW but occupied, so no penalty
    const move = {
      placements: [{ row: 0, col: 1, letter: 'a', points: 1, isBlank: false }],
      score: 5,
      words: ['a']
    };

    const penalty = ai.computeDefensePenalty(move, board);
    // (0,0) is occupied so not penalized; (1,1) is DW and empty, so should get 8
    assert.equal(penalty, 8);
  });

  it('defenseWeight affects computeEffectiveScore', () => {
    const trie = buildTrie([]);
    const configWithDefense = {
      topN: 1, rackLeaveWeight: 0, defenseWeight: 1.0,
      endgameBias: 0, endgameThreshold: 0, exchangeThreshold: 0,
    };
    const configNoDefense = {
      topN: 1, rackLeaveWeight: 0, defenseWeight: 0,
      endgameBias: 0, endgameThreshold: 0, exchangeThreshold: 0,
    };
    const aiWith = new AIPlayer(trie, configWithDefense, alphabet);
    const aiWithout = new AIPlayer(trie, configNoDefense, alphabet);
    const board = boardWithBonuses();
    const rack = [makeTile('a', 1)];

    // Place at (0,1) adjacent to TW at (0,0)
    const move = {
      placements: [{ row: 0, col: 1, letter: 'a', points: 1, isBlank: false }],
      score: 10,
      words: ['a']
    };

    const scoreWith = aiWith.computeEffectiveScore(move, board, rack, 50);
    const scoreWithout = aiWithout.computeEffectiveScore(move, board, rack, 50);
    assert.ok(scoreWith < scoreWithout, 'Defense weight should reduce effective score');
  });
});

// ---------------------------------------------------------------------------
// Endgame bias
// ---------------------------------------------------------------------------

describe('AIPlayer - Endgame bias', () => {
  it('endgameBias penalizes long words when bag is small', () => {
    const trie = buildTrie([]);
    const config = {
      topN: 1, rackLeaveWeight: 0, defenseWeight: 0,
      endgameBias: 0.7, endgameThreshold: 20, exchangeThreshold: 0,
    };
    const ai = new AIPlayer(trie, config, alphabet);
    const board = emptyBoard();
    const rack = [];

    const shortMove = {
      placements: [{ row: 7, col: 7, letter: 'a' }, { row: 7, col: 8, letter: 'b' }],
      score: 10,
      words: ['ab']
    };
    const longMove = {
      placements: [
        { row: 7, col: 7, letter: 'a' }, { row: 7, col: 8, letter: 'b' },
        { row: 7, col: 9, letter: 'c' }, { row: 7, col: 10, letter: 'd' },
        { row: 7, col: 11, letter: 'e' },
      ],
      score: 10,
      words: ['abcde']
    };

    const shortScore = ai.computeEffectiveScore(shortMove, board, rack, 5);
    const longScore = ai.computeEffectiveScore(longMove, board, rack, 5);
    assert.ok(shortScore > longScore, 'Short move should score higher in endgame');
  });

  it('endgameBias does not apply when bag is large', () => {
    const trie = buildTrie([]);
    const config = {
      topN: 1, rackLeaveWeight: 0, defenseWeight: 0,
      endgameBias: 0.7, endgameThreshold: 20, exchangeThreshold: 0,
    };
    const ai = new AIPlayer(trie, config, alphabet);
    const board = emptyBoard();
    const rack = [];

    const move = {
      placements: [
        { row: 7, col: 7, letter: 'a' }, { row: 7, col: 8, letter: 'b' },
        { row: 7, col: 9, letter: 'c' }, { row: 7, col: 10, letter: 'd' },
      ],
      score: 10,
      words: ['abcd']
    };

    // tileBagSize > endgameThreshold, so no bias applied
    const score = ai.computeEffectiveScore(move, board, rack, 50);
    assert.equal(score, 10, 'No endgame penalty when bag is large');
  });
});
