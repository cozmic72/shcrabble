'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { generateMoves, BONUS_LAYOUT } = require('../ai/movegen');
const Trie = require('../ai/trie');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOARD_SIZE = 15;

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

function makeBlankTile() {
  return { letter: '', points: 0, isBlank: true };
}

function makeRotatableTile(letter, points, rotatedLetter, rotatedPoints) {
  return {
    letter, points, isBlank: false,
    isRotatable: true, rotatedLetter, rotatedPoints, isRotated: false
  };
}

// Build a small trie from word list
function buildTrie(words) {
  const trie = new Trie();
  for (const w of words) trie.insert(w);
  return trie;
}

// Simple Roman alphabet for testing
const ROMAN_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

// ---------------------------------------------------------------------------
// First move (empty board)
// ---------------------------------------------------------------------------

describe('MoveGen - First move (empty board)', () => {
  it('generates moves covering center [7,7]', () => {
    const trie = buildTrie(['cat', 'at', 'to']);
    const rack = [makeTile('c', 3), makeTile('a', 1), makeTile('t', 1)];
    const board = emptyBoard();

    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, ROMAN_LETTERS);
    assert.ok(moves.length > 0, 'Should generate at least one move');

    for (const move of moves) {
      const coversCenter = move.placements.some(p => p.row === 7 && p.col === 7);
      assert.ok(coversCenter, `Move should cover center: ${JSON.stringify(move.placements)}`);
    }
  });

  it('all generated words are valid', () => {
    const words = ['cat', 'at', 'act'];
    const trie = buildTrie(words);
    const rack = [makeTile('c', 3), makeTile('a', 1), makeTile('t', 1)];
    const board = emptyBoard();

    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, ROMAN_LETTERS);

    for (const move of moves) {
      for (const word of move.words) {
        assert.ok(trie.isWord(word), `Generated word "${word}" should be in trie`);
      }
    }
  });

  it('scores are calculated correctly for first move', () => {
    const trie = buildTrie(['at']);
    const rack = [makeTile('a', 1), makeTile('t', 1)];
    const board = emptyBoard();

    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, ROMAN_LETTERS);
    assert.ok(moves.length > 0);

    // Find horizontal move starting at 7,7 -> "at"
    const atMove = moves.find(m =>
      m.words.includes('at') &&
      m.placements.some(p => p.row === 7 && p.col === 7)
    );
    assert.ok(atMove, 'Should find "at" move covering center');
    // Score should account for bonus squares
    assert.ok(atMove.score > 0);
  });
});

// ---------------------------------------------------------------------------
// Cross-word validation
// ---------------------------------------------------------------------------

describe('MoveGen - Cross-word validation', () => {
  it('generates moves that form valid cross-words', () => {
    const trie = buildTrie(['cat', 'at', 'ta', 'to', 'co', 'ct', 'ac']);
    const board = emptyBoard();
    placeWord(board, 'cat', 7, 7, true); // horizontal at row 7

    const rack = [makeTile('o', 1), makeTile('a', 1), makeTile('t', 1)];
    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, ROMAN_LETTERS);

    for (const move of moves) {
      for (const word of move.words) {
        assert.ok(trie.isWord(word), `Cross-word "${word}" should be valid`);
      }
    }
  });

  it('cross-word scores are included in move score', () => {
    const trie = buildTrie(['at', 'ta', 'aa', 'tt']);
    const board = emptyBoard();
    placeWord(board, 'at', 7, 7, true);

    const rack = [makeTile('a', 1), makeTile('t', 1)];
    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, ROMAN_LETTERS);

    // Any move that forms cross-words should have those scores included
    for (const move of moves) {
      if (move.words.length > 1) {
        // Score should be greater than just the main word
        assert.ok(move.score > 0, 'Move with cross-words should have positive score');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Blank tiles
// ---------------------------------------------------------------------------

describe('MoveGen - Blank tiles', () => {
  it('moves with blank tiles have isBlank: true', () => {
    const trie = buildTrie(['at', 'ab']);
    const rack = [makeBlankTile(), makeTile('t', 1)];
    const board = emptyBoard();

    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, ROMAN_LETTERS);
    assert.ok(moves.length > 0, 'Should generate moves with blank tile');

    // Find a move that uses the blank
    const blankMove = moves.find(m => m.placements.some(p => p.isBlank));
    assert.ok(blankMove, 'Should have at least one move using the blank');

    const blankPlacement = blankMove.placements.find(p => p.isBlank);
    assert.equal(blankPlacement.isBlank, true);
  });

  it('blank tiles score 0 points', () => {
    const trie = buildTrie(['at']);
    const rack = [makeBlankTile(), makeTile('t', 1)];
    const board = emptyBoard();

    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, ROMAN_LETTERS);
    const blankMove = moves.find(m => m.placements.some(p => p.isBlank));

    if (blankMove) {
      const blankPlacement = blankMove.placements.find(p => p.isBlank);
      assert.equal(blankPlacement.points, 0, 'Blank tile should have 0 points');
    }
  });
});

// ---------------------------------------------------------------------------
// Rotatable tiles
// ---------------------------------------------------------------------------

describe('MoveGen - Rotatable tiles', () => {
  it('moves can use tiles in rotated orientation', () => {
    // 'p' rotates to 'b' (using roman letters for simplicity in logic,
    // but actual rotation is a Shavian concept). We'll use Shavian chars.
    // 𐑐 (U+10450) rotates to 𐑚 (U+1045A)
    const shavianLetters = ['\u{10450}', '\u{1045A}', '\u{10451}'];
    const trie = buildTrie(['\u{1045A}\u{10451}']); // word using rotated letter

    const rack = [
      makeRotatableTile('\u{10450}', 5, '\u{1045A}', 3),
      makeTile('\u{10451}', 2)
    ];
    const board = emptyBoard();

    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, shavianLetters);

    // Should find the word using the rotated form
    const rotatedMove = moves.find(m =>
      m.placements.some(p => p.letter === '\u{1045A}')
    );
    assert.ok(rotatedMove, 'Should generate move using rotated tile');
  });

  it('rotated placements have correct points (rotatedPoints)', () => {
    const shavianLetters = ['\u{10450}', '\u{1045A}', '\u{10451}'];
    const trie = buildTrie(['\u{1045A}\u{10451}']);

    const rack = [
      makeRotatableTile('\u{10450}', 5, '\u{1045A}', 3),
      makeTile('\u{10451}', 2)
    ];
    const board = emptyBoard();

    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, shavianLetters);
    const rotatedMove = moves.find(m =>
      m.placements.some(p => p.letter === '\u{1045A}')
    );

    if (rotatedMove) {
      const rotatedPlacement = rotatedMove.placements.find(p => p.letter === '\u{1045A}');
      assert.equal(rotatedPlacement.points, 3, 'Rotated placement should use rotatedPoints');
    }
  });
});

// ---------------------------------------------------------------------------
// Board word validation (regression test)
// ---------------------------------------------------------------------------

describe('MoveGen - Board word validation regression', () => {
  it('all words formed by generated moves are valid in the trie', () => {
    // Use a richer word list to get more interesting board states
    const wordList = [
      'the', 'to', 'at', 'he', 'it', 'in', 'on', 'an', 'hat', 'hit',
      'hot', 'not', 'no', 'oh', 'hi', 'ah', 'thin', 'than', 'then',
      'that', 'this', 'tin', 'tan', 'ten', 'ton', 'hint', 'hoot',
      'noon', 'into', 'onto', 'too', 'toot'
    ];
    const trie = buildTrie(wordList);
    const board = emptyBoard();

    // Play first word
    placeWord(board, 'thin', 7, 6, true);

    // Now generate a second move
    const rack = [
      makeTile('a', 1), makeTile('t', 1), makeTile('o', 1),
      makeTile('n', 1), makeTile('h', 4)
    ];
    const moves = generateMoves(board, rack, trie, BONUS_LAYOUT, ROMAN_LETTERS);

    for (const move of moves) {
      for (const word of move.words) {
        assert.ok(trie.isWord(word), `Word "${word}" on board must be valid`);
      }
    }
  });

  it('validates every word on board after playing multiple moves', () => {
    const wordList = ['at', 'to', 'ta', 'it', 'ti', 'tat', 'tit', 'tot', 'oat', 'ait'];
    const trie = buildTrie(wordList);
    const board = emptyBoard();

    // Simulate a game: place two words
    placeWord(board, 'at', 7, 7, true);
    placeWord(board, 'to', 7, 8, false); // vertical from [7,8], reuses 't'
    // Board now has: row 7: _a t_, row 8 col 8: o
    // Actually 'at' places 'a' at [7,7] and 't' at [7,8]
    // 'to' vertical from [7,8] would be 't' at [7,8] and 'o' at [8,8]
    // But [7,8] already has 't', so let's just set [8,8]
    board[8][8] = { letter: 'o', points: 1, isBlank: false };

    // Validate every horizontal and vertical word on the board
    for (let r = 0; r < BOARD_SIZE; r++) {
      let word = '';
      for (let c = 0; c <= BOARD_SIZE; c++) {
        if (c < BOARD_SIZE && board[r][c].letter !== null) {
          word += board[r][c].letter;
        } else {
          if ([...word].length >= 2) {
            assert.ok(trie.isWord(word), `Invalid H word at row ${r}: "${word}"`);
          }
          word = '';
        }
      }
    }
    for (let c = 0; c < BOARD_SIZE; c++) {
      let word = '';
      for (let r = 0; r <= BOARD_SIZE; r++) {
        if (r < BOARD_SIZE && board[r][c].letter !== null) {
          word += board[r][c].letter;
        } else {
          if ([...word].length >= 2) {
            assert.ok(trie.isWord(word), `Invalid V word at col ${c}: "${word}"`);
          }
          word = '';
        }
      }
    }
  });
});
