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
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const READLEX_PATH = path.join(__dirname, '../data/readlex/readlex.json');

// In-memory game storage (could move to DB for persistence)
const games = new Map();

// In-memory pending votes for invalid words
const pendingVotes = new Map(); // voteId -> { gameId, playerId, playerName, placements, invalidWords, votes: Map(playerId -> boolean), score }

// Initialize dictionary
const dictionary = new Dictionary();

// Parse JSON bodies
app.use(express.json());

// Serve static files from public directory
app.use('/shcrabble', express.static(path.join(__dirname, '../public')));

// API endpoints
app.get('/shcrabble/api/health', (req, res) => {
  res.json({ status: 'ok', games: games.size });
});

// Get user's games
app.get('/shcrabble/api/my-games/:playerName', async (req, res) => {
  try {
    const playerName = decodeURIComponent(req.params.playerName);

    // Get all active games from memory
    const myGames = [];
    for (const [gameId, game] of games.entries()) {
      const player = game.players.find(p => p.name === playerName);
      if (player) {
        myGames.push({
          id: gameId,
          status: game.status,
          players: game.players.map(p => p.name),
          currentTurn: game.players[game.currentPlayerIndex]?.name,
          tilesRemaining: game.tileBag ? game.tileBag.length : 0
        });
      }
    }

    res.json({ games: myGames });
  } catch (err) {
    console.error('Error fetching my games:', err);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// Create new game
app.post('/shcrabble/api/create', async (req, res) => {
  try {
    const gameId = uuidv4();
    const { rackSize = 9, allowVoting = true } = req.body;

    const game = new Game(gameId, dictionary, { rackSize, allowVoting });

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
          game = Game.deserialize(gameId, rows[0].game_state, dictionary);
        } else {
          game = new Game(gameId, dictionary);
        }
        games.set(gameId, game);
      }

      // Check if this is a reconnection (by name)
      const existingPlayer = game.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());

      if (existingPlayer) {
        // Reconnect existing player with new ID
        const playerId = uuidv4();
        const player = game.reconnectPlayer(playerId, playerName);

        if (!player) {
          socket.emit('error', { message: 'Failed to reconnect' });
          return;
        }

        console.log(`Player ${playerName} reconnected with new ID ${playerId}, ownerId is ${game.ownerId}`);

        // Update player ID in database
        await db.query(
          'UPDATE players SET id = ? WHERE session_id = ? AND player_name = ?',
          [playerId, gameId, playerName]
        );

        // Update game state
        await db.query(
          'UPDATE sessions SET game_state = ? WHERE id = ?',
          [game.serialize(), gameId]
        );

        // Join socket room
        socket.join(gameId);
        socket.data.gameId = gameId;
        socket.data.playerId = playerId;
        socket.data.isSpectator = false;

        // Send rejoin confirmation
        socket.emit('joined', {
          playerId,
          playerIndex: player.index,
          gameState: game.getState(playerId),
          reconnected: true
        });

        // Notify others of reconnection
        const sockets = await io.in(gameId).fetchSockets();
        for (const s of sockets) {
          if (s.id !== socket.id) {
            s.emit('player-reconnected', {
              playerName: player.name,
              gameState: game.getState(s.data.playerId)
            });
          }
        }

        console.log(`Player ${playerName} reconnected to game ${gameId}`);
        return;
      }

      // Check if game is locked - if so, join as spectator
      if (game.locked) {
        const spectatorId = uuidv4();
        const spectator = game.addSpectator(spectatorId, playerName);

        // Save game state
        await db.query(
          'UPDATE sessions SET game_state = ? WHERE id = ?',
          [game.serialize(), gameId]
        );

        // Join socket room
        socket.join(gameId);
        socket.data.gameId = gameId;
        socket.data.playerId = spectatorId;
        socket.data.isSpectator = true;

        // Send spectator confirmation
        socket.emit('joined', {
          spectatorId,
          gameState: game.getState(null),
          isSpectator: true
        });

        // Notify others
        const sockets = await io.in(gameId).fetchSockets();
        for (const s of sockets) {
          if (s.id !== socket.id) {
            s.emit('spectator-joined', {
              spectatorName: spectator.name,
              spectators: game.spectators
            });
          }
        }

        console.log(`Spectator ${playerName} joined game ${gameId}`);
        return;
      }

      // New player joining
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
      socket.data.isSpectator = false;

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
          gameState: game.getState(s.data.playerId || null)
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

      // Validate first WITHOUT placing tiles
      const invalidWords = game.validatePlacements(placements);

      if (invalidWords.length > 0) {
        // Invalid words found
        // In single player mode or when voting is disabled, reject the move
        if (game.players.length === 1 || !game.allowVoting) {
          socket.emit('error', {
            message: `Invalid words: ${invalidWords.join(', ')}`
          });
          console.log(`Invalid words detected: ${invalidWords.join(', ')}, move rejected (single player or voting disabled)`);
          return;
        }

        // Multi-player with voting enabled - ask player if they want to put it to a vote
        const score = game.calculateScore(placements);

        socket.emit('invalid-word-prompt', {
          invalidWords,
          placements,
          score
        });

        console.log(`Invalid words detected: ${invalidWords.join(', ')}, asking player to confirm vote`);
        return;
      }

      // All words valid - place tiles and proceed
      game.placeTiles(player.index, placements);
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

      // Notify all players and spectators with personalized game state
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        s.emit('game-update', {
          gameState: game.getState(s.data.isSpectator ? null : s.data.playerId),
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

  // Player confirms they want to put invalid words to a vote
  socket.on('confirm-vote', async ({ placements, invalidWords, score }) => {
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

      // Initiate voting
      const voteId = uuidv4();

      pendingVotes.set(voteId, {
        gameId,
        playerId,
        playerName: player.name,
        placements,
        invalidWords,
        votes: new Map(),
        score
      });

      // Notify player that vote is pending
      socket.emit('vote-pending', {
        voteId,
        invalidWords,
        message: `Waiting for other players to vote on: ${invalidWords.join(', ')}`
      });

      // Ask other players to vote
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        if (s.data.playerId !== playerId && !s.data.isSpectator) {
          s.emit('vote-request', {
            voteId,
            playerName: player.name,
            invalidWords
          });
        }
      }

      console.log(`Vote ${voteId} initiated for words: ${invalidWords.join(', ')}`);

    } catch (err) {
      console.error('Error confirming vote:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Submit vote on word validity
  socket.on('submit-vote', async ({ voteId, accept }) => {
    try {
      const { gameId, playerId } = socket.data;
      const vote = pendingVotes.get(voteId);

      if (!vote || vote.gameId !== gameId) {
        socket.emit('error', { message: 'Vote not found' });
        return;
      }

      // Record vote
      vote.votes.set(playerId, accept);

      const game = games.get(gameId);
      const otherPlayers = game.players.filter(p => p.id !== vote.playerId);
      const allVoted = otherPlayers.every(p => vote.votes.has(p.id));

      console.log(`Vote received: ${accept ? 'accept' : 'reject'} from ${playerId}, ${vote.votes.size}/${otherPlayers.length} votes`);

      if (allVoted) {
        // Tally votes - accept if at least one player voted yes
        const acceptVotes = Array.from(vote.votes.values()).filter(v => v).length;
        const accepted = acceptVotes > 0;

        console.log(`Vote complete: ${acceptVotes} accept votes, ${accepted ? 'ACCEPTED' : 'REJECTED'}`);

        if (accepted) {
          // Apply the move
          const player = game.players.find(p => p.id === vote.playerId);
          player.score += vote.score;
          game.nextTurn();

          // Update database
          await db.query(
            'UPDATE sessions SET game_state = ?, current_turn = ? WHERE id = ?',
            [game.serialize(), game.currentPlayerIndex, gameId]
          );

          await db.query(
            'UPDATE players SET score = ? WHERE id = ?',
            [player.score, vote.playerId]
          );

          // Notify all players
          const sockets = await io.in(gameId).fetchSockets();
          for (const s of sockets) {
            s.emit('vote-result', {
              voteId,
              accepted: true,
              message: `Move accepted by vote (${vote.invalidWords.join(', ')})`
            });

            s.emit('game-update', {
              gameState: game.getState(s.data.isSpectator ? null : s.data.playerId),
              lastMove: {
                playerId: vote.playerId,
                playerName: vote.playerName,
                score: vote.score
              }
            });
          }
        } else {
          // Reject the move - undo placement
          const player = game.players.find(p => p.id === vote.playerId);

          // Return tiles to rack
          vote.placements.forEach(p => {
            const idx = player.rack.findIndex(t =>
              (t.isBlank && p.isBlank) || (!t.isBlank && t.letter === p.letter)
            );
            // Tiles were already removed, need to add them back
            player.rack.push({
              letter: p.letter,
              points: p.points,
              isBlank: p.isBlank
            });
          });

          // Notify all players
          const sockets = await io.in(gameId).fetchSockets();
          for (const s of sockets) {
            s.emit('vote-result', {
              voteId,
              accepted: false,
              message: `Move rejected by vote (${vote.invalidWords.join(', ')})`
            });

            // Send updated game state with tiles back in rack
            s.emit('game-update', {
              gameState: game.getState(s.data.isSpectator ? null : s.data.playerId)
            });
          }
        }

        pendingVotes.delete(voteId);
      }

    } catch (err) {
      console.error('Error processing vote:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Validate word
  socket.on('validate-word', ({ word }) => {
    try {
      console.log(`Validating word: "${word}" (${word.length} chars)`);
      const isValid = dictionary.isValidWord(word);
      console.log(`  Result: ${isValid}`);
      socket.emit('word-validated', { word, isValid });
    } catch (err) {
      console.error('Validation error:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Exchange tiles
  socket.on('exchange-tiles', async ({ indices }) => {
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

      // Validate enough tiles in bag
      if (game.tileBag.length < 7) {
        socket.emit('error', { message: 'Not enough tiles in bag to exchange' });
        return;
      }

      // Exchange tiles
      game.exchangeTiles(player.index, indices);

      // Move to next turn
      game.nextTurn();

      // Update database
      await db.query(
        'UPDATE sessions SET game_state = ?, current_turn = ? WHERE id = ?',
        [game.serialize(), game.currentPlayerIndex, gameId]
      );

      // Notify all players with personalized game state
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        s.emit('game-update', {
          gameState: game.getState(s.data.isSpectator ? null : s.data.playerId)
        });
      }

      console.log(`Player ${player.name} exchanged ${indices.length} tiles`);

    } catch (err) {
      console.error('Error exchanging tiles:', err);
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

  // Owner: Remove player
  socket.on('remove-player', async ({ targetPlayerId }) => {
    try {
      const { gameId, playerId } = socket.data;
      const game = games.get(gameId);

      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      // Check if requester is the owner
      if (game.ownerId !== playerId) {
        socket.emit('error', { message: 'Only the game owner can remove players' });
        return;
      }

      // Remove the player
      const removedPlayer = game.removePlayer(targetPlayerId);

      if (!removedPlayer) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }

      // Delete from database
      await db.query('DELETE FROM players WHERE id = ?', [targetPlayerId]);

      // Update game state
      await db.query(
        'UPDATE sessions SET game_state = ?, status = ? WHERE id = ?',
        [game.serialize(), game.status, gameId]
      );

      // Notify all participants
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        if (s.data.playerId === targetPlayerId) {
          s.emit('removed-from-game', {
            message: 'You have been removed from the game by the owner'
          });
          s.leave(gameId);
        } else {
          s.emit('player-removed', {
            playerName: removedPlayer.name,
            gameState: game.getState(s.data.playerId || null)
          });
        }
      }

      console.log(`Player ${removedPlayer.name} removed from game ${gameId} by owner`);

    } catch (err) {
      console.error('Error removing player:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Owner: End game
  socket.on('end-game', async () => {
    try {
      const { gameId, playerId } = socket.data;
      const game = games.get(gameId);

      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      // Check if requester is the owner
      if (game.ownerId !== playerId) {
        socket.emit('error', { message: 'Only the game owner can end the game' });
        return;
      }

      // Calculate final scores
      const finalScores = game.players.map(p => ({
        name: p.name,
        score: p.score
      })).sort((a, b) => b.score - a.score);

      // Notify all participants before deleting
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        s.emit('game-ended', {
          finalScores
        });
      }

      // Delete game from database
      await db.query('DELETE FROM sessions WHERE id = ?', [gameId]);

      // Remove from memory
      games.delete(gameId);

      console.log(`Game ${gameId} ended by owner and deleted`);

    } catch (err) {
      console.error('Error ending game:', err);
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', async () => {
    const { gameId, playerId, isSpectator } = socket.data;
    console.log('Client disconnected:', socket.id);

    if (!gameId) return;

    try {
      let game = games.get(gameId);

      // Try to load from DB if not in memory
      if (!game) {
        const rows = await db.query('SELECT game_state FROM sessions WHERE id = ?', [gameId]);
        if (rows && rows.length > 0 && rows[0].game_state) {
          game = Game.deserialize(gameId, rows[0].game_state, dictionary);
          games.set(gameId, game);
        }
      }

      if (!game) return;

      if (isSpectator) {
        // Remove spectator
        const spectator = game.removeSpectator(playerId);
        if (spectator) {
          console.log(`Spectator ${spectator.name} left game ${gameId}`);

          // Notify remaining participants
          const sockets = await io.in(gameId).fetchSockets();
          for (const s of sockets) {
            s.emit('spectator-left', {
              spectatorName: spectator.name,
              spectators: game.spectators
            });
          }
        }
      } else {
        // Mark player as disconnected
        const disconnected = game.disconnectPlayer(playerId);
        if (disconnected) {
          const player = game.players.find(p => p.id === playerId);
          console.log(`Player ${player.name} disconnected from game ${gameId}`);

          // Notify remaining participants
          const sockets = await io.in(gameId).fetchSockets();
          for (const s of sockets) {
            s.emit('player-disconnected', {
              playerName: player.name,
              gameState: game.getState(s.data.playerId)
            });
          }
        }
      }

      // Check if all players are disconnected
      const allDisconnected = game.players.every(p => !p.connected);
      if (allDisconnected && game.players.length > 0) {
        // All players disconnected - remove from memory but keep in DB
        games.delete(gameId);
        console.log(`Game ${gameId} removed from memory - all players disconnected`);
      }

      // Save game state to database
      await db.query(
        'UPDATE sessions SET game_state = ?, status = ? WHERE id = ?',
        [game.serialize(), game.status, gameId]
      );

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
