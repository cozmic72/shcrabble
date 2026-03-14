// Game client state
let socket = null;
let gameState = null;
let playerId = null;
let playerIndex = null;
let currentPlacements = [];
let draggedTile = null;
let draggedFromRack = false;
let rackDragSource = null;
let previousRackSize = 0;
let exchangeMode = false;
let tilesToExchange = [];
let currentVoteId = null;
let pendingGameCreatedDialog = false; // Flag to show game-created dialog after welcome
let pendingBlankPlacement = null; // Stores pending blank tile placement data

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

// Save user preferences
function saveUserName(name) {
  localStorage.setItem('shcrabble-userName', name);
}

function getUserName() {
  return localStorage.getItem('shcrabble-userName') || '';
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

    // Show welcome dialog on first visit
    const hideWelcome = localStorage.getItem('shcrabble-hide-welcome');
    if (!hideWelcome) {
      document.getElementById('welcome-content').innerHTML = i18n.getWelcome();
      document.getElementById('welcome-dialog').style.display = 'flex';
    } else if (pendingGameCreatedDialog) {
      // If welcome is hidden and we have a pending game-created dialog, show it now
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
    gameState = data.gameState;

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

    if (data.lastMove) {
      console.log(`[GAME-UPDATE] ${data.lastMove.playerName} scored ${data.lastMove.score}`);
      showMessage(i18n.t('msgPlayerScored', {
        name: data.lastMove.playerName,
        score: data.lastMove.score
      }), 'success');
    }
  });

  socket.on('error', (data) => {
    showMessage(data.message, 'error');

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
    showMessage(`${data.playerName} disconnected`, 'info');
    gameState = data.gameState;
    updatePlayersList();
  });

  socket.on('player-reconnected', (data) => {
    showMessage(`${data.playerName} reconnected`, 'success');
    gameState = data.gameState;
    updatePlayersList();
  });

  socket.on('spectator-joined', (data) => {
    showMessage(`${data.spectatorName} joined as spectator`, 'info');
    gameState.spectators = data.spectators;
    updatePlayersList();
  });

  socket.on('spectator-left', (data) => {
    showMessage(`${data.spectatorName} left`, 'info');
    gameState.spectators = data.spectators;
    updatePlayersList();
  });

  socket.on('player-removed', (data) => {
    showMessage(`${data.playerName} was removed from the game`, 'error');
    gameState = data.gameState;
    updatePlayersList();
    updateBoard();
  });

  socket.on('removed-from-game', (data) => {
    alert(data.message);
    window.location.reload();
  });

  socket.on('game-ended', (data) => {
    gameState = data.gameState;
    showGameEndedDialog(data.finalScores);
  });

  socket.on('vote-pending', (data) => {
    console.log('[VOTE-PENDING]', data);
    currentVoteId = data.voteId;
    showMessage(data.message, 'info');
  });

  socket.on('vote-request', (data) => {
    console.log('[VOTE-REQUEST]', data);
    currentVoteId = data.voteId;
    const wordsText = data.invalidWords.join(', ');
    document.getElementById('vote-question').textContent =
      `${data.playerName} placed '${wordsText}', but it's not in the dictionary. Will you allow this move?`;
    document.getElementById('vote-dialog').style.display = 'flex';
  });

  socket.on('vote-result', (data) => {
    console.log('[VOTE-RESULT]', data);
    document.getElementById('vote-dialog').style.display = 'none';
    showMessage(data.message, data.accepted ? 'success' : 'error');
    currentVoteId = null;
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
      showMessage('Move cancelled', 'info');
    }
  });
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
  const tilesLabel = i18n.t('tilesRemaining');
  document.getElementById('tiles-remaining').innerHTML = `<span data-i18n="tilesRemaining">${tilesLabel}</span>: ${count}`;
}

function updateGameUI() {
  if (!gameState) return;

  // Update players list
  updatePlayersList();

  // Update board
  updateBoard();

  // Update rack
  updateRack();

  // Update game info
  updateTilesRemaining(gameState.tilesRemaining);

  // Enable/disable submit button
  const submitBtn = document.getElementById('submit-move-btn');
  submitBtn.disabled = currentPlacements.length === 0 || gameState.currentPlayerIndex !== playerIndex;

  // Show/hide end game button for owner
  const endGameBtn = document.getElementById('end-game-btn');
  if (gameState.ownerId === playerId && gameState.status !== 'completed') {
    endGameBtn.style.display = 'inline-block';
  } else {
    endGameBtn.style.display = 'none';
  }
}

function updatePlayersList() {
  const playersList = document.getElementById('players-list');
  playersList.innerHTML = '';

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

    const scoreLabel = i18n.t('score');
    const tilesLabel = i18n.t('tiles');
    const disconnectedLabel = player.connected ? '' : ' (disconnected)';
    const isOwner = player.id === gameState.ownerId ? ' 👑' : '';
    const canRemove = gameState.ownerId === playerId && player.id !== playerId;
    console.log(`Player ${player.name}: ownerId=${gameState.ownerId}, myId=${playerId}, canRemove=${canRemove}`);
    const removeBtn = canRemove
      ? `<button class="remove-player-btn" data-player-id="${player.id}">Remove</button>`
      : '';

    card.innerHTML = `
      <div class="player-name">${player.name}${isOwner}${idx === gameState.currentPlayerIndex ? ' ⬅' : ''}${disconnectedLabel}</div>
      <div class="player-score">${scoreLabel}: ${player.score}</div>
      <div class="player-score">${tilesLabel}: ${player.rackCount}</div>
      ${removeBtn}
    `;

    playersList.appendChild(card);
  });

  // Add spectators section if any
  if (gameState.spectators && gameState.spectators.length > 0) {
    const spectatorsHeader = document.createElement('h3');
    spectatorsHeader.textContent = 'Spectators';
    spectatorsHeader.style.marginTop = '20px';
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
      if (confirm('Remove this player from the game?')) {
        socket.emit('remove-player', { targetPlayerId });
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

      // Highlight current placements
      const placement = currentPlacements.find(p => p.row === row && p.col === col);
      if (placement) {
        square.classList.add('placement');
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

        // Add drag handlers
        tileDiv.addEventListener('dragstart', handlePlacedTileDragStart);
        tileDiv.addEventListener('dragend', handleDragEnd);

        square.appendChild(tileDiv);
      } else {
        square.classList.remove('placement');
      }
    }
  }
}

function updateRack() {
  const rackDiv = document.getElementById('rack');
  rackDiv.innerHTML = '';

  const myPlayer = gameState.players.find(p => p.id === playerId);
  if (!myPlayer || !myPlayer.rack) return;

  const currentRackSize = myPlayer.rack.length;
  const hasNewTiles = currentRackSize > previousRackSize;

  myPlayer.rack.forEach((tile, idx) => {
    // Skip tiles that have been placed on the board
    const isPlaced = currentPlacements.some(p => p.rackIndex === idx);
    if (isPlaced) return;

    const tileDiv = document.createElement('div');
    tileDiv.className = 'rack-tile';

    // Animate new tiles (tiles at the end of the rack after move submission)
    if (hasNewTiles && idx >= previousRackSize) {
      tileDiv.classList.add('new-tile');
    }

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

    tileDiv.dataset.index = idx;
    tileDiv.dataset.letter = tile.letter;
    tileDiv.dataset.points = tile.points;
    tileDiv.dataset.isBlank = tile.isBlank;

    // In exchange mode, make tiles clickable to select
    if (exchangeMode) {
      tileDiv.style.cursor = 'pointer';
      if (tilesToExchange.includes(idx)) {
        tileDiv.style.opacity = '0.5';
        tileDiv.style.border = '3px solid #667eea';
      }
      tileDiv.addEventListener('click', () => toggleTileForExchange(idx));
    } else {
      // Make tiles draggable in normal mode
      tileDiv.draggable = true;
      tileDiv.addEventListener('dragstart', handleDragStart);
      tileDiv.addEventListener('dragend', handleDragEnd);
    }

    rackDiv.appendChild(tileDiv);
  });

  previousRackSize = currentRackSize;

  // Make rack itself a drop zone for reordering
  rackDiv.addEventListener('dragover', handleRackDragOver);
  rackDiv.addEventListener('drop', handleRackDrop);
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
  draggedTile = {
    letter: e.target.dataset.letter,
    points: parseInt(e.target.dataset.points),
    isBlank: e.target.dataset.isBlank === 'true',
    rackIndex: parseInt(e.target.dataset.index)
  };
  draggedFromRack = true;
  rackDragSource = e.target;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
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

function showJoinGameDialog() {
  // Prepopulate name from localStorage
  const savedName = getUserName();
  if (savedName) {
    document.getElementById('join-name').value = savedName;
  }

  // Check URL params for game ID
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('game')) {
    document.getElementById('game-id').value = urlParams.get('game');
  }

  document.getElementById('join-game-dialog').style.display = 'flex';
}

function createGame() {
  const name = document.getElementById('create-name').value.trim();
  const rackSize = parseInt(document.getElementById('rack-size').value);
  const allowVoting = document.getElementById('allow-voting').checked;

  if (!name) {
    alert('Please enter your name');
    return;
  }

  if (rackSize < 5 || rackSize > 12) {
    alert('Rack size must be between 5 and 12');
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
      allowVoting
    })
  })
    .then(res => res.json())
    .then(data => {
      document.getElementById('create-game-dialog').style.display = 'none';

      const inviteLink = window.location.origin + data.inviteLink;
      document.getElementById('invite-link').value = inviteLink;

      // Set flag to show game-created dialog after welcome dialog is dismissed
      pendingGameCreatedDialog = true;

      // Auto-join the game (which will trigger 'joined' event)
      socket.emit('join-game', {
        gameId: data.gameId,
        playerName: name
      });
    })
    .catch(err => {
      console.error('Error creating game:', err);
      alert('Failed to create game');
    });
}

function joinGame() {
  const name = document.getElementById('join-name').value.trim();
  let gameId = document.getElementById('game-id').value.trim();

  if (!name) {
    alert('Please enter your name');
    return;
  }

  if (!gameId) {
    alert('Please enter a game ID');
    return;
  }

  saveUserName(name);

  document.getElementById('join-game-dialog').style.display = 'none';

  socket.emit('join-game', {
    gameId: gameId,
    playerName: name
  });
}

function copyInviteLink() {
  const linkInput = document.getElementById('invite-link');
  linkInput.select();
  document.execCommand('copy');
  showMessage('Link copied!', 'success');
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

  const { row, col, draggedTile, rackIndex } = pendingBlankPlacement;

  console.log('[BLANK] Selected letter:', letter, 'for position:', row, col);

  // Add the placement with chosen letter
  currentPlacements.push({
    row,
    col,
    letter: letter,
    points: 0, // Blank tiles are worth 0 points
    isBlank: true,
    rackIndex: rackIndex
  });

  console.log('[BLANK] Current placements:', currentPlacements);

  // Clean up
  document.getElementById('blank-letter-dialog').style.display = 'none';
  pendingBlankPlacement = null;

  updateBoard();
  updateGameUI();
  validateCurrentMove();
}

function validateCurrentMove() {
  const submitBtn = document.getElementById('submit-move-btn');
  const messageArea = document.getElementById('message-area');

  if (currentPlacements.length === 0) {
    submitBtn.disabled = true;
    return;
  }

  console.log('[VALIDATE] Validating current move with placements:', currentPlacements);

  // Create temporary board with current placements
  const tempBoard = JSON.parse(JSON.stringify(gameState.board));
  currentPlacements.forEach(p => {
    tempBoard[p.row][p.col] = {
      letter: p.letter,
      points: p.points,
      isBlank: p.isBlank
    };
  });

  // Read horizontal and vertical word for each placed tile
  const wordsToCheck = new Set();

  for (const p of currentPlacements) {
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
    showMessage('Move must form at least one word', 'error');
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
        showMessage(`Warning: Invalid word(s): ${invalidWords.join(', ')}`, 'warning');
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

function submitMove() {
  if (currentPlacements.length === 0) {
    showMessage(i18n.t('errorNoTilesPlaced'), 'error');
    return;
  }

  console.log('[SUBMIT-MOVE] Submitting placements:', currentPlacements);

  // Keep placements until server confirms - don't clear yet
  socket.emit('make-move', {
    placements: currentPlacements
  });

  // Disable submit button while waiting
  document.getElementById('submit-move-btn').disabled = true;
  showMessage('Submitting move...', 'info');
}

function recallTiles() {
  currentPlacements = [];
  updateBoard();
  updateGameUI();
  showMessage(i18n.t('msgTilesRecalled'), '');
  validateCurrentMove();
}

function passTurn() {
  if (confirm('Are you sure you want to pass your turn?')) {
    socket.emit('pass-turn');
  }
}

function exchangeTilesClick() {
  if (exchangeMode) {
    // Execute exchange
    if (tilesToExchange.length === 0) {
      showMessage('Select at least one tile to exchange', 'error');
      return;
    }

    socket.emit('exchange-tiles', { indices: tilesToExchange });
    exchangeMode = false;
    tilesToExchange = [];
    document.getElementById('exchange-tiles-btn').textContent = i18n.t('exchangeTiles');
    document.getElementById('cancel-exchange-btn').style.display = 'none';
    showMessage('Exchanging tiles...', 'info');
  } else {
    // Enter exchange mode
    if (gameState.tilesRemaining < 7) {
      showMessage('Cannot exchange - fewer than 7 tiles remaining in bag', 'error');
      return;
    }
    exchangeMode = true;
    tilesToExchange = [];
    updateRack();
    document.getElementById('exchange-tiles-btn').textContent = 'Confirm Exchange';
    document.getElementById('cancel-exchange-btn').style.display = 'inline-block';
    showMessage('Click tiles to select for exchange, then click Confirm Exchange', 'info');
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
  if (confirm('Leave this game? You can rejoin later with the same name.')) {
    // Disconnect and reload to lobby
    window.location.href = '/shcrabble/';
  }
}

function endGame() {
  if (confirm('End the game now? Final scores will be calculated.')) {
    socket.emit('end-game');
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initSocket();

  // Check if joining via link - auto-open join dialog
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('game')) {
    showJoinGameDialog();
  }

  // Event listeners for lobby buttons
  document.getElementById('create-game-btn').addEventListener('click', showCreateGameDialog);
  document.getElementById('join-game-btn').addEventListener('click', showJoinGameDialog);

  // Event listeners for dialog confirm buttons
  document.getElementById('create-game-confirm-btn').addEventListener('click', createGame);
  document.getElementById('join-game-confirm-btn').addEventListener('click', joinGame);
  document.getElementById('copy-link-btn').addEventListener('click', copyInviteLink);
  document.getElementById('submit-move-btn').addEventListener('click', submitMove);
  document.getElementById('recall-tiles-btn').addEventListener('click', recallTiles);
  document.getElementById('exchange-tiles-btn').addEventListener('click', exchangeTilesClick);
  document.getElementById('cancel-exchange-btn').addEventListener('click', cancelExchange);
  document.getElementById('pass-turn-btn').addEventListener('click', passTurn);
  document.getElementById('leave-game-btn').addEventListener('click', leaveGame);
  document.getElementById('end-game-btn').addEventListener('click', endGame);

  // Vote button handlers
  document.getElementById('vote-accept-btn').addEventListener('click', () => {
    if (currentVoteId) {
      console.log('[VOTE] Voting ACCEPT for', currentVoteId);
      socket.emit('submit-vote', { voteId: currentVoteId, accept: true });
      document.getElementById('vote-dialog').style.display = 'none';
    }
  });

  document.getElementById('vote-reject-btn').addEventListener('click', () => {
    if (currentVoteId) {
      console.log('[VOTE] Voting REJECT for', currentVoteId);
      socket.emit('submit-vote', { voteId: currentVoteId, accept: false });
      document.getElementById('vote-dialog').style.display = 'none';
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
      return;
    }

    e.preventDefault();

    if (!draggedTile) return;

    const target = e.target.closest('.square');
    if (!target) return;

    const row = parseInt(target.dataset.row);
    const col = parseInt(target.dataset.col);

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
        rackIndex
      };
      showBlankLetterDialog();
      return;
    }

    // Add new placement (non-blank)
    currentPlacements.push({
      row,
      col,
      letter: draggedTile.letter,
      points: draggedTile.points,
      isBlank: false,
      rackIndex: rackIndex
    });

    draggedTile = null;
    draggedFromRack = false;
    updateBoard();
    updateGameUI();
    validateCurrentMove();
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

  // Settings menu buttons
  document.querySelectorAll('#settings-menu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('settings-dialog').style.display = 'flex';
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

  // Close dialog handlers
  document.querySelectorAll('.close-dialog').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const dialogId = e.target.getAttribute('data-dialog');
      document.getElementById(dialogId).style.display = 'none';
    });
  });

  // Close dialogs on overlay click
  document.querySelectorAll('.dialog-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.style.display = 'none';
      }
    });
  });

  // Language select handler
  document.getElementById('language-select').addEventListener('change', (e) => {
    i18n.setLanguage(e.target.value);
  });

  // Welcome dialog handlers
  document.getElementById('welcome-close-btn').addEventListener('click', () => {
    const dontShow = document.getElementById('dont-show-welcome').checked;
    if (dontShow) {
      localStorage.setItem('shcrabble-hide-welcome', 'true');
    }
    document.getElementById('welcome-dialog').style.display = 'none';

    // If game-created dialog is pending, show it now
    if (pendingGameCreatedDialog) {
      document.getElementById('game-created-dialog').style.display = 'flex';
      pendingGameCreatedDialog = false;
    }
  });

  // Initialize i18n
  i18n.init().then(() => {
    // Set current language in dropdown
    document.getElementById('language-select').value = i18n.getLanguage();
    // Update all text
    i18n.updateAllText();
  });
});
