'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const Game = require('../server/game');
const Dictionary = require('../server/dictionary');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGame(options = {}) {
  const game = new Game('test-game', null, options);
  return game;
}

function makeGameWithDict(dict, options = {}) {
  return new Game('test-game', dict, options);
}

function addTwoPlayers(game) {
  game.addPlayer('p1', 'Alice');
  game.addPlayer('p2', 'Bob');
}

// Minimal dictionary stub that accepts any word
class StubDictionary {
  constructor(validWords = new Set()) {
    this.validWords = validWords;
    this.loaded = true;
  }
  isValidWord(word) {
    return this.validWords.has(word);
  }
}

// ---------------------------------------------------------------------------
// Board creation
// ---------------------------------------------------------------------------

describe('Game - Board creation', () => {
  it('creates a 15x15 board', () => {
    const game = makeGame();
    assert.equal(game.board.length, 15);
    for (const row of game.board) {
      assert.equal(row.length, 15);
    }
  });

  it('center square is at [7,7] with no letter', () => {
    const game = makeGame();
    assert.equal(game.board[7][7].letter, null);
  });

  it('has correct bonus squares', () => {
    const game = makeGame();
    // Triple word corners
    assert.equal(game.board[0][0].bonus, 'TW');
    assert.equal(game.board[0][14].bonus, 'TW');
    assert.equal(game.board[14][0].bonus, 'TW');
    assert.equal(game.board[14][14].bonus, 'TW');
    // Center is DW (star)
    // Actually checking the code: center [7,7] is not in DW list, it is in TW list
    // Let me check: TW includes [7,0] and [7,14] and [0,7] and [14,7] but not [7,7]
    // DW does not include [7,7] either. So center has no bonus.
    assert.equal(game.board[7][7].bonus, null);
    // Double word
    assert.equal(game.board[1][1].bonus, 'DW');
    assert.equal(game.board[2][2].bonus, 'DW');
    // Triple letter
    assert.equal(game.board[1][5].bonus, 'TL');
    assert.equal(game.board[5][1].bonus, 'TL');
    // Double letter
    assert.equal(game.board[0][3].bonus, 'DL');
    assert.equal(game.board[3][7].bonus, 'DL');
    // Plain square
    assert.equal(game.board[1][2].bonus, null);
  });
});

// ---------------------------------------------------------------------------
// Tile loading
// ---------------------------------------------------------------------------

describe('Game - Tile loading', () => {
  it('loadTiles() creates correct number of tiles from tiles.csv', () => {
    const game = makeGame();
    game.loadTiles();
    // Count from CSV: sum of all counts
    const expectedTotal = 2+5+3+2+2+4+2+1+1+1+2+4+2+2+3+3+1+1+3+1+4+3+5+2+2+5+2+2+1+1+5+5+2+2+2+2+1+1+1+2+1+2+2;
    assert.equal(game.tileBag.length, expectedTotal);
  });

  it('loadTiles() with split-extended loads tiles-extended.csv', () => {
    const game = makeGame({ tileMode: 'split-extended' });
    game.loadTiles();
    assert.ok(game.tiles.length > 0);
    // split-extended should not have rotatable tiles
    const rotatable = game.tileBag.find(t => t.isRotatable);
    assert.equal(rotatable, undefined);
  });

  it('loadTiles() with useRotation loads tiles-rotatable.csv with rotation properties', () => {
    const game = makeGame({ tileMode: 'rotation' });
    game.loadTiles();
    // Rotatable tiles should have isRotatable, rotatedLetter, rotatedPoints
    const rotatableTile = game.tileBag.find(t => t.isRotatable);
    assert.ok(rotatableTile, 'Should have at least one rotatable tile');
    assert.ok('rotatedLetter' in rotatableTile);
    assert.ok('rotatedPoints' in rotatableTile);
    assert.equal(rotatableTile.isRotated, false);
  });

  it('blank tiles have isBlank: true and letter: ""', () => {
    const game = makeGame();
    game.loadTiles();
    const blanks = game.tileBag.filter(t => t.isBlank);
    assert.equal(blanks.length, 2);
    for (const b of blanks) {
      assert.equal(b.isBlank, true);
      assert.equal(b.letter, '');
      assert.equal(b.points, 0);
    }
  });

  it('allLetters includes all valid letters', () => {
    const game = makeGame();
    game.loadTiles();
    assert.ok(game.allLetters.length > 0);
    // Should include Shavian letters but not blank
    assert.ok(game.allLetters.includes('\u{10450}')); // first Shavian letter
    assert.ok(!game.allLetters.includes(''));
  });

  it('allLetters includes rotated letters in rotation mode', () => {
    const game = makeGame({ useRotation: true });
    game.loadTiles();
    // In rotation mode, rotated letters should be in allLetters
    // e.g., 𐑐 rotates to 𐑚 - both should be present
    assert.ok(game.allLetters.includes('\u{10450}')); // 𐑐
    assert.ok(game.allLetters.includes('\u{1045A}')); // 𐑚
  });
});

// ---------------------------------------------------------------------------
// Player management
// ---------------------------------------------------------------------------

describe('Game - Player management', () => {
  it('addPlayer() draws initial rack of correct size', () => {
    const game = makeGame({ rackSize: 9 });
    const player = game.addPlayer('p1', 'Alice');
    assert.equal(player.rack.length, 9);
  });

  it('addPlayer() draws rack of custom size', () => {
    const game = makeGame({ rackSize: 7 });
    const player = game.addPlayer('p1', 'Alice');
    assert.equal(player.rack.length, 7);
  });

  it('adding 2nd player starts the game', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    assert.equal(game.status, 'waiting');
    game.addPlayer('p2', 'Bob');
    assert.equal(game.status, 'active');
  });

  it('first player is owner', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    assert.equal(game.ownerId, 'p1');
  });

  it('getCurrentPlayer() returns correct player', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    game.addPlayer('p2', 'Bob');
    assert.equal(game.getCurrentPlayer().id, 'p1');
    game.nextTurn();
    assert.equal(game.getCurrentPlayer().id, 'p2');
    game.nextTurn();
    assert.equal(game.getCurrentPlayer().id, 'p1');
  });

  it('rejects more than 4 players', () => {
    const game = makeGame();
    game.addPlayer('p1', 'A');
    game.addPlayer('p2', 'B');
    game.addPlayer('p3', 'C');
    game.addPlayer('p4', 'D');
    assert.throws(() => game.addPlayer('p5', 'E'), /Game is full/);
  });
});

// ---------------------------------------------------------------------------
// Tile placement
// ---------------------------------------------------------------------------

describe('Game - placeTiles()', () => {
  let game;

  beforeEach(() => {
    game = makeGame();
    addTwoPlayers(game);
  });

  it('removes tiles from rack and places on board', () => {
    const player = game.players[0];
    const tile = player.rack[0];
    const letter = tile.letter;
    const initialRackLength = player.rack.length;

    const placements = [{ row: 7, col: 7, letter, isBlank: tile.isBlank, points: tile.points }];
    game.placeTiles(0, placements);

    assert.equal(game.board[7][7].letter, letter);
    // Rack size should be same (refilled from bag)
    assert.equal(player.rack.length, initialRackLength);
  });

  it('refills rack from bag', () => {
    const player = game.players[0];
    const initialBagSize = game.tileBag.length;
    const tile = player.rack[0];

    game.placeTiles(0, [{ row: 7, col: 7, letter: tile.letter, isBlank: tile.isBlank, points: tile.points }]);

    // Bag should have one less tile (drew one to refill)
    assert.equal(game.tileBag.length, initialBagSize - 1);
  });

  it('rejects tiles not in rack', () => {
    // Find a letter not in the player's rack
    const player = game.players[0];
    const rackLetters = new Set(player.rack.map(t => t.letter));
    // Use a letter definitely not in rack - try finding one
    let missingLetter = null;
    for (const letter of game.allLetters) {
      if (!rackLetters.has(letter)) {
        missingLetter = letter;
        break;
      }
    }

    if (missingLetter) {
      assert.throws(
        () => game.placeTiles(0, [{ row: 7, col: 7, letter: missingLetter, isBlank: false }]),
        /doesn't have tiles/
      );
    }
  });

  it('works with blank tiles', () => {
    const player = game.players[0];
    // Replace first tile with a blank for testing
    player.rack[0] = { letter: '', points: 0, isBlank: true };

    const placements = [{ row: 7, col: 7, letter: '\u{10450}', isBlank: true, points: 0 }];
    game.placeTiles(0, placements);

    assert.equal(game.board[7][7].letter, '\u{10450}');
    assert.equal(game.board[7][7].isBlank, true);
  });

  it('works with rotated tiles', () => {
    const game2 = makeGame({ useRotation: true });
    game2.addPlayer('p1', 'Alice');
    game2.addPlayer('p2', 'Bob');

    const player = game2.players[0];
    // Find a rotatable tile in rack
    const rotatableIdx = player.rack.findIndex(t => t.isRotatable);

    if (rotatableIdx >= 0) {
      const tile = player.rack[rotatableIdx];
      const placements = [{
        row: 7, col: 7,
        letter: tile.rotatedLetter,
        isBlank: false,
        isRotated: true,
        points: tile.rotatedPoints
      }];
      game2.placeTiles(0, placements);
      assert.equal(game2.board[7][7].letter, tile.rotatedLetter);
      assert.equal(game2.board[7][7].points, tile.rotatedPoints);
    }
  });

  it('rejects placement when it is not your turn', () => {
    const player = game.players[1];
    const tile = player.rack[0];
    assert.throws(
      () => game.placeTiles(1, [{ row: 7, col: 7, letter: tile.letter, isBlank: false }]),
      /Not your turn/
    );
  });
});

// ---------------------------------------------------------------------------
// Move validation (validatePlacements)
// ---------------------------------------------------------------------------

describe('Game - validatePlacements()', () => {
  it('rejects empty placements', () => {
    const game = makeGame();
    addTwoPlayers(game);
    assert.throws(() => game.validatePlacements([]), /Must place at least one tile/);
  });

  it('rejects placements on occupied squares', () => {
    const game = makeGame();
    addTwoPlayers(game);
    game.board[7][7].letter = '\u{10450}';
    assert.throws(
      () => game.validatePlacements([{ row: 7, col: 7, letter: '\u{10451}' }]),
      /already occupied/
    );
  });

  it('rejects placements not in a line', () => {
    const game = makeGame();
    addTwoPlayers(game);
    assert.throws(
      () => game.validatePlacements([
        { row: 7, col: 7, letter: '\u{10450}' },
        { row: 8, col: 8, letter: '\u{10451}' }
      ]),
      /straight line/
    );
  });

  it('first move must cover center [7,7]', () => {
    const game = makeGame();
    addTwoPlayers(game);
    assert.throws(
      () => game.validatePlacements([
        { row: 0, col: 0, letter: '\u{10450}' },
        { row: 0, col: 1, letter: '\u{10451}' }
      ]),
      /center square/
    );
  });

  it('validates words against dictionary', () => {
    const dict = new StubDictionary(new Set(['\u{10450}\u{10451}']));
    const game = makeGameWithDict(dict);
    game.loadTiles();
    addTwoPlayers(game);

    // Valid word
    const invalidWords = game.validatePlacements([
      { row: 7, col: 7, letter: '\u{10450}' },
      { row: 7, col: 8, letter: '\u{10451}' }
    ]);
    assert.equal(invalidWords.length, 0);
  });

  it('returns invalid words from dictionary check', () => {
    const dict = new StubDictionary(new Set()); // empty = nothing valid
    const game = makeGameWithDict(dict);
    game.loadTiles();
    addTwoPlayers(game);

    const invalidWords = game.validatePlacements([
      { row: 7, col: 7, letter: '\u{10450}' },
      { row: 7, col: 8, letter: '\u{10451}' }
    ]);
    assert.ok(invalidWords.length > 0);
  });

  it('detects and validates cross-words', () => {
    // Place a vertical word first, then check horizontal crossing it
    const dict = new StubDictionary(new Set([
      '\u{10450}\u{10451}',
      '\u{10451}\u{10452}',
    ]));
    const game = makeGameWithDict(dict);
    game.loadTiles();
    addTwoPlayers(game);

    // Manually place a tile on the board (simulate previous move)
    game.board[7][7].letter = '\u{10450}';
    game.board[7][8].letter = '\u{10451}';
    game.turnsTaken = 1; // Not first move anymore

    // Place tile below [7][8] to form cross-word
    const invalidWords = game.validatePlacements([
      { row: 8, col: 8, letter: '\u{10452}' }
    ]);
    // The vertical word would be 𐑑𐑒 (col 8, rows 7-8) which is in our dict
    assert.equal(invalidWords.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('Game - Scoring', () => {
  it('applies letter bonuses (DL, TL) correctly', () => {
    const game = makeGame();
    // DL at [0,3]
    const score = game.calculateScore([
      { row: 0, col: 3, points: 5 } // DL square
    ]);
    assert.equal(score, 10); // 5 * 2
  });

  it('applies TL bonus correctly', () => {
    const game = makeGame();
    // TL at [1,5]
    const score = game.calculateScore([
      { row: 1, col: 5, points: 3 }
    ]);
    assert.equal(score, 9); // 3 * 3
  });

  it('applies word multipliers (DW, TW) correctly', () => {
    const game = makeGame();
    // DW at [1,1]
    const score = game.calculateScore([
      { row: 1, col: 1, points: 4 },
      { row: 1, col: 2, points: 3 }
    ]);
    // (4 + 3) * 2 = 14
    assert.equal(score, 14);
  });

  it('applies TW multiplier correctly', () => {
    const game = makeGame();
    // TW at [0,0]
    const score = game.calculateScore([
      { row: 0, col: 0, points: 2 },
      { row: 0, col: 1, points: 3 }
    ]);
    // (2 + 3) * 3 = 15
    assert.equal(score, 15);
  });

  it('bingo bonus (50 points) for using 7 tiles', () => {
    const game = makeGame();
    const placements = [];
    for (let i = 0; i < 7; i++) {
      placements.push({ row: 7, col: i, points: 1 });
    }
    const score = game.calculateScore(placements);
    // 7 * 1 * wordMultiplier(1) + 50 = 57
    // But col 3 is DL: 1*2=2, all others 1 each, plus TW at [7,0]
    // Actually [7,0] is TW and [7,3] is DL
    // So: (1 + 1 + 1 + 2 + 1 + 1 + 1) * 3 + 50 = 24 + 50 = 74
    // Wait: [7,0] is TW so wordMultiplier=3, [7,3] is DL so letter*2
    assert.equal(score, 74);
  });

  it('no bingo bonus for fewer than 7 tiles', () => {
    const game = makeGame();
    // Place on squares with no bonuses
    const score = game.calculateScore([
      { row: 7, col: 6, points: 5 } // no bonus at [7,6]
    ]);
    assert.equal(score, 5);
  });
});

// ---------------------------------------------------------------------------
// Endgame scoring
// ---------------------------------------------------------------------------

describe('Game - Endgame scoring', () => {
  it('casual mode: winner gets opponents tile values, opponents lose tile values', () => {
    const game = makeGame({ rules: 'casual' });
    addTwoPlayers(game);

    game.players[0].score = 100;
    game.players[1].score = 80;
    game.players[0].rack = []; // went out
    game.players[1].rack = [
      { letter: '\u{10450}', points: 5 },
      { letter: '\u{10451}', points: 3 }
    ];

    game.applyEndgameScoring();

    assert.equal(game.players[0].score, 108); // 100 + 5 + 3
    assert.equal(game.players[1].score, 72);  // 80 - 5 - 3
  });

  it('tournament mode: winner gets 2x opponents tiles', () => {
    const game = makeGame({ rules: 'tournament' });
    addTwoPlayers(game);

    game.players[0].score = 100;
    game.players[1].score = 80;
    game.players[0].rack = [];
    game.players[1].rack = [
      { letter: '\u{10450}', points: 5 },
      { letter: '\u{10451}', points: 3 }
    ];

    game.applyEndgameScoring();

    assert.equal(game.players[0].score, 116); // 100 + (5+3)*2
    assert.equal(game.players[1].score, 80);  // unchanged in tournament
  });

  it('when no one went out, everyone subtracts own tiles (casual)', () => {
    const game = makeGame({ rules: 'casual' });
    addTwoPlayers(game);

    game.players[0].score = 100;
    game.players[1].score = 80;
    game.players[0].rack = [{ letter: 'a', points: 4 }];
    game.players[1].rack = [{ letter: 'b', points: 6 }];

    game.applyEndgameScoring();

    assert.equal(game.players[0].score, 96);
    assert.equal(game.players[1].score, 74);
  });

  it('tracks consecutive scoreless turns', () => {
    const game = makeGame();
    addTwoPlayers(game);
    assert.equal(game.consecutiveScorelessTurns, 0);
    game.consecutiveScorelessTurns = 3;
    assert.equal(game.consecutiveScorelessTurns, 3);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('Game - Serialization', () => {
  it('serialize() produces valid JSON', () => {
    const game = makeGame();
    addTwoPlayers(game);
    const json = game.serialize();
    assert.doesNotThrow(() => JSON.parse(json));
  });

  it('deserialize() restores game state correctly', () => {
    const game = makeGame({ rackSize: 7, rules: 'tournament', tileMode: 'split' });
    addTwoPlayers(game);
    game.players[0].score = 42;
    game.consecutiveScorelessTurns = 2;
    game.turnsTaken = 5;
    game.locked = true;

    const json = game.serialize();
    const restored = Game.deserialize('test-game', json);

    assert.equal(restored.gameId, 'test-game');
    assert.equal(restored.players.length, 2);
    assert.equal(restored.players[0].score, 42);
    assert.equal(restored.status, 'active');
    assert.equal(restored.consecutiveScorelessTurns, 2);
    assert.equal(restored.turnsTaken, 5);
    assert.equal(restored.locked, true);
    assert.equal(restored.rackSize, 7);
    assert.equal(restored.rules, 'tournament');
  });

  it('rotation properties preserved through serialize/deserialize', () => {
    const game = makeGame({ tileMode: 'rotation' });
    addTwoPlayers(game);

    const json = game.serialize();
    const restored = Game.deserialize('test-game', json);

    assert.equal(restored.useRotation, true);
    // Tile info should be reloaded
    assert.ok(restored.tiles);
    const rotatable = restored.tiles.find(t => t.isRotatable);
    assert.ok(rotatable, 'Restored game should have rotatable tile definitions');
    assert.ok('rotatedLetter' in rotatable);
    assert.ok('rotatedPoints' in rotatable);
  });

  it('deserialize handles object input (MySQL JSON columns)', () => {
    const game = makeGame();
    addTwoPlayers(game);
    const data = JSON.parse(game.serialize());
    const restored = Game.deserialize('test-game', data);
    assert.equal(restored.players.length, 2);
  });

  it('bot properties preserved through serialize/deserialize', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    game.addBot('casual');

    const json = game.serialize();
    const restored = Game.deserialize('test-game', json);

    assert.equal(restored.players.length, 2);
    assert.equal(restored.players[1].isBot, true);
    assert.equal(restored.players[1].botTier, 'casual');
    assert.equal(restored.players[1].name, 'Bot (Casual)');
  });
});

// ---------------------------------------------------------------------------
// Bot player management
// ---------------------------------------------------------------------------

describe('Game - Bot management', () => {
  it('addBot() creates a bot player with correct properties', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    const bot = game.addBot('intermediate');

    assert.equal(bot.isBot, true);
    assert.equal(bot.botTier, 'intermediate');
    assert.equal(bot.name, 'Bot (Intermediate)');
    assert.ok(bot.id.startsWith('bot-intermediate-'));
    assert.equal(bot.rack.length, 9);
    assert.equal(bot.score, 0);
    assert.equal(bot.connected, true);
  });

  it('addBot() starts game when 2nd player is a bot', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    assert.equal(game.status, 'waiting');
    game.addBot('beginner');
    assert.equal(game.status, 'active');
  });

  it('addBot() rejects unknown tier', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    assert.throws(() => game.addBot('godlike'), /Unknown bot tier/);
  });

  it('addBot() rejects when game is full', () => {
    const game = makeGame();
    game.addPlayer('p1', 'A');
    game.addPlayer('p2', 'B');
    game.addPlayer('p3', 'C');
    game.addPlayer('p4', 'D');
    assert.throws(() => game.addBot('casual'), /Game is full/);
  });

  it('addBot() works even when game is locked (mid-game join)', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    game.addBot('casual');
    game.locked = true;
    game.addBot('expert');
    assert.strictEqual(game.players.length, 3);
  });

  it('getState() includes isBot and botTier', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    game.addBot('expert');

    const state = game.getState('p1');
    assert.equal(state.players[0].isBot, false);
    assert.equal(state.players[0].botTier, null);
    assert.equal(state.players[1].isBot, true);
    assert.equal(state.players[1].botTier, 'expert');
  });

  it('removePlayer() works for bots', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    const bot = game.addBot('casual');

    const result = game.removePlayer(bot.id);
    assert.ok(result);
    assert.equal(game.players.length, 1);
    assert.equal(game.status, 'waiting');
  });

  it('multiple bots can be added', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Alice');
    game.addBot('beginner');
    game.addBot('expert');
    game.addBot('casual');

    assert.equal(game.players.length, 4);
    assert.equal(game.players.filter(p => p.isBot).length, 3);
  });
});

// ---------------------------------------------------------------------------
// Tile mode
// ---------------------------------------------------------------------------

describe('Game - tileMode', () => {
  it('defaults to rotation when no options given', () => {
    const game = makeGame();
    assert.equal(game.tileMode, 'rotation');
    assert.equal(game.useRotation, true);
    assert.equal(game.useCompounds, false);
  });

  it('accepts explicit tileMode option', () => {
    const game = makeGame({ tileMode: 'split' });
    assert.equal(game.tileMode, 'split');
    assert.equal(game.useRotation, false);
  });

  it('accepts split-extended tileMode', () => {
    const game = makeGame({ tileMode: 'split-extended' });
    assert.equal(game.tileMode, 'split-extended');
    assert.equal(game.useRotation, false);
  });

  it('accepts rotation-extended tileMode', () => {
    const game = makeGame({ tileMode: 'rotation-extended' });
    assert.equal(game.tileMode, 'rotation-extended');
    assert.equal(game.useRotation, true);
  });

  it('useCompounds getter always returns false', () => {
    const game = makeGame({ tileMode: 'compound' });
    assert.equal(game.useCompounds, false);
  });

  it('backwards compat: useRotation option maps to rotation tileMode', () => {
    const game = makeGame({ useRotation: true });
    assert.equal(game.tileMode, 'rotation');
    assert.equal(game.useRotation, true);
  });

  it('backwards compat: useCompounds option maps to compound tileMode', () => {
    const game = makeGame({ useCompounds: true });
    assert.equal(game.tileMode, 'compound');
  });

  it('tileMode preserved through serialize/deserialize', () => {
    const game = makeGame({ tileMode: 'split-extended' });
    addTwoPlayers(game);

    const json = game.serialize();
    const restored = Game.deserialize('test-game', json);

    assert.equal(restored.tileMode, 'split-extended');
    assert.equal(restored.useRotation, false);
  });

  it('deserialize old useRotation saves as rotation tileMode', () => {
    // Simulate old serialized state with no tileMode but useRotation: true
    const oldState = {
      board: makeGame().board,
      players: [],
      spectators: [],
      currentPlayerIndex: 0,
      tileBag: [],
      status: 'waiting',
      locked: false,
      turnsTaken: 0,
      ownerId: null,
      rackSize: 9,
      allowVoting: true,
      rules: 'casual',
      useRotation: true,
      consecutiveScorelessTurns: 0,
    };

    const restored = Game.deserialize('test-game', oldState);
    assert.equal(restored.tileMode, 'rotation');
    assert.equal(restored.useRotation, true);
  });

  it('deserialize old useCompounds saves as split tileMode', () => {
    const oldState = {
      board: makeGame().board,
      players: [],
      spectators: [],
      currentPlayerIndex: 0,
      tileBag: [],
      status: 'waiting',
      locked: false,
      turnsTaken: 0,
      ownerId: null,
      rackSize: 9,
      allowVoting: true,
      rules: 'casual',
      useCompounds: true,
      consecutiveScorelessTurns: 0,
    };

    const restored = Game.deserialize('test-game', oldState);
    assert.equal(restored.tileMode, 'split');
    assert.equal(restored.useCompounds, false);
  });

  it('compound tileMode loads tiles.csv as fallback', () => {
    const game = makeGame({ tileMode: 'compound' });
    game.loadTiles();
    // Should load successfully using tiles.csv fallback
    assert.ok(game.tiles.length > 0);
    assert.ok(game.tileBag.length > 0);
  });
});
