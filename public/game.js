// Game client state
let socket = null;
let gameState = null;
let playerId = null;
let playerIndex = null;
let currentPlacements = [];
let draggedTile = null;

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
      showMessage(`Waiting for players... (${gameState.players.length}/2 minimum)`, '');
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
      showMessage(`${data.lastMove.playerName} scored ${data.lastMove.score} points!`, 'success');
    }
  });

  socket.on('error', (data) => {
    showMessage(data.message, 'error');
  });

  socket.on('word-validated', (data) => {
    console.log(`Word ${data.word} is ${data.isValid ? 'valid' : 'invalid'}`);
  });

  socket.on('player-left', (data) => {
    showMessage(`${data.playerName} left the game. ${data.playersRemaining} player(s) remaining.`, 'error');
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

function updateGameUI() {
  if (!gameState) return;

  // Update players list
  updatePlayersList();

  // Update board
  updateBoard();

  // Update rack
  updateRack();

  // Update game info
  document.getElementById('tiles-remaining').textContent = `Tiles: ${gameState.tilesRemaining}`;

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

    card.innerHTML = `
      <div class="player-name">${player.name}${idx === gameState.currentPlayerIndex ? ' ⬅' : ''}</div>
      <div class="player-score">Score: ${player.score}</div>
      <div class="player-score">Tiles: ${player.rackCount}</div>
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
          label.textContent = bonus;
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
}

function handleSquareClick(row, col) {
  if (gameState.currentPlayerIndex !== playerIndex) {
    showMessage("It's not your turn!", 'error');
    return;
  }

  if (gameState.board[row][col].letter) {
    showMessage("Square already occupied!", 'error');
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
    showMessage("No tiles in rack!", 'error');
    return;
  }

  showMessage(`Click a tile in your rack, then click a square to place it`, '');
}

// Drag and drop handlers
function handleDragStart(e) {
  draggedTile = {
    letter: e.target.dataset.letter,
    points: parseInt(e.target.dataset.points),
    isBlank: e.target.dataset.isBlank === 'true',
    rackIndex: parseInt(e.target.dataset.index)
  };
  e.target.classList.add('dragging');
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
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
    showMessage('No tiles placed!', 'error');
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
  showMessage('Tiles recalled', '');
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
    e.preventDefault();

    if (!draggedTile) return;

    const target = e.target.closest('.square');
    if (!target) return;

    const row = parseInt(target.dataset.row);
    const col = parseInt(target.dataset.col);

    if (gameState.board[row][col].letter) {
      showMessage("Square already occupied!", 'error');
      return;
    }

    if (currentPlacements.find(p => p.row === row && p.col === col)) {
      showMessage("Already placed a tile here!", 'error');
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
    updateBoard();
    updateGameUI();
  });
});
