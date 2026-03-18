// Game client state
let socket = null;
let gameState = null;
let playerId = null;
let playerIndex = null;
let timerUpdateInterval = null;
let isReconnection = false;
let currentPlacements = [];
let draggedTile = null;
let draggedFromRack = false;
let rackDragSource = null;
let previousRackSize = 0;
let previousRackState = []; // Track previous rack for animation
let isRecalling = false; // Flag to prevent slide-in animation during recall
let exchangeMode = false;
let tilesToExchange = [];
let currentVoteId = null;
let pendingGameCreatedDialog = false; // Flag to show game-created dialog after welcome
let tutorialPage = 1;
let pendingBlankPlacement = null; // Stores pending blank tile placement data
let lastPlacementPosition = null; // Track last tile placement for double-click continuation
let boardCursor = { row: 7, col: 7 }; // Keyboard cursor position on board
let selectedRackIndex = null; // Index into player's rack for keyboard selection
let lastMovePlacements = []; // Track placements from last move for highlighting
let highlightFadeTimeout = null; // Timeout for fading highlight
let watchedPlayerId = null; // For spectators: which player's rack to display
const opponentPreviews = new Map(); // playerIndex -> [{row, col, letter}]

// Touch support for mobile
let touchDraggedElement = null;
let touchClone = null;
let touchStartPos = { x: 0, y: 0 };
let touchStartTime = 0;
let touchHasMoved = false;
let touchCurrentTarget = null;

// Pinch zoom support for board
let boardScale = 1;
let boardTranslateX = 0;
let boardTranslateY = 0;
let pinchStartDistance = 0;
let pinchStartScale = 1;
let pinchStartX = 0;
let pinchStartY = 0;
let pinchStartTranslateX = 0;
let pinchStartTranslateY = 0;
let isPinching = false;

// All Shavian letters for blank tile selection
// First 40 letters in Unicode order (4 rows of 10)
const SHAVIAN_LETTERS = [
  '𐑐', '𐑑', '𐑒', '𐑓', '𐑔', '𐑕', '𐑖', '𐑗', '𐑘', '𐑙',
  '𐑚', '𐑛', '𐑜', '𐑝', '𐑟', '𐑠', '𐑡', '𐑢', '𐑣', '𐑤',
  '𐑥', '𐑦', '𐑧', '𐑨', '𐑩', '𐑪', '𐑫', '𐑬', '𐑭', '𐑮',
  '𐑯', '𐑰', '𐑱', '𐑲', '𐑳', '𐑴', '𐑵', '𐑶', '𐑷', '𐑸',
  // Compounds on separate row
  '𐑹', '𐑺'
];

// Turn notification visual flash
function startTurnNotification() {
  const gameScreen = document.getElementById('game-screen');
  if (gameScreen) {
    gameScreen.classList.add('your-turn');
  }
}

function stopTurnNotification() {
  const gameScreen = document.getElementById('game-screen');
  if (gameScreen) {
    gameScreen.classList.remove('your-turn');
  }
}

// Save user preferences
function saveUserName(name) {
  localStorage.setItem('shcrabble-userName', name);
}

function getUserName() {
  return localStorage.getItem('shcrabble-userName') || '';
}

// Get or create a unique user ID
function getUserId() {
  let userId = localStorage.getItem('shcrabble-userId');
  if (!userId) {
    // Generate a new UUID
    userId = crypto.randomUUID();
    localStorage.setItem('shcrabble-userId', userId);
  }
  return userId;
}

// Validate username - allow letters (Unicode), numbers, spaces, hyphens
function validateUsername(name) {
  // Allow: letters (any script including Shavian), numbers, spaces, hyphens
  // Disallow: special chars that could be used for injection
  const validPattern = /^[\p{L}\p{N}\s-]+$/u;

  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Name cannot be empty' };
  }

  if (name.length > 20) {
    return { valid: false, error: 'Name must be 20 characters or less' };
  }

  if (!validPattern.test(name)) {
    return { valid: false, error: 'Name can only contain letters, numbers, spaces, and hyphens' };
  }

  return { valid: true };
}

// Debug function: Show owner info and help become owner
window.becomeOwner = function() {
  if (!gameState) {
    console.log('Not in a game');
    return;
  }

  const owner = gameState.players.find(p => p.id === gameState.ownerId);
  console.log('Current owner:', owner ? owner.name : 'Unknown');
  console.log('Your name:', gameState.players.find(p => p.id === playerId)?.name);

  if (!owner) {
    console.log('No owner found');
    return;
  }

  console.log(`To become owner, save the owner's name and reload:`);
  console.log(`localStorage.setItem('shcrabble-userName', '${owner.name}')`);
  console.log(`window.location.reload()`);
  console.log('\nOr run: becomeOwner(true) to do it automatically');

  if (arguments[0] === true) {
    localStorage.setItem('shcrabble-userName', owner.name);
    window.location.reload();
  }
}

// Debug function: Add specific tiles to your rack
// NOTE: This only modifies client-side state for UI testing
// The server won't have these tiles, so moves will be rejected
window.addTile = function(letter, isBlank = false) {
  if (!gameState) {
    console.log('Not in a game');
    return;
  }

  const myPlayer = gameState.players.find(p => p.id === playerId);
  if (!myPlayer) {
    console.log('Player not found');
    return;
  }

  const tile = {
    letter: isBlank ? '' : letter,
    points: isBlank ? 0 : 1, // Default to 1, you can specify if needed
    isBlank: isBlank
  };

  myPlayer.rack.push(tile);
  updateRack();
  console.log(`Added tile: ${isBlank ? '?' : letter}`);
  console.log('⚠️  CLIENT-ONLY: Server won\'t recognize this tile');
}

// Debug function: Add multiple tiles at once
window.addTiles = function(letters) {
  if (!gameState) {
    console.log('Not in a game');
    return;
  }

  const myPlayer = gameState.players.find(p => p.id === playerId);
  if (!myPlayer) {
    console.log('Player not found');
    return;
  }

  const letterArray = typeof letters === 'string' ? [...letters] : letters;

  letterArray.forEach(letter => {
    if (letter === '?') {
      addTile('', true);
    } else {
      addTile(letter);
    }
  });

  console.log(`Added ${letterArray.length} tiles`);
}

// Debug function: Clear your rack
window.clearRack = function() {
  if (!gameState) {
    console.log('Not in a game');
    return;
  }

  const myPlayer = gameState.players.find(p => p.id === playerId);
  if (!myPlayer) {
    console.log('Player not found');
    return;
  }

  myPlayer.rack = [];
  updateRack();
  console.log('Rack cleared');
}

// Initialize socket connection
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('[SOCKET] Connected to server');
  });

  // Debug: log all incoming events
  socket.onAny((eventName, ...args) => {
    console.log(`[SOCKET-EVENT] ${eventName}:`, ...args);
  });

  socket.on('joined', (data) => {
    playerId = data.playerId;
    playerIndex = data.playerIndex;
    gameState = data.gameState;

    // Always show game screen when joined
    showGameScreen();

    updateGameUI();
    startTimerUpdates();

    // Check if this player is the game owner
    const isOwner = playerId === gameState.ownerId;

    // If this is the game owner, populate and potentially show the game-created dialog
    if (isOwner && gameState.config) {
      const config = gameState.config;
      populateGameConfigSummary(
        config.rackSize,
        config.allowVoting,
        config.rules,
        config.customTiles
      );

      // Update invite link
      const inviteLink = window.location.origin + `/shcrabble/?game=${gameState.gameId}`;
      document.getElementById('invite-link').value = inviteLink;
    }

    // Show welcome dialog on first visit
    const hideWelcome = localStorage.getItem('shcrabble-hide-welcome-1.2');
    isReconnection = data.reconnected || false;

    if (!hideWelcome) {
      document.getElementById('welcome-content').innerHTML = i18n.getWelcome();
      tutorialPage = 1;
      document.getElementById('welcome-dialog').style.display = 'flex';
      setTimeout(updateTutorialPage, 0);
    } else if (isOwner && !isReconnection) {
      // Only show game-created dialog for owner when first creating, not when reconnecting
      document.getElementById('game-created-dialog').style.display = 'flex';
      pendingGameCreatedDialog = false;
    }

    // If still in lobby, show waiting message
    if (gameState.status === 'waiting') {
      showMessage(i18n.t('msgWaitingPlayers', { count: gameState.players.length }), '');
    }
  });

  socket.on('game-update', (data) => {
    console.log('[GAME-UPDATE]', data);

    // Preserve local rack order before updating game state
    const myPlayer = gameState?.players?.find(p => p.id === playerId);
    const previousRackOrder = myPlayer?.rack ? [...myPlayer.rack] : null;
    const previousTurnIndex = gameState?.currentPlayerIndex;

    gameState = data.gameState;

    // Clear opponent previews when game state updates (move was applied)
    opponentPreviews.clear();

    // Restart timer updates if timer config changed
    startTimerUpdates();

    // Restore local rack order if the rack contents haven't changed
    if (previousRackOrder) {
      const newPlayer = gameState.players.find(p => p.id === playerId);
      if (newPlayer && newPlayer.rack) {
        // Check if rack has same tiles (might be in different order from server)
        const sameContents = previousRackOrder.length === newPlayer.rack.length &&
          previousRackOrder.every(tile =>
            newPlayer.rack.some(t => t.letter === tile.letter && t.points === tile.points && t.isBlank === tile.isBlank)
          );

        if (sameContents) {
          // Rack hasn't changed, restore local order
          newPlayer.rack = previousRackOrder;
        }
      }
    }

    // Switch to game screen when game becomes active
    if (gameState.status === 'active' && document.getElementById('lobby-screen').style.display !== 'none') {
      showGameScreen();
    }

    // If this was our move (lastMove.playerId matches), clear placements
    if (data.lastMove && data.lastMove.playerId === playerId) {
      console.log('[GAME-UPDATE] Clearing our placements after successful move');
      currentPlacements = [];
    }

    updateGameUI();

    // Play turn change sound if turn changed
    if (previousTurnIndex !== undefined && previousTurnIndex !== gameState.currentPlayerIndex) {
      if (gameState.currentPlayerIndex === playerIndex) {
        // It's now our turn - convert ghost placements to real
        handleGhostToRealConversion();
        if (window.sounds) sounds.yourTurn();
        // Start visual notification
        startTurnNotification();
      } else {
        // Someone else's turn
        if (window.sounds) sounds.opponentTurn();
        // Stop visual notification if it was running
        stopTurnNotification();
      }
    }

    if (data.lastMove) {
      console.log(`[GAME-UPDATE] ${data.lastMove.playerName} scored ${data.lastMove.score}`);
      showMessage(i18n.t('msgPlayerScored', {
        name: data.lastMove.playerName,
        score: data.lastMove.score
      }), 'success');

      // Highlight the last move placements
      if (data.lastMove.placements && data.lastMove.playerId !== playerId) {
        highlightLastMove(data.lastMove.placements);
      }
    }
  });

  socket.on('error', (data) => {
    showMessage(data.message, 'error');

    // Play error sound
    if (window.sounds) sounds.error();

    // Re-enable submit button if move was rejected
    if (currentPlacements.length > 0) {
      document.getElementById('submit-move-btn').disabled = false;
    }
  });

  socket.on('word-validated', (data) => {
    console.log(`Word ${data.word} is ${data.isValid ? 'valid' : 'invalid'}`);
  });

  socket.on('player-left', (data) => {
    showMessage(i18n.t('msgPlayerLeft', {
      name: data.playerName,
      count: data.playersRemaining
    }), 'error');
  });

  socket.on('player-disconnected', (data) => {
    showMessage(i18n.t('playerDisconnected', { name: data.playerName }), 'info');
    gameState = data.gameState;
    updatePlayersList();
  });

  socket.on('opponent-preview', (data) => {
    if (data.playerIndex === playerIndex) return; // Ignore our own previews

    // Check for conflicts with our ghost placements
    if (data.placements.length > 0) {
      let hadConflict = false;
      for (const p of data.placements) {
        const conflictIdx = currentPlacements.findIndex(cp => cp.row === p.row && cp.col === p.col);
        if (conflictIdx !== -1) {
          recallSingleTile(currentPlacements[conflictIdx]);
          currentPlacements.splice(conflictIdx, 1);
          hadConflict = true;
        }
      }
      if (hadConflict) {
        updateRack();
        emitTilePreview();
      }
    }

    if (data.placements.length === 0) {
      opponentPreviews.delete(data.playerIndex);
    } else {
      opponentPreviews.set(data.playerIndex, data.placements);
    }
    updateBoard();
  });

  socket.on('player-reconnected', (data) => {
    showMessage(i18n.t('playerReconnected', { name: data.playerName }), 'success');
    gameState = data.gameState;
    updatePlayersList();
  });

  socket.on('spectator-joined', (data) => {
    showMessage(i18n.t('spectatorJoined', { name: data.spectatorName }), 'info');
    gameState.spectators = data.spectators;
    updatePlayersList();

    // Play player joined sound
    if (window.sounds) sounds.playerJoined();
  });

  socket.on('spectator-left', (data) => {
    showMessage(i18n.t('spectatorLeft', { name: data.spectatorName }), 'info');
    gameState.spectators = data.spectators;
    updatePlayersList();
  });

  socket.on('player-removed', (data) => {
    showMessage(i18n.t('playerRemoved', { name: data.playerName }), 'error');
    gameState = data.gameState;
    updatePlayersList();
    updateBoard();
  });

  socket.on('removed-from-game', (data) => {
    alert(data.message);
    window.location.reload();
  });

  socket.on('player-left', (data) => {
    showMessage(i18n.t('playerLeft', { name: data.playerName }), 'info');
    gameState = data.gameState;
    updatePlayersList();
    updateBoard();
  });

  socket.on('left-game', (data) => {
    alert(data.message);
    window.location.reload();
  });

  socket.on('ownership-transferred', (data) => {
    // Update game state to reflect new owner
    if (gameState) {
      gameState.ownerId = data.newOwnerId;
    }

    // Show message about ownership transfer
    if (playerId === data.newOwnerId) {
      showMessage(i18n.t('youAreNowOwner'), 'info');

      // Update config summary and invite link for new owner
      if (gameState && gameState.config) {
        const config = gameState.config;
        populateGameConfigSummary(
          config.rackSize,
          config.allowVoting,
          config.rules,
          config.customTiles
        );
        const inviteLink = window.location.origin + `/shcrabble/?game=${gameState.gameId}`;
        document.getElementById('invite-link').value = inviteLink;
      }
    } else {
      showMessage(i18n.t('ownershipTransferred', { name: data.newOwnerName }), 'info');
    }

    // Update UI to show/hide owner controls
    updateGameUI();
  });

  socket.on('game-ended', (data) => {
    showGameEndedDialog(data.finalScores);
    // Hide game controls since game is over
    hideGameControls();

    // Play game ended sound
    if (window.sounds) sounds.gameEnded();
  });

  socket.on('suggest-end-game', (data) => {
    if (data.reason === 'six-consecutive-scoreless-turns') {
      document.getElementById('suggest-end-game-dialog').style.display = 'flex';
    }
  });

  socket.on('game-deleted', (data) => {
    alert(data.message || 'This game has been deleted');
    window.location.href = '/shcrabble/';
  });

  socket.on('vote-pending', (data) => {
    console.log('[VOTE-PENDING]', data);
    currentVoteId = data.voteId;

    // Show progress dialog instead of just a message
    document.getElementById('vote-progress-message').textContent =
      `Waiting for votes on: ${data.invalidWords.join(', ')}`;
    document.getElementById('vote-count-current').textContent = '0';
    document.getElementById('vote-count-total').textContent = data.totalVoters;
    document.getElementById('vote-accept-count').textContent = '0';
    document.getElementById('vote-reject-count').textContent = '0';
    document.getElementById('vote-progress-dialog').style.display = 'flex';
  });

  socket.on('vote-progress', (data) => {
    console.log('[VOTE-PROGRESS]', data);

    // Update progress dialog with vote counts
    document.getElementById('vote-count-current').textContent = data.votesReceived;
    document.getElementById('vote-count-total').textContent = data.totalVoters;
    document.getElementById('vote-accept-count').textContent = data.acceptVotes;
    document.getElementById('vote-reject-count').textContent = data.rejectVotes;
  });

  socket.on('vote-request', (data) => {
    console.log('[VOTE-REQUEST]', data);
    currentVoteId = data.voteId;
    const wordsText = data.invalidWords.join(', ');

    // Show vote dialog
    document.getElementById('vote-question').textContent =
      `${data.playerName} placed '${wordsText}', but it's not in the dictionary. Will you allow this move?`;
    document.getElementById('vote-dialog').style.display = 'flex';

    // Also show progress dialog in background (will be visible after voting)
    document.getElementById('vote-progress-message').textContent =
      `Voting on: ${wordsText}`;
    document.getElementById('vote-count-current').textContent = '0';
    document.getElementById('vote-count-total').textContent = '?'; // Will be updated
    document.getElementById('vote-accept-count').textContent = '0';
    document.getElementById('vote-reject-count').textContent = '0';

    // Play vote request sound
    if (window.sounds) sounds.voteRequest();
  });

  socket.on('vote-result', (data) => {
    console.log('[VOTE-RESULT]', data);
    document.getElementById('vote-dialog').style.display = 'none';
    document.getElementById('vote-progress-dialog').style.display = 'none';
    showMessage(data.message, data.accepted ? 'success' : (data.cancelled ? 'info' : 'error'));
    currentVoteId = null;

    // If vote was rejected or cancelled, clear current placements and re-enable submit button
    // so player can recall tiles or modify their move
    if (!data.accepted && currentPlacements.length > 0) {
      // Don't clear placements - let player recall or modify them
      document.getElementById('submit-move-btn').disabled = false;
    }

    // Play appropriate vote result sound
    if (window.sounds) {
      if (data.accepted) {
        sounds.voteAccepted();
      } else if (!data.cancelled) {
        sounds.voteRejected();
      }
    }
  });

  socket.on('invalid-word-prompt', (data) => {
    console.log('[INVALID-WORD-PROMPT]', data);
    const wordsText = data.invalidWords.join(', ');
    const message = `The following words are not in the dictionary: ${wordsText}\n\nDo you want to put this to a vote with other players?`;

    if (confirm(message)) {
      console.log('[INVALID-WORD-PROMPT] User confirmed - initiating vote');
      socket.emit('confirm-vote', {
        placements: data.placements,
        invalidWords: data.invalidWords,
        score: data.score
      });
    } else {
      console.log('[INVALID-WORD-PROMPT] User cancelled - re-enabling submit button');
      // User cancelled - re-enable submit button so they can recall tiles or try again
      document.getElementById('submit-move-btn').disabled = false;
      showMessage(i18n.t('moveCancelled'), 'info');
    }
  });
}

function addBot() {
  const tierName = document.getElementById('bot-tier-select').value;
  socket.emit('add-bot', { tierName });
}

// UI Functions
function showGameScreen() {
  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';
}

function showMessage(message, type = '') {
  const messageArea = document.getElementById('message-area');
  messageArea.textContent = message;
  messageArea.className = type;
}

// Update tiles remaining display
function updateTilesRemaining(count) {
  const tilesRemainingEl = document.getElementById('tiles-remaining');

  // Check if game is completed
  if (gameState && gameState.status === 'completed') {
    tilesRemainingEl.innerHTML = `<strong style="color: #667eea; font-size: 1.1em;">🏁 GAME OVER 🏁</strong>`;
  } else {
    const tilesLabel = i18n.t('tilesRemaining');
    tilesRemainingEl.innerHTML = `<span data-i18n="tilesRemaining">${tilesLabel}</span>: ${count}`;
  }
}

let highlightedPlayerIdx = null;

function clearTileHighlights() {
  highlightedPlayerIdx = null;
  document.querySelectorAll('.highlighted-tile').forEach(el => {
    el.classList.remove('highlighted-tile');
  });
}

function highlightPlayerTiles(playerIdx) {
  clearTileHighlights();

  if (highlightedPlayerIdx === playerIdx) {
    return;
  }

  highlightedPlayerIdx = playerIdx;

  const squares = document.querySelectorAll('.square');
  squares.forEach(sq => {
    const row = parseInt(sq.dataset.row);
    const col = parseInt(sq.dataset.col);
    if (gameState && gameState.board[row][col].placedBy === playerIdx) {
      sq.classList.add('highlighted-tile');
    }
  });
}

// Clear highlights when clicking outside player cards
document.addEventListener('click', (e) => {
  if (highlightedPlayerIdx === null) return;
  if (e.target.closest('.player-card')) return;
  clearTileHighlights();
});

function updateGameUI() {
  if (!gameState) return;

  // Check if game is completed
  const isCompleted = gameState.status === 'completed';

  // Show/hide finished game banner
  const finishedBanner = document.getElementById('game-finished-banner');
  if (isCompleted) {
    // Sort players by score to get final standings
    const finalScores = [...gameState.players].sort((a, b) => b.score - a.score);
    const winner = finalScores[0];

    const scoresHtml = finalScores.map((p, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
      return `<div style="padding: 3px 0;">${idx + 1}. ${medal} <strong>${p.name}</strong>: ${p.score} points</div>`;
    }).join('');

    finishedBanner.innerHTML = `
      <h2 style="margin: 0 0 15px 0; font-size: 1.5em;">🎉 Game Finished! 🎉</h2>
      <div style="font-size: 1.2em; margin-bottom: 15px;">
        Winner: <strong style="font-size: 1.3em;">${winner.name}</strong> (${winner.score} points)
      </div>
      <div style="font-size: 0.95em; border-top: 1px solid rgba(255,255,255,0.3); padding-top: 15px;">
        ${scoresHtml}
      </div>
    `;
    finishedBanner.style.display = 'block';
  } else {
    finishedBanner.style.display = 'none';
  }

  // Update players list
  updatePlayersList();

  // Update board
  updateBoard();

  // Update rack
  updateRack();

  // Update game info
  updateTilesRemaining(gameState.tilesRemaining);

  // Update rack title for spectators
  const rackTitle = document.querySelector('#rack-container h3');
  if (playerIndex === null && watchedPlayerId) {
    const watchedPlayer = gameState.players.find(p => p.id === watchedPlayerId);
    if (watchedPlayer) {
      rackTitle.textContent = `${watchedPlayer.name}'s Rack`;
    }
  }

  // Hide move controls for spectators or completed games
  const moveControls = document.getElementById('move-controls');
  if (playerIndex === null || isCompleted) {
    moveControls.style.display = 'none';
  } else {
    moveControls.style.display = 'flex';

    // Enable/disable submit button
    const submitBtn = document.getElementById('submit-move-btn');
    submitBtn.disabled = currentPlacements.length === 0 || gameState.currentPlayerIndex !== playerIndex;
  }

  // Show/hide end game button for owner or admin (only for active games)
  const endGameBtn = document.getElementById('end-game-btn');
  const isAdmin = sessionStorage.getItem('shcrabble-adminMode') === 'true';
  const isOwner = gameState.ownerId === playerId;
  if ((isOwner || isAdmin) && !isCompleted) {
    endGameBtn.style.display = 'inline-block';
  } else {
    endGameBtn.style.display = 'none';
  }

  // Show delete game button for owner or admin (only for completed games)
  const deleteGameBtn = document.getElementById('delete-game-btn');
  if ((isOwner || isAdmin) && isCompleted) {
    deleteGameBtn.style.display = 'inline-block';
  } else {
    deleteGameBtn.style.display = 'none';
  }

  // Show/hide pause timer button for owner (for all games with clock display)
  const pauseTimerBtn = document.getElementById('pause-timer-btn');
  const showClock = localStorage.getItem('shcrabble-showClock') !== 'false';
  if ((isOwner || isAdmin) && showClock && !isCompleted && gameState.status === 'active') {
    pauseTimerBtn.style.display = 'inline-block';
    const isPaused = gameState.timer?.paused || false;
    pauseTimerBtn.textContent = isPaused ? i18n.t('resumeTimer') : i18n.t('pauseTimer');
    pauseTimerBtn.setAttribute('data-i18n', isPaused ? 'resumeTimer' : 'pauseTimer');
  } else {
    pauseTimerBtn.style.display = 'none';
  }

  // Hide leave game button for spectators (they should use Main Menu)
  const leaveGameBtn = document.getElementById('leave-game-btn');
  if (playerIndex === null) {
    leaveGameBtn.style.display = 'none';
  } else {
    leaveGameBtn.style.display = 'inline-block';
  }

  // Show/hide bot controls (for game owner when room available)
  const botControls = document.getElementById('bot-controls');
  if (botControls) {
    const canAddBot = isOwner && gameState.players.length < 4 && gameState.status !== 'completed';
    botControls.style.display = canAddBot ? 'block' : 'none';
  }
}

// Helper function to format time in MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Start timer update interval for live countdown
function startTimerUpdates() {
  // Clear any existing interval
  if (timerUpdateInterval) {
    clearInterval(timerUpdateInterval);
  }

  // Check if user wants to see clock
  const showClock = localStorage.getItem('shcrabble-showClock') !== 'false';
  if (!showClock) {
    return;
  }

  // Update every second for all games (count-up or count-down)
  timerUpdateInterval = setInterval(() => {
    // Update if timer is running (for count-down) or if game is active (for count-up)
    const timerRunning = gameState?.config?.timerEnabled && !gameState?.timer?.paused;
    const gameActive = gameState?.status === 'active' && gameState?.timer?.turnStartTime;

    if (timerRunning || gameActive) {
      updatePlayersList(); // Refresh player cards to show updated times
    }
  }, 1000);
}

// Stop timer updates
function stopTimerUpdates() {
  if (timerUpdateInterval) {
    clearInterval(timerUpdateInterval);
    timerUpdateInterval = null;
  }
}

function updatePlayersList() {
  const playersList = document.getElementById('players-list');
  playersList.innerHTML = '';

  // Add "Players" header as inline element for mobile
  const playersHeader = document.createElement('div');
  playersHeader.className = 'section-header';
  playersHeader.textContent = i18n.t('players') || 'Players';
  playersList.appendChild(playersHeader);

  const timerEnabled = gameState.config?.timerEnabled || false;

  gameState.players.forEach((player, idx) => {
    const card = document.createElement('div');
    card.className = 'player-card';

    if (idx === gameState.currentPlayerIndex) {
      card.classList.add('active');
    }

    if (player.id === playerId) {
      card.classList.add('current-user');
    }

    if (!player.connected) {
      card.classList.add('disconnected');
    }

    if (player.hasLeft) {
      card.classList.add('left-game');
    }

    const scoreLabel = i18n.t('score');
    const tilesLabel = i18n.t('tiles');
    const statusLabel = player.hasLeft ? ' (left)' : (player.connected ? '' : ' (disconnected)');
    const botLabel = player.isBot ? ' 🤖' : '';
    const isOwner = player.id === gameState.ownerId ? ' 👑' : '';
    const isAdmin = sessionStorage.getItem('shcrabble-adminMode') === 'true';
    const isGameOwner = gameState.ownerId === playerId;
    const canRemove = (isGameOwner || isAdmin) && player.id !== playerId && !player.hasLeft;
    const removeBtn = canRemove
      ? `<button class="remove-player-btn" data-player-id="${player.id}">Remove</button>`
      : '';

    // Calculate time display if clock is shown (check user preference)
    let timeDisplay = '';
    const showClock = localStorage.getItem('shcrabble-showClock') !== 'false'; // Default true
    if (showClock) {
      let timeUsed = player.timeUsed || 0;

      // Add current turn elapsed time if this is the current player and timer is running
      if (idx === gameState.currentPlayerIndex && gameState.timer?.turnStartTime && !gameState.timer?.paused) {
        const elapsed = Math.floor((Date.now() - gameState.timer.turnStartTime) / 1000);
        timeUsed += elapsed;
      }

      if (timerEnabled) {
        // Count-down mode: show time remaining
        const timeLimit = gameState.config.timeLimit || 1500;
        const timeRemaining = Math.max(0, timeLimit - timeUsed);
        const isLowTime = timeRemaining < 60 && idx === gameState.currentPlayerIndex;
        const timeColor = isLowTime ? 'color: #f44336;' : '';
        timeDisplay = `<div class="player-score" style="${timeColor}">${i18n.t('timeRemaining')}: ${formatTime(timeRemaining)}</div>`;
      } else {
        // Count-up mode: show time used
        timeDisplay = `<div class="player-score">${i18n.t('timeUsed')}: ${formatTime(timeUsed)}</div>`;
      }
    }

    card.innerHTML = `
      <div class="player-name">${player.name}${botLabel}${isOwner}${idx === gameState.currentPlayerIndex ? ' ⬅' : ''}${statusLabel}</div>
      <div class="player-score">${scoreLabel}: ${player.score}</div>
      <div class="player-score">${tilesLabel}: ${player.rackCount}</div>
      ${timeDisplay}
      ${removeBtn}
    `;

    // Allow spectators to click to switch watched player
    if (playerIndex === null) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        // Don't trigger if clicking remove button
        if (e.target.closest('.remove-player-btn')) return;
        // Switch to watching this player
        watchedPlayerId = player.id;
        updateGameUI();
        highlightPlayerTiles(idx);
      });

      // Highlight the currently watched player
      if (watchedPlayerId === player.id) {
        card.style.border = '3px solid #667eea';
      }
    } else {
      // For players: click to highlight that player's tiles on the board
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        if (e.target.closest('.remove-player-btn')) return;
        highlightPlayerTiles(idx);
      });
    }

    playersList.appendChild(card);
  });

  // Add spectators section if any
  if (gameState.spectators && gameState.spectators.length > 0) {
    const spectatorsHeader = document.createElement('div');
    spectatorsHeader.className = 'section-header';
    spectatorsHeader.textContent = i18n.t('spectators') || 'Spectators';
    playersList.appendChild(spectatorsHeader);

    gameState.spectators.forEach(spectator => {
      const card = document.createElement('div');
      card.className = 'player-card spectator';
      card.innerHTML = `<div class="player-name">${spectator.name} 👁</div>`;
      playersList.appendChild(card);
    });
  }

  // Add event listeners for remove buttons
  document.querySelectorAll('.remove-player-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetPlayerId = e.target.dataset.playerId;
      if (confirm(i18n.t('confirmRemovePlayer'))) {
        const isAdmin = sessionStorage.getItem('shcrabble-adminMode') === 'true';
        socket.emit('remove-player', { targetPlayerId, isAdmin });
      }
    });
  });
}

function updateBoard() {
  let boardDiv = document.getElementById('board');

  // Create board if it doesn't exist
  if (boardDiv.children.length === 0) {
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 15; col++) {
        const square = document.createElement('div');
        square.className = 'square';
        square.dataset.row = row;
        square.dataset.col = col;

        const bonus = gameState.board[row][col].bonus;
        if (bonus) {
          square.classList.add(bonus);
          const label = document.createElement('div');
          label.className = 'bonus-label';
          label.setAttribute('data-bonus', bonus);
          // Always use Shavian for bonus labels
          const bonusLabels = {
            'TW': '𐑑𐑮𐑦𐑐𐑩𐑤 𐑢𐑻𐑛',
            'DW': '𐑛𐑳𐑚𐑩𐑤 𐑢𐑻𐑛',
            'TL': '𐑑𐑮𐑦𐑐𐑩𐑤 𐑤𐑧𐑑𐑼',
            'DL': '𐑛𐑳𐑚𐑩𐑤 𐑤𐑧𐑑𐑼'
          };
          label.textContent = bonusLabels[bonus] || bonus;
          square.appendChild(label);
        }

        if (row === 7 && col === 7) {
          square.classList.add('center');
        }

        // Add click handler for placing tiles
        square.addEventListener('click', () => handleSquareClick(row, col));

        boardDiv.appendChild(square);
      }
    }
  }

  // Update squares with letters
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const square = boardDiv.children[row * 15 + col];
      const cell = gameState.board[row][col];

      // Clear previous content (except bonus labels)
      const bonusLabel = square.querySelector('.bonus-label');
      square.innerHTML = '';
      if (bonusLabel) {
        square.appendChild(bonusLabel);
      }

      if (cell.letter) {
        square.classList.add('occupied');
        const letter = document.createElement('div');
        letter.className = 'tile-letter';
        letter.textContent = cell.letter;
        square.appendChild(letter);

        // Add points if not blank
        if (!cell.isBlank && cell.points) {
          const points = document.createElement('span');
          points.className = 'tile-points';
          points.textContent = cell.points;
          square.appendChild(points);
        }
      } else {
        square.classList.remove('occupied');
      }

      // Highlight last move placements
      const isLastMove = lastMovePlacements.find(p => p.row === row && p.col === col);
      if (isLastMove) {
        square.classList.add('last-move-highlight');
      } else {
        square.classList.remove('last-move-highlight', 'fading');
      }

      // Highlight current placements
      const placement = currentPlacements.find(p => p.row === row && p.col === col);
      if (placement) {
        // Use ghost-placement class if it's a ghost tile, otherwise placement
        if (placement.isGhost) {
          square.classList.add('ghost-placement');
          square.classList.remove('placement');
        } else {
          square.classList.add('placement');
          square.classList.remove('ghost-placement');
        }
        const tileDiv = document.createElement('div');
        tileDiv.className = 'tile placed-tile';
        tileDiv.draggable = true;
        tileDiv.dataset.row = row;
        tileDiv.dataset.col = col;
        tileDiv.dataset.letter = placement.letter;
        tileDiv.dataset.points = placement.points;
        tileDiv.dataset.isBlank = placement.isBlank;

        const letter = document.createElement('div');
        letter.className = 'tile-letter';
        letter.textContent = placement.letter;
        tileDiv.appendChild(letter);

        // Add points if not blank
        if (!placement.isBlank && placement.points) {
          const points = document.createElement('span');
          points.className = 'tile-points';
          points.textContent = placement.points;
          tileDiv.appendChild(points);
        }

        // Add drag handlers (desktop)
        tileDiv.addEventListener('dragstart', handlePlacedTileDragStart);
        tileDiv.addEventListener('dragend', handleDragEnd);

        // Add touch handlers (mobile)
        tileDiv.addEventListener('touchstart', handlePlacedTileTouchStart, { passive: false });
        tileDiv.addEventListener('touchmove', handleTouchMove, { passive: false });
        tileDiv.addEventListener('touchend', handleTouchEnd, { passive: false });

        square.appendChild(tileDiv);
      } else {
        square.classList.remove('placement', 'ghost-placement');
      }
    }
  }

  // Render opponent preview tiles
  for (const [pi, placements] of opponentPreviews) {
    for (const p of placements) {
      const square = boardDiv.children[p.row * 15 + p.col];
      if (square && !square.querySelector('.placed-tile') && !square.classList.contains('occupied')) {
        const preview = document.createElement('div');
        preview.className = 'opponent-preview-tile';
        preview.textContent = p.letter;
        square.appendChild(preview);
      }
    }
  }

  // Render keyboard cursor
  if (boardCursor && playerIndex !== null) {
    // Clear previous cursor
    const prevCursor = boardDiv.querySelector('.keyboard-cursor');
    if (prevCursor) prevCursor.classList.remove('keyboard-cursor');

    const cursorSquare = boardDiv.querySelector(`.square[data-row="${boardCursor.row}"][data-col="${boardCursor.col}"]`);
    if (cursorSquare) {
      cursorSquare.classList.add('keyboard-cursor');
    }
  }
}

function handleGhostToRealConversion() {
  // Check if any ghost placements conflict with the current board state
  const conflicts = [];
  const validPlacements = [];

  currentPlacements.forEach(placement => {
    if (placement.isGhost) {
      // Check if this square is now occupied on the board
      if (gameState.board[placement.row][placement.col].letter) {
        conflicts.push(placement);
      } else {
        // No conflict - convert to real placement
        placement.isGhost = false;
        validPlacements.push(placement);
      }
    } else {
      validPlacements.push(placement);
    }
  });

  // If there were conflicts, recall ALL ghost tiles and notify user
  if (conflicts.length > 0) {
    console.log('[GHOST] Conflicts detected, recalling ghost tiles:', conflicts);
    currentPlacements = currentPlacements.filter(p => !p.isGhost);
    showMessage(`Ghost tiles recalled due to conflicts`, 'info');
    if (window.sounds) sounds.tilesRecalled();
  } else if (validPlacements.some(p => !p.isGhost && currentPlacements.some(cp => cp.isGhost))) {
    // Some ghost tiles were converted successfully
    console.log('[GHOST] Ghost tiles converted to real placements');
    showMessage(`Ghost tiles are now active!`, 'success');
  }

  updateBoard();
  updateGameUI();
  validateCurrentMove();
}

function highlightLastMove(placements) {
  // Clear any existing highlight timeout
  if (highlightFadeTimeout) {
    clearTimeout(highlightFadeTimeout);
    highlightFadeTimeout = null;
  }

  // Store the placements to highlight
  lastMovePlacements = placements;

  // Update board to apply highlights
  updateBoard();
}

function fadeLastMoveHighlight() {
  // Add fading class to all highlighted squares
  const board = document.getElementById('board');
  const highlightedSquares = board.querySelectorAll('.last-move-highlight');

  highlightedSquares.forEach(square => {
    square.classList.add('fading');
  });

  // Clear the placements after animation completes
  setTimeout(() => {
    lastMovePlacements = [];
    updateBoard();
  }, 1000); // Match the fadeHighlight animation duration
}

function updateRack() {
  const rackDiv = document.getElementById('rack');

  // For spectators, show the watched player's rack, or first player if none selected
  let targetPlayer;
  if (playerIndex === null) {
    // Spectator mode
    if (watchedPlayerId) {
      targetPlayer = gameState.players.find(p => p.id === watchedPlayerId);
    }
    // Default to first player if no one is being watched
    if (!targetPlayer && gameState.players.length > 0) {
      targetPlayer = gameState.players[0];
      watchedPlayerId = targetPlayer.id;
    }
  } else {
    // Regular player mode
    targetPlayer = gameState.players.find(p => p.id === playerId);
  }

  if (!targetPlayer || !targetPlayer.rack) return;

  // Build current visible rack (for spectators, show all tiles; for players, exclude placed tiles)
  const visibleRack = playerIndex === null
    ? targetPlayer.rack.map((tile, idx) => ({ tile, originalIndex: idx }))
    : targetPlayer.rack
        .map((tile, idx) => ({ tile, originalIndex: idx }))
        .filter(({ originalIndex }) => !currentPlacements.some(p => p.rackIndex === originalIndex));

  const currentRackSize = visibleRack.length;
  const hasNewTiles = !isRecalling && currentRackSize > previousRackSize;
  const numNewTiles = hasNewTiles ? currentRackSize - previousRackSize : 0;

  // Clear and rebuild rack
  rackDiv.innerHTML = '';

  visibleRack.forEach(({ tile, originalIndex }, displayIndex) => {
    const tileDiv = document.createElement('div');
    tileDiv.className = 'rack-tile';

    // Determine if this is a new tile (added at the beginning, pushing others right)
    // Only animate slide-in if not recalling
    const isNewTile = hasNewTiles && displayIndex < numNewTiles;

    // Determine if this is an existing tile that needs to slide right
    const isShiftingTile = hasNewTiles && displayIndex >= numNewTiles;

    if (isNewTile) {
      tileDiv.classList.add('new-tile');
      // All new tiles animate together
    } else if (isShiftingTile) {
      tileDiv.classList.add('sliding');
      // Calculate how far to slide from (in pixels)
      const slideDistance = -60 * numNewTiles; // 50px tile + 10px gap
      tileDiv.style.setProperty('--slide-from', `${slideDistance}px`);
      // All existing tiles slide together in unison
    }

    // Determine display letter and points (accounting for rotation state)
    const isRotated = tile.isRotatable && tile.isRotated;
    const displayLetter = isRotated ? tile.rotatedLetter : tile.letter;
    const displayPoints = isRotated ? tile.rotatedPoints : tile.points;
    const altPoints = tile.isRotatable ? (isRotated ? tile.points : tile.rotatedPoints) : null;

    if (tile.isBlank) {
      tileDiv.classList.add('blank');
      tileDiv.textContent = '?';
    } else {
      // Add alt points indicator for rotatable tiles (top-left, upside-down)
      if (tile.isRotatable) {
        tileDiv.classList.add('rotatable');
        const altPointsSpan = document.createElement('span');
        altPointsSpan.className = 'tile-alt-points';
        altPointsSpan.textContent = altPoints;
        tileDiv.appendChild(altPointsSpan);
      }

      tileDiv.appendChild(document.createTextNode(displayLetter));

      // Add points display
      const pointsSpan = document.createElement('span');
      pointsSpan.className = 'tile-points';
      pointsSpan.textContent = displayPoints;
      tileDiv.appendChild(pointsSpan);
    }

    tileDiv.dataset.index = originalIndex;
    tileDiv.dataset.letter = displayLetter;
    tileDiv.dataset.points = displayPoints;
    tileDiv.dataset.isBlank = tile.isBlank;

    if (tile.isRotatable) {
      tileDiv.dataset.rotatable = 'true';
      tileDiv.dataset.rotatedLetter = tile.rotatedLetter;
      tileDiv.dataset.rotatedPoints = tile.rotatedPoints;
      tileDiv.dataset.isRotated = tile.isRotated ? 'true' : 'false';
    }

    // Only make tiles interactive for actual players, not spectators
    if (playerIndex !== null) {
      // In exchange mode, make tiles clickable to select
      if (exchangeMode) {
        tileDiv.style.cursor = 'pointer';
        if (tilesToExchange.includes(originalIndex)) {
          tileDiv.style.opacity = '0.5';
          tileDiv.style.border = '3px solid #667eea';
        }
        tileDiv.addEventListener('click', () => toggleTileForExchange(originalIndex));
      } else {
        // Make tiles draggable in normal mode (desktop)
        tileDiv.draggable = true;
        tileDiv.addEventListener('dragstart', (e) => {
          tileDiv.classList.add('was-dragged');
          handleDragStart(e);
        });
        tileDiv.addEventListener('dragend', handleDragEnd);
        // Add double-click handler to place tile after last placement
        tileDiv.addEventListener('dblclick', () => handleTileDoubleClick(originalIndex));

        // Add click handler for rotation (single click without drag)
        if (tile.isRotatable) {
          tileDiv.addEventListener('click', (e) => {
            if (!tileDiv.classList.contains('was-dragged')) {
              rotateTile(originalIndex);
            }
            tileDiv.classList.remove('was-dragged');
          });
        }

        // Add touch support for mobile
        tileDiv.addEventListener('touchstart', handleTouchStart, { passive: false });
        tileDiv.addEventListener('touchmove', handleTouchMove, { passive: false });
        tileDiv.addEventListener('touchend', handleTouchEnd, { passive: false });
      }
    } else {
      // Spectator mode - tiles are not interactive
      tileDiv.style.cursor = 'default';
    }

    // Highlight keyboard-selected rack tile
    if (selectedRackIndex === originalIndex) {
      tileDiv.classList.add('rack-selected');
    }

    rackDiv.appendChild(tileDiv);
  });

  previousRackSize = currentRackSize;
  previousRackState = visibleRack.map(({ tile }) => tile);

  // Make rack itself a drop zone for reordering
  rackDiv.addEventListener('dragover', handleRackDragOver);
  rackDiv.addEventListener('drop', handleRackDrop);
}

function rotateTile(rackIndex) {
  const myPlayer = gameState.players.find(p => p.id === playerId);
  if (!myPlayer || !myPlayer.rack) return;

  const tile = myPlayer.rack[rackIndex];
  if (!tile || !tile.isRotatable) return;

  // Toggle rotation state
  tile.isRotated = !tile.isRotated;

  // Find the tile div in the rack to animate it
  const rackDiv = document.getElementById('rack');
  const tileDiv = rackDiv.querySelector(`.rack-tile[data-index="${rackIndex}"]`);
  if (tileDiv) {
    tileDiv.classList.add('rotating');
    tileDiv.addEventListener('animationend', () => {
      tileDiv.classList.remove('rotating');
      updateRack();
    }, { once: true });
  } else {
    updateRack();
  }
}

function handleSquareClick(row, col) {
  if (gameState.currentPlayerIndex !== playerIndex) {
    showMessage(i18n.t('errorNotYourTurn'), 'error');
    return;
  }

  if (gameState.board[row][col].letter) {
    showMessage(i18n.t('errorSquareOccupied'), 'error');
    return;
  }

  // Check if already placed
  const existingIdx = currentPlacements.findIndex(p => p.row === row && p.col === col);
  if (existingIdx >= 0) {
    // Remove placement
    currentPlacements.splice(existingIdx, 1);
    updateBoard();
    updateGameUI();
    validateCurrentMove();
    emitTilePreview();
    return;
  }

  // Prompt for letter selection (simplified - in real version, drag & drop)
  const myPlayer = gameState.players.find(p => p.id === playerId);
  if (!myPlayer || !myPlayer.rack || myPlayer.rack.length === 0) {
    showMessage(i18n.t('errorNoTiles'), 'error');
    return;
  }

  showMessage('', '');
}

// Drag and drop handlers
function handleDragStart(e) {
  const tileEl = e.target.closest('.rack-tile');
  const isRotated = tileEl && tileEl.dataset.isRotated === 'true';
  draggedTile = {
    letter: e.target.dataset.letter,
    points: parseInt(e.target.dataset.points),
    isBlank: e.target.dataset.isBlank === 'true',
    rackIndex: parseInt(e.target.dataset.index),
    isRotated: isRotated
  };
  draggedFromRack = true;
  rackDragSource = e.target;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';

  // Play pickup sound
  if (window.sounds) sounds.tilePickup();
}

function handlePlacedTileDragStart(e) {
  const row = parseInt(e.target.dataset.row);
  const col = parseInt(e.target.dataset.col);

  draggedTile = {
    letter: e.target.dataset.letter,
    points: parseInt(e.target.dataset.points),
    isBlank: e.target.dataset.isBlank === 'true',
    fromBoard: true,
    boardRow: row,
    boardCol: col
  };
  draggedFromRack = false;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedFromRack = false;
  rackDragSource = null;
}

// Touch event handlers for mobile support
function handleTouchStart(e) {
  // Don't start drag if pinching
  if (e.touches.length > 1 || isPinching) return;

  const tile = e.target.closest('.rack-tile');
  if (!tile) return;

  touchDraggedElement = tile;
  touchStartPos = {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY
  };
  touchStartTime = Date.now();
  touchHasMoved = false;

  // Store tile data
  draggedTile = {
    letter: tile.dataset.letter,
    points: parseInt(tile.dataset.points),
    isBlank: tile.dataset.isBlank === 'true',
    rackIndex: parseInt(tile.dataset.index),
    isRotated: tile.dataset.isRotated === 'true',
    isRotatable: tile.dataset.rotatedLetter !== undefined
  };
  draggedFromRack = true;
  rackDragSource = tile;

  // Don't create clone immediately - wait to see if this is a tap or drag
  // We'll create it in handleTouchMove if needed

  e.preventDefault();
}

function handlePlacedTileTouchStart(e) {
  // Don't start drag if pinching
  if (e.touches.length > 1 || isPinching) return;

  const tile = e.target.closest('.placed-tile');
  if (!tile) return;

  touchDraggedElement = tile;
  touchStartPos = {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY
  };
  touchStartTime = Date.now();
  touchHasMoved = false;

  const row = parseInt(tile.dataset.row);
  const col = parseInt(tile.dataset.col);

  draggedTile = {
    letter: tile.dataset.letter,
    points: parseInt(tile.dataset.points),
    isBlank: tile.dataset.isBlank === 'true',
    fromBoard: true,
    boardRow: row,
    boardCol: col
  };
  draggedFromRack = false;

  // Don't create clone immediately - wait to see if this is a tap or drag
  // We'll create it in handleTouchMove if needed

  e.preventDefault();
}

function handleTouchMove(e) {
  if (!touchDraggedElement) return;

  const touch = e.touches[0];
  const deltaX = touch.clientX - touchStartPos.x;
  const deltaY = touch.clientY - touchStartPos.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  // Consider it a drag if moved more than 10 pixels
  const DRAG_THRESHOLD = 10;
  if (distance > DRAG_THRESHOLD) {
    touchHasMoved = true;

    // Create clone if not already created
    if (!touchClone) {
      touchClone = touchDraggedElement.cloneNode(true);
      touchClone.style.position = 'fixed';
      touchClone.style.zIndex = '10000';
      touchClone.style.pointerEvents = 'none';
      touchClone.style.opacity = '0.8';
      touchClone.style.width = touchDraggedElement.offsetWidth + 'px';
      touchClone.style.height = touchDraggedElement.offsetHeight + 'px';
      document.body.appendChild(touchClone);

      // Make original semi-transparent
      touchDraggedElement.style.opacity = '0.3';

      // Play pickup sound
      if (window.sounds) sounds.tilePickup();
    }
  }

  if (touchClone) {
    // Update clone position
    touchClone.style.left = touch.clientX - touchClone.offsetWidth / 2 + 'px';
    touchClone.style.top = touch.clientY - touchClone.offsetHeight / 2 + 'px';

    // Find element under touch
    const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
    touchCurrentTarget = elementUnderTouch;

    // Highlight drop target
    document.querySelectorAll('.square').forEach(sq => sq.classList.remove('drag-over'));
    const square = elementUnderTouch?.closest('.square');
    if (square) {
      square.classList.add('drag-over');
    }

    // Handle rack reordering preview for touch
    const rackElement = elementUnderTouch?.closest('#rack');
    if (rackElement && draggedFromRack && rackDragSource && !draggedTile?.fromBoard) {
      const rack = document.getElementById('rack');
      const afterElement = getDragAfterElement(rack, touch.clientX);

      // Live preview: temporarily insert dragged element at new position
      if (afterElement == null) {
        rack.appendChild(rackDragSource);
      } else if (afterElement !== rackDragSource.nextSibling) {
        rack.insertBefore(rackDragSource, afterElement);
      }
    }
  }

  e.preventDefault();
}

function handleTouchEnd(e) {
  if (!touchDraggedElement) return;

  // Restore original tile opacity
  touchDraggedElement.style.opacity = '';

  // Remove clone
  if (touchClone) {
    touchClone.remove();
    touchClone = null;
  }

  // Check if this was a tap (no movement) - handle rotation
  if (!touchHasMoved && draggedFromRack && draggedTile?.isRotatable) {
    rotateTile(draggedTile.rackIndex);

    // Clean up
    document.querySelectorAll('.square').forEach(sq => sq.classList.remove('drag-over'));
    touchDraggedElement = null;
    draggedTile = null;
    draggedFromRack = false;
    rackDragSource = null;
    touchCurrentTarget = null;
    return;
  }

  // Find drop target
  const touch = e.changedTouches[0];
  const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);

  // Check if dropped on board square
  const square = elementUnderTouch?.closest('.square');
  if (square && draggedTile && touchHasMoved) {
    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);

    // Check if square is empty or already has a placement
    const hasExistingPlacement = currentPlacements.some(p => p.row === row && p.col === col);
    const hasBoardTile = gameState.board[row][col].letter;

    if (!hasBoardTile && !hasExistingPlacement) {
      // Handle blank tiles
      if (draggedTile.isBlank) {
        pendingBlankPlacement = {
          row,
          col,
          draggedTile,
          rackIndex: draggedTile.rackIndex,
          isGhost: gameState.currentPlayerIndex !== playerIndex
        };
        showBlankLetterDialog();
      } else {
        // Regular tile placement
        const isGhostPlacement = gameState.currentPlayerIndex !== playerIndex;

        // If dragging from board, remove old placement
        if (draggedTile.fromBoard) {
          const oldIdx = currentPlacements.findIndex(p =>
            p.row === draggedTile.boardRow && p.col === draggedTile.boardCol
          );
          if (oldIdx >= 0) {
            currentPlacements.splice(oldIdx, 1);
          }
        }

        const touchPlacement = {
          row,
          col,
          letter: draggedTile.letter,
          points: draggedTile.points,
          isBlank: false,
          rackIndex: draggedTile.rackIndex,
          isGhost: isGhostPlacement
        };
        if (draggedTile.isRotated) touchPlacement.isRotated = true;
        currentPlacements.push(touchPlacement);

        lastPlacementPosition = { row, col };

        // Play placement sound
        if (window.sounds) sounds.tilePlaced();

        updateBoard();
        updateGameUI();
        validateCurrentMove();
        emitTilePreview();
      }
    }
  }

  // Check if dropped back on rack
  const rackElement = elementUnderTouch?.closest('#rack');
  if (rackElement && draggedTile?.fromBoard && touchHasMoved) {
    // Remove placement from board
    const idx = currentPlacements.findIndex(p =>
      p.row === draggedTile.boardRow && p.col === draggedTile.boardCol
    );
    if (idx >= 0) {
      currentPlacements.splice(idx, 1);
      updateBoard();
      updateGameUI();
      validateCurrentMove();
      emitTilePreview();
    }
  }

  // Check if reordering tiles within rack
  if (rackElement && draggedFromRack && touchHasMoved && !draggedTile?.fromBoard) {
    handleTouchRackReorder(touch.clientX);
  }

  // Clean up
  document.querySelectorAll('.square').forEach(sq => sq.classList.remove('drag-over'));
  touchDraggedElement = null;
  draggedTile = null;
  draggedFromRack = false;
  rackDragSource = null;
  touchCurrentTarget = null;

  e.preventDefault();
}

// Pinch zoom for board on mobile
function setupBoardPinchZoom() {
  const boardContainer = document.getElementById('board-container');
  if (!boardContainer) return;

  boardContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      isPinching = true;

      // Calculate initial pinch center point
      pinchStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      pinchStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      // Calculate initial distance between fingers
      pinchStartDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );

      // Store current state
      pinchStartScale = boardScale;
      pinchStartTranslateX = boardTranslateX;
      pinchStartTranslateY = boardTranslateY;

      // Get board position relative to container
      const board = document.getElementById('board');
      const containerRect = boardContainer.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();

      // Store offset from container to board
      const offsetX = pinchStartX - containerRect.left;
      const offsetY = pinchStartY - containerRect.top;

      e.preventDefault();
    }
  }, { passive: false });

  boardContainer.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && isPinching) {
      // Calculate current pinch center
      const currentX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      // Calculate current distance
      const currentDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );

      // Calculate new scale
      const newScale = Math.max(0.5, Math.min(3, pinchStartScale * (currentDistance / pinchStartDistance)));

      // Calculate how much the pinch center has moved
      const deltaX = currentX - pinchStartX;
      const deltaY = currentY - pinchStartY;

      // Calculate translation needed to keep pinch point anchored
      const scaleDelta = newScale - pinchStartScale;
      const containerRect = boardContainer.getBoundingClientRect();
      const focusX = pinchStartX - containerRect.left;
      const focusY = pinchStartY - containerRect.top;

      // Adjust translation to keep the pinch point stable
      const newTranslateX = pinchStartTranslateX + deltaX - (focusX * scaleDelta);
      const newTranslateY = pinchStartTranslateY + deltaY - (focusY * scaleDelta);

      // Update state
      boardScale = newScale;
      boardTranslateX = newTranslateX;
      boardTranslateY = newTranslateY;

      // Apply transform
      const board = document.getElementById('board');
      if (board) {
        board.style.transform = `translate(${boardTranslateX}px, ${boardTranslateY}px) scale(${boardScale})`;
        board.style.transformOrigin = 'top left';
      }

      e.preventDefault();
    }
  }, { passive: false });

  boardContainer.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      isPinching = false;
    }
  });
}

// Handle drag over rack for reordering
function handleRackDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  if (!draggedFromRack || !rackDragSource) return;

  const rack = document.getElementById('rack');
  const afterElement = getDragAfterElement(rack, e.clientX);

  // Live preview: temporarily insert dragged element at new position
  if (afterElement == null) {
    rack.appendChild(rackDragSource);
  } else if (afterElement !== rackDragSource.nextSibling) {
    rack.insertBefore(rackDragSource, afterElement);
  }
}

// Handle drop on rack for reordering
function handleRackDrop(e) {
  e.preventDefault();

  if (!draggedFromRack || !rackDragSource) return;

  const rack = document.getElementById('rack');
  const afterElement = getDragAfterElement(rack, e.clientX);

  if (afterElement == null) {
    rack.appendChild(rackDragSource);
  } else {
    rack.insertBefore(rackDragSource, afterElement);
  }

  // Update the game state rack array to match the new DOM order
  const rackTiles = [...rack.querySelectorAll('.rack-tile')];
  const newRack = rackTiles.map(tileDiv => {
    const index = parseInt(tileDiv.dataset.index);
    return gameState.players[playerIndex].rack[index];
  });
  gameState.players[playerIndex].rack = newRack;

  // Refresh the rack display to update data-index attributes
  updateRack();
}

// Handle touch-based rack reordering
function handleTouchRackReorder(touchX) {
  if (!rackDragSource) return;

  const rack = document.getElementById('rack');
  const afterElement = getDragAfterElement(rack, touchX);

  if (afterElement == null) {
    rack.appendChild(rackDragSource);
  } else {
    rack.insertBefore(rackDragSource, afterElement);
  }

  // Update the game state rack array to match the new DOM order
  const rackTiles = [...rack.querySelectorAll('.rack-tile')];
  const newRack = rackTiles.map(tileDiv => {
    const index = parseInt(tileDiv.dataset.index);
    return gameState.players[playerIndex].rack[index];
  });
  gameState.players[playerIndex].rack = newRack;

  // Refresh the rack display to update data-index attributes
  updateRack();
}

// Find the element to insert before when reordering
function getDragAfterElement(container, x) {
  const draggableElements = [...container.querySelectorAll('.rack-tile:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = x - box.left - box.width / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Lobby functions
function showCreateGameDialog() {
  // Prepopulate name from localStorage
  const savedName = getUserName();
  if (savedName) {
    document.getElementById('create-name').value = savedName;
  }
  document.getElementById('create-game-dialog').style.display = 'flex';
}

async function fetchAndDisplayGameInfo(gameId) {
  if (!gameId || gameId.length < 8) {
    // Hide config summary if no valid game ID
    document.getElementById('join-game-config-summary').style.display = 'none';
    document.getElementById('join-game-finished-summary').style.display = 'none';
    // Reset dialog to default state
    document.querySelector('#join-game-dialog h2').textContent = 'Join Game';
    document.querySelector('[name="join-role"]').closest('.setting-item').style.display = 'block';
    document.getElementById('join-game-confirm-btn').textContent = 'Join Game';
    return;
  }

  try {
    const response = await fetch(`/shcrabble/api/game-info/${encodeURIComponent(gameId)}`);
    if (!response.ok) {
      document.getElementById('join-game-config-summary').style.display = 'none';
      document.getElementById('join-game-finished-summary').style.display = 'none';
      return;
    }

    const data = await response.json();
    const config = data.config;
    const isCompleted = data.status === 'completed';

    if (isCompleted) {
      // Update dialog for completed game
      document.querySelector('#join-game-dialog h2').textContent = 'View Game';
      document.getElementById('join-game-confirm-btn').textContent = 'View Game';

      // Hide role selector
      document.querySelector('[name="join-role"]').closest('.setting-item').style.display = 'none';

      // Hide config summary, show finished summary
      document.getElementById('join-game-config-summary').style.display = 'none';

      // Show final scores
      const finishedSummary = document.getElementById('join-game-finished-summary');
      const winner = data.finalScores[0];
      const scoresHtml = data.finalScores.map((p, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
        return `<div style="padding: 5px 0;">${idx + 1}. ${medal} <strong>${p.name}</strong>: ${p.score} points</div>`;
      }).join('');

      finishedSummary.innerHTML = `
        <div style="background: #f5f5f5; padding: 12px; border-radius: 6px; margin-bottom: 15px;">
          <h4 style="margin: 0 0 8px 0; font-size: 0.9em; color: #667eea;">Game Finished</h4>
          <div style="font-size: 0.9em; margin-bottom: 10px;">
            Winner: <strong style="color: #4caf50;">${winner.name}</strong> (${winner.score} points)
          </div>
          <div style="font-size: 0.85em; border-top: 1px solid #ddd; padding-top: 8px;">
            ${scoresHtml}
          </div>
        </div>
      `;
      finishedSummary.style.display = 'block';
    } else {
      // Reset dialog to normal join state
      document.querySelector('#join-game-dialog h2').textContent = 'Join Game';
      document.getElementById('join-game-confirm-btn').textContent = 'Join Game';
      document.querySelector('[name="join-role"]').closest('.setting-item').style.display = 'block';
      document.getElementById('join-game-finished-summary').style.display = 'none';

      // Populate the join dialog config summary
      const rulesText = config.rules === 'tournament' ? i18n.t('tournamentRules') : i18n.t('casualRules');
      document.getElementById('join-config-rules').textContent = rulesText;
      document.getElementById('join-config-rack-size').textContent = config.rackSize;

      const isCustom = config.customTiles !== null;
      const distText = isCustom ? i18n.t('customDist') : i18n.t('defaultDist');
      document.getElementById('join-config-tile-dist').textContent = distText;
      document.getElementById('join-config-total-tiles').textContent = config.totalTiles;

      const votingText = config.allowVoting ? i18n.t('yes') : i18n.t('no');
      document.getElementById('join-config-voting').textContent = votingText;

      // Show the config summary
      document.getElementById('join-game-config-summary').style.display = 'block';
    }
  } catch (err) {
    console.error('Error fetching game info:', err);
    document.getElementById('join-game-config-summary').style.display = 'none';
    document.getElementById('join-game-finished-summary').style.display = 'none';
  }
}

function showJoinGameDialog() {
  // Prepopulate name from localStorage
  const savedName = getUserName();
  if (savedName) {
    document.getElementById('join-name').value = savedName;
  }

  // Check URL params for game ID
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('game')) {
    const gameId = urlParams.get('game');
    document.getElementById('game-id').value = gameId;
    // Fetch and display game info
    fetchAndDisplayGameInfo(gameId);
  }

  document.getElementById('join-game-dialog').style.display = 'flex';
}

function populateGameConfigSummary(rackSize, allowVoting, rules, customTileDistribution) {
  // Populate rules
  const rulesText = rules === 'tournament' ? i18n.t('tournamentRules') : i18n.t('casualRules');
  document.getElementById('config-rules').textContent = rulesText;

  // Populate rack size
  document.getElementById('config-rack-size').textContent = rackSize;

  // Populate tile distribution
  const isCustom = customTileDistribution !== null;
  const distText = isCustom ? i18n.t('customDist') : i18n.t('defaultDist');
  document.getElementById('config-tile-dist').textContent = distText;

  // Calculate total tiles
  let totalTiles = 100; // default
  if (isCustom) {
    totalTiles = customTileDistribution.reduce((sum, tile) => sum + tile.count, 0);
  }
  document.getElementById('config-total-tiles').textContent = totalTiles;

  // Populate voting
  const votingText = allowVoting ? i18n.t('yes') : i18n.t('no');
  document.getElementById('config-voting').textContent = votingText;
}

function createGame() {
  const name = document.getElementById('create-name').value.trim();
  const rackSize = parseInt(document.getElementById('rack-size').value);
  const allowVoting = document.getElementById('allow-voting').checked;
  const rules = document.querySelector('input[name="game-rules"]:checked').value;
  const baseMode = document.querySelector('input[name="tile-mode"]:checked').value;
  const useExtended = document.getElementById('use-extended').checked;
  const tileMode = useExtended ? baseMode + '-extended' : baseMode;
  const customTileDistribution = getSelectedTileDistribution();
  const timerEnabled = document.getElementById('timer-enabled').checked;
  const timeLimitMinutes = parseInt(document.getElementById('time-limit-minutes').value) || 25;

  if (!name) {
    alert(i18n.t('enterYourName'));
    return;
  }

  if (rackSize < 5 || rackSize > 12) {
    alert(i18n.t('rackSizeRange'));
    return;
  }

  saveUserName(name);

  fetch('/shcrabble/api/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      rackSize,
      allowVoting,
      rules,
      tileMode,
      customTiles: customTileDistribution,
      timerEnabled,
      timeLimit: timeLimitMinutes * 60 // Convert to seconds
    })
  })
    .then(res => res.json())
    .then(data => {
      document.getElementById('create-game-dialog').style.display = 'none';

      const inviteLink = window.location.origin + data.inviteLink;
      document.getElementById('invite-link').value = inviteLink;

      // Populate game configuration summary
      populateGameConfigSummary(rackSize, allowVoting, rules, customTileDistribution);

      // Set flag to show game-created dialog after welcome dialog is dismissed
      pendingGameCreatedDialog = true;

      // Auto-join the game (which will trigger 'joined' event)
      socket.emit('join-game', {
        gameId: data.gameId,
        playerName: name,
        userId: getUserId()
      });
    })
    .catch(err => {
      console.error('Error creating game:', err);
      alert(i18n.t('failedCreateGame'));
    });
}

function joinGame() {
  const name = document.getElementById('join-name').value.trim();
  let gameId = document.getElementById('game-id').value.trim();
  const roleSelector = document.querySelector('[name="join-role"]').closest('.setting-item');
  const role = roleSelector.style.display === 'none'
    ? 'spectator'  // Force spectator for completed games
    : document.querySelector('input[name="join-role"]:checked').value;

  if (!name) {
    alert(i18n.t('enterYourName'));
    return;
  }

  if (!gameId) {
    alert(i18n.t('enterGameId'));
    return;
  }

  saveUserName(name);

  document.getElementById('join-game-dialog').style.display = 'none';

  socket.emit('join-game', {
    gameId: gameId,
    playerName: name,
    userId: getUserId(),
    asSpectator: role === 'spectator'
  });
}

function copyInviteLink() {
  const linkInput = document.getElementById('invite-link');
  linkInput.select();
  document.execCommand('copy');
  showMessage(i18n.t('linkCopied'), 'success');
}

function showBlankLetterDialog() {
  const letterGrid = document.getElementById('letter-grid');
  letterGrid.innerHTML = '';

  // Create buttons for each letter
  SHAVIAN_LETTERS.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'letter-option';
    btn.textContent = letter;
    btn.addEventListener('click', () => selectBlankLetter(letter));
    letterGrid.appendChild(btn);
  });

  document.getElementById('blank-letter-dialog').style.display = 'flex';
}

function selectBlankLetter(letter) {
  if (!pendingBlankPlacement) return;

  const { row, col, draggedTile, rackIndex, isGhost } = pendingBlankPlacement;

  console.log('[BLANK] Selected letter:', letter, 'for position:', row, col);

  // Add the placement with chosen letter
  currentPlacements.push({
    row,
    col,
    letter: letter,
    points: 0, // Blank tiles are worth 0 points
    isBlank: true,
    rackIndex: rackIndex,
    isGhost: isGhost || false
  });

  console.log('[BLANK] Current placements:', currentPlacements);

  // Play placement sound
  if (window.sounds) sounds.tilePlaced();

  // Clean up
  document.getElementById('blank-letter-dialog').style.display = 'none';
  pendingBlankPlacement = null;

  updateBoard();
  updateGameUI();
  validateCurrentMove();
  emitTilePreview();
}

// Find next unambiguous position after last placement for double-click
function getNextPlacementPosition() {
  if (currentPlacements.length === 0) return null;

  // Determine if placements are horizontal or vertical
  if (currentPlacements.length === 1) {
    // With only one tile, check if it's adjacent to an existing board tile
    const p = currentPlacements[0];
    const hasLeftNeighbor = p.col > 0 && gameState.board[p.row][p.col - 1].letter;
    const hasRightNeighbor = p.col < 14 && gameState.board[p.row][p.col + 1].letter;
    const hasTopNeighbor = p.row > 0 && gameState.board[p.row - 1][p.col].letter;
    const hasBottomNeighbor = p.row < 14 && gameState.board[p.row + 1][p.col].letter;

    const hasHorizontalNeighbor = hasLeftNeighbor || hasRightNeighbor;
    const hasVerticalNeighbor = hasTopNeighbor || hasBottomNeighbor;

    // If tile is adjacent horizontally, continue horizontally
    if (hasHorizontalNeighbor && !hasVerticalNeighbor) {
      const nextCol = p.col + 1;
      if (nextCol <= 14 && !gameState.board[p.row][nextCol].letter) {
        return { row: p.row, col: nextCol };
      }
    }

    // If tile is adjacent vertically, continue vertically
    if (hasVerticalNeighbor && !hasHorizontalNeighbor) {
      const nextRow = p.row + 1;
      if (nextRow <= 14 && !gameState.board[nextRow][p.col].letter) {
        return { row: nextRow, col: p.col };
      }
    }

    // If adjacent both ways, prefer horizontal (arbitrary but consistent choice)
    if (hasHorizontalNeighbor && hasVerticalNeighbor) {
      const nextCol = p.col + 1;
      if (nextCol <= 14 && !gameState.board[p.row][nextCol].letter) {
        return { row: p.row, col: nextCol };
      }
      // If can't go right, try down
      const nextRow = p.row + 1;
      if (nextRow <= 14 && !gameState.board[nextRow][p.col].letter) {
        return { row: nextRow, col: p.col };
      }
    }

    // Otherwise ambiguous (no neighbors)
    return null;
  }

  // Check if all placements are in same row (horizontal) or same column (vertical)
  const rows = currentPlacements.map(p => p.row);
  const cols = currentPlacements.map(p => p.col);
  const allSameRow = rows.every(r => r === rows[0]);
  const allSameCol = cols.every(c => c === cols[0]);

  if (!allSameRow && !allSameCol) {
    // Placements are neither all horizontal nor all vertical - ambiguous
    return null;
  }

  // Sort placements by position
  const sorted = [...currentPlacements].sort((a, b) => {
    if (allSameRow) return a.col - b.col;
    return a.row - b.row;
  });

  const last = sorted[sorted.length - 1];

  // Calculate next position
  let nextRow, nextCol;
  if (allSameRow) {
    nextRow = last.row;
    nextCol = last.col + 1;
  } else {
    nextRow = last.row + 1;
    nextCol = last.col;
  }

  // Check if next position is valid and empty
  if (nextRow > 14 || nextCol > 14) return null;
  if (gameState.board[nextRow][nextCol].letter) return null;
  if (currentPlacements.find(p => p.row === nextRow && p.col === nextCol)) return null;

  return { row: nextRow, col: nextCol };
}

// Handle double-click on rack tile
function handleTileDoubleClick(rackIndex) {
  if (gameState.currentPlayerIndex !== playerIndex) {
    showMessage(i18n.t('errorNotYourTurn'), 'error');
    return;
  }

  const nextPos = getNextPlacementPosition();
  if (!nextPos) {
    showMessage(i18n.t('cannotDeterminePlacement'), 'info');
    return;
  }

  const myPlayer = gameState.players.find(p => p.id === playerId);
  const tile = myPlayer.rack[rackIndex];

  // If it's a blank tile, show letter selection dialog
  if (tile.isBlank) {
    pendingBlankPlacement = {
      row: nextPos.row,
      col: nextPos.col,
      draggedTile: { ...tile, rackIndex },
      rackIndex
    };
    showBlankLetterDialog();
    return;
  }

  // Add placement (accounting for rotation)
  const isRotated = tile.isRotatable && tile.isRotated;
  const dblClickPlacement = {
    row: nextPos.row,
    col: nextPos.col,
    letter: isRotated ? tile.rotatedLetter : tile.letter,
    points: isRotated ? tile.rotatedPoints : tile.points,
    isBlank: false,
    rackIndex: rackIndex
  };
  if (isRotated) dblClickPlacement.isRotated = true;
  currentPlacements.push(dblClickPlacement);

  updateBoard();
  updateGameUI();
  validateCurrentMove();
  emitTilePreview();
}

function validateCurrentMove() {
  const submitBtn = document.getElementById('submit-move-btn');
  const messageArea = document.getElementById('message-area');

  // Check if we have any real (non-ghost) placements
  const realPlacements = currentPlacements.filter(p => !p.isGhost);

  if (realPlacements.length === 0) {
    submitBtn.disabled = true;
    return;
  }

  console.log('[VALIDATE] Validating current move with placements:', realPlacements);

  // Create temporary board with current placements (only real ones)
  const tempBoard = JSON.parse(JSON.stringify(gameState.board));
  realPlacements.forEach(p => {
    tempBoard[p.row][p.col] = {
      letter: p.letter,
      points: p.points,
      isBlank: p.isBlank
    };
  });

  // Read horizontal and vertical word for each placed tile (only real placements)
  const wordsToCheck = new Set();

  for (const p of realPlacements) {
    // Read horizontal word
    const hWord = readWordFromBoard(tempBoard, p.row, p.col, true);
    console.log(`[VALIDATE] Tile at ${p.row},${p.col}: horizontal word = "${hWord}" (${hWord.length} chars)`);
    if (hWord.length > 1) wordsToCheck.add(hWord);

    // Read vertical word
    const vWord = readWordFromBoard(tempBoard, p.row, p.col, false);
    console.log(`[VALIDATE] Tile at ${p.row},${p.col}: vertical word = "${vWord}" (${vWord.length} chars)`);
    if (vWord.length > 1) wordsToCheck.add(vWord);
  }

  console.log('[VALIDATE] Words to check:', Array.from(wordsToCheck));

  if (wordsToCheck.size === 0) {
    submitBtn.disabled = true;
    showMessage(i18n.t('mustFormWord'), 'error');
    return;
  }

  // Check each word via server
  let validationsPending = wordsToCheck.size;
  let allValid = true;
  const invalidWords = [];

  wordsToCheck.forEach(word => {
    socket.emit('validate-word', { word });
  });

  // Listen for validation responses
  const validationHandler = (data) => {
    validationsPending--;

    if (!data.isValid) {
      allValid = false;
      invalidWords.push(data.word);
    }

    if (validationsPending === 0) {
      socket.off('word-validated', validationHandler);

      // Temporarily allow submission even if words are invalid
      submitBtn.disabled = false;

      if (allValid) {
        showMessage('', '');
      } else {
        showMessage(i18n.t('invalidWords', { words: invalidWords.join(', ') }), 'warning');
      }
    }
  };

  socket.on('word-validated', validationHandler);
}

function readWordFromBoard(board, row, col, horizontal) {
  let word = '';

  if (horizontal) {
    let startCol = col;
    let endCol = col;

    while (startCol > 0 && board[row][startCol - 1].letter) startCol--;
    while (endCol < 14 && board[row][endCol + 1].letter) endCol++;

    for (let c = startCol; c <= endCol; c++) {
      word += board[row][c].letter || '';
    }
  } else {
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

function emitTilePreview() {
  if (!socket) return;
  socket.emit('tile-preview', {
    placements: currentPlacements.map(p => ({ row: p.row, col: p.col, letter: p.letter }))
  });
}

function recallSingleTile(placement) {
  const myPlayer = gameState.players.find(p => p.id === playerId);
  if (!myPlayer) return;

  // Return the tile to the rack
  const tile = {
    letter: placement.isBlank ? '' : placement.letter,
    points: placement.points,
    isBlank: placement.isBlank || false
  };
  // Re-add rotation info if it was a rotated tile
  if (placement.isRotated) {
    tile.isRotatable = true;
    tile.isRotated = true;
  }
  myPlayer.rack.splice(placement.rackIndex, 0, tile);
}

function submitMove() {
  // Only submit real (non-ghost) placements
  const realPlacements = currentPlacements.filter(p => !p.isGhost);

  if (realPlacements.length === 0) {
    showMessage(i18n.t('errorNoTilesPlaced'), 'error');
    return;
  }

  console.log('[SUBMIT-MOVE] Submitting placements:', realPlacements);

  // Keep placements until server confirms - don't clear yet
  socket.emit('make-move', {
    placements: realPlacements
  });

  // Clear preview since we're submitting
  socket.emit('tile-preview', { placements: [] });

  // Play submit sound
  if (window.sounds) sounds.moveSubmitted();

  // Disable submit button while waiting
  document.getElementById('submit-move-btn').disabled = true;
  showMessage(i18n.t('submittingMove'), 'info');
}

function recallTiles() {
  if (currentPlacements.length === 0) return;

  // Play recall sound
  if (window.sounds) sounds.tilesRecalled();

  // Set flag to prevent slide-in animation
  isRecalling = true;

  // Reset previousRackSize to ensure tiles reappear correctly
  // The rack will grow by the number of tiles being recalled
  previousRackSize = Math.max(0, previousRackSize - currentPlacements.length);

  const board = document.getElementById('board');
  const rack = document.getElementById('rack');
  const rackRect = rack.getBoundingClientRect();

  // Animate each placed tile flying back to the rack
  currentPlacements.forEach((placement, index) => {
    const squares = board.querySelectorAll('.square');
    squares.forEach(square => {
      const row = parseInt(square.dataset.row);
      const col = parseInt(square.dataset.col);
      if (row === placement.row && col === placement.col) {
        const tileEl = square.querySelector('.placed-tile');
        if (tileEl) {
          // Get current position
          const tileRect = tileEl.getBoundingClientRect();

          // Calculate distance to rack (approximate - center of rack)
          const deltaX = rackRect.left + rackRect.width / 2 - tileRect.left;
          const deltaY = rackRect.top + rackRect.height / 2 - tileRect.top;

          // Create a flying clone
          const clone = tileEl.cloneNode(true);
          clone.className = 'rack-tile'; // Use rack-tile styling for proper appearance
          if (placement.isBlank) {
            clone.classList.add('blank');
          }
          clone.style.position = 'fixed';
          clone.style.left = tileRect.left + 'px';
          clone.style.top = tileRect.top + 'px';
          clone.style.width = '50px';
          clone.style.height = '50px';
          clone.style.margin = '0';
          clone.style.zIndex = '10000';
          clone.style.pointerEvents = 'none';
          clone.style.transition = `transform 0.4s ease-out, opacity 0.4s ease-out`;
          clone.style.transitionDelay = `${index * 0.05}s`;
          document.body.appendChild(clone);

          // Hide original
          tileEl.style.opacity = '0';

          // Trigger animation on next frame
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clone.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(0.5)`;
              clone.style.opacity = '0';
            });
          });

          // Remove clone after animation
          setTimeout(() => {
            clone.remove();
          }, 400 + (index * 50) + 100);
        }
      }
    });
  });

  // Calculate animation duration before clearing placements
  const numPlacements = currentPlacements.length;
  const longestDelay = 400 + (numPlacements * 50) + 100;

  // Immediately clear placements and update UI to show tiles back in rack
  // This ensures tiles reappear immediately, not after animation completes
  currentPlacements = [];
  updateBoard();
  updateGameUI();
  showMessage(i18n.t('msgTilesRecalled'), '');
  validateCurrentMove();
  emitTilePreview();

  // Clear recall flag after animations complete to ensure no unwanted slide-in
  setTimeout(() => {
    isRecalling = false;
  }, longestDelay);
}

// Keyboard controls
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (document.querySelector('.dialog-overlay[style*="display: flex"]')) return;
  if (!gameState || gameState.status !== 'active' || playerIndex === null) return;

  handleKeyboardInput(e);
});

function handleKeyboardInput(e) {
  const key = e.key;

  // Number keys 1-9: select rack tile
  if (key >= '1' && key <= '9') {
    const idx = parseInt(key) - 1;
    const rack = gameState.players[playerIndex].rack;
    const usedIndices = new Set(currentPlacements.map(p => p.rackIndex));
    if (idx < rack.length && !usedIndices.has(idx)) {
      selectedRackIndex = (selectedRackIndex === idx) ? null : idx;
      updateRack();
    }
    e.preventDefault();
    return;
  }

  // Tab: cycle rack selection
  if (key === 'Tab') {
    const rack = gameState.players[playerIndex].rack;
    if (rack.length > 0) {
      if (selectedRackIndex === null) {
        selectedRackIndex = findNextAvailableRackTile(-1);
      } else {
        selectedRackIndex = findNextAvailableRackTile(selectedRackIndex);
      }
      updateRack();
    }
    e.preventDefault();
    return;
  }

  // Arrow keys / WASD: move cursor
  let moved = false;
  if (key === 'ArrowUp' || key === 'w' || key === 'W') {
    boardCursor.row = Math.max(0, boardCursor.row - 1);
    moved = true;
  } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
    boardCursor.row = Math.min(14, boardCursor.row + 1);
    moved = true;
  } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
    boardCursor.col = Math.max(0, boardCursor.col - 1);
    moved = true;
  } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
    boardCursor.col = Math.min(14, boardCursor.col + 1);
    moved = true;
  }

  if (moved) {
    updateBoard();
    e.preventDefault();
    return;
  }

  // Space or Enter: place/pick up tile
  if (key === ' ' || key === 'Enter') {
    handleKeyboardPlacement();
    e.preventDefault();
    return;
  }

  // R: rotate selected tile
  if (key === 'r' || key === 'R') {
    if (selectedRackIndex !== null) {
      rotateTile(selectedRackIndex);
    }
    e.preventDefault();
    return;
  }

  // Escape: deselect or recall
  if (key === 'Escape') {
    if (selectedRackIndex !== null) {
      selectedRackIndex = null;
      updateRack();
    } else if (currentPlacements.length > 0) {
      recallTiles();
    }
    e.preventDefault();
    return;
  }
}

function handleKeyboardPlacement() {
  const { row, col } = boardCursor;

  // Check if there's already a ghost/current placement at this position
  const existingIdx = currentPlacements.findIndex(p => p.row === row && p.col === col);

  if (existingIdx !== -1) {
    // Pick up the placed tile -- return it to rack
    const placement = currentPlacements[existingIdx];
    currentPlacements.splice(existingIdx, 1);
    // If the picked-up tile was the selected one, keep selection; otherwise select it
    selectedRackIndex = placement.rackIndex;
    updateBoard();
    updateRack();
    updateGameUI();
    validateCurrentMove();
    emitTilePreview();
    return;
  }

  // Check if the board cell is occupied (existing permanent tile)
  if (gameState.board[row][col].letter !== null) {
    return;
  }

  // Check if we have a selected rack tile
  if (selectedRackIndex === null) return;

  const rack = gameState.players[playerIndex].rack;
  if (selectedRackIndex >= rack.length) return;

  const tile = rack[selectedRackIndex];

  // Check if this tile has already been placed elsewhere
  const alreadyPlaced = currentPlacements.find(p => p.rackIndex === selectedRackIndex);
  if (alreadyPlaced) return;

  const isGhostPlacement = gameState.currentPlayerIndex !== playerIndex;

  // For blank tiles, show the blank letter dialog
  if (tile.isBlank) {
    const rackIndex = selectedRackIndex;
    pendingBlankPlacement = {
      row,
      col,
      draggedTile: tile,
      rackIndex: rackIndex,
      isGhost: isGhostPlacement
    };
    showBlankLetterDialog();

    // After blank dialog resolves, advance cursor and select next tile
    const origSelectBlankLetter = selectBlankLetter;
    const origPendingHandler = function(letter) {
      origSelectBlankLetter(letter);
      advanceCursorAfterPlacement();
      selectedRackIndex = findNextAvailableRackTile(rackIndex);
      updateBoard();
      updateRack();
    };
    // Patch the letter grid buttons to use our handler
    const letterGrid = document.getElementById('letter-grid');
    const buttons = letterGrid.querySelectorAll('.letter-option');
    buttons.forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', () => origPendingHandler(newBtn.textContent));
    });
    return;
  }

  // Determine display letter and points (accounting for rotation state)
  const isRotated = tile.isRotatable && tile.isRotated;
  const displayLetter = isRotated ? tile.rotatedLetter : tile.letter;
  const displayPoints = isRotated ? tile.rotatedPoints : tile.points;

  const placement = {
    row,
    col,
    letter: displayLetter,
    points: displayPoints,
    isBlank: false,
    rackIndex: selectedRackIndex,
    isGhost: isGhostPlacement
  };
  if (isRotated) placement.isRotated = true;
  currentPlacements.push(placement);

  if (window.sounds) sounds.tilePlaced();

  advanceCursorAfterPlacement();
  selectedRackIndex = findNextAvailableRackTile(selectedRackIndex);

  updateBoard();
  updateRack();
  updateGameUI();
  validateCurrentMove();
  emitTilePreview();
}

function advanceCursorAfterPlacement() {
  if (currentPlacements.length < 2) {
    // First tile -- advance right by default
    boardCursor.col = Math.min(14, boardCursor.col + 1);
    return;
  }

  // Determine direction from existing placements
  const allSameRow = currentPlacements.every(p => p.row === currentPlacements[0].row);
  const allSameCol = currentPlacements.every(p => p.col === currentPlacements[0].col);

  if (allSameRow) {
    boardCursor.col = Math.min(14, boardCursor.col + 1);
  } else if (allSameCol) {
    boardCursor.row = Math.min(14, boardCursor.row + 1);
  }

  // Skip occupied squares
  while (boardCursor.row <= 14 && boardCursor.col <= 14 &&
         gameState.board[boardCursor.row][boardCursor.col].letter !== null) {
    if (allSameRow || currentPlacements.length < 2) {
      boardCursor.col = Math.min(14, boardCursor.col + 1);
    } else {
      boardCursor.row = Math.min(14, boardCursor.row + 1);
    }
    if (boardCursor.row > 14 || boardCursor.col > 14) break;
  }
  // Clamp back to valid range
  boardCursor.row = Math.min(14, boardCursor.row);
  boardCursor.col = Math.min(14, boardCursor.col);
}

function findNextAvailableRackTile(afterIndex) {
  const rack = gameState.players[playerIndex].rack;
  const usedIndices = new Set(currentPlacements.map(p => p.rackIndex));

  for (let i = afterIndex + 1; i < rack.length; i++) {
    if (!usedIndices.has(i)) return i;
  }
  for (let i = 0; i <= afterIndex; i++) {
    if (!usedIndices.has(i)) return i;
  }
  return null;
}

function passTurn() {
  if (confirm(i18n.t('confirmPassTurn'))) {
    socket.emit('pass-turn');
  }
}

function exchangeTilesClick() {
  if (exchangeMode) {
    // Execute exchange
    if (tilesToExchange.length === 0) {
      showMessage(i18n.t('selectTilesToExchange'), 'error');
      return;
    }

    socket.emit('exchange-tiles', { indices: tilesToExchange });
    exchangeMode = false;
    tilesToExchange = [];
    document.getElementById('exchange-tiles-btn').textContent = i18n.t('exchangeTiles');
    document.getElementById('cancel-exchange-btn').style.display = 'none';
    showMessage(i18n.t('exchangingTiles'), 'info');
  } else {
    // Enter exchange mode
    if (gameState.tilesRemaining < 7) {
      showMessage(i18n.t('cannotExchangeFewTiles'), 'error');
      return;
    }
    exchangeMode = true;
    tilesToExchange = [];
    updateRack();
    document.getElementById('exchange-tiles-btn').textContent = 'Confirm Exchange';
    document.getElementById('cancel-exchange-btn').style.display = 'inline-block';
    showMessage(i18n.t('clickTilesToExchange'), 'info');
  }
}

function cancelExchange() {
  exchangeMode = false;
  tilesToExchange = [];
  updateRack();
  document.getElementById('exchange-tiles-btn').textContent = i18n.t('exchangeTiles');
  document.getElementById('cancel-exchange-btn').style.display = 'none';
  showMessage('', '');
}

function toggleTileForExchange(index) {
  const idx = tilesToExchange.indexOf(index);
  if (idx >= 0) {
    tilesToExchange.splice(idx, 1);
  } else {
    tilesToExchange.push(index);
  }
  updateRack();
}

function leaveGame() {
  if (confirm(i18n.t('confirmLeaveGame'))) {
    // Remove yourself from the game
    const isAdmin = sessionStorage.getItem('shcrabble-adminMode') === 'true';
    socket.emit('remove-player', { targetPlayerId: playerId, isAdmin });
    // Navigate to main menu (clear URL to prevent auto-rejoin)
    window.location.assign('/shcrabble/');
  }
}

function goToMainMenu() {
  // Stop timer updates before leaving
  stopTimerUpdates();
  // Just navigate without leaving the game (clear URL to prevent auto-rejoin)
  window.location.assign('/shcrabble/');
}

function endGame() {
  if (confirm(i18n.t('confirmEndGame'))) {
    const isAdmin = sessionStorage.getItem('shcrabble-adminMode') === 'true';
    socket.emit('end-game', { isAdmin });
  }
}

async function deleteGame() {
  if (!confirm(i18n.t('confirmDeleteGame'))) {
    return;
  }

  try {
    const response = await fetch('/shcrabble/api/delete-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameIds: [gameState.gameId] })
    });

    if (response.ok) {
      alert(i18n.t('gameDeleted'));
      window.location.href = '/shcrabble/';
    } else {
      alert(i18n.t('failedDeleteGame'));
    }
  } catch (err) {
    console.error('Error deleting game:', err);
    alert(i18n.t('failedDeleteGame'));
  }
}

function togglePauseTimer() {
  socket.emit('toggle-timer-pause');
}

function hideGameControls() {
  // Hide rack and controls
  const rackContainer = document.getElementById('rack-container');
  if (rackContainer) {
    rackContainer.style.display = 'none';
  }

  // Hide end game button
  const endGameBtn = document.getElementById('end-game-btn');
  if (endGameBtn) {
    endGameBtn.style.display = 'none';
  }
}

async function showMyGamesDialog(showAllGames = false) {
  const userId = getUserId();
  const playerName = getUserName();

  // Store admin mode in sessionStorage if viewing all games
  if (showAllGames) {
    sessionStorage.setItem('shcrabble-adminMode', 'true');
  } else {
    sessionStorage.removeItem('shcrabble-adminMode');
  }

  const gamesList = document.getElementById('my-games-list');
  gamesList.innerHTML = '<p>Loading...</p>';
  document.getElementById('my-games-dialog').style.display = 'flex';

  try {
    // Admin view: show all games if requested, otherwise show user's games
    let endpoint;
    if (showAllGames) {
      endpoint = `/shcrabble/api/all-games`;
    } else {
      // Include playerName for backwards compatibility with old games
      endpoint = `/shcrabble/api/my-games/${encodeURIComponent(userId)}?playerName=${encodeURIComponent(playerName)}`;
    }
    const response = await fetch(endpoint);
    const data = await response.json();

    if (data.games.length === 0) {
      gamesList.innerHTML = '<p>No active games found.</p>';
      return;
    }

    gamesList.innerHTML = '';

    // Add delete button and controls if in admin mode
    if (showAllGames) {
      const controlsDiv = document.createElement('div');
      controlsDiv.style.padding = '10px';
      controlsDiv.style.borderBottom = '2px solid #ccc';
      controlsDiv.style.marginBottom = '10px';
      controlsDiv.innerHTML = `
        <button id="delete-selected-games-btn" class="primary-btn" style="background: #f44336;">Delete Selected</button>
        <span id="selected-count" style="margin-left: 10px; color: #666;">0 selected</span>
      `;
      gamesList.appendChild(controlsDiv);
    }

    data.games.forEach(game => {
      const gameDiv = document.createElement('div');
      gameDiv.className = 'game-item';
      gameDiv.style.padding = '15px';
      gameDiv.style.borderBottom = '1px solid #ddd';
      gameDiv.style.display = 'flex';
      gameDiv.style.alignItems = 'center';
      gameDiv.style.gap = '10px';

      const isCompleted = game.status === 'completed';
      const statusColor = isCompleted ? '#999' : (game.status === 'active' ? '#4caf50' : '#ff9800');
      const isYourTurn = game.currentTurn === playerName;
      const turnIndicator = isYourTurn && !isCompleted ? ' 🟢 Your turn!' : '';
      const activeIndicator = game.isActive ? '' : ' 💤 (No one connected)';

      // Add checkbox only in admin mode
      const checkboxHtml = showAllGames
        ? `<input type="checkbox" class="game-checkbox" data-game-id="${game.id}" style="width: 20px; height: 20px; cursor: pointer;">`
        : '';

      // Build game info
      let gameInfoHtml = '';
      if (isCompleted) {
        // Show final scores for completed games
        const winner = game.finalScores[0];
        const scoresPreview = game.finalScores.slice(0, 3).map((p, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
          return `${medal} ${p.name} (${p.score})`;
        }).join(', ');

        gameInfoHtml = `
          <div style="font-weight: bold; margin-bottom: 5px;">
            <span style="color: ${statusColor};">●</span> Game ${game.id.substring(0, 8)}... <span style="color: #999; font-weight: normal;">[FINISHED]</span>
          </div>
          <div style="font-size: 0.9em; color: #666;">
            Winner: <strong>${winner.name}</strong> (${winner.score} points)
          </div>
          <div style="font-size: 0.85em; color: #888;">
            ${scoresPreview}
          </div>
        `;
      } else {
        // Show active game info
        gameInfoHtml = `
          <div style="font-weight: bold; margin-bottom: 5px;">
            <span style="color: ${statusColor};">●</span> Game ${game.id.substring(0, 8)}...${activeIndicator}
          </div>
          <div style="font-size: 0.9em; color: #666;">
            Players: ${game.players.join(', ')}
          </div>
          <div style="font-size: 0.9em; color: #666;">
            Tiles remaining: ${game.tilesRemaining}${turnIndicator}
          </div>
        `;
      }

      gameDiv.innerHTML = `
        ${checkboxHtml}
        <div style="flex: 1; cursor: pointer;" class="game-info">
          ${gameInfoHtml}
        </div>
      `;

      // Only navigate when clicking the info area, not the checkbox
      const infoDiv = gameDiv.querySelector('.game-info');
      infoDiv.addEventListener('click', () => {
        // Close my-games dialog and open join-game dialog with pre-filled game ID
        document.getElementById('my-games-dialog').style.display = 'none';
        document.getElementById('game-id').value = game.id;
        document.getElementById('join-name').value = getUserName();
        // Fetch and display game info
        fetchAndDisplayGameInfo(game.id);
        document.getElementById('join-game-dialog').style.display = 'flex';
      });

      gamesList.appendChild(gameDiv);
    });

    // Add event listeners for admin controls
    if (showAllGames) {
      // Update selected count when checkboxes change
      document.querySelectorAll('.game-checkbox').forEach(cb => {
        cb.addEventListener('change', updateSelectedCount);
      });

      // Delete selected games
      document.getElementById('delete-selected-games-btn').addEventListener('click', deleteSelectedGames);
    }
  } catch (err) {
    console.error('Error loading games:', err);
    gamesList.innerHTML = '<p>Error loading games. Please try again.</p>';
  }
}

function updateSelectedCount() {
  const checkboxes = document.querySelectorAll('.game-checkbox:checked');
  const countSpan = document.getElementById('selected-count');
  if (countSpan) {
    countSpan.textContent = `${checkboxes.length} selected`;
  }
}

async function deleteSelectedGames() {
  const checkboxes = document.querySelectorAll('.game-checkbox:checked');
  const gameIds = Array.from(checkboxes).map(cb => cb.dataset.gameId);

  if (gameIds.length === 0) {
    alert('No games selected');
    return;
  }

  if (!confirm(`Delete ${gameIds.length} game(s)? This cannot be undone.`)) {
    return;
  }

  try {
    const response = await fetch('/shcrabble/api/delete-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameIds })
    });

    const result = await response.json();

    if (response.ok) {
      alert(`Successfully deleted ${result.deleted} game(s)`);
      // Refresh the games list
      await showMyGamesDialog(true); // true = show all games (admin mode)
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    console.error('Error deleting games:', err);
    alert('Failed to delete games. Please try again.');
  }
}

function showGameEndedDialog(finalScores) {
  const dialog = document.getElementById('game-ended-dialog');
  const scoresDiv = document.getElementById('final-scores');

  scoresDiv.innerHTML = '';

  finalScores.forEach((player, idx) => {
    const rank = idx + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
    const scoreEntry = document.createElement('div');
    scoreEntry.className = 'score-entry';
    scoreEntry.style.padding = '10px';
    scoreEntry.style.borderBottom = '1px solid #ddd';
    scoreEntry.innerHTML = `<strong>${rank}. ${medal} ${player.name}</strong>: ${player.score} points`;
    scoresDiv.appendChild(scoreEntry);
  });

  dialog.style.display = 'flex';
}

function showPlayerTiles(player) {
  // Only spectators can view other players' tiles
  if (playerIndex !== null) return;

  const dialog = document.getElementById('player-tiles-dialog');
  const nameElement = document.getElementById('player-tiles-name');
  const rackElement = document.getElementById('player-tiles-rack');

  // Set player name
  nameElement.textContent = `${player.name}'s Tiles`;

  // Clear and populate rack
  rackElement.innerHTML = '';

  if (!player.rack || player.rack.length === 0) {
    rackElement.innerHTML = '<p style="color: #666;">No tiles</p>';
  } else {
    player.rack.forEach(tile => {
      const tileDiv = document.createElement('div');
      tileDiv.className = 'rack-tile';
      tileDiv.style.cursor = 'default'; // Not draggable

      if (tile.isBlank) {
        tileDiv.classList.add('blank');
        tileDiv.textContent = '?';
      } else {
        tileDiv.textContent = tile.letter;

        // Add points display
        const pointsSpan = document.createElement('span');
        pointsSpan.className = 'tile-points';
        pointsSpan.textContent = tile.points;
        tileDiv.appendChild(pointsSpan);
      }

      rackElement.appendChild(tileDiv);
    });
  }

  // Show dialog
  dialog.style.display = 'flex';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initSocket();

  // Setup mobile pinch zoom for board
  setupBoardPinchZoom();

  // Check if joining via link
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('game')) {
    // Always show the join-game dialog with game info
    showJoinGameDialog();
  }

  // Event listeners for lobby buttons
  document.getElementById('create-game-btn').addEventListener('click', showCreateGameDialog);
  document.getElementById('join-game-btn').addEventListener('click', showJoinGameDialog);

  // Timer enabled checkbox toggle
  document.getElementById('timer-enabled').addEventListener('change', (e) => {
    document.getElementById('timer-settings').style.display = e.target.checked ? 'block' : 'none';
  });

  // Event listeners for dialog confirm buttons
  document.getElementById('create-game-confirm-btn').addEventListener('click', createGame);
  document.getElementById('join-game-confirm-btn').addEventListener('click', joinGame);
  document.getElementById('copy-link-btn').addEventListener('click', copyInviteLink);

  // Fetch game info when game ID is entered or changed
  document.getElementById('game-id').addEventListener('input', (e) => {
    const gameId = e.target.value.trim();
    fetchAndDisplayGameInfo(gameId);
  });
  document.getElementById('submit-move-btn').addEventListener('click', submitMove);
  document.getElementById('recall-tiles-btn').addEventListener('click', recallTiles);
  document.getElementById('exchange-tiles-btn').addEventListener('click', exchangeTilesClick);
  document.getElementById('cancel-exchange-btn').addEventListener('click', cancelExchange);
  document.getElementById('pass-turn-btn').addEventListener('click', passTurn);
  document.getElementById('main-menu-game-btn').addEventListener('click', goToMainMenu);
  document.getElementById('leave-game-btn').addEventListener('click', leaveGame);
  document.getElementById('end-game-btn').addEventListener('click', endGame);
  document.getElementById('delete-game-btn').addEventListener('click', deleteGame);
  document.getElementById('pause-timer-btn').addEventListener('click', togglePauseTimer);

  // Vote button handlers
  document.getElementById('vote-accept-btn').addEventListener('click', () => {
    if (currentVoteId) {
      console.log('[VOTE] Voting ACCEPT for', currentVoteId);
      socket.emit('submit-vote', { voteId: currentVoteId, accept: true });
      document.getElementById('vote-dialog').style.display = 'none';
      // Show progress dialog after voting
      document.getElementById('vote-progress-dialog').style.display = 'flex';
    }
  });

  document.getElementById('vote-reject-btn').addEventListener('click', () => {
    if (currentVoteId) {
      console.log('[VOTE] Voting REJECT for', currentVoteId);
      socket.emit('submit-vote', { voteId: currentVoteId, accept: false });
      document.getElementById('vote-dialog').style.display = 'none';
      // Show progress dialog after voting
      document.getElementById('vote-progress-dialog').style.display = 'flex';
    }
  });

  document.getElementById('cancel-vote-btn').addEventListener('click', () => {
    if (currentVoteId) {
      console.log('[VOTE] Cancelling vote', currentVoteId);
      socket.emit('cancel-vote', { voteId: currentVoteId });
      document.getElementById('vote-progress-dialog').style.display = 'none';
      currentVoteId = null;
    }
  });

  // Suggest end game dialog handlers
  document.getElementById('confirm-end-game-btn').addEventListener('click', () => {
    document.getElementById('suggest-end-game-dialog').style.display = 'none';
    endGame(); // Trigger the end game function
  });

  document.getElementById('continue-game-btn').addEventListener('click', () => {
    document.getElementById('suggest-end-game-dialog').style.display = 'none';
  });

  // Stop turn notification on any click in game screen
  document.addEventListener('click', (e) => {
    if (e.target.closest('#game-screen')) {
      stopTurnNotification();
    }
  });

  // Allow board squares to receive drops
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    // Handle drop on rack - remove placement and return to rack
    if (e.target.closest('#rack')) {
      e.preventDefault();
      if (!draggedTile) return;

      // If dragging from board, remove that placement
      if (draggedTile.fromBoard) {
        const idx = currentPlacements.findIndex(p =>
          p.row === draggedTile.boardRow && p.col === draggedTile.boardCol
        );
        if (idx >= 0) {
          currentPlacements.splice(idx, 1);
        }
      }

      draggedTile = null;
      draggedFromRack = false;
      updateBoard();
      updateGameUI();
      validateCurrentMove();
      emitTilePreview();
      return;
    }

    e.preventDefault();

    if (!draggedTile) return;

    const target = e.target.closest('.square');
    if (!target) return;

    const row = parseInt(target.dataset.row);
    const col = parseInt(target.dataset.col);

    // Determine if this is a ghost placement (not our turn)
    const isGhostPlacement = gameState.currentPlayerIndex !== playerIndex;

    if (gameState.board[row][col].letter) {
      showMessage(i18n.t('errorSquareOccupied'), 'error');
      return;
    }

    if (currentPlacements.find(p => p.row === row && p.col === col)) {
      showMessage(i18n.t('errorAlreadyPlaced'), 'error');
      return;
    }

    // If dragging from board, remove old placement
    let rackIndex = null;
    if (draggedTile.fromBoard) {
      const idx = currentPlacements.findIndex(p =>
        p.row === draggedTile.boardRow && p.col === draggedTile.boardCol
      );
      if (idx >= 0) {
        rackIndex = currentPlacements[idx].rackIndex;
        currentPlacements.splice(idx, 1);
      }
    } else {
      // Dragging from rack
      rackIndex = draggedTile.rackIndex;
    }

    // If it's a blank tile, show letter selection dialog
    if (draggedTile.isBlank) {
      pendingBlankPlacement = {
        row,
        col,
        draggedTile,
        rackIndex,
        isGhost: isGhostPlacement
      };
      showBlankLetterDialog();
      return;
    }

    // Add new placement (non-blank)
    const dropPlacement = {
      row,
      col,
      letter: draggedTile.letter,
      points: draggedTile.points,
      isBlank: false,
      rackIndex: rackIndex,
      isGhost: isGhostPlacement
    };
    if (draggedTile.isRotated) dropPlacement.isRotated = true;
    currentPlacements.push(dropPlacement);

    // Play placement sound
    if (window.sounds) sounds.tilePlaced();

    draggedTile = null;
    draggedFromRack = false;
    updateBoard();
    updateGameUI();
    validateCurrentMove();
    emitTilePreview();
  });

  // Burger menu handlers
  // Handle both burger menus (lobby and game screen)
  document.querySelectorAll('#burger-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const menu = e.target.closest('#burger-menu');
      const dropdown = menu.querySelector('#burger-dropdown');
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#burger-menu')) {
      document.querySelectorAll('#burger-dropdown').forEach(d => {
        d.style.display = 'none';
      });
    }
  });

  // Fade last move highlight when window gains focus
  window.addEventListener('focus', () => {
    if (lastMovePlacements.length > 0) {
      fadeLastMoveHighlight();
    }
  });

  // Settings menu buttons
  document.querySelectorAll('#settings-menu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('settings-dialog').style.display = 'flex';
      document.querySelectorAll('#burger-dropdown').forEach(d => {
        d.style.display = 'none';
      });
    });
  });


  // My Games menu buttons
  document.querySelectorAll('#my-games-menu-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      // Admin view: Cmd/Ctrl+click shows all games
      const showAllGames = e.metaKey || e.ctrlKey;
      await showMyGamesDialog(showAllGames);
      document.querySelectorAll('#burger-dropdown').forEach(d => {
        d.style.display = 'none';
      });
    });
  });

  // About menu buttons
  document.querySelectorAll('#about-menu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('about-content').innerHTML = i18n.getAbout();
      document.getElementById('about-dialog').style.display = 'flex';
      document.querySelectorAll('#burger-dropdown').forEach(d => {
        d.style.display = 'none';
      });
    });
  });

  // Rules menu buttons
  document.querySelectorAll('#rules-menu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('rules-content').innerHTML = i18n.getRules();
      document.getElementById('rules-dialog').style.display = 'flex';
      document.querySelectorAll('#burger-dropdown').forEach(d => {
        d.style.display = 'none';
      });
    });
  });

  // Close dialog handlers
  document.querySelectorAll('.close-dialog').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const dialogId = e.target.getAttribute('data-dialog');
      document.getElementById(dialogId).style.display = 'none';
    });
  });

  // Close dialogs on overlay click (except voting dialogs which are modal)
  document.querySelectorAll('.dialog-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      // Don't allow closing voting dialogs by clicking outside - they are modal
      if (overlay.id === 'vote-dialog' || overlay.id === 'vote-progress-dialog') {
        return;
      }
      if (e.target === overlay) {
        overlay.style.display = 'none';
      }
    });
  });

  // Language select handler
  document.getElementById('language-select').addEventListener('change', (e) => {
    i18n.setLanguage(e.target.value);
  });

  // Show clock checkbox handler
  const showClockCheckbox = document.getElementById('show-clock');
  showClockCheckbox.checked = localStorage.getItem('shcrabble-showClock') !== 'false';
  showClockCheckbox.addEventListener('change', (e) => {
    localStorage.setItem('shcrabble-showClock', e.target.checked ? 'true' : 'false');
    // Restart timer updates to apply the change
    stopTimerUpdates();
    startTimerUpdates();
    // Refresh the display
    if (gameState) {
      updatePlayersList();
    }
  });

  // Tutorial / welcome dialog (tutorialPage is module-level for cross-scope access)

  function closeWelcomeDialog() {
    const dontShow = document.getElementById('dont-show-welcome').checked;
    if (dontShow) {
      localStorage.setItem('shcrabble-hide-welcome-1.2', 'true');
    }
    document.getElementById('welcome-dialog').style.display = 'none';

    const isOwner = gameState && playerId === gameState.ownerId;
    if (pendingGameCreatedDialog || (isOwner && !isReconnection)) {
      document.getElementById('game-created-dialog').style.display = 'flex';
      pendingGameCreatedDialog = false;
    }
  }

  function updateTutorialPage() {
    document.querySelectorAll('.tutorial-page').forEach(p => {
      p.style.display = parseInt(p.dataset.page) === tutorialPage ? 'block' : 'none';
    });
    document.querySelectorAll('.tutorial-dots .dot').forEach((d, i) => {
      d.classList.toggle('active', i === tutorialPage - 1);
    });
    const prev = document.querySelector('.tutorial-prev');
    const next = document.querySelector('.tutorial-next');
    const pageCount = document.querySelectorAll('.tutorial-page').length;
    if (prev) prev.style.visibility = tutorialPage === 1 ? 'hidden' : 'visible';
    if (next) next.textContent = tutorialPage === pageCount ? 'Get Started!' : 'Next →';
  }

  window.tutorialNext = function() {
    const pageCount = document.querySelectorAll('.tutorial-page').length;
    if (tutorialPage < pageCount) { tutorialPage++; updateTutorialPage(); }
    else { closeWelcomeDialog(); }
  };
  window.tutorialPrev = function() {
    if (tutorialPage > 1) { tutorialPage--; updateTutorialPage(); }
  };

  // Custom tile distribution handlers
  setupCustomTileEditor();

  // Reload custom tiles when tile mode or extended checkbox changes
  function reloadCustomTilesForMode() {
    const baseMode = document.querySelector('input[name="tile-mode"]:checked').value;
    const useExtended = document.getElementById('use-extended').checked;
    const tileMode = useExtended ? baseMode + '-extended' : baseMode;
    const storageKey = 'customTiles-' + tileMode;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        customTiles = JSON.parse(saved);
      } catch (e) {
        customTiles = null;
      }
    } else {
      customTiles = null;
    }
  }

  document.querySelectorAll('input[name="tile-mode"]').forEach(radio => {
    radio.addEventListener('change', reloadCustomTilesForMode);
  });
  document.getElementById('use-extended').addEventListener('change', reloadCustomTilesForMode);

  // Initialize i18n
  i18n.init().then(() => {
    // Set current language in dropdown
    document.getElementById('language-select').value = i18n.getLanguage();
    // Update all text
    i18n.updateAllText();
  });
});

// Custom Tile Distribution
function getCurrentTileMode() {
  const baseMode = document.querySelector('input[name="tile-mode"]:checked').value;
  const useExtended = document.getElementById('use-extended').checked;
  return useExtended ? baseMode + '-extended' : baseMode;
}

async function loadDefaultTiles(tileMode) {
  const res = await fetch('/shcrabble/api/default-tiles/' + tileMode);
  const data = await res.json();
  return data.tiles;
}

let customTiles = null;

function setupCustomTileEditor() {
  const tileDistRadios = document.querySelectorAll('input[name="tile-distribution"]');
  const editBtn = document.getElementById('edit-tiles-btn');

  // Show/hide edit button based on selection
  tileDistRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      editBtn.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
  });

  // Open tile editor
  editBtn.addEventListener('click', () => {
    openTileEditor();
  });

  // Save tiles
  document.getElementById('save-tiles-btn').addEventListener('click', () => {
    saveTileDistribution();
  });

  // Reset to default
  document.getElementById('reset-tiles-btn').addEventListener('click', async () => {
    customTiles = await loadDefaultTiles(getCurrentTileMode());
    populateTileEditor();
  });

  // Import CSV
  document.getElementById('import-csv-btn').addEventListener('click', () => {
    document.getElementById('csv-file-input').click();
  });

  document.getElementById('csv-file-input').addEventListener('change', () => {
    importTilesFromCSV();
  });

  // Export as CSV
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    exportTilesAsCSV();
  });

  // Load custom tiles from localStorage based on tile mode
  const initBaseMode = document.querySelector('input[name="tile-mode"]:checked').value;
  const initExtended = document.getElementById('use-extended').checked;
  const initTileMode = initExtended ? initBaseMode + '-extended' : initBaseMode;
  const storageKey = 'customTiles-' + initTileMode;
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      customTiles = JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse custom tiles:', e);
    }
  }
}

async function openTileEditor() {
  const tileMode = getCurrentTileMode();
  if (!customTiles) {
    customTiles = await loadDefaultTiles(tileMode);
  }
  populateTileEditor();
  document.getElementById('tile-editor-dialog').style.display = 'flex';
}

function populateTileEditor() {
  const tbody = document.getElementById('tile-editor-body');
  const thead = document.getElementById('tile-editor-head');
  tbody.innerHTML = '';

  const tileMode = getCurrentTileMode();
  const isRotatable = tileMode.startsWith('rotation');

  if (thead) {
    thead.innerHTML = `
      <tr>
        <th style="padding: 8px; border: 1px solid #ddd;">Letter</th>
        <th style="padding: 8px; border: 1px solid #ddd;">Count</th>
        <th style="padding: 8px; border: 1px solid #ddd;">Points</th>
        ${isRotatable ? '<th style="padding: 8px; border: 1px solid #ddd;">Rotated Pts</th>' : ''}
      </tr>
    `;
  }

  customTiles.forEach((tile, index) => {
    const row = document.createElement('tr');
    let rotatedCol = '';
    if (isRotatable && tile.rotatedPoints !== undefined) {
      rotatedCol = `
        <td style="padding: 8px; border: 1px solid #ddd;">
          <input type="number" min="0" max="20" value="${tile.rotatedPoints}" data-index="${index}" data-field="rotatedPoints"
                 style="width: 60px; padding: 4px; text-align: center;">
        </td>
      `;
    } else if (isRotatable) {
      rotatedCol = '<td style="padding: 8px; border: 1px solid #ddd; text-align: center; color: #999;">\u2014</td>';
    }

    row.innerHTML = `
      <td style="padding: 8px; border: 1px solid #ddd; text-align: center; font-size: 1.2em;">${tile.letter === 'blank' ? '(Blank)' : tile.letter}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">
        <input type="number" min="0" max="20" value="${tile.count}" data-index="${index}" data-field="count"
               style="width: 60px; padding: 4px; text-align: center;">
      </td>
      <td style="padding: 8px; border: 1px solid #ddd;">
        <input type="number" min="0" max="20" value="${tile.points}" data-index="${index}" data-field="points"
               style="width: 60px; padding: 4px; text-align: center;">
      </td>
      ${rotatedCol}
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', updateTileValue);
  });

  updateTotalCount();
}

function updateTileValue(e) {
  const index = parseInt(e.target.dataset.index);
  const field = e.target.dataset.field;
  const value = parseInt(e.target.value) || 0;

  customTiles[index][field] = value;
  updateTotalCount();
}

function updateTotalCount() {
  const total = customTiles.reduce((sum, tile) => sum + tile.count, 0);
  document.getElementById('total-tiles-count').textContent = total;
}

function saveTileDistribution() {
  const baseMode = document.querySelector('input[name="tile-mode"]:checked').value;
  const useExtended = document.getElementById('use-extended').checked;
  const tileMode = useExtended ? baseMode + '-extended' : baseMode;
  const storageKey = 'customTiles-' + tileMode;
  localStorage.setItem(storageKey, JSON.stringify(customTiles));
  document.getElementById('tile-editor-dialog').style.display = 'none';
  alert('Custom tile distribution saved!');
}

function exportTilesAsCSV() {
  const tileMode = getCurrentTileMode();
  const isRotatable = tileMode.startsWith('rotation');
  let csv = isRotatable ? 'letter,count,points,rotated_points\n' : 'letter,count,points\n';
  customTiles.forEach(tile => {
    if (isRotatable) {
      csv += `${tile.letter},${tile.count},${tile.points},${tile.rotatedPoints !== undefined ? tile.rotatedPoints : ''}\n`;
    } else {
      csv += `${tile.letter},${tile.count},${tile.points}\n`;
    }
  });

  // Create download link
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'custom_tiles.csv';
  a.click();
  window.URL.revokeObjectURL(url);
}

function importTilesFromCSV() {
  const fileInput = document.getElementById('csv-file-input');
  const file = fileInput.files[0];

  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;
      const lines = content.trim().split('\n');

      // Skip header if present
      const startIdx = lines[0].toLowerCase().includes('letter') ? 1 : 0;

      const newTiles = [];
      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',');
        const letter = parts[0];
        const count = parts[1];
        const points = parts[2];
        const rotatedPoints = parts[3];

        if (!letter || count === undefined || points === undefined) {
          throw new Error(`Invalid CSV format at line ${i + 1}`);
        }

        const tile = {
          letter: letter.trim(),
          count: parseInt(count.trim()),
          points: parseInt(points.trim())
        };
        if (rotatedPoints && rotatedPoints.trim() !== '') {
          tile.rotatedPoints = parseInt(rotatedPoints.trim());
        }
        newTiles.push(tile);
      }

      if (newTiles.length === 0) {
        throw new Error('No valid tiles found in CSV');
      }

      // Update customTiles and refresh the editor
      customTiles = newTiles;
      populateTileEditor();
      showMessage('CSV imported successfully!', 'success');

    } catch (err) {
      showMessage(`Error importing CSV: ${err.message}`, 'error');
      console.error('CSV import error:', err);
    }

    // Clear file input so same file can be selected again
    fileInput.value = '';
  };

  reader.onerror = () => {
    showMessage('Error reading file', 'error');
    fileInput.value = '';
  };

  reader.readAsText(file);
}

function getSelectedTileDistribution() {
  const useCustom = document.querySelector('input[name="tile-distribution"]:checked').value === 'custom';
  return useCustom && customTiles ? customTiles : null;
}
