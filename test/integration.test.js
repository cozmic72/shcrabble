'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { ALPHABETS, buildWordList } = require('../ai/alphabet');
const { AIPlayer, TIERS } = require('../ai/player');
const { generateMoves, BONUS_LAYOUT } = require('../ai/movegen');
const Trie = require('../ai/trie');
const Game = require('../server/game');

const BOARD_SIZE = 15;
const READLEX_PATH = path.join(__dirname, '../data/readlex/readlex.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateBoardWords(board, trie) {
  const errors = [];

  // Check horizontal words
  for (let r = 0; r < BOARD_SIZE; r++) {
    let word = '';
    for (let c = 0; c <= BOARD_SIZE; c++) {
      if (c < BOARD_SIZE && board[r][c].letter !== null) {
        word += board[r][c].letter;
      } else {
        if ([...word].length >= 2) {
          if (!trie.isWord(word)) {
            errors.push(`Invalid H word at row ${r}: "${word}"`);
          }
        }
        word = '';
      }
    }
  }

  // Check vertical words
  for (let c = 0; c < BOARD_SIZE; c++) {
    let word = '';
    for (let r = 0; r <= BOARD_SIZE; r++) {
      if (r < BOARD_SIZE && board[r][c].letter !== null) {
        word += board[r][c].letter;
      } else {
        if ([...word].length >= 2) {
          if (!trie.isWord(word)) {
            errors.push(`Invalid V word at col ${c}: "${word}"`);
          }
        }
        word = '';
      }
    }
  }

  return errors;
}

function playFullGame(alphabetKey, tierKey, maxTurns) {
  const config = ALPHABETS[alphabetKey];
  const tier = TIERS[tierKey];

  // Build word list and trie
  const words = buildWordList(READLEX_PATH, config, tier.vocabSize || undefined);
  const trie = new Trie();
  for (const w of words) trie.insert(w);

  const ai1 = new AIPlayer(trie, tier, config);
  const ai2 = new AIPlayer(trie, tier, config);

  // Create game
  const useRotation = alphabetKey === 'rotatable' || alphabetKey === 'rotatable-extended';
  const useCompounds = alphabetKey === 'compound';
  const game = new Game('integration-test', null, { useRotation, useCompounds, rackSize: 9 });
  game.addPlayer('ai1', 'AI-1');
  game.addPlayer('ai2', 'AI-2');

  let turns = 0;
  let consecutivePasses = 0;

  while (game.status === 'active' && turns < maxTurns && consecutivePasses < 6) {
    const currentIdx = game.currentPlayerIndex;
    const player = game.players[currentIdx];
    const ai = currentIdx === 0 ? ai1 : ai2;

    const move = ai.findBestMove(game.board, player.rack, game.tileBag.length);

    if (!move) {
      consecutivePasses++;
      game.consecutiveScorelessTurns++;
      game.nextTurn();
      turns++;
      continue;
    }

    if (move.exchange) {
      if (game.tileBag.length >= 7) {
        try {
          game.exchangeTiles(currentIdx, move.indices);
          consecutivePasses++;
          game.consecutiveScorelessTurns++;
        } catch {
          consecutivePasses++;
        }
      } else {
        consecutivePasses++;
      }
      game.nextTurn();
      turns++;
      continue;
    }

    // Place tiles
    try {
      game.placeTiles(currentIdx, move.placements);
      player.score += move.score;
      consecutivePasses = 0;
      game.consecutiveScorelessTurns = 0;

      // Check if game should end (player emptied rack with empty bag)
      if (player.rack.length === 0 && game.tileBag.length === 0) {
        game.status = 'completed';
        break;
      }
    } catch {
      consecutivePasses++;
      game.consecutiveScorelessTurns++;
    }

    game.nextTurn();
    turns++;
  }

  return { game, trie, turns, consecutivePasses };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('Integration - Full game with split alphabet', () => {
  it('plays a complete game without crashing', () => {
    const { game, trie, turns } = playFullGame('split', 'casual', 100);

    assert.ok(turns > 0, 'Game should have taken at least one turn');
    assert.ok(
      game.status === 'completed' || turns >= 100 || game.consecutiveScorelessTurns >= 6,
      'Game should reach completion or stall condition'
    );

    // Scores should be non-negative (player scores start at 0 and only go up)
    for (const player of game.players) {
      assert.ok(player.score >= 0, `Player ${player.name} score should be non-negative: ${player.score}`);
    }

    // Validate all words on the board
    const errors = validateBoardWords(game.board, trie);
    assert.equal(errors.length, 0, `Board should have all valid words: ${errors.join('; ')}`);
  });
});

describe('Integration - Full game with rotatable alphabet', () => {
  it('plays a complete game without crashing', () => {
    const { game, trie, turns } = playFullGame('rotatable', 'casual', 100);

    assert.ok(turns > 0, 'Game should have taken at least one turn');

    for (const player of game.players) {
      assert.ok(player.score >= 0, `Player ${player.name} score should be non-negative: ${player.score}`);
    }

    const errors = validateBoardWords(game.board, trie);
    assert.equal(errors.length, 0, `Board should have all valid words: ${errors.join('; ')}`);
  });
});

describe('Integration - Full game with roman alphabet', () => {
  it('plays a complete game without crashing', () => {
    const { game, trie, turns } = playFullGame('roman', 'casual', 100);

    assert.ok(turns > 0, 'Game should have taken at least one turn');

    for (const player of game.players) {
      assert.ok(player.score >= 0, `Player ${player.name} score should be non-negative: ${player.score}`);
    }

    const errors = validateBoardWords(game.board, trie);
    assert.equal(errors.length, 0, `Board should have all valid words: ${errors.join('; ')}`);
  });
});

describe('Integration - Board integrity regression test', () => {
  it('every word on the final board is valid after AI game (split)', () => {
    // Use expert tier for more thorough testing
    const { game, trie, turns } = playFullGame('split', 'beginner', 60);

    assert.ok(turns > 2, 'Should play more than 2 turns for meaningful test');

    const errors = validateBoardWords(game.board, trie);
    assert.equal(errors.length, 0,
      `All words on board must be valid after ${turns} turns. Errors: ${errors.join('; ')}`
    );
  });
});

describe('Integration - Game state consistency', () => {
  it('tile counts remain consistent throughout game', () => {
    const config = ALPHABETS.split;
    const tier = TIERS.beginner;
    const words = buildWordList(READLEX_PATH, config, tier.vocabSize || undefined);
    const trie = new Trie();
    for (const w of words) trie.insert(w);

    const ai = new AIPlayer(trie, tier, config);
    const game = new Game('consistency-test', null, { rackSize: 9 });
    game.addPlayer('ai1', 'AI-1');
    game.addPlayer('ai2', 'AI-2');

    // Count initial tiles
    const initialTotal = game.tileBag.length + game.players[0].rack.length + game.players[1].rack.length;

    let turns = 0;
    while (game.status === 'active' && turns < 30) {
      const currentIdx = game.currentPlayerIndex;
      const player = game.players[currentIdx];
      const move = ai.findBestMove(game.board, player.rack, game.tileBag.length);

      if (!move || move.exchange) {
        game.nextTurn();
        turns++;
        continue;
      }

      try {
        game.placeTiles(currentIdx, move.placements);
        player.score += move.score;
      } catch {
        // skip
      }

      // Count tiles after each move
      let boardTiles = 0;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (game.board[r][c].letter !== null) boardTiles++;
        }
      }
      const rackTiles = game.players.reduce((sum, p) => sum + p.rack.length, 0);
      const currentTotal = game.tileBag.length + rackTiles + boardTiles;

      assert.equal(currentTotal, initialTotal,
        `Total tiles should be conserved. Bag: ${game.tileBag.length}, Racks: ${rackTiles}, Board: ${boardTiles}, Expected: ${initialTotal}`
      );

      game.nextTurn();
      turns++;
    }
  });
});
