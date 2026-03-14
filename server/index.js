const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const Game = require('./game');
const Dictionary = require('./dictionary');
const db = require('./db');

// Use Node's built-in UUID generator
const uuidv4 = () => crypto.randomUUID();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/shcrabble/socket.io'
});

const PORT = process.env.PORT || 3000;
const READLEX_PATH = path.join(__dirname, '../data/readlex.json');

// In-memory game storage (could move to DB for persistence)
const games = new Map();

// Initialize dictionary
const dictionary = new Dictionary();

// Serve static files from public directory
app.use('/shcrabble', express.static(path.join(__dirname, '../public')));

// Serve Socket.IO client library
app.use('/shcrabble/socket.io', express.static(path.join(__dirname, '../node_modules/socket.io/client-dist')));

// API endpoints
app.get('/shcrabble/api/health', (req, res) => {
  res.json({ status: 'ok', games: games.size });
});

// Create new game
app.get('/shcrabble/api/create', async (req, res) => {
  try {
    const gameId = uuidv4();
    const game = new Game(gameId);

    // Store in memory
    games.set(gameId, game);

    // Store in database
    await db.query(
      'INSERT INTO sessions (id, status, max_players) VALUES (?, ?, ?)',
      [gameId, 'waiting', 4]
    );

    res.json({
      gameId,
      inviteLink: `/shcrabble/?game=${gameId}`
    });
  } catch (err) {
    console.error('Error creating game:', err);
    res.status(500).json({ error: err.message });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join game
  socket.on('join-game', async ({ gameId, playerName }) => {
    try {
      let game = games.get(gameId);

      if (!game) {
        // Try to load from database
        const rows = await db.query('SELECT * FROM sessions WHERE id = ?', [gameId]);
        if (rows.length === 0) {
          socket.emit('error', { message: 'Game not found' });
          return;
        }

        if (rows[0].game_state) {
          game = Game.deserialize(gameId, rows[0].game_state);
        } else {
          game = new Game(gameId);
        }
        games.set(gameId, game);
      }

      // Check for duplicate names
      if (game.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
        socket.emit('error', { message: 'A player with that name is already in the game' });
        return;
      }

      const playerId = uuidv4();
      const player = game.addPlayer(playerId, playerName);

      // Save player to database
      await db.query(
        'INSERT INTO players (id, session_id, player_name, player_index) VALUES (?, ?, ?, ?)',
        [playerId, gameId, playerName, player.index]
      );

      // Update game state in database
      await db.query(
        'UPDATE sessions SET game_state = ?, status = ? WHERE id = ?',
        [game.serialize(), game.status, gameId]
      );

      // Join socket room
      socket.join(gameId);
      socket.data.gameId = gameId;
      socket.data.playerId = playerId;

      // Send game state to all players
      socket.emit('joined', {
        playerId,
        playerIndex: player.index,
        gameState: game.getState(playerId)
      });

      // Send personalized updates to each player
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        s.emit('game-update', {
          gameState: game.getState(s.data.playerId)
        });
      }

      console.log(`Player ${playerName} joined game ${gameId}`);
    } catch (err) {
      console.error('Error joining game:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Make a move
  socket.on('make-move', async ({ placements }) => {
    try {
      const { gameId, playerId } = socket.data;
      const game = games.get(gameId);

      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      const player = game.players.find(p => p.id === playerId);
      if (!player) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }

      // Validate and place tiles
      game.placeTiles(player.index, placements);

      // Calculate score
      const score = game.calculateScore(placements);
      player.score += score;

      // Move to next turn
      game.nextTurn();

      // Update database
      await db.query(
        'UPDATE sessions SET game_state = ?, current_turn = ? WHERE id = ?',
        [game.serialize(), game.currentPlayerIndex, gameId]
      );

      await db.query(
        'UPDATE players SET score = ? WHERE id = ?',
        [player.score, playerId]
      );

      // Notify all players with personalized game state
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        s.emit('game-update', {
          gameState: game.getState(s.data.playerId),
          lastMove: {
            playerId,
            playerName: player.name,
            score
          }
        });
      }

    } catch (err) {
      console.error('Error making move:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Validate word
  socket.on('validate-word', ({ word }) => {
    try {
      const isValid = dictionary.isValidWord(word);
      socket.emit('word-validated', { word, isValid });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Pass turn
  socket.on('pass-turn', async () => {
    try {
      const { gameId, playerId } = socket.data;
      const game = games.get(gameId);

      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      const player = game.players.find(p => p.id === playerId);
      if (!player || player.index !== game.currentPlayerIndex) {
        socket.emit('error', { message: 'Not your turn' });
        return;
      }

      game.nextTurn();

      await db.query(
        'UPDATE sessions SET game_state = ?, current_turn = ? WHERE id = ?',
        [game.serialize(), game.currentPlayerIndex, gameId]
      );

      // Notify all players with personalized game state
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        s.emit('game-update', {
          gameState: game.getState(s.data.playerId)
        });
      }

    } catch (err) {
      console.error('Error passing turn:', err);
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', async () => {
    const { gameId, playerId } = socket.data;
    console.log('Client disconnected:', socket.id);

    if (!gameId || !playerId) return;

    try {
      const game = games.get(gameId);
      if (!game) return;

      // Find and remove the player
      const playerIndex = game.players.findIndex(p => p.id === playerId);
      if (playerIndex === -1) return;

      const player = game.players[playerIndex];
      console.log(`Player ${player.name} left game ${gameId}`);

      // Remove player from game
      game.players.splice(playerIndex, 1);

      // Update player indices
      game.players.forEach((p, idx) => {
        p.index = idx;
      });

      // Adjust current player index if needed
      if (game.currentPlayerIndex >= game.players.length) {
        game.currentPlayerIndex = 0;
      }

      // If no players left, clean up the game
      if (game.players.length === 0) {
        games.delete(gameId);
        await db.query('UPDATE sessions SET status = ? WHERE id = ?', ['completed', gameId]);
        console.log(`Game ${gameId} ended - no players remaining`);
        return;
      }

      // If less than 2 players, set game back to waiting
      if (game.players.length < 2) {
        game.status = 'waiting';
      }

      // Update database
      await db.query(
        'UPDATE sessions SET game_state = ?, status = ? WHERE id = ?',
        [game.serialize(), game.status, gameId]
      );

      await db.query('DELETE FROM players WHERE id = ?', [playerId]);

      // Notify remaining players
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        s.emit('game-update', {
          gameState: game.getState(s.data.playerId)
        });
        s.emit('player-left', {
          playerName: player.name,
          playersRemaining: game.players.length
        });
      }

    } catch (err) {
      console.error('Error handling disconnect:', err);
    }
  });
});

// Initialize and start server
async function start() {
  try {
    // Test database connection
    const dbOk = await db.testConnection();
    if (!dbOk) {
      console.warn('Warning: Database connection failed. Game state will not be persisted.');
    }

    // Load dictionary
    console.log('Loading dictionary...');
    await dictionary.loadDictionary(READLEX_PATH);

    // Start server
    server.listen(PORT, () => {
      console.log(`Shcrabble server running on http://localhost:${PORT}`);
      console.log(`Game UI available at http://localhost:${PORT}/shcrabble`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
