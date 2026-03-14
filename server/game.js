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
  constructor(gameId, dictionary = null) {
    this.gameId = gameId;
    this.board = this.createEmptyBoard();
    this.players = [];
    this.spectators = [];
    this.currentPlayerIndex = 0;
    this.tileBag = [];
    this.tiles = null;
    this.status = 'waiting'; // waiting, active, completed
    this.locked = false; // true after first turn is taken
    this.turnsTaken = 0;
    this.ownerId = null; // Player ID of game creator
    this.dictionary = dictionary; // Reference to dictionary for word validation
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
    if (this.locked) {
      throw new Error('Game is locked - first turn has been taken');
    }

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
      rack: this.drawTiles(9),
      index: this.players.length,
      connected: true
    };

    this.players.push(player);

    // First player is the owner
    if (this.players.length === 1) {
      this.ownerId = playerId;
    }

    if (this.players.length === 2 && this.status === 'waiting') {
      this.status = 'active';
    }

    return player;
  }

  // Reconnect existing player
  reconnectPlayer(playerId, playerName) {
    const player = this.players.find(p => p.name === playerName);
    if (!player) {
      return null;
    }

    const oldId = player.id;

    // Update player ID and mark as connected
    player.id = playerId;
    player.connected = true;

    // If this player was the owner, update ownerId
    if (this.ownerId === oldId) {
      this.ownerId = playerId;
    }

    return player;
  }

  // Add spectator
  addSpectator(spectatorId, spectatorName) {
    const spectator = {
      id: spectatorId,
      name: spectatorName
    };

    this.spectators.push(spectator);
    return spectator;
  }

  // Remove spectator
  removeSpectator(spectatorId) {
    const index = this.spectators.findIndex(s => s.id === spectatorId);
    if (index !== -1) {
      const spectator = this.spectators[index];
      this.spectators.splice(index, 1);
      return spectator;
    }
    return null;
  }

  // Mark player as disconnected
  disconnectPlayer(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      player.connected = false;
      return true;
    }
    return false;
  }

  // Remove player completely (by owner)
  removePlayer(playerId) {
    const index = this.players.findIndex(p => p.id === playerId);
    if (index === -1) return null;

    const player = this.players[index];

    // Return tiles to bag
    if (player.rack) {
      this.tileBag.push(...player.rack);
      this.shuffleTileBag();
    }

    this.players.splice(index, 1);

    // Update player indices
    this.players.forEach((p, idx) => {
      p.index = idx;
    });

    // Adjust current player index if needed
    if (this.currentPlayerIndex >= this.players.length && this.players.length > 0) {
      this.currentPlayerIndex = 0;
    }

    // If less than 2 players, set back to waiting
    if (this.players.length < 2) {
      this.status = 'waiting';
      this.locked = false;
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

  // Exchange tiles from player's rack
  exchangeTiles(playerIndex, indices) {
    const player = this.players[playerIndex];

    if (playerIndex !== this.currentPlayerIndex) {
      throw new Error('Not your turn');
    }

    if (this.tileBag.length < 7) {
      throw new Error('Not enough tiles in bag to exchange');
    }

    if (indices.length === 0) {
      throw new Error('Must select at least one tile to exchange');
    }

    // Remove tiles from rack and add to bag
    const tilesToReturn = [];
    indices.sort((a, b) => b - a); // Sort descending to avoid index issues

    for (const idx of indices) {
      if (idx < 0 || idx >= player.rack.length) {
        throw new Error('Invalid tile index');
      }
      tilesToReturn.push(player.rack.splice(idx, 1)[0]);
    }

    // Add returned tiles to bag and shuffle
    this.tileBag.push(...tilesToReturn);
    this.shuffleTileBag();

    // Draw new tiles
    const newTiles = this.drawTiles(indices.length);
    player.rack.push(...newTiles);

    return true;
  }

  // Place tiles on board (assumes validation already done)
  placeTiles(playerIndex, placements) {
    // placements: [{row, col, letter, isBlank}]
    const player = this.players[playerIndex];

    // Verify it's this player's turn
    if (playerIndex !== this.currentPlayerIndex) {
      throw new Error('Not your turn');
    }

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

    // Lock game after first turn
    this.turnsTaken++;
    if (this.turnsTaken === 1) {
      this.locked = true;
    }

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

    // First move must cover center square
    if (this.turnsTaken === 0) {
      const coversCenter = placements.some(p => p.row === 7 && p.col === 7);
      if (!coversCenter) {
        throw new Error('First move must cover the center square');
      }
    }

    // Temporarily place tiles to check words
    const tempBoard = JSON.parse(JSON.stringify(this.board));
    placements.forEach(p => {
      tempBoard[p.row][p.col].letter = p.letter;
    });

    // Check horizontal and vertical word for each placed tile
    const wordsToCheck = new Set();

    for (const p of placements) {
      // Check horizontal word
      const hWord = this.readWord(tempBoard, p.row, p.col, true);
      if (hWord.length > 1) wordsToCheck.add(hWord);

      // Check vertical word
      const vWord = this.readWord(tempBoard, p.row, p.col, false);
      if (vWord.length > 1) wordsToCheck.add(vWord);
    }

    console.log('Words to validate:', Array.from(wordsToCheck));

    if (wordsToCheck.size === 0) {
      throw new Error('Move must form at least one word');
    }

    // Check dictionary if available - return list of invalid words
    const invalidWords = [];
    if (this.dictionary) {
      for (const word of wordsToCheck) {
        if (!this.dictionary.isValidWord(word)) {
          invalidWords.push(word);
        }
      }
    }

    return invalidWords;
  }

  // Read word horizontally or vertically from a position
  readWord(board, row, col, horizontal) {
    let word = '';

    if (horizontal) {
      // Find start and end of word
      let startCol = col;
      let endCol = col;

      while (startCol > 0 && board[row][startCol - 1].letter) startCol--;
      while (endCol < 14 && board[row][endCol + 1].letter) endCol++;

      for (let c = startCol; c <= endCol; c++) {
        word += board[row][c].letter || '';
      }
    } else {
      // Find start and end of word
      let startRow = row;
      let endRow = row;

      while (startRow > 0 && board[startRow - 1][col].letter) startRow--;
      while (endRow < 14 && board[endRow + 1][col].letter) endRow++;

      for (let r = startRow; r <= endRow; r++) {
        word += board[r][col].letter || '';
      }
    }

    return word;
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
        connected: p.connected,
        // Only send rack to the player themselves
        rack: forPlayerId === p.id ? p.rack : undefined
      })),
      spectators: this.spectators.map(s => ({
        id: s.id,
        name: s.name
      })),
      currentPlayerIndex: this.currentPlayerIndex,
      status: this.status,
      locked: this.locked,
      ownerId: this.ownerId,
      tilesRemaining: this.tileBag.length
    };
  }

  // Serialize for database storage
  serialize() {
    return JSON.stringify({
      board: this.board,
      players: this.players,
      spectators: this.spectators,
      currentPlayerIndex: this.currentPlayerIndex,
      tileBag: this.tileBag,
      status: this.status,
      locked: this.locked,
      turnsTaken: this.turnsTaken,
      ownerId: this.ownerId
    });
  }

  // Deserialize from database
  static deserialize(gameId, data, dictionary = null) {
    const game = new Game(gameId, dictionary);
    // MySQL returns JSON columns as objects, not strings
    const state = typeof data === 'string' ? JSON.parse(data) : data;
    game.board = state.board;
    game.players = state.players || [];
    game.spectators = state.spectators || [];
    game.currentPlayerIndex = state.currentPlayerIndex || 0;
    game.tileBag = state.tileBag || [];
    game.status = state.status || 'waiting';
    game.locked = state.locked || false;
    game.turnsTaken = state.turnsTaken || 0;
    game.ownerId = state.ownerId || null;
    game.loadTiles(); // Load tile info
    return game;
  }
}

module.exports = Game;
