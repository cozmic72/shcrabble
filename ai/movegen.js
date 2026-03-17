'use strict';

const BOARD_SIZE = 15;
const CENTER = 7;

const ALL_LETTERS = [
  '𐑐','𐑚','𐑑','𐑛','𐑒','𐑜','𐑓','𐑝','𐑔','𐑞','𐑕','𐑟','𐑖','𐑠','𐑗','𐑡',
  '𐑘','𐑢','𐑣','𐑤','𐑮','𐑥','𐑯','𐑙','𐑦','𐑰','𐑧','𐑱','𐑨','𐑲','𐑩','𐑳',
  '𐑴','𐑪','𐑵','𐑶','𐑷','𐑭','𐑺','𐑻','𐑫','𐑬'
];

const BONUS_LAYOUT = (() => {
  const b = Array.from({length: 15}, () => Array(15).fill(null));
  [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]].forEach(([r,c]) => b[r][c] = 'TW');
  [[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],[13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10]].forEach(([r,c]) => b[r][c] = 'DW');
  [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]].forEach(([r,c]) => b[r][c] = 'TL');
  [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]].forEach(([r,c]) => b[r][c] = 'DL');
  return b;
})();

function generateMoves(board, rack, trie, bonusLayout, alphabet) {
  if (!bonusLayout) bonusLayout = BONUS_LAYOUT;
  if (!alphabet) alphabet = ALL_LETTERS;

  const boardIsEmpty = isBoardEmpty(board);
  const moves = [];

  // Generate horizontal moves on the original board
  generateDirectionalMoves(board, rack, trie, bonusLayout, boardIsEmpty, false, moves, alphabet);

  // Generate vertical moves by transposing, then un-transpose results
  const tBoard = transpose(board);
  const tBonus = transpose(bonusLayout);
  const verticalMoves = [];
  generateDirectionalMoves(tBoard, rack, trie, tBonus, boardIsEmpty, true, verticalMoves, alphabet);

  // Un-transpose the placements in vertical moves
  for (let i = 0; i < verticalMoves.length; i++) {
    const move = verticalMoves[i];
    for (let j = 0; j < move.placements.length; j++) {
      const p = move.placements[j];
      const tmp = p.row;
      p.row = p.col;
      p.col = tmp;
    }
    moves.push(move);
  }

  moves.sort((a, b) => b.score - a.score);
  return moves;
}

function isBoardEmpty(board) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c].letter !== null) return false;
    }
  }
  return true;
}

function transpose(grid) {
  const t = Array.from({length: BOARD_SIZE}, () => Array(BOARD_SIZE));
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      t[c][r] = grid[r][c];
    }
  }
  return t;
}

function generateDirectionalMoves(board, rack, trie, bonusLayout, boardIsEmpty, isTransposed, moves, alphabet) {
  // Precompute cross-check sets for each empty cell in this orientation
  // crossChecks[r][c] = null means any letter, Set means only those letters
  const crossChecks = computeCrossChecks(board, trie, alphabet);

  for (let row = 0; row < BOARD_SIZE; row++) {
    const anchors = findAnchorsInRow(board, row, boardIsEmpty);
    if (anchors.length === 0) continue;

    for (let i = 0; i < anchors.length; i++) {
      const anchorCol = anchors[i];
      const maxLeftExtend = computeMaxLeftExtend(board, row, anchorCol, anchors);

      // Build rack availability: map of letter -> count, plus blank count
      const rackLetters = new Map();
      let blankCount = 0;
      const rotationPool = new Map();

      for (let ri = 0; ri < rack.length; ri++) {
        const tile = rack[ri];
        if (tile.isBlank) {
          blankCount++;
        } else {
          rackLetters.set(tile.letter, (rackLetters.get(tile.letter) || 0) + 1);
          if (tile.isRotatable) {
            const existing = rotationPool.get(tile.letter);
            if (existing) {
              existing.count++;
            } else {
              rotationPool.set(tile.letter, {
                rotatedLetter: tile.rotatedLetter,
                rotatedPoints: tile.rotatedPoints,
                count: 1,
              });
            }
          }
        }
      }

      // Build a points lookup from the rack
      const rackPoints = new Map();
      for (let ri = 0; ri < rack.length; ri++) {
        if (!rack[ri].isBlank && !rackPoints.has(rack[ri].letter)) {
          rackPoints.set(rack[ri].letter, rack[ri].points);
        }
      }

      const rackState = {
        letters: rackLetters,
        blanks: blankCount,
        rotations: rotationPool,
        points: rackPoints,
        totalTiles: rack.length,
      };

      // Try left parts of length 0..maxLeftExtend
      extendLeft(
        board, trie, crossChecks, bonusLayout, row, anchorCol,
        maxLeftExtend, rackState, [], 0, trie.root, moves, alphabet
      );
    }
  }
}

function computeCrossChecks(board, trie, alphabet) {
  const checks = Array.from({length: BOARD_SIZE}, () => Array(BOARD_SIZE).fill(null));

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c].letter !== null) continue;

      // Check if there are vertical (perpendicular) neighbors
      const hasAbove = r > 0 && board[r - 1][c].letter !== null;
      const hasBelow = r < BOARD_SIZE - 1 && board[r + 1][c].letter !== null;

      if (!hasAbove && !hasBelow) {
        checks[r][c] = null; // Any letter allowed
        continue;
      }

      // Gather the prefix above and suffix below
      let prefix = '';
      let rr = r - 1;
      while (rr >= 0 && board[rr][c].letter !== null) rr--;
      for (let k = rr + 1; k < r; k++) {
        prefix += board[k][c].letter;
      }

      let suffix = '';
      for (let k = r + 1; k < BOARD_SIZE && board[k][c].letter !== null; k++) {
        suffix += board[k][c].letter;
      }

      // Find which letters produce a valid cross-word: prefix + letter + suffix
      const validSet = new Set();
      for (let li = 0; li < alphabet.length; li++) {
        const letter = alphabet[li];
        if (trie.isWord(prefix + letter + suffix)) {
          validSet.add(letter);
        }
      }
      checks[r][c] = validSet;
    }
  }
  return checks;
}

function findAnchorsInRow(board, row, boardIsEmpty) {
  const anchors = [];

  if (boardIsEmpty) {
    // Only center cell is an anchor (only relevant if this is row 7)
    if (row === CENTER) anchors.push(CENTER);
    return anchors;
  }

  for (let c = 0; c < BOARD_SIZE; c++) {
    if (board[row][c].letter !== null) continue;
    // Adjacent to a filled cell?
    if (
      (c > 0 && board[row][c - 1].letter !== null) ||
      (c < BOARD_SIZE - 1 && board[row][c + 1].letter !== null) ||
      (row > 0 && board[row - 1][c].letter !== null) ||
      (row < BOARD_SIZE - 1 && board[row + 1][c].letter !== null)
    ) {
      anchors.push(c);
    }
  }
  return anchors;
}

function computeMaxLeftExtend(board, row, anchorCol, anchors) {
  let limit = 0;
  let c = anchorCol - 1;
  while (c >= 0 && board[row][c].letter === null) {
    // Stop if we hit another anchor (except the current one)
    if (anchors.indexOf(c) !== -1) break;
    limit++;
    c--;
  }
  return limit;
}

// Consume a primary letter from rackState, also decrementing the rotation pool
// when the remaining count means we must be consuming a rotatable tile.
// Returns true if a rotatable tile was consumed (for restoration).
function consumePrimaryLetter(rackState, letter, count) {
  rackState.letters.set(letter, count - 1);
  const rotInfo = rackState.rotations.get(letter);
  if (rotInfo && (count - 1) < rotInfo.count) {
    rotInfo.count--;
    return true;
  }
  return false;
}

function restorePrimaryLetter(rackState, letter, count, consumedRotatable) {
  rackState.letters.set(letter, count);
  if (consumedRotatable) {
    rackState.rotations.get(letter).count++;
  }
}

// Consume a rotatable tile in its rotated orientation
function consumeRotatedLetter(rackState, primaryLetter, rotInfo) {
  rotInfo.count--;
  const prevCount = rackState.letters.get(primaryLetter);
  rackState.letters.set(primaryLetter, prevCount - 1);
  return prevCount;
}

function restoreRotatedLetter(rackState, primaryLetter, rotInfo, prevCount) {
  rotInfo.count++;
  rackState.letters.set(primaryLetter, prevCount);
}

// Recursive left-part building, then extends right through the anchor
function extendLeft(board, trie, crossChecks, bonusLayout, row, anchorCol, leftRemaining, rackState, placements, tilesPlaced, node, moves, alphabet) {
  // Try extending right from current position (left part is complete)
  extendRight(board, trie, crossChecks, bonusLayout, row, anchorCol, anchorCol, rackState, placements, tilesPlaced, node, moves, alphabet);

  if (leftRemaining === 0) return;

  const col = anchorCol - (placements.filter(p => p.col < anchorCol).length + countBoardTilesLeft(board, row, anchorCol, placements));
  const leftCol = anchorCol - tilesPlaced - 1;
  // Actually we need to compute the column for the next left tile
  // The left part grows leftward from anchorCol-1
  const nextCol = anchorCol - (countLeftPartSize(placements, anchorCol, board, row)) - 1;

  if (nextCol < 0) return;

  // If the cell already has a tile, walk through it
  if (board[row][nextCol].letter !== null) {
    const existingLetter = board[row][nextCol].letter;
    const childNode = node.children.get(existingLetter);
    if (childNode) {
      extendLeft(board, trie, crossChecks, bonusLayout, row, anchorCol, leftRemaining - 1, rackState, placements, tilesPlaced, childNode, moves, alphabet);
    }
    return;
  }

  // Check cross-checks for this cell
  const cc = crossChecks[row][nextCol];

  // Try each letter from rack
  const tried = new Set();
  for (const [letter, count] of rackState.letters) {
    if (count <= 0) continue;
    if (cc !== null && !cc.has(letter)) continue;
    if (tried.has(letter)) continue;
    tried.add(letter);

    const childNode = node.children.get(letter);
    if (!childNode) continue;

    const consumedRotatable = consumePrimaryLetter(rackState, letter, count);
    const points = rackState.points.get(letter) || 0;
    placements.push({ row, col: nextCol, letter, points, isBlank: false });

    extendLeft(board, trie, crossChecks, bonusLayout, row, anchorCol, leftRemaining - 1, rackState, placements, tilesPlaced + 1, childNode, moves, alphabet);

    placements.pop();
    restorePrimaryLetter(rackState, letter, count, consumedRotatable);
  }

  // Try rotatable tiles in their rotated orientation
  for (const [primaryLetter, rotInfo] of rackState.rotations) {
    if (rotInfo.count <= 0) continue;
    const letter = rotInfo.rotatedLetter;
    if (tried.has(letter)) continue;
    if (cc !== null && !cc.has(letter)) continue;

    const childNode = node.children.get(letter);
    if (!childNode) continue;

    const prevCount = consumeRotatedLetter(rackState, primaryLetter, rotInfo);
    placements.push({ row, col: nextCol, letter, points: rotInfo.rotatedPoints, isBlank: false, primaryLetter });

    extendLeft(board, trie, crossChecks, bonusLayout, row, anchorCol, leftRemaining - 1, rackState, placements, tilesPlaced + 1, childNode, moves, alphabet);

    placements.pop();
    restoreRotatedLetter(rackState, primaryLetter, rotInfo, prevCount);
  }

  // Try blanks
  if (rackState.blanks > 0) {
    rackState.blanks--;
    for (let li = 0; li < alphabet.length; li++) {
      const letter = alphabet[li];
      if (cc !== null && !cc.has(letter)) continue;
      const childNode = node.children.get(letter);
      if (!childNode) continue;

      placements.push({ row, col: nextCol, letter, points: 0, isBlank: true });
      extendLeft(board, trie, crossChecks, bonusLayout, row, anchorCol, leftRemaining - 1, rackState, placements, tilesPlaced + 1, childNode, moves, alphabet);
      placements.pop();
    }
    rackState.blanks++;
  }
}

function countLeftPartSize(placements, anchorCol, board, row) {
  // Count how many cells to the left of anchor are covered (placements + board tiles traversed)
  let count = 0;
  for (let i = 0; i < placements.length; i++) {
    if (placements[i].col < anchorCol) count++;
  }
  // Also count board tiles that are between leftmost placement and anchor
  if (count > 0) {
    const leftmost = Math.min(...placements.filter(p => p.col < anchorCol).map(p => p.col));
    for (let c = leftmost; c < anchorCol; c++) {
      if (board[row][c].letter !== null) count++;
    }
  }
  return count;
}

function countBoardTilesLeft(board, row, anchorCol, placements) {
  let count = 0;
  if (placements.length > 0) {
    const leftCols = placements.filter(p => p.col < anchorCol).map(p => p.col);
    if (leftCols.length > 0) {
      const leftmost = Math.min(...leftCols);
      for (let c = leftmost; c < anchorCol; c++) {
        if (board[row][c].letter !== null) count++;
      }
    }
  }
  return count;
}

function extendRight(board, trie, crossChecks, bonusLayout, row, anchorCol, col, rackState, placements, tilesPlaced, node, moves, alphabet) {
  if (col >= BOARD_SIZE) {
    if (node.isEnd && tilesPlaced > 0) {
      recordMove(board, bonusLayout, placements, rackState.totalTiles, moves);
    }
    return;
  }

  if (board[row][col].letter !== null) {
    const existingLetter = board[row][col].letter;
    const childNode = node.children.get(existingLetter);
    if (childNode) {
      extendRight(board, trie, crossChecks, bonusLayout, row, anchorCol, col + 1, rackState, placements, tilesPlaced, childNode, moves, alphabet);
    }
    return;
  }

  if (node.isEnd && tilesPlaced > 0 && col > anchorCol) {
    recordMove(board, bonusLayout, placements, rackState.totalTiles, moves);
  }

  const cc = crossChecks[row][col];

  const tried = new Set();
  for (const [letter, count] of rackState.letters) {
    if (count <= 0) continue;
    if (cc !== null && !cc.has(letter)) continue;
    if (tried.has(letter)) continue;
    tried.add(letter);

    const childNode = node.children.get(letter);
    if (!childNode) continue;

    const consumedRotatable = consumePrimaryLetter(rackState, letter, count);
    const points = rackState.points.get(letter) || 0;
    placements.push({ row, col, letter, points, isBlank: false });

    extendRight(board, trie, crossChecks, bonusLayout, row, anchorCol, col + 1, rackState, placements, tilesPlaced + 1, childNode, moves, alphabet);

    placements.pop();
    restorePrimaryLetter(rackState, letter, count, consumedRotatable);
  }

  // Try rotatable tiles in their rotated orientation
  for (const [primaryLetter, rotInfo] of rackState.rotations) {
    if (rotInfo.count <= 0) continue;
    const letter = rotInfo.rotatedLetter;
    if (tried.has(letter)) continue;
    if (cc !== null && !cc.has(letter)) continue;

    const childNode = node.children.get(letter);
    if (!childNode) continue;

    const prevCount = consumeRotatedLetter(rackState, primaryLetter, rotInfo);
    placements.push({ row, col, letter, points: rotInfo.rotatedPoints, isBlank: false, primaryLetter });

    extendRight(board, trie, crossChecks, bonusLayout, row, anchorCol, col + 1, rackState, placements, tilesPlaced + 1, childNode, moves, alphabet);

    placements.pop();
    restoreRotatedLetter(rackState, primaryLetter, rotInfo, prevCount);
  }

  if (rackState.blanks > 0) {
    rackState.blanks--;
    for (let li = 0; li < alphabet.length; li++) {
      const letter = alphabet[li];
      if (cc !== null && !cc.has(letter)) continue;
      const childNode = node.children.get(letter);
      if (!childNode) continue;

      placements.push({ row, col, letter, points: 0, isBlank: true });
      extendRight(board, trie, crossChecks, bonusLayout, row, anchorCol, col + 1, rackState, placements, tilesPlaced + 1, childNode, moves, alphabet);
      placements.pop();
    }
    rackState.blanks++;
  }
}

function recordMove(board, bonusLayout, placements, rackTileCount, moves) {
  if (placements.length === 0) return;

  // Determine the main word direction and span
  const placementsCopy = placements.map(p => ({
    row: p.row,
    col: p.col,
    letter: p.letter,
    points: p.points,
    isBlank: p.isBlank,
    primaryLetter: p.primaryLetter || undefined,
  }));

  const row = placementsCopy[0].row;
  const allCols = placementsCopy.map(p => p.col);
  const minCol = Math.min(...allCols);
  const maxCol = Math.max(...allCols);

  // Build the placement lookup
  const placementMap = new Map();
  for (let i = 0; i < placementsCopy.length; i++) {
    placementMap.set(placementsCopy[i].col, placementsCopy[i]);
  }

  // Find the full extent of the main word (including board tiles)
  let wordStart = minCol;
  while (wordStart > 0 && board[row][wordStart - 1].letter !== null) wordStart--;
  let wordEnd = maxCol;
  while (wordEnd < BOARD_SIZE - 1 && board[row][wordEnd + 1].letter !== null) wordEnd++;

  // Build main word string and score it
  let mainWord = '';
  let mainWordScore = 0;
  let mainWordMultiplier = 1;

  for (let c = wordStart; c <= wordEnd; c++) {
    const placement = placementMap.get(c);
    if (placement) {
      const bonus = bonusLayout[row][c];
      let letterScore = placement.points;
      if (bonus === 'DL') letterScore *= 2;
      else if (bonus === 'TL') letterScore *= 3;
      if (bonus === 'DW') mainWordMultiplier *= 2;
      else if (bonus === 'TW') mainWordMultiplier *= 3;
      mainWordScore += letterScore;
      mainWord += placement.letter;
    } else {
      // Board tile
      const cell = board[row][c];
      mainWordScore += cell.isBlank ? 0 : (cell.points || 0);
      mainWord += cell.letter;
    }
  }

  mainWordScore *= mainWordMultiplier;

  const words = [];
  let totalScore = 0;

  // Only count the main word if it's at least 2 characters
  if ([...mainWord].length >= 2) {
    totalScore += mainWordScore;
    words.push(mainWord);
  }

  // Score cross-words for each placed tile
  for (let i = 0; i < placementsCopy.length; i++) {
    const p = placementsCopy[i];
    const col = p.col;

    // Check perpendicular (vertical in the original orientation, which means checking rows)
    let crossStart = row;
    while (crossStart > 0 && board[crossStart - 1][col].letter !== null) crossStart--;
    let crossEnd = row;
    while (crossEnd < BOARD_SIZE - 1 && board[crossEnd + 1][col].letter !== null) crossEnd++;

    if (crossStart === crossEnd) continue; // No cross-word (just the placed tile)

    let crossWord = '';
    let crossScore = 0;
    let crossMultiplier = 1;

    for (let r = crossStart; r <= crossEnd; r++) {
      if (r === row) {
        const bonus = bonusLayout[row][col];
        let letterScore = p.points;
        if (bonus === 'DL') letterScore *= 2;
        else if (bonus === 'TL') letterScore *= 3;
        if (bonus === 'DW') crossMultiplier *= 2;
        else if (bonus === 'TW') crossMultiplier *= 3;
        crossScore += letterScore;
        crossWord += p.letter;
      } else {
        const cell = board[r][col];
        crossScore += cell.isBlank ? 0 : (cell.points || 0);
        crossWord += cell.letter;
      }
    }

    crossScore *= crossMultiplier;
    totalScore += crossScore;
    words.push(crossWord);
  }

  // Bingo bonus: all rack tiles used
  if (placementsCopy.length === rackTileCount) {
    totalScore += 50;
  }

  moves.push({
    placements: placementsCopy,
    score: totalScore,
    words: words
  });
}

module.exports = { generateMoves, BONUS_LAYOUT, ALL_LETTERS };
