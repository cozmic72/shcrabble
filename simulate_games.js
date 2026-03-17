'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = __dirname;

if (isMainThread) {
  runMain();
} else {
  runWorker();
}

// ---------------------------------------------------------------------------
// Main thread
// ---------------------------------------------------------------------------

async function runMain() {
  const args = parseArgs(process.argv.slice(2));
  const numGames = args.games;
  const alphabetName = args.alphabet;
  const vocabLimit = args.vocab;
  const topN = args.topN;

  const { ALPHABETS, buildWordList } = require(path.join(PROJECT_ROOT, 'ai', 'alphabet'));
  const alphabet = ALPHABETS[alphabetName];
  if (!alphabet) {
    console.error(`Unknown alphabet: "${alphabetName}". Valid options: ${Object.keys(ALPHABETS).join(', ')}`);
    process.exit(1);
  }

  const tilesPath = path.join(PROJECT_ROOT, 'data', alphabet.tiles);

  console.log(`Loading dictionary (alphabet: ${alphabet.name})...`);
  const readlexPath = path.join(PROJECT_ROOT, 'data', 'readlex', 'readlex.json');
  const wordList = buildWordList(readlexPath, alphabet, vocabLimit || undefined);
  const vocabLabel = vocabLimit ? `${vocabLimit} words (vocab limited)` : `${wordList.length} words`;
  console.log(`Dictionary ready: ${vocabLabel}`);
  if (topN > 1) console.log(`Move selection: random from top ${topN}`);

  const numWorkers = Math.min(os.cpus().length, numGames);
  const gamesPerWorker = distributeWork(numGames, numWorkers);

  console.log(`Running ${numGames} games across ${numWorkers} workers...`);
  const startTime = Date.now();

  let completedGames = 0;
  const allResults = [];
  let renderedBoards = [];

  const workerPromises = gamesPerWorker.map((count, workerIndex) => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: {
          wordList,
          alphabetLetters: alphabet.letters,
          rotationPairs: alphabet.rotationPairs || null,
          numGames: count,
          tilesPath,
          topN,
          render: workerIndex === 0 ? args.render : 0,
          workerIndex,
          projectRoot: PROJECT_ROOT
        }
      });

      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          completedGames += msg.count;
          if (completedGames % 100 === 0 || completedGames === numGames) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            process.stdout.write(`\r  Progress: ${completedGames}/${numGames} games (${elapsed}s)`);
          }
        } else if (msg.type === 'results') {
          allResults.push(msg.data);
          if (msg.boards) renderedBoards = renderedBoards.concat(msg.boards);
        }
      });

      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
        else resolve();
      });
    });
  });

  await Promise.all(workerPromises);
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nAll games complete in ${totalTime}s\n`);

  const merged = mergeResults(allResults);
  printReport(merged, numGames, tilesPath, alphabet.name);

  for (let i = 0; i < renderedBoards.length; i++) {
    printBoard(renderedBoards[i], i + 1);
  }
}

function parseArgs(argv) {
  let games = 1000;
  let alphabet = 'split';
  let vocab = 0;    // 0 = unlimited
  let topN = 1;     // pick from top N moves (1 = greedy)
  let render = 0;   // render N final boards

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--games' && i + 1 < argv.length) {
      games = parseInt(argv[++i], 10);
    } else if (argv[i] === '--alphabet' && i + 1 < argv.length) {
      alphabet = argv[++i];
    } else if (argv[i] === '--vocab' && i + 1 < argv.length) {
      vocab = parseInt(argv[++i], 10);
    } else if (argv[i] === '--top-n' && i + 1 < argv.length) {
      topN = parseInt(argv[++i], 10);
    } else if (argv[i] === '--render' && i + 1 < argv.length) {
      render = parseInt(argv[++i], 10);
    }
  }

  return { games, alphabet, vocab, topN, render };
}

function distributeWork(total, numWorkers) {
  const base = Math.floor(total / numWorkers);
  const remainder = total % numWorkers;
  const counts = [];
  for (let i = 0; i < numWorkers; i++) {
    counts.push(base + (i < remainder ? 1 : 0));
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Worker thread
// ---------------------------------------------------------------------------

function runWorker() {
  const { wordList, alphabetLetters, rotationPairs, numGames, tilesPath, topN, render, projectRoot } = workerData;

  const Trie = require(path.join(projectRoot, 'ai', 'trie'));
  const { generateMoves, BONUS_LAYOUT } = require(path.join(projectRoot, 'ai', 'movegen'));
  const Game = require(path.join(projectRoot, 'server', 'game'));

  const trie = new Trie();
  for (let i = 0; i < wordList.length; i++) {
    trie.insert(wordList[i]);
  }

  const customTiles = parseTilesCsv(tilesPath, rotationPairs);

  // Build a reverse rotation map: rotatedLetter -> primaryLetter
  // Used to identify rotated placements when matching against rack tiles
  const rotationMap = new Map();
  if (rotationPairs) {
    for (const [primary, rotated] of rotationPairs) {
      rotationMap.set(rotated, primary);
    }
  }

  const results = createEmptyResults();
  const renderedBoards = [];
  let progressBatch = 0;

  for (let g = 0; g < numGames; g++) {
    const gameResult = simulateOneGame(Game, trie, generateMoves, BONUS_LAYOUT, customTiles, alphabetLetters, rotationMap, topN);
    accumulateGameResult(results, gameResult);

    if (renderedBoards.length < render) {
      renderedBoards.push({
        board: gameResult.board,
        scores: gameResult.scores,
        turns: gameResult.totalTurns,
        passes: gameResult.totalPasses,
        completed: gameResult.playerWentOut,
        remaining: gameResult.remainingLetters,
      });
    }

    progressBatch++;
    if (progressBatch >= 10) {
      parentPort.postMessage({ type: 'progress', count: progressBatch });
      progressBatch = 0;
    }
  }

  if (progressBatch > 0) {
    parentPort.postMessage({ type: 'progress', count: progressBatch });
  }

  parentPort.postMessage({ type: 'results', data: results, boards: renderedBoards });
}

// ---------------------------------------------------------------------------
// Game simulation
// ---------------------------------------------------------------------------

function parseTilesCsv(tilesPath, rotationPairs) {
  const fs = require('fs');
  const content = fs.readFileSync(tilesPath, 'utf8');
  const lines = content.trim().split('\n').slice(1);

  // Build a lookup from primary letter to rotated letter using rotation pairs
  const rotatedLetterMap = new Map();
  if (rotationPairs) {
    for (const [primary, rotated] of rotationPairs) {
      rotatedLetterMap.set(primary, rotated);
    }
  }

  return lines.map(line => {
    const parts = line.split(',');
    const letter = parts[0].trim();
    const count = parseInt(parts[1], 10);
    const points = parseInt(parts[2], 10);
    const rotatedPointsStr = parts[3] ? parts[3].trim() : '';

    const tile = { letter, count, points };

    // If the CSV has a rotated_points value and this letter has a rotation pair,
    // mark the tile as rotatable
    if (rotatedPointsStr !== '' && rotatedLetterMap.has(letter)) {
      tile.isRotatable = true;
      tile.rotatedLetter = rotatedLetterMap.get(letter);
      tile.rotatedPoints = parseInt(rotatedPointsStr, 10);
    }

    return tile;
  });
}

function simulateOneGame(Game, trie, generateMoves, bonusLayout, customTiles, alphabetLetters, rotationMap, topN) {
  const game = new Game('sim', null, { rackSize: 9, rules: 'casual', allowVoting: false });
  game.customTiles = customTiles;

  // Build rotation info lookup from customTiles for tagging rack tiles
  const tileRotationInfo = new Map();
  for (const t of customTiles) {
    if (t.isRotatable) {
      tileRotationInfo.set(t.letter, {
        rotatedLetter: t.rotatedLetter,
        rotatedPoints: t.rotatedPoints,
      });
    }
  }

  function tagRotationInfo(tile) {
    if (tile.isBlank) return;
    const rotInfo = tileRotationInfo.get(tile.letter);
    if (rotInfo) {
      tile.isRotatable = true;
      tile.rotatedLetter = rotInfo.rotatedLetter;
      tile.rotatedPoints = rotInfo.rotatedPoints;
    }
  }

  game.addPlayer('p1', 'Player1');
  game.addPlayer('p2', 'Player2');

  // Tag rotation info on initial rack tiles (Game.loadTiles strips custom properties)
  if (tileRotationInfo.size > 0) {
    for (let pi = 0; pi < 2; pi++) {
      for (const tile of game.players[pi].rack) {
        tagRotationInfo(tile);
      }
    }
    for (const tile of game.tileBag) {
      tagRotationInfo(tile);
    }
  }

  // Tile tracking: each tile gets a unique id based on draw order
  // tileTracker[tileId] = { letter, points, isBlank, turnDrawn, turnPlayed, playerIndex, stranded }
  const tileTracker = [];
  let nextTileId = 0;

  // Map rack tiles to tracker ids. rackMap[playerIndex] = Map<rackIndex, tileId>
  // We use a simpler approach: track by identity using a WeakMap-like scheme.
  // Since tiles are plain objects, we tag them with a _simId property.
  function tagInitialRacks() {
    for (let pi = 0; pi < 2; pi++) {
      for (const tile of game.players[pi].rack) {
        const id = nextTileId++;
        tile._simId = id;
        tileTracker.push({
          letter: tile.isBlank ? '(blank)' : tile.letter,
          points: tile.points,
          isBlank: tile.isBlank,
          turnDrawn: 0,
          turnPlayed: -1,
          playerIndex: pi,
          stranded: false
        });
      }
    }
  }

  tagInitialRacks();

  let totalTurns = 0;
  let totalPasses = 0;
  let moveScores = [];

  while (game.status === 'active') {
    const pi = game.currentPlayerIndex;
    const player = game.players[pi];
    const rack = player.rack;

    const moves = generateMoves(game.board, rack, trie, bonusLayout, alphabetLetters);
    let bestMove = null;
    if (moves.length > 0) {
      const candidates = Math.min(topN, moves.length);
      bestMove = moves[Math.floor(Math.random() * candidates)];
    }

    totalTurns++;

    if (bestMove) {
      // Record which tiles are being played by matching placements to rack tiles
      const usedRackIndices = identifyUsedRackTiles(rack, bestMove.placements);
      for (const ri of usedRackIndices) {
        const tile = rack[ri];
        if (tile._simId !== undefined) {
          tileTracker[tile._simId].turnPlayed = totalTurns;
        }
      }

      // For rotated placements, swap to primary letter before placeTiles
      // so rack matching works (Game matches on t.letter === p.letter)
      const rotatedPlacements = [];
      if (rotationMap.size > 0) {
        for (const p of bestMove.placements) {
          if (p.primaryLetter) {
            rotatedPlacements.push({ index: bestMove.placements.indexOf(p), originalLetter: p.letter, row: p.row, col: p.col });
            p.letter = p.primaryLetter;
          }
        }
      }

      try {
        game.placeTiles(pi, bestMove.placements);
      } catch (_) {
        // Restore rotated letters before continuing
        for (const rp of rotatedPlacements) {
          bestMove.placements[rp.index].letter = rp.originalLetter;
        }
        // Rare movegen edge case (blank + same-letter) — treat as pass
        game.consecutiveScorelessTurns++;
        totalPasses++;
        game.nextTurn();
        continue;
      }

      // Fix board cells to show the correct (rotated) letter
      for (const rp of rotatedPlacements) {
        game.board[rp.row][rp.col].letter = rp.originalLetter;
        bestMove.placements[rp.index].letter = rp.originalLetter;
      }

      // Tag any newly drawn tiles (placeTiles refills the rack)
      for (const tile of player.rack) {
        if (tile._simId === undefined) {
          const id = nextTileId++;
          tile._simId = id;
          tagRotationInfo(tile);
          tileTracker.push({
            letter: tile.isBlank ? '(blank)' : tile.letter,
            points: tile.points,
            isBlank: tile.isBlank,
            turnDrawn: totalTurns,
            turnPlayed: -1,
            playerIndex: pi,
            stranded: false
          });
        }
      }

      player.score += bestMove.score;
      game.consecutiveScorelessTurns = 0;
      moveScores.push(bestMove.score);
    } else {
      game.consecutiveScorelessTurns++;
      totalPasses++;
    }

    // Check end conditions before advancing turn
    const rackEmpty = player.rack.length === 0 && game.tileBag.length === 0;
    const stalledByPasses = game.consecutiveScorelessTurns >= 4;

    if (rackEmpty || stalledByPasses) {
      game.status = 'completed';
      break;
    }

    game.nextTurn();
  }

  game.applyEndgameScoring();

  // Mark stranded tiles
  for (let pi = 0; pi < 2; pi++) {
    for (const tile of game.players[pi].rack) {
      if (tile._simId !== undefined) {
        tileTracker[tile._simId].stranded = true;
      }
    }
  }

  const playerWentOut = game.players.some(p => p.rack.length === 0);

  return {
    totalTurns,
    totalPasses,
    scores: [game.players[0].score, game.players[1].score],
    playerWentOut,
    remainingTiles: [game.players[0].rack.length, game.players[1].rack.length],
    remainingLetters: [
      game.players[0].rack.map(t => t.isBlank ? '*' : t.letter),
      game.players[1].rack.map(t => t.isBlank ? '*' : t.letter),
    ],
    moveScores,
    tileTracker,
    board: game.board,
  };
}

function identifyUsedRackTiles(rack, placements) {
  const used = [];
  const claimed = new Set();

  for (const p of placements) {
    const idx = rack.findIndex((t, i) => {
      if (claimed.has(i)) return false;
      if (t.isBlank && p.isBlank) return true;
      if (t.isBlank || p.isBlank) return false;
      // Direct letter match
      if (t.letter === p.letter) return true;
      // Rotated placement: placement has primaryLetter, rack tile has that as its letter
      if (p.primaryLetter && t.isRotatable && t.letter === p.primaryLetter) return true;
      return false;
    });
    if (idx >= 0) {
      used.push(idx);
      claimed.add(idx);
    }
  }

  return used;
}

// ---------------------------------------------------------------------------
// Result accumulation
// ---------------------------------------------------------------------------

function createEmptyResults() {
  return {
    gameCount: 0,
    totalTurns: 0,
    totalPasses: 0,
    totalMoves: 0,
    completedGames: 0,
    stalledGames: 0,
    allScores: [],
    // Per-letter: letter -> { totalLingerTurns, playedCount, strandedCount, totalDrawn }
    letterStats: {}
  };
}

function accumulateGameResult(results, gameResult) {
  results.gameCount++;
  results.totalTurns += gameResult.totalTurns;
  results.totalPasses += gameResult.totalPasses;
  results.totalMoves += gameResult.totalTurns - gameResult.totalPasses;

  if (gameResult.playerWentOut) {
    results.completedGames++;
  } else {
    results.stalledGames++;
  }

  results.allScores.push(gameResult.scores[0], gameResult.scores[1]);

  for (const entry of gameResult.tileTracker) {
    const letter = entry.letter;
    if (!results.letterStats[letter]) {
      results.letterStats[letter] = { totalLingerTurns: 0, playedCount: 0, strandedCount: 0, totalDrawn: 0 };
    }
    const stats = results.letterStats[letter];
    stats.totalDrawn++;

    if (entry.turnPlayed >= 0) {
      stats.playedCount++;
      stats.totalLingerTurns += (entry.turnPlayed - entry.turnDrawn);
    }
    if (entry.stranded) {
      stats.strandedCount++;
    }
  }
}

// ---------------------------------------------------------------------------
// Merging results from multiple workers
// ---------------------------------------------------------------------------

function mergeResults(allResults) {
  const merged = createEmptyResults();

  for (const r of allResults) {
    merged.gameCount += r.gameCount;
    merged.totalTurns += r.totalTurns;
    merged.totalPasses += r.totalPasses;
    merged.totalMoves += r.totalMoves;
    merged.completedGames += r.completedGames;
    merged.stalledGames += r.stalledGames;
    merged.allScores.push(...r.allScores);

    for (const [letter, stats] of Object.entries(r.letterStats)) {
      if (!merged.letterStats[letter]) {
        merged.letterStats[letter] = { totalLingerTurns: 0, playedCount: 0, strandedCount: 0, totalDrawn: 0 };
      }
      const m = merged.letterStats[letter];
      m.totalLingerTurns += stats.totalLingerTurns;
      m.playedCount += stats.playedCount;
      m.strandedCount += stats.strandedCount;
      m.totalDrawn += stats.totalDrawn;
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printBoard(gameData, gameNum) {
  const { board, scores, turns, passes, completed, remaining } = gameData;
  const status = completed ? 'completed' : 'stalled';

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  GAME ${gameNum} — ${status} (${turns} turns, ${passes} passes)`);
  console.log(`  P1: ${scores[0]} pts  P2: ${scores[1]} pts`);
  if (remaining[0].length > 0) console.log(`  P1 rack: ${remaining[0].join(' ')}`);
  if (remaining[1].length > 0) console.log(`  P2 rack: ${remaining[1].join(' ')}`);
  console.log('='.repeat(70));

  // Column headers
  const colNums = '    ' + Array.from({length: 15}, (_, i) =>
    String(i).padStart(2)).join('');
  console.log(colNums);
  console.log('   +' + '──'.repeat(15) + '─+');

  for (let r = 0; r < 15; r++) {
    let row = String(r).padStart(2) + ' │';
    for (let c = 0; c < 15; c++) {
      const cell = board[r][c];
      if (cell.letter !== null) {
        row += cell.letter + ' ';
      } else {
        const bonus = cell.bonus;
        if (bonus === 'TW') row += '≡ ';
        else if (bonus === 'DW') row += '▪ ';
        else if (bonus === 'TL') row += '∴ ';
        else if (bonus === 'DL') row += '· ';
        else if (r === 7 && c === 7) row += '★ ';
        else row += '  ';
      }
    }
    row += '│';
    console.log(row);
  }
  console.log('   +' + '──'.repeat(15) + '─+');
  console.log('  Legend: ≡=TW  ▪=DW  ∴=TL  ·=DL  ★=center');
}

function printReport(results, numGames, tilesPath, alphabetName) {
  const fs = require('fs');
  const divider = '='.repeat(70);
  const subDivider = '-'.repeat(70);

  console.log(divider);
  console.log(`  SHCRABBLE MONTE CARLO SIMULATION REPORT (alphabet: ${alphabetName})`);
  console.log(divider);

  // Aggregate stats
  const avgTurns = (results.totalTurns / numGames).toFixed(1);
  const avgScore = (results.allScores.reduce((a, b) => a + b, 0) / results.allScores.length).toFixed(1);
  const passRate = ((results.totalPasses / results.totalTurns) * 100).toFixed(1);
  const completionRate = ((results.completedGames / numGames) * 100).toFixed(1);

  console.log('\n  AGGREGATE STATISTICS');
  console.log(subDivider);
  console.log(`  Games simulated:      ${numGames}`);
  console.log(`  Completion rate:      ${completionRate}% (player emptied rack)`);
  console.log(`  Stalled games:        ${results.stalledGames} (ended by consecutive passes)`);
  console.log(`  Avg turns per game:   ${avgTurns}`);
  console.log(`  Avg final score:      ${avgScore}`);
  console.log(`  Pass rate:            ${passRate}% of all turns`);

  // Score distribution
  const scores = results.allScores.slice().sort((a, b) => a - b);
  const min = scores[0];
  const max = scores[scores.length - 1];
  const median = scores[Math.floor(scores.length / 2)];
  const p10 = scores[Math.floor(scores.length * 0.1)];
  const p90 = scores[Math.floor(scores.length * 0.9)];

  console.log('\n  SCORE DISTRIBUTION');
  console.log(subDivider);
  console.log(`  Min:      ${min}`);
  console.log(`  10th pct: ${p10}`);
  console.log(`  Median:   ${median}`);
  console.log(`  90th pct: ${p90}`);
  console.log(`  Max:      ${max}`);

  printScoreHistogram(scores);

  // Load tile points from the same CSV used for simulation
  const pointValues = {};
  const tilesContent = fs.readFileSync(tilesPath, 'utf8');
  const tilesLines = tilesContent.trim().split('\n').slice(1);
  for (const line of tilesLines) {
    const [letter, , points] = line.split(',');
    if (letter !== 'blank') {
      pointValues[letter] = parseInt(points, 10);
    }
  }

  // Per-letter stats sorted by stranded rate descending
  const letterEntries = Object.entries(results.letterStats)
    .filter(([letter]) => letter !== '(blank)')
    .sort((a, b) => {
      const aRate = a[1].totalDrawn > 0 ? a[1].strandedCount / a[1].totalDrawn : 0;
      const bRate = b[1].totalDrawn > 0 ? b[1].strandedCount / b[1].totalDrawn : 0;
      return bRate - aRate;
    });

  const lingerValues = {};
  const strandRates = {};

  console.log('\n  PER-LETTER METRICS');
  console.log(subDivider);
  console.log(`  ${'Letter'.padEnd(10)} ${'Points'.padStart(6)} ${'Drawn'.padStart(7)} ${'Played'.padStart(7)} ${'Stranded'.padStart(9)} ${'Strand%'.padStart(8)} ${'AvgLinger'.padStart(10)}`);
  console.log(`  ${''.padEnd(10, '-')} ${''.padEnd(6, '-')} ${''.padEnd(7, '-')} ${''.padEnd(7, '-')} ${''.padEnd(9, '-')} ${''.padEnd(8, '-')} ${''.padEnd(10, '-')}`);

  for (const [letter, stats] of letterEntries) {
    const pts = pointValues[letter] !== undefined ? pointValues[letter] : '?';
    const strandRate = stats.totalDrawn > 0 ? ((stats.strandedCount / stats.totalDrawn) * 100).toFixed(1) : '0.0';
    const avgLinger = stats.playedCount > 0 ? (stats.totalLingerTurns / stats.playedCount).toFixed(1) : 'N/A';

    lingerValues[letter] = stats.playedCount > 0 ? stats.totalLingerTurns / stats.playedCount : 0;
    strandRates[letter] = stats.totalDrawn > 0 ? stats.strandedCount / stats.totalDrawn : 0;

    console.log(`  ${letter.padEnd(10)} ${String(pts).padStart(6)} ${String(stats.totalDrawn).padStart(7)} ${String(stats.playedCount).padStart(7)} ${String(stats.strandedCount).padStart(9)} ${strandRate.padStart(7)}% ${String(avgLinger).padStart(10)}`);
  }

  // Blank stats
  const blankStats = results.letterStats['(blank)'];
  if (blankStats) {
    const blankStrandRate = blankStats.totalDrawn > 0 ? ((blankStats.strandedCount / blankStats.totalDrawn) * 100).toFixed(1) : '0.0';
    const blankLinger = blankStats.playedCount > 0 ? (blankStats.totalLingerTurns / blankStats.playedCount).toFixed(1) : 'N/A';
    console.log(`  ${'(blank)'.padEnd(10)} ${'0'.padStart(6)} ${String(blankStats.totalDrawn).padStart(7)} ${String(blankStats.playedCount).padStart(7)} ${String(blankStats.strandedCount).padStart(9)} ${blankStrandRate.padStart(7)}% ${String(blankLinger).padStart(10)}`);
  }

  // Compute correlations
  const lettersWithBoth = letterEntries.filter(([l]) => pointValues[l] !== undefined && lingerValues[l] > 0);
  const pointsArr = lettersWithBoth.map(([l]) => pointValues[l]);
  const lingerArr = lettersWithBoth.map(([l]) => lingerValues[l]);
  const strandArr = lettersWithBoth.map(([l]) => strandRates[l]);

  const corrLinger = pearsonCorrelation(pointsArr, lingerArr);
  const corrStrand = pearsonCorrelation(pointsArr, strandArr);

  console.log('\n  CORRELATION ANALYSIS');
  console.log(subDivider);
  console.log(`  Point values vs. avg linger time:  r = ${isNaN(corrLinger) ? 'N/A' : corrLinger.toFixed(4)}`);
  console.log(`  Point values vs. stranded rate:     r = ${isNaN(corrStrand) ? 'N/A' : corrStrand.toFixed(4)}`);
  console.log(`  (Positive r means higher-point tiles are harder to deploy)`);
  console.log(divider);
}

function printScoreHistogram(scores) {
  const bucketSize = 50;
  const min = Math.floor(scores[0] / bucketSize) * bucketSize;
  const max = Math.ceil(scores[scores.length - 1] / bucketSize) * bucketSize;
  const buckets = {};

  for (let b = min; b <= max; b += bucketSize) {
    buckets[b] = 0;
  }

  for (const s of scores) {
    const bucket = Math.floor(s / bucketSize) * bucketSize;
    buckets[bucket] = (buckets[bucket] || 0) + 1;
  }

  const maxCount = Math.max(...Object.values(buckets));
  const barWidth = 40;

  console.log('');
  for (const [bucket, count] of Object.entries(buckets).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const label = `${String(bucket).padStart(5)}-${String(Number(bucket) + bucketSize - 1).padStart(5)}`;
    const bar = '#'.repeat(Math.round((count / maxCount) * barWidth));
    const pct = ((count / scores.length) * 100).toFixed(0);
    console.log(`  ${label} | ${bar} ${count} (${pct}%)`);
  }
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n < 2) return NaN;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return NaN;
  return numerator / denominator;
}
