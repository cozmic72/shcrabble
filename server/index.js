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

// Validate username - letters, numbers, spaces, and safe punctuation
function validateUsername(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.trim().length === 0 || name.length > 20) return false;
  // Allow letters (any script), numbers, spaces, hyphens, @, !, ?, |, /, and namer dot (·)
  // Disallow quotes and other potentially dangerous chars
  return /^[\p{L}\p{N}\s\-@!?|/·]+$/u.test(name);
}

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

// Get all games (admin view)
app.get('/shcrabble/api/all-games', async (req, res) => {
  try {
    const allGames = [];
    const seenGameIds = new Set();

    // First, get all active games from memory
    for (const [gameId, game] of games.entries()) {
      seenGameIds.add(gameId);
      allGames.push({
        id: gameId,
        status: game.status,
        players: game.players.map(p => p.name),
        currentTurn: game.players[game.currentPlayerIndex]?.name,
        tilesRemaining: game.tileBag ? game.tileBag.length : 0,
        isActive: true
      });
    }

    // Then, get all games from database
    const dbRows = await db.query('SELECT id, game_state, status FROM sessions WHERE status != ?', ['completed']);
    for (const row of dbRows) {
      if (seenGameIds.has(row.id)) continue; // Already got this one from memory

      try {
        // Skip if game_state is null
        if (!row.game_state) {
          console.log(`Skipping game ${row.id} in all-games - null game state`);
          continue;
        }

        const gameState = typeof row.game_state === 'string'
          ? JSON.parse(row.game_state)
          : row.game_state;

        allGames.push({
          id: row.id,
          status: row.status,
          players: gameState.players ? gameState.players.map(p => p.name) : [],
          currentTurn: gameState.players ? gameState.players[gameState.currentPlayerIndex]?.name : null,
          tilesRemaining: gameState.tileBag ? gameState.tileBag.length : 0,
          isActive: false
        });
      } catch (e) {
        console.error(`Error parsing game state for ${row.id}:`, e);
      }
    }

    res.json({ games: allGames });
  } catch (err) {
    console.error('Error fetching all games:', err);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// Get user's games
app.get('/shcrabble/api/my-games/:userId', async (req, res) => {
  try {
    const userId = decodeURIComponent(req.params.userId);
    const playerName = req.query.playerName; // For backwards compatibility with old games
    const myGames = [];
    const seenGameIds = new Set();

    // First, get all active games from memory
    for (const [gameId, game] of games.entries()) {
      let player = null;

      // Check if any player has userId (new games)
      const hasUserId = game.players.some(p => p.userId);

      if (hasUserId) {
        // New game with userId - match by userId
        player = game.players.find(p => p.userId === userId);
      } else if (playerName) {
        // Old game without userId - fall back to name matching
        player = game.players.find(p => p.name === playerName);
      }

      if (player) {
        seenGameIds.add(gameId);
        myGames.push({
          id: gameId,
          status: game.status,
          players: game.players.map(p => p.name),
          currentTurn: game.players[game.currentPlayerIndex]?.name,
          tilesRemaining: game.tileBag ? game.tileBag.length : 0,
          isActive: true
        });
      }
    }

    // Then, check database for games not in memory (all players disconnected)
    const dbRows = await db.query('SELECT id, game_state, status FROM sessions WHERE status != ?', ['completed']);
    for (const row of dbRows) {
      if (seenGameIds.has(row.id)) continue; // Already got this one from memory

      try {
        // Skip if game_state is null
        if (!row.game_state) {
          console.log(`Skipping game ${row.id} - null game state`);
          continue;
        }

        // Check if this game has the player
        // game_state might already be parsed by mysql2 driver
        const gameState = typeof row.game_state === 'string'
          ? JSON.parse(row.game_state)
          : row.game_state;

        let hasPlayer = false;

        // Check if any player has userId (new games)
        const hasUserId = gameState.players && gameState.players.some(p => p.userId);

        if (hasUserId) {
          // New game with userId - match by userId
          hasPlayer = gameState.players.some(p => p.userId === userId);
        } else if (playerName && gameState.players) {
          // Old game without userId - fall back to name matching
          hasPlayer = gameState.players.some(p => p.name === playerName);
        }

        if (hasPlayer) {
          myGames.push({
            id: row.id,
            status: row.status,
            players: gameState.players.map(p => p.name),
            currentTurn: gameState.players[gameState.currentPlayerIndex]?.name,
            tilesRemaining: gameState.tileBag ? gameState.tileBag.length : 0,
            isActive: false // No one connected
          });
        }
      } catch (e) {
        console.error(`Error parsing game state for ${row.id}:`, e);
      }
    }

    res.json({ games: myGames });
  } catch (err) {
    console.error('Error fetching my games:', err);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// Check if user is already a player in a game
app.get('/shcrabble/api/check-player', async (req, res) => {
  try {
    const { gameId, userId } = req.query;

    if (!gameId || !userId) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Check in-memory game first
    const game = games.get(gameId);
    if (game) {
      const isPlayer = game.players.some(p => p.userId === userId || p.name === req.query.playerName);
      return res.json({ isPlayer });
    }

    // Check database
    const rows = await db.query('SELECT game_state FROM sessions WHERE id = ?', [gameId]);
    if (rows.length === 0) {
      return res.json({ isPlayer: false });
    }

    const gameState = typeof rows[0].game_state === 'string'
      ? JSON.parse(rows[0].game_state)
      : rows[0].game_state;

    const isPlayer = gameState.players && gameState.players.some(p => p.userId === userId);
    res.json({ isPlayer });
  } catch (err) {
    console.error('Error checking player:', err);
    res.status(500).json({ error: 'Failed to check player' });
  }
});

// Delete multiple games (admin)
app.post('/shcrabble/api/delete-games', async (req, res) => {
  try {
    const { gameIds } = req.body;

    if (!gameIds || !Array.isArray(gameIds) || gameIds.length === 0) {
      return res.status(400).json({ error: 'Invalid game IDs' });
    }

    let deletedCount = 0;

    for (const gameId of gameIds) {
      // Remove from memory if exists
      const game = games.get(gameId);
      if (game) {
        // Notify all connected players
        const sockets = await io.in(gameId).fetchSockets();
        for (const s of sockets) {
          s.emit('game-deleted', { message: 'This game has been deleted by an administrator' });
          s.leave(gameId);
        }
        games.delete(gameId);
      }

      // Delete from database
      await db.query('DELETE FROM sessions WHERE id = ?', [gameId]);
      deletedCount++;
    }

    res.json({ deleted: deletedCount });
  } catch (err) {
    console.error('Error deleting games:', err);
    res.status(500).json({ error: 'Failed to delete games' });
  }
});

// Get game info (for join dialog)
app.get('/shcrabble/api/game-info/:gameId', async (req, res) => {
  try {
    const gameId = req.params.gameId;

    // Check memory first
    let game = games.get(gameId);

    // If not in memory, try database
    if (!game) {
      const rows = await db.query('SELECT game_state FROM sessions WHERE id = ?', [gameId]);
      if (rows.length === 0 || !rows[0].game_state) {
        return res.status(404).json({ error: 'Game not found' });
      }

      game = Game.deserialize(gameId, rows[0].game_state, dictionary);
    }

    // Return game configuration
    res.json({
      config: {
        rackSize: game.rackSize,
        allowVoting: game.allowVoting,
        rules: game.rules,
        customTiles: game.customTiles,
        totalTiles: game.tiles ? game.tiles.reduce((sum, t) => sum + t.count, 0) : 100
      },
      playerCount: game.players.length,
      status: game.status
    });
  } catch (err) {
    console.error('Error fetching game info:', err);
    res.status(500).json({ error: 'Failed to fetch game info' });
  }
});

// Create new game
app.post('/shcrabble/api/create', async (req, res) => {
  try {
    const gameId = uuidv4();
    const { rackSize = 9, allowVoting = true, rules = 'casual', customTiles = null } = req.body;

    const game = new Game(gameId, dictionary, { rackSize, allowVoting, rules, customTiles });

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
  socket.on('join-game', async ({ gameId, playerName, userId, asSpectator = false }) => {
    try {
      // Validate username
      if (!validateUsername(playerName)) {
        socket.emit('error', { message: 'Invalid username. Use only letters, numbers, spaces, and basic punctuation (max 20 chars)' });
        return;
      }

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

      // Check if this is a reconnection (by name) - check both players and spectators
      const existingPlayer = game.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
      const existingSpectator = game.spectators.find(s => s.name.toLowerCase() === playerName.toLowerCase());

      if (existingPlayer) {
        // Check if player has left - prevent rejoin
        if (existingPlayer.hasLeft) {
          socket.emit('error', { message: 'You have left this game and cannot rejoin. Your score will remain in the game.' });
          return;
        }

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

      if (existingSpectator) {
        // Reconnect existing spectator with new ID
        const spectatorId = uuidv4();

        // Update spectator ID in the game state
        existingSpectator.id = spectatorId;

        // Update game state
        await db.query(
          'UPDATE sessions SET game_state = ? WHERE id = ?',
          [game.serialize(), gameId]
        );

        // Join socket room
        socket.join(gameId);
        socket.data.gameId = gameId;
        socket.data.playerId = spectatorId;
        socket.data.isSpectator = true;

        // Send reconnection confirmation
        socket.emit('joined', {
          playerId: spectatorId,
          playerIndex: null,
          gameState: game.getState(null),
          isSpectator: true,
          reconnected: true
        });

        console.log(`Spectator ${playerName} reconnected to game ${gameId}`);
        return;
      }

      // Check if user wants to join as spectator or if game is locked
      if (asSpectator || game.locked) {
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
          playerId: spectatorId,
          playerIndex: null,
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
      const player = game.addPlayer(playerId, playerName, userId);

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

      // Reset consecutive scoreless turns (successful scoring move)
      game.consecutiveScorelessTurns = 0;

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

      // Check if game should end (player used all tiles and bag is empty)
      const playerWentOut = player.rack.length === 0;
      const bagEmpty = game.tileBag.length === 0;

      if (playerWentOut && bagEmpty) {
        // Game is over - apply endgame scoring
        game.applyEndgameScoring();
        game.status = 'completed';

        const finalScores = game.players.map(p => ({
          name: p.name,
          score: p.score
        })).sort((a, b) => b.score - a.score);

        // Notify all participants
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

        console.log(`Game ${gameId} ended automatically (player went out)`);
      } else {
        // Game continues - notify all players and spectators with personalized game state
        const sockets = await io.in(gameId).fetchSockets();
        for (const s of sockets) {
          s.emit('game-update', {
            gameState: game.getState(s.data.isSpectator ? null : s.data.playerId),
            lastMove: {
              playerId,
              playerName: player.name,
              score,
              placements
            }
          });
        }
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

      const otherPlayers = game.players.filter(p => p.id !== playerId);
      const totalVoters = otherPlayers.length + game.spectators.length;

      // Notify player that vote is pending
      socket.emit('vote-pending', {
        voteId,
        invalidWords,
        totalVoters,
        message: `Waiting for other players to vote on: ${invalidWords.join(', ')}`
      });

      // Ask other players and spectators to vote
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        // Send to all players except the one who made the move, and all spectators
        if (s.data.playerId !== playerId) {
          s.emit('vote-request', {
            voteId,
            playerName: player.name,
            invalidWords
          });
        }
      }

      console.log(`Vote ${voteId} initiated for words: ${invalidWords.join(', ')}, ${totalVoters} voters`);

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

      // Count total eligible voters (other players + spectators)
      const totalVoters = otherPlayers.length + game.spectators.length;
      const votesReceived = vote.votes.size;
      const acceptVotes = Array.from(vote.votes.values()).filter(v => v).length;
      const rejectVotes = votesReceived - acceptVotes;

      console.log(`Vote received: ${accept ? 'accept' : 'reject'} from ${playerId}, ${votesReceived}/${totalVoters} votes (${acceptVotes} accept, ${rejectVotes} reject)`);

      // Send progress update to everyone in the game
      const allSockets = await io.in(gameId).fetchSockets();
      for (const s of allSockets) {
        s.emit('vote-progress', {
          voteId: vote.voteId,
          votesReceived,
          totalVoters,
          acceptVotes,
          rejectVotes
        });
      }

      // Check if we have a majority decision (early termination)
      const majorityNeeded = Math.floor(totalVoters / 2) + 1;
      const hasAcceptMajority = acceptVotes >= majorityNeeded;
      const hasRejectMajority = rejectVotes >= majorityNeeded;
      const allVoted = votesReceived >= totalVoters;

      if (allVoted || hasAcceptMajority || hasRejectMajority) {
        // Tally votes - accept if majority voted yes (>50%)
        const accepted = acceptVotes > (totalVoters / 2);

        console.log(`Vote complete: ${acceptVotes} accept votes, ${accepted ? 'ACCEPTED' : 'REJECTED'}`);

        if (accepted) {
          // Apply the move
          const player = game.players.find(p => p.id === vote.playerId);

          // Place the tiles on the board
          game.placeTiles(player.index, vote.placements);

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

          // Check if game should end (player used all tiles and bag is empty)
          const playerWentOut = player.rack.length === 0;
          const bagEmpty = game.tileBag.length === 0;

          if (playerWentOut && bagEmpty) {
            // Game is over - apply endgame scoring
            game.applyEndgameScoring();
            game.status = 'completed';

            const finalScores = game.players.map(p => ({
              name: p.name,
              score: p.score
            })).sort((a, b) => b.score - a.score);

            // Notify all participants
            const sockets = await io.in(gameId).fetchSockets();
            for (const s of sockets) {
              s.emit('vote-result', {
                voteId,
                accepted: true,
                message: `Move accepted by vote (${vote.invalidWords.join(', ')})`
              });

              s.emit('game-ended', {
                finalScores
              });
            }

            // Delete game from database
            await db.query('DELETE FROM sessions WHERE id = ?', [gameId]);

            // Remove from memory
            games.delete(gameId);

            console.log(`Game ${gameId} ended automatically after vote (player went out)`);
          } else {
            // Game continues - notify all players
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
                  score: vote.score,
                  placements: vote.placements
                }
              });
            }
          }
        } else {
          // Reject the move
          // Note: Tiles were never placed on the board or removed from rack,
          // so we don't need to do anything to the game state.
          // The tiles are still in the player's rack.

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

  // Cancel vote
  socket.on('cancel-vote', async ({ voteId }) => {
    try {
      const { gameId, playerId } = socket.data;
      const vote = pendingVotes.get(voteId);

      if (!vote || vote.gameId !== gameId) {
        socket.emit('error', { message: 'Vote not found' });
        return;
      }

      // Only the player who initiated the vote can cancel it
      if (vote.playerId !== playerId) {
        socket.emit('error', { message: 'Only the player who submitted can cancel the vote' });
        return;
      }

      console.log(`Vote ${voteId} cancelled by ${playerId}`);

      // Notify all players that vote was cancelled
      const sockets = await io.in(gameId).fetchSockets();
      for (const s of sockets) {
        s.emit('vote-result', {
          voteId,
          accepted: false,
          cancelled: true,
          message: `Vote cancelled by player`
        });

        // Send updated game state
        const game = games.get(gameId);
        s.emit('game-update', {
          gameState: game.getState(s.data.isSpectator ? null : s.data.playerId)
        });
      }

      pendingVotes.delete(voteId);

    } catch (err) {
      console.error('Error cancelling vote:', err);
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

      // Increment consecutive scoreless turns
      game.consecutiveScorelessTurns++;

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

      // Check for six consecutive scoreless turns
      if (game.consecutiveScorelessTurns >= 6) {
        // Notify owner to decide if game should end
        const ownerSocket = sockets.find(s => s.data.playerId === game.ownerId);
        if (ownerSocket) {
          ownerSocket.emit('suggest-end-game', {
            reason: 'six-consecutive-scoreless-turns'
          });
        }
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

      // Increment consecutive scoreless turns
      game.consecutiveScorelessTurns++;

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

      // Check for six consecutive scoreless turns
      if (game.consecutiveScorelessTurns >= 6) {
        // Notify owner to decide if game should end
        const ownerSocket = sockets.find(s => s.data.playerId === game.ownerId);
        if (ownerSocket) {
          ownerSocket.emit('suggest-end-game', {
            reason: 'six-consecutive-scoreless-turns'
          });
        }
      }

    } catch (err) {
      console.error('Error passing turn:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Owner: Remove player
  socket.on('remove-player', async ({ targetPlayerId, isAdmin = false }) => {
    try {
      const { gameId, playerId } = socket.data;
      const game = games.get(gameId);

      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      const isLeavingSelf = targetPlayerId === playerId;

      // If player is leaving themselves, mark as left (keep in game for scoring)
      if (isLeavingSelf) {
        const result = game.markPlayerAsLeft(targetPlayerId);

        if (!result) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        const { player: leftPlayer, wasOwner, newOwner, needsSkip } = result;

        // Update game state in database
        await db.query(
          'UPDATE sessions SET game_state = ?, status = ? WHERE id = ?',
          [game.serialize(), game.status, gameId]
        );

        // Notify all participants
        const sockets = await io.in(gameId).fetchSockets();
        for (const s of sockets) {
          if (s.data.playerId === targetPlayerId) {
            s.emit('left-game', {
              message: 'You have left the game. Your score will remain but you cannot rejoin.'
            });
            s.leave(gameId);
          } else {
            s.emit('player-left', {
              playerName: leftPlayer.name,
              gameState: game.getState(s.data.playerId || null)
            });

            // Notify about ownership transfer
            if (wasOwner && newOwner) {
              s.emit('ownership-transferred', {
                newOwnerName: newOwner.name,
                newOwnerId: newOwner.id
              });
            }
          }
        }

        console.log(`Player ${leftPlayer.name} left game ${gameId}`);

      } else {
        // Owner removing another player - remove completely
        // Check if requester is the owner or admin
        if (!isAdmin && game.ownerId !== playerId) {
          socket.emit('error', { message: 'Only the game owner can remove players' });
          return;
        }

        // Remove the player
        const result = game.removePlayer(targetPlayerId);

        if (!result) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        const { player: removedPlayer, wasOwner, newOwner } = result;

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

            // Notify about ownership transfer
            if (wasOwner && newOwner) {
              s.emit('ownership-transferred', {
                newOwnerName: newOwner.name,
                newOwnerId: newOwner.id
              });
            }
          }
        }

        console.log(`Player ${removedPlayer.name} removed from game ${gameId} by owner`);
      }

    } catch (err) {
      console.error('Error removing player:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Owner: End game
  socket.on('end-game', async ({ isAdmin = false } = {}) => {
    try {
      const { gameId, playerId } = socket.data;
      const game = games.get(gameId);

      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      // Check if requester is the owner or admin
      if (!isAdmin && game.ownerId !== playerId) {
        socket.emit('error', { message: 'Only the game owner can end the game' });
        return;
      }

      // Apply endgame scoring adjustments
      game.applyEndgameScoring();

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
