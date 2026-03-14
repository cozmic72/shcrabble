// Game client state
let socket = null;
let gameState = null;
let playerId = null;
let playerIndex = null;
let currentPlacements = [];
let draggedTile = null;
let draggedFromRack = false;
let rackDragSource = null;

// Initialize socket connection
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected to server');
  });

  socket.on('joined', (data) => {
    playerId = data.playerId;
    playerIndex = data.playerIndex;
    gameState = data.gameState;

    // Only show game screen if game is active
    if (gameState.status === 'active') {
      showGameScreen();
    }

    updateGameUI();

    // If still in lobby, show waiting message
    if (gameState.status === 'waiting') {
      showMessage(i18n.t('msgWaitingPlayers', { count: gameState.players.length }), '');
    }
  });

  socket.on('game-update', (data) => {
    gameState = data.gameState;

    // Switch to game screen when game becomes active
    if (gameState.status === 'active' && document.getElementById('lobby-screen').style.display !== 'none') {
      showGameScreen();
    }

    updateGameUI();

    if (data.lastMove) {
      showMessage(i18n.t('msgPlayerScored', {
        name: data.lastMove.playerName,
        score: data.lastMove.score
      }), 'success');
    }
  });

  socket.on('error', (data) => {
    showMessage(data.message, 'error');
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

    const scoreLabel = i18n.t('score');
    const tilesLabel = i18n.t('tiles');

    card.innerHTML = `
      <div class="player-name">${player.name}${idx === gameState.currentPlayerIndex ? ' ⬅' : ''}</div>
      <div class="player-score">${scoreLabel}: ${player.score}</div>
      <div class="player-score">${tilesLabel}: ${player.rackCount}</div>
    `;

    playersList.appendChild(card);
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
          label.textContent = i18n.t(`bonus${bonus}`);
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
      } else {
        square.classList.remove('occupied');
      }

      // Highlight current placements
      const placement = currentPlacements.find(p => p.row === row && p.col === col);
      if (placement) {
        square.classList.add('placement');
        const letter = document.createElement('div');
        letter.className = 'tile-letter';
        letter.textContent = placement.letter;
        square.appendChild(letter);
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

  myPlayer.rack.forEach((tile, idx) => {
    const tileDiv = document.createElement('div');
    tileDiv.className = 'rack-tile';
    if (tile.isBlank) {
      tileDiv.classList.add('blank');
      tileDiv.textContent = '?';
    } else {
      tileDiv.textContent = tile.letter;
    }
    tileDiv.dataset.index = idx;
    tileDiv.dataset.letter = tile.letter;
    tileDiv.dataset.points = tile.points;
    tileDiv.dataset.isBlank = tile.isBlank;

    // Make tiles draggable
    tileDiv.draggable = true;
    tileDiv.addEventListener('dragstart', handleDragStart);
    tileDiv.addEventListener('dragend', handleDragEnd);

    rackDiv.appendChild(tileDiv);
  });

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
function createGame() {
  const name = document.getElementById('host-name').value.trim();
  if (!name) {
    alert('Please enter your name');
    return;
  }

  fetch('/shcrabble/api/create')
    .then(res => res.json())
    .then(data => {
      const inviteLink = window.location.origin + data.inviteLink;
      document.getElementById('invite-link').value = inviteLink;
      document.getElementById('invite-link-container').style.display = 'block';

      // Auto-join the game
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

  // Check URL params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('game')) {
    gameId = urlParams.get('game');
    document.getElementById('game-id').value = gameId;
  }

  if (!name) {
    alert('Please enter your name');
    return;
  }

  if (!gameId) {
    alert('Please enter a game ID');
    return;
  }

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

function submitMove() {
  if (currentPlacements.length === 0) {
    showMessage(i18n.t('errorNoTilesPlaced'), 'error');
    return;
  }

  socket.emit('make-move', {
    placements: currentPlacements
  });

  currentPlacements = [];
  updateBoard();
}

function recallTiles() {
  currentPlacements = [];
  updateBoard();
  updateGameUI();
  showMessage(i18n.t('msgTilesRecalled'), '');
}

function passTurn() {
  if (confirm('Are you sure you want to pass your turn?')) {
    socket.emit('pass-turn');
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initSocket();

  // Check if joining via link
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('game')) {
    document.getElementById('game-id').value = urlParams.get('game');
  }

  // Event listeners
  document.getElementById('create-game-btn').addEventListener('click', createGame);
  document.getElementById('join-game-btn').addEventListener('click', joinGame);
  document.getElementById('copy-link-btn').addEventListener('click', copyInviteLink);
  document.getElementById('submit-move-btn').addEventListener('click', submitMove);
  document.getElementById('recall-tiles-btn').addEventListener('click', recallTiles);
  document.getElementById('pass-turn-btn').addEventListener('click', passTurn);

  // Allow board squares to receive drops
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    // Don't handle if this is a rack reorder
    if (e.target.closest('#rack')) {
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

    // Add placement
    currentPlacements.push({
      row,
      col,
      letter: draggedTile.letter,
      points: draggedTile.points,
      isBlank: draggedTile.isBlank
    });

    draggedTile = null;
    draggedFromRack = false;
    updateBoard();
    updateGameUI();
  });

  // Burger menu handlers
  document.getElementById('burger-btn').addEventListener('click', () => {
    const dropdown = document.getElementById('burger-dropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#burger-menu')) {
      document.getElementById('burger-dropdown').style.display = 'none';
    }
  });

  // Settings menu
  document.getElementById('settings-menu-btn').addEventListener('click', () => {
    document.getElementById('settings-dialog').style.display = 'flex';
    document.getElementById('burger-dropdown').style.display = 'none';
  });

  // About menu
  document.getElementById('about-menu-btn').addEventListener('click', () => {
    document.getElementById('about-content').innerHTML = i18n.getAbout();
    document.getElementById('about-dialog').style.display = 'flex';
    document.getElementById('burger-dropdown').style.display = 'none';
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

  // Initialize i18n
  i18n.init().then(() => {
    // Set current language in dropdown
    document.getElementById('language-select').value = i18n.getLanguage();
    // Update all text
    i18n.updateAllText();
  });
});
