const fs = require('fs');
const path = require('path');

// Scrabble board constants
const BOARD_SIZE = 15;

// Bonus squares (standard Scrabble layout)
const BONUS_SQUARES = {
  // Triple Word Score
  TW: [[0,0], [0,7], [0,14], [7,0], [7,14], [14,0], [14,7], [14,14]],
  // Double Word Score
  DW: [[1,1], [2,2], [3,3], [4,4], [1,13], [2,12], [3,11], [4,10],
       [13,1], [12,2], [11,3], [10,4], [13,13], [12,12], [11,11], [10,10]],
  // Triple Letter Score
  TL: [[1,5], [1,9], [5,1], [5,5], [5,9], [5,13], [9,1], [9,5], [9,9], [9,13], [13,5], [13,9]],
  // Double Letter Score
  DL: [[0,3], [0,11], [2,6], [2,8], [3,0], [3,7], [3,14], [6,2], [6,6], [6,8], [6,12],
       [7,3], [7,11], [8,2], [8,6], [8,8], [8,12], [11,0], [11,7], [11,14], [12,6], [12,8], [14,3], [14,11]]
};

class Game {
  constructor(gameId) {
    this.gameId = gameId;
    this.board = this.createEmptyBoard();
    this.players = [];
    this.currentPlayerIndex = 0;
    this.tileBag = [];
    this.tiles = null;
    this.status = 'waiting'; // waiting, active, completed
  }

  // Load tiles from CSV
  loadTiles() {
    const tilesPath = path.join(__dirname, '../data/tiles.csv');
    const content = fs.readFileSync(tilesPath, 'utf8');
    const lines = content.trim().split('\n').slice(1); // Skip header

    this.tiles = [];
    this.tileBag = [];

    lines.forEach(line => {
      const [letter, count, points] = line.split(',');
      const tileInfo = {
        letter: letter === 'blank' ? '' : letter,
        points: parseInt(points),
        isBlank: letter === 'blank'
      };

      this.tiles.push(tileInfo);

      // Add tiles to bag
      for (let i = 0; i < parseInt(count); i++) {
        this.tileBag.push({ ...tileInfo });
      }
    });

    // Shuffle the bag
    this.shuffleTileBag();
  }

  shuffleTileBag() {
    for (let i = this.tileBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tileBag[i], this.tileBag[j]] = [this.tileBag[j], this.tileBag[i]];
    }
  }

  createEmptyBoard() {
    const board = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      board[i] = [];
      for (let j = 0; j < BOARD_SIZE; j++) {
        board[i][j] = {
          letter: null,
          bonus: this.getBonusType(i, j)
        };
      }
    }
    return board;
  }

  getBonusType(row, col) {
    for (const [type, positions] of Object.entries(BONUS_SQUARES)) {
      if (positions.some(([r, c]) => r === row && c === col)) {
        return type;
      }
    }
    return null;
  }

  addPlayer(playerId, playerName) {
    if (this.players.length >= 4) {
      throw new Error('Game is full');
    }

    if (!this.tiles) {
      this.loadTiles();
    }

    const player = {
      id: playerId,
      name: playerName,
      score: 0,
      rack: this.drawTiles(7),
      index: this.players.length
    };

    this.players.push(player);

    if (this.players.length === 2 && this.status === 'waiting') {
      this.status = 'active';
    }

    return player;
  }

  drawTiles(count) {
    const tiles = [];
    for (let i = 0; i < count && this.tileBag.length > 0; i++) {
      tiles.push(this.tileBag.pop());
    }
    return tiles;
  }

  // Place tiles on board
  placeTiles(playerIndex, placements) {
    // placements: [{row, col, letter, isBlank}]
    const player = this.players[playerIndex];

    // Verify it's this player's turn
    if (playerIndex !== this.currentPlayerIndex) {
      throw new Error('Not your turn');
    }

    // Validate placements
    this.validatePlacements(placements);

    // Apply placements to board
    placements.forEach(p => {
      this.board[p.row][p.col].letter = p.letter;
      this.board[p.row][p.col].isBlank = p.isBlank || false;
      this.board[p.row][p.col].points = p.points || 0;
    });

    // Remove used tiles from rack (to be implemented fully)
    // For now, simplified
    placements.forEach(p => {
      const idx = player.rack.findIndex(t =>
        (t.isBlank && p.isBlank) || (!t.isBlank && t.letter === p.letter)
      );
      if (idx >= 0) {
        player.rack.splice(idx, 1);
      }
    });

    // Refill rack
    const newTiles = this.drawTiles(placements.length);
    player.rack.push(...newTiles);

    return true;
  }

  validatePlacements(placements) {
    if (placements.length === 0) {
      throw new Error('Must place at least one tile');
    }

    // Check all placements are on empty squares
    for (const p of placements) {
      if (this.board[p.row][p.col].letter !== null) {
        throw new Error(`Square ${p.row},${p.col} is already occupied`);
      }
    }

    // Check all placements are in a line
    const isHorizontal = placements.every(p => p.row === placements[0].row);
    const isVertical = placements.every(p => p.col === placements[0].col);

    if (!isHorizontal && !isVertical) {
      throw new Error('All tiles must be placed in a straight line');
    }

    // More validation to add:
    // - First move must cover center square
    // - Subsequent moves must connect to existing tiles
    // - Words formed must be valid

    return true;
  }

  // Calculate score for a move
  calculateScore(placements) {
    // Simplified scoring - to be fully implemented
    let score = 0;
    let wordMultiplier = 1;

    placements.forEach(p => {
      let letterScore = p.points || 1;
      const bonus = this.board[p.row][p.col].bonus;

      if (bonus === 'DL') letterScore *= 2;
      if (bonus === 'TL') letterScore *= 3;
      if (bonus === 'DW') wordMultiplier *= 2;
      if (bonus === 'TW') wordMultiplier *= 3;

      score += letterScore;
    });

    score *= wordMultiplier;

    // Bonus for using all 7 tiles
    if (placements.length === 7) {
      score += 50;
    }

    return score;
  }

  nextTurn() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  // Get game state for client
  getState(forPlayerId = null) {
    return {
      gameId: this.gameId,
      board: this.board,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        rackCount: p.rack.length,
        // Only send rack to the player themselves
        rack: forPlayerId === p.id ? p.rack : undefined
      })),
      currentPlayerIndex: this.currentPlayerIndex,
      status: this.status,
      tilesRemaining: this.tileBag.length
    };
  }

  // Serialize for database storage
  serialize() {
    return JSON.stringify({
      board: this.board,
      players: this.players,
      currentPlayerIndex: this.currentPlayerIndex,
      tileBag: this.tileBag,
      status: this.status
    });
  }

  // Deserialize from database
  static deserialize(gameId, data) {
    const game = new Game(gameId);
    const state = JSON.parse(data);
    game.board = state.board;
    game.players = state.players;
    game.currentPlayerIndex = state.currentPlayerIndex;
    game.tileBag = state.tileBag;
    game.status = state.status;
    game.loadTiles(); // Load tile info
    return game;
  }
}

module.exports = Game;
