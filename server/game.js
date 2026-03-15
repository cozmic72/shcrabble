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
  constructor(gameId, dictionary = null, options = {}) {
    this.gameId = gameId;
    this.board = this.createEmptyBoard();
    this.players = [];
    this.spectators = [];
    this.currentPlayerIndex = 0;
    this.tileBag = [];
    this.tiles = null;
    this.status = 'waiting'; // waiting, active, completed
    this.locked = false; // true after first round is complete (all players had one turn)
    this.turnsTaken = 0;
    this.ownerId = null; // Player ID of game creator
    this.dictionary = dictionary; // Reference to dictionary for word validation
    this.rackSize = options.rackSize || 9; // Customizable rack size
    this.allowVoting = options.allowVoting !== undefined ? options.allowVoting : true; // Allow voting on invalid words
    this.rules = options.rules || 'casual'; // 'casual' or 'tournament'
    this.useCompounds = options.useCompounds || false; // Use compound letters (𐑼, 𐑽, etc.)
    this.customTiles = options.customTiles || null; // Custom tile distribution
    this.consecutiveScorelessTurns = 0; // Track consecutive passes/exchanges for endgame

    // Timer settings
    this.timerEnabled = options.timerEnabled || false; // Whether timer is enabled
    this.timeLimit = options.timeLimit || 25 * 60; // Time limit per player in seconds (default 25 minutes)
    this.timerPaused = this.timerEnabled; // Start paused if timer is enabled (owner must unpause)
    this.turnStartTime = null; // Timestamp when current turn started
  }

  // Load tile definitions and metadata from CSV (without initializing tileBag)
  loadTileInfo() {
    const filename = this.useCompounds ? 'tiles-compound.csv' : 'tiles.csv';
    const tilesPath = path.join(__dirname, '../data', filename);
    const content = fs.readFileSync(tilesPath, 'utf8');
    const lines = content.trim().split('\n').slice(1); // Skip header

    this.tiles = [];
    this.allLetters = []; // Store all possible letters for wildcard validation

    lines.forEach(line => {
      const [letter, count, points] = line.split(',');
      const tileInfo = {
        letter: letter === 'blank' ? '' : letter,
        points: parseInt(points),
        isBlank: letter === 'blank',
        count: parseInt(count)
      };

      this.tiles.push(tileInfo);

      // Store non-blank letters for wildcard validation
      if (letter !== 'blank') {
        this.allLetters.push(letter);
      }
    });
  }

  // Load tiles from CSV or custom distribution
  loadTiles() {
    // Use custom tiles if provided, otherwise load from CSV
    if (this.customTiles) {
      this.tiles = this.customTiles.map(t => ({
        letter: t.letter,
        points: t.points,
        count: t.count,
        isBlank: t.letter === 'blank'
      }));
      this.allLetters = this.tiles
        .filter(t => t.letter !== 'blank')
        .map(t => t.letter);
    } else {
      this.loadTileInfo();
    }

    this.tileBag = [];

    this.tiles.forEach(tileInfo => {
      // Add tiles to bag
      for (let i = 0; i < tileInfo.count; i++) {
        this.tileBag.push({
          letter: tileInfo.letter,
          points: tileInfo.points,
          isBlank: tileInfo.isBlank
        });
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

  addPlayer(playerId, playerName, userId = null) {
    if (this.locked) {
      throw new Error('Game is locked - first round is complete');
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
      userId: userId, // Store the persistent user ID
      score: 0,
      rack: this.drawTiles(this.rackSize),
      index: this.players.length,
      connected: true,
      hasLeft: false,
      timeUsed: 0 // Accumulative time used in seconds
    };

    this.players.push(player);

    // First player is the owner
    if (this.players.length === 1) {
      this.ownerId = playerId;
    }

    if (this.players.length === 2 && this.status === 'waiting') {
      this.status = 'active';
      // Start timer when game becomes active
      this.startTurnTimer();
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

  // Mark player as having left (keeps them in game for scoring)
  markPlayerAsLeft(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return null;

    player.hasLeft = true;
    player.connected = false;

    const wasOwner = this.ownerId === playerId;

    // Transfer ownership if the owner left
    let newOwner = null;
    if (wasOwner) {
      // Find first player who hasn't left
      const remainingPlayer = this.players.find(p => !p.hasLeft);
      if (remainingPlayer) {
        this.ownerId = remainingPlayer.id;
        newOwner = remainingPlayer;
      }
    }

    // Check if we need to skip to next player's turn
    const needsSkip = this.currentPlayerIndex === player.index;

    // Count active (non-left) players
    const activePlayers = this.players.filter(p => !p.hasLeft);

    // If less than 2 active players, set back to waiting
    if (activePlayers.length < 2) {
      this.status = 'waiting';
      this.locked = false;
    }

    return { player, wasOwner, newOwner, needsSkip };
  }

  // Remove player completely (by owner)
  removePlayer(playerId) {
    const index = this.players.findIndex(p => p.id === playerId);
    if (index === -1) return null;

    const player = this.players[index];
    const wasOwner = this.ownerId === playerId;

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

    // Transfer ownership if the owner left
    let newOwner = null;
    if (wasOwner && this.players.length > 0) {
      this.ownerId = this.players[0].id;
      newOwner = this.players[0];
    }

    // Adjust current player index if needed
    if (this.currentPlayerIndex >= this.players.length && this.players.length > 0) {
      this.currentPlayerIndex = 0;
    }

    // If less than 2 players, set back to waiting
    if (this.players.length < 2) {
      this.status = 'waiting';
      this.locked = false;
    }

    return { player, wasOwner, newOwner };
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

    // Validate player has all tiles in rack before placing
    const missingTiles = [];
    const tilesToRemove = [];
    placements.forEach(p => {
      const idx = player.rack.findIndex((t, i) => {
        // Skip tiles we've already marked for removal
        if (tilesToRemove.includes(i)) return false;
        return (t.isBlank && p.isBlank) || (!t.isBlank && t.letter === p.letter);
      });
      if (idx < 0) {
        missingTiles.push(p.isBlank ? '(blank)' : p.letter);
      } else {
        tilesToRemove.push(idx);
      }
    });

    if (missingTiles.length > 0) {
      throw new Error(`Player doesn't have tiles in rack: ${missingTiles.join(', ')}`);
    }

    // Apply placements to board
    placements.forEach(p => {
      this.board[p.row][p.col].letter = p.letter;
      this.board[p.row][p.col].isBlank = p.isBlank || false;
      this.board[p.row][p.col].points = p.points || 0;
    });

    // Remove used tiles from rack (now validated)
    // Sort in descending order to avoid index shifting issues
    tilesToRemove.sort((a, b) => b - a);
    tilesToRemove.forEach(idx => {
      player.rack.splice(idx, 1);
    });

    // Refill rack
    const newTiles = this.drawTiles(placements.length);
    player.rack.push(...newTiles);

    // Track turns taken
    this.turnsTaken++;

    // Lock game after first complete round (all players have had one turn)
    if (this.turnsTaken >= this.players.length) {
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
      tempBoard[p.row][p.col].isBlank = p.isBlank || false;
    });

    // Check horizontal and vertical word for each placed tile
    const wordsToCheck = []; // Array of {word, positions: [{row, col}]}

    for (const p of placements) {
      // Check horizontal word
      const hWordData = this.readWordWithPositions(tempBoard, p.row, p.col, true);
      // Count actual characters (not code units) to handle Unicode properly
      const hWordLength = [...hWordData.word].length;
      if (hWordLength > 1) {
        wordsToCheck.push(hWordData);
      }

      // Check vertical word
      const vWordData = this.readWordWithPositions(tempBoard, p.row, p.col, false);
      const vWordLength = [...vWordData.word].length;
      if (vWordLength > 1) {
        wordsToCheck.push(vWordData);
      }
    }

    // Remove duplicates (same positions)
    const uniqueWords = [];
    for (const wordData of wordsToCheck) {
      const posKey = wordData.positions.map(p => `${p.row},${p.col}`).join('|');
      if (!uniqueWords.some(w => w.positions.map(p => `${p.row},${p.col}`).join('|') === posKey)) {
        uniqueWords.push(wordData);
      }
    }

    console.log('Words to validate:', uniqueWords.map(w => w.word));

    if (uniqueWords.length === 0) {
      throw new Error('Move must form at least one word');
    }

    // Check dictionary if available - return list of invalid words
    const invalidWords = [];
    if (this.dictionary) {
      for (const wordData of uniqueWords) {
        // Find which positions have blank tiles
        const blankPositions = [];
        for (let i = 0; i < wordData.positions.length; i++) {
          const pos = wordData.positions[i];
          if (tempBoard[pos.row][pos.col].isBlank) {
            blankPositions.push(i);
          }
        }

        // Check if this word (with blanks) is valid
        if (!this.isValidWordWithBlanks(wordData.word, blankPositions)) {
          invalidWords.push(wordData.word);
        }
      }
    }

    return invalidWords;
  }

  // Check if a word is valid, considering blank tiles
  isValidWordWithBlanks(word, blankPositions) {
    if (blankPositions.length === 0) {
      // No blanks, just check normally
      return this.dictionary.isValidWord(word);
    }

    // Try all combinations of letters for blank positions
    const wordArray = [...word];
    return this.tryBlankCombinations(wordArray, blankPositions, 0);
  }

  // Recursively try all letter combinations for blank positions
  tryBlankCombinations(wordArray, blankPositions, posIndex) {
    if (posIndex >= blankPositions.length) {
      // All blanks filled, check if valid
      return this.dictionary.isValidWord(wordArray.join(''));
    }

    const blankPos = blankPositions[posIndex];

    // Try each possible letter
    for (const letter of this.allLetters) {
      wordArray[blankPos] = letter;
      if (this.tryBlankCombinations([...wordArray], blankPositions, posIndex + 1)) {
        return true; // Found a valid combination
      }
    }

    return false; // No valid combination found
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

  // Read word with positions (for blank tile validation)
  readWordWithPositions(board, row, col, horizontal) {
    let word = '';
    const positions = [];

    if (horizontal) {
      // Find start and end of word
      let startCol = col;
      let endCol = col;

      while (startCol > 0 && board[row][startCol - 1].letter) startCol--;
      while (endCol < 14 && board[row][endCol + 1].letter) endCol++;

      for (let c = startCol; c <= endCol; c++) {
        word += board[row][c].letter || '';
        positions.push({row, col: c});
      }
    } else {
      // Find start and end of word
      let startRow = row;
      let endRow = row;

      while (startRow > 0 && board[startRow - 1][col].letter) startRow--;
      while (endRow < 14 && board[endRow + 1][col].letter) endRow++;

      for (let r = startRow; r <= endRow; r++) {
        word += board[r][col].letter || '';
        positions.push({row: r, col});
      }
    }

    return {word, positions};
  }

  // Calculate score for a move
  calculateScore(placements) {
    // Simplified scoring - to be fully implemented
    let score = 0;
    let wordMultiplier = 1;

    placements.forEach(p => {
      let letterScore = p.points !== undefined ? p.points : 1;
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

  // Apply endgame scoring adjustments
  applyEndgameScoring() {
    // Find player who went out (has no tiles left)
    const playerWhoWentOut = this.players.find(p => p.rack.length === 0);

    if (this.rules === 'tournament') {
      // Tournament rules (2 players only): winner gets 2x opponent's remaining tiles
      if (playerWhoWentOut && this.players.length === 2) {
        const opponent = this.players.find(p => p.id !== playerWhoWentOut.id);
        const opponentTileValue = opponent.rack.reduce((sum, tile) => sum + tile.points, 0);
        playerWhoWentOut.score += opponentTileValue * 2;
      } else {
        // If no one went out, everyone subtracts their own tiles
        this.players.forEach(player => {
          const tileValue = player.rack.reduce((sum, tile) => sum + tile.points, 0);
          player.score -= tileValue;
        });
      }
    } else {
      // Casual rules (2-4 players): standard Scrabble endgame scoring
      if (playerWhoWentOut) {
        // Player who went out gets sum of all other players' tiles
        let totalOpponentTiles = 0;
        this.players.forEach(player => {
          const tileValue = player.rack.reduce((sum, tile) => sum + tile.points, 0);
          if (player.id !== playerWhoWentOut.id) {
            totalOpponentTiles += tileValue;
            player.score -= tileValue; // Subtract from each opponent
          }
        });
        playerWhoWentOut.score += totalOpponentTiles; // Add to winner
      } else {
        // No one went out - everyone subtracts their own tiles
        this.players.forEach(player => {
          const tileValue = player.rack.reduce((sum, tile) => sum + tile.points, 0);
          player.score -= tileValue;
        });
      }
    }
  }

  // Start timer for current turn
  startTurnTimer() {
    // Always track time for all games (for count-up display when no time limit)
    // But respect pause state if timer is enabled
    if (this.status === 'active' && (!this.timerEnabled || !this.timerPaused)) {
      this.turnStartTime = Date.now();
    }
  }

  // Stop timer and add elapsed time to current player
  stopTurnTimer() {
    // Always track time for all games
    if (this.turnStartTime && (!this.timerEnabled || !this.timerPaused)) {
      const elapsed = Math.floor((Date.now() - this.turnStartTime) / 1000);
      const currentPlayer = this.players[this.currentPlayerIndex];
      if (currentPlayer) {
        currentPlayer.timeUsed += elapsed;

        // Check if player has run out of time (only if timer is enabled)
        if (this.timerEnabled && currentPlayer.timeUsed >= this.timeLimit) {
          this.endGameByTimeout();
        }
      }
      this.turnStartTime = null;
    }
  }

  // End game when a player runs out of time
  endGameByTimeout() {
    this.status = 'completed';
    this.timerPaused = true;
    this.turnStartTime = null;
    // Final scores are already calculated based on current scores
  }

  // Pause the timer (works for both timer-enabled and count-up games)
  pauseTimer() {
    this.stopTurnTimer(); // Save current elapsed time
    this.timerPaused = true;
  }

  // Resume the timer (works for both timer-enabled and count-up games)
  resumeTimer() {
    if (this.timerPaused) {
      this.timerPaused = false;
      this.startTurnTimer(); // Restart timer for current turn
    }
  }

  // Get current turn time remaining (in seconds)
  getCurrentTurnTime() {
    if (!this.timerEnabled) return null;

    const currentPlayer = this.players[this.currentPlayerIndex];
    if (!currentPlayer) return null;

    let timeUsed = currentPlayer.timeUsed;

    // Add current turn elapsed time if timer is running
    if (this.turnStartTime && !this.timerPaused) {
      const currentElapsed = Math.floor((Date.now() - this.turnStartTime) / 1000);
      timeUsed += currentElapsed;
    }

    return Math.max(0, this.timeLimit - timeUsed);
  }

  nextTurn() {
    this.stopTurnTimer(); // Stop timer for ending turn
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    this.startTurnTimer(); // Start timer for new turn
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  // Get game state for client
  getState(forPlayerId = null) {
    // Spectators have forPlayerId === null and should see all racks
    const isSpectator = forPlayerId === null;

    return {
      gameId: this.gameId,
      board: this.board,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        rackCount: p.rack.length,
        connected: p.connected,
        timeUsed: p.timeUsed || 0,
        hasLeft: p.hasLeft,
        // Send rack to the player themselves OR to spectators
        rack: (forPlayerId === p.id || isSpectator) ? p.rack : undefined
      })),
      spectators: this.spectators.map(s => ({
        id: s.id,
        name: s.name
      })),
      currentPlayerIndex: this.currentPlayerIndex,
      status: this.status,
      locked: this.locked,
      ownerId: this.ownerId,
      tilesRemaining: this.tileBag.length,
      // Game configuration
      config: {
        rackSize: this.rackSize,
        allowVoting: this.allowVoting,
        rules: this.rules,
        useCompounds: this.useCompounds,
        customTiles: this.customTiles,
        totalTiles: this.tiles ? this.tiles.reduce((sum, t) => sum + t.count, 0) : 100,
        timerEnabled: this.timerEnabled,
        timeLimit: this.timeLimit
      },
      // Timer state - always send turnStartTime for count-up display
      timer: {
        enabled: this.timerEnabled,
        paused: this.timerPaused,
        timeLimit: this.timeLimit,
        turnStartTime: this.turnStartTime
      }
    };
  }

  // Serialize for database storage
  serialize() {
    // Always save elapsed time before serializing (for all games, not just timer-enabled)
    if (this.turnStartTime && (!this.timerEnabled || !this.timerPaused)) {
      const elapsed = Math.floor((Date.now() - this.turnStartTime) / 1000);
      const currentPlayer = this.players[this.currentPlayerIndex];
      if (currentPlayer) {
        currentPlayer.timeUsed += elapsed;
      }
    }

    return JSON.stringify({
      board: this.board,
      players: this.players,
      spectators: this.spectators,
      currentPlayerIndex: this.currentPlayerIndex,
      tileBag: this.tileBag,
      status: this.status,
      locked: this.locked,
      turnsTaken: this.turnsTaken,
      ownerId: this.ownerId,
      rackSize: this.rackSize,
      allowVoting: this.allowVoting,
      rules: this.rules,
      useCompounds: this.useCompounds,
      consecutiveScorelessTurns: this.consecutiveScorelessTurns,
      customTiles: this.customTiles,
      timerEnabled: this.timerEnabled,
      timeLimit: this.timeLimit,
      timerPaused: this.timerPaused
    });
  }

  // Deserialize from database
  static deserialize(gameId, data, dictionary = null) {
    // MySQL returns JSON columns as objects, not strings
    const state = typeof data === 'string' ? JSON.parse(data) : data;

    const options = {
      rackSize: state.rackSize || 9,
      allowVoting: state.allowVoting !== undefined ? state.allowVoting : true,
      rules: state.rules || 'casual',
      useCompounds: state.useCompounds || false,
      customTiles: state.customTiles || null,
      timerEnabled: state.timerEnabled || false,
      timeLimit: state.timeLimit || 25 * 60
    };

    const game = new Game(gameId, dictionary, options);
    game.board = state.board;
    game.players = state.players || [];
    game.spectators = state.spectators || [];
    game.currentPlayerIndex = state.currentPlayerIndex || 0;
    game.tileBag = state.tileBag || [];
    game.status = state.status || 'waiting';
    game.locked = state.locked || false;
    game.turnsTaken = state.turnsTaken || 0;
    game.ownerId = state.ownerId || null;
    game.consecutiveScorelessTurns = state.consecutiveScorelessTurns || 0;
    game.timerPaused = state.timerPaused || false;
    // Don't restore turnStartTime - it will be set when game resumes
    game.loadTileInfo(); // Load tile definitions only (preserves tileBag)
    return game;
  }
}

module.exports = Game;
