'use strict';

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');

const { ALPHABETS, buildWordList } = require('./alphabet');
const Trie = require('./trie');
const { AIPlayer, TIERS } = require('./player');
const Game = require(path.join(PROJECT_ROOT, 'server', 'game'));

function main() {
  const args = parseArgs(process.argv.slice(2));
  const alphabet = ALPHABETS[args.alphabet];
  if (!alphabet) {
    console.error(`Unknown alphabet: "${args.alphabet}". Valid: ${Object.keys(ALPHABETS).join(', ')}`);
    process.exit(1);
  }

  const tierNames = args.tiers;
  for (const t of tierNames) {
    if (!TIERS[t]) {
      console.error(`Unknown tier: "${t}". Valid: ${Object.keys(TIERS).join(', ')}`);
      process.exit(1);
    }
  }

  if (tierNames.length < 2) {
    console.error('Need at least 2 tiers for a tournament.');
    process.exit(1);
  }

  const readlexPath = path.join(PROJECT_ROOT, 'data', 'readlex', 'readlex.json');
  const tilesPath = path.join(PROJECT_ROOT, 'data', alphabet.tiles);
  const customTiles = parseTilesCsv(tilesPath, alphabet.rotationPairs || null);

  const rotationMap = new Map();
  if (alphabet.rotationPairs) {
    for (const [primary, rotated] of alphabet.rotationPairs) {
      rotationMap.set(rotated, primary);
    }
  }

  const tileRotationInfo = new Map();
  for (const t of customTiles) {
    if (t.isRotatable) {
      tileRotationInfo.set(t.letter, {
        rotatedLetter: t.rotatedLetter,
        rotatedPoints: t.rotatedPoints,
      });
    }
  }

  // Build tries for each unique vocab size
  const vocabSizes = [...new Set(tierNames.map(t => TIERS[t].vocabSize))];
  const tries = new Map();

  console.log(`Loading dictionary (alphabet: ${alphabet.name})...`);
  for (const vs of vocabSizes) {
    const label = vs === 0 ? 'unlimited' : vs;
    console.log(`  Building trie for vocab size: ${label}`);
    const wordList = buildWordList(readlexPath, alphabet, vs || undefined);
    const trie = new Trie();
    for (const word of wordList) trie.insert(word);
    tries.set(vs, trie);
    console.log(`    ${wordList.length} words loaded`);
  }

  // Build AI players
  const players = new Map();
  for (const tierName of tierNames) {
    const config = TIERS[tierName];
    const trie = tries.get(config.vocabSize);
    players.set(tierName, new AIPlayer(trie, config, alphabet));
  }

  // Round robin
  const matchups = [];
  for (let i = 0; i < tierNames.length; i++) {
    for (let j = i + 1; j < tierNames.length; j++) {
      matchups.push([tierNames[i], tierNames[j]]);
    }
  }

  const results = new Map();
  for (const [a, b] of matchups) {
    results.set(`${a}:${b}`, createMatchupStats());
  }

  const tierStats = new Map();
  for (const t of tierNames) {
    tierStats.set(t, { totalScore: 0, totalGames: 0 });
  }

  const totalMatchupGames = matchups.length * args.games * 2;
  let completedGames = 0;
  let totalTurns = 0;
  let totalCompleted = 0;
  const startTime = Date.now();

  console.log(`\nRunning ${totalMatchupGames} total games (${args.games} per side per matchup)...\n`);

  for (const [tierA, tierB] of matchups) {
    const playerA = players.get(tierA);
    const playerB = players.get(tierB);
    const stats = results.get(`${tierA}:${tierB}`);

    for (let g = 0; g < args.games; g++) {
      // A goes first
      const r1 = playOneGame(playerA, playerB, alphabet, customTiles, rotationMap, tileRotationInfo);
      stats.aFirst.wins += r1.scores[0] > r1.scores[1] ? 1 : 0;
      stats.aFirst.losses += r1.scores[0] < r1.scores[1] ? 1 : 0;
      stats.aFirst.totalScoreA += r1.scores[0];
      stats.aFirst.totalScoreB += r1.scores[1];
      stats.aFirst.games++;
      totalTurns += r1.turns;
      if (r1.completed) totalCompleted++;
      tierStats.get(tierA).totalScore += r1.scores[0];
      tierStats.get(tierA).totalGames++;
      tierStats.get(tierB).totalScore += r1.scores[1];
      tierStats.get(tierB).totalGames++;

      // B goes first
      const r2 = playOneGame(playerB, playerA, alphabet, customTiles, rotationMap, tileRotationInfo);
      stats.bFirst.wins += r2.scores[1] > r2.scores[0] ? 1 : 0;
      stats.bFirst.losses += r2.scores[1] < r2.scores[0] ? 1 : 0;
      stats.bFirst.totalScoreA += r2.scores[1];
      stats.bFirst.totalScoreB += r2.scores[0];
      stats.bFirst.games++;
      totalTurns += r2.turns;
      if (r2.completed) totalCompleted++;
      tierStats.get(tierA).totalScore += r2.scores[1];
      tierStats.get(tierA).totalGames++;
      tierStats.get(tierB).totalScore += r2.scores[0];
      tierStats.get(tierB).totalGames++;

      completedGames += 2;
      if (completedGames % 10 === 0 || completedGames === totalMatchupGames) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        process.stdout.write(`\r  Progress: ${completedGames}/${totalMatchupGames} games (${elapsed}s)`);
      }
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nAll games complete in ${totalTime}s\n`);

  printResults(tierNames, results, tierStats, args, totalTurns, totalCompleted, totalMatchupGames);
}

function parseArgs(argv) {
  let games = 100;
  let alphabet = 'split';
  let tiers = Object.keys(TIERS);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--games' && i + 1 < argv.length) {
      games = parseInt(argv[++i], 10);
    } else if (argv[i] === '--alphabet' && i + 1 < argv.length) {
      alphabet = argv[++i];
    } else if (argv[i] === '--tiers' && i + 1 < argv.length) {
      tiers = argv[++i].split(',').map(t => t.trim());
    }
  }

  return { games, alphabet, tiers };
}

function parseTilesCsv(tilesPath, rotationPairs) {
  const content = fs.readFileSync(tilesPath, 'utf8');
  const lines = content.trim().split('\n').slice(1);

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

    if (rotatedPointsStr !== '' && rotatedLetterMap.has(letter)) {
      tile.isRotatable = true;
      tile.rotatedLetter = rotatedLetterMap.get(letter);
      tile.rotatedPoints = parseInt(rotatedPointsStr, 10);
    }

    return tile;
  });
}

function createMatchupStats() {
  return {
    aFirst: { wins: 0, losses: 0, totalScoreA: 0, totalScoreB: 0, games: 0 },
    bFirst: { wins: 0, losses: 0, totalScoreA: 0, totalScoreB: 0, games: 0 },
  };
}

function tagRotationInfo(tile, tileRotationInfo) {
  if (tile.isBlank) return;
  const rotInfo = tileRotationInfo.get(tile.letter);
  if (rotInfo) {
    tile.isRotatable = true;
    tile.rotatedLetter = rotInfo.rotatedLetter;
    tile.rotatedPoints = rotInfo.rotatedPoints;
  }
}

function playOneGame(playerA, playerB, alphabet, customTiles, rotationMap, tileRotationInfo) {
  const game = new Game('tournament', null, { rackSize: 9, rules: 'casual', allowVoting: false });
  game.customTiles = customTiles;

  game.addPlayer('a', playerA.config.name);
  game.addPlayer('b', playerB.config.name);

  // Tag rotation info on initial rack tiles and bag
  if (tileRotationInfo.size > 0) {
    for (let pi = 0; pi < 2; pi++) {
      for (const tile of game.players[pi].rack) {
        tagRotationInfo(tile, tileRotationInfo);
      }
    }
    for (const tile of game.tileBag) {
      tagRotationInfo(tile, tileRotationInfo);
    }
  }

  const players = [playerA, playerB];
  let turns = 0;

  while (game.status === 'active' && turns < 80) {
    const pi = game.currentPlayerIndex;
    const ai = players[pi];
    const rack = game.players[pi].rack;
    const move = ai.findBestMove(game.board, rack, game.tileBag.length);

    turns++;

    if (move && move.exchange) {
      // Exchange tiles instead of playing
      try {
        game.exchangeTiles(pi, move.indices);
      } catch (_) { /* ignore exchange failures */ }
      game.consecutiveScorelessTurns++;
      game.nextTurn();
      continue;
    }

    if (move) {
      // For rotated placements, swap to primary letter before placeTiles
      const rotatedPlacements = [];
      if (rotationMap.size > 0) {
        for (const p of move.placements) {
          if (p.primaryLetter) {
            rotatedPlacements.push({
              index: move.placements.indexOf(p),
              originalLetter: p.letter,
              row: p.row,
              col: p.col,
            });
            p.letter = p.primaryLetter;
          }
        }
      }

      try {
        game.placeTiles(pi, move.placements);
      } catch (_) {
        // Restore rotated letters before continuing
        for (const rp of rotatedPlacements) {
          move.placements[rp.index].letter = rp.originalLetter;
        }
        game.consecutiveScorelessTurns++;
        game.nextTurn();
        continue;
      }

      // Fix board cells to show the correct (rotated) letter
      for (const rp of rotatedPlacements) {
        game.board[rp.row][rp.col].letter = rp.originalLetter;
        move.placements[rp.index].letter = rp.originalLetter;
      }

      // Tag any newly drawn tiles
      if (tileRotationInfo.size > 0) {
        for (const tile of game.players[pi].rack) {
          if (!tile.isRotatable && !tile.isBlank) {
            tagRotationInfo(tile, tileRotationInfo);
          }
        }
      }

      game.players[pi].score += move.score;
      game.consecutiveScorelessTurns = 0;

      const rackEmpty = game.players[pi].rack.length === 0 && game.tileBag.length === 0;
      if (rackEmpty) {
        game.status = 'completed';
        break;
      }
    } else {
      game.consecutiveScorelessTurns++;
      if (game.consecutiveScorelessTurns >= 4) {
        game.status = 'completed';
        break;
      }
    }

    game.nextTurn();
  }

  game.applyEndgameScoring();

  return {
    scores: [game.players[0].score, game.players[1].score],
    turns,
    completed: game.players.some(p => p.rack.length === 0),
  };
}

function printResults(tierNames, results, tierStats, args, totalTurns, totalCompleted, totalMatchupGames) {
  // Build win rate matrix: winMatrix[a][b] = A's win rate against B
  const winMatrix = new Map();
  for (const a of tierNames) {
    const row = new Map();
    for (const b of tierNames) {
      if (a === b) {
        row.set(b, null);
        continue;
      }

      // Find the matchup (could be a:b or b:a in the results map)
      const keyAB = `${a}:${b}`;
      const keyBA = `${b}:${a}`;

      let aWins = 0;
      let totalGames = 0;

      if (results.has(keyAB)) {
        const stats = results.get(keyAB);
        // A is the "a" side. aFirst = A went first, bFirst = B went first
        aWins += stats.aFirst.wins;
        aWins += stats.bFirst.wins;
        totalGames += stats.aFirst.games + stats.bFirst.games;
      } else if (results.has(keyBA)) {
        // Key is b:a, so "a" side in stats is B, "b" side is A.
        // aFirst.wins = B's wins when B goes first => A's wins = aFirst.losses
        // bFirst.wins = B's wins when A goes first => A's wins = bFirst.losses
        const s = results.get(keyBA);
        aWins += s.aFirst.losses;
        aWins += s.bFirst.losses;
        totalGames += s.aFirst.games + s.bFirst.games;
      }

      const winRate = totalGames > 0 ? aWins / totalGames : 0;
      row.set(b, winRate);
    }
    winMatrix.set(a, row);
  }

  // Print header
  const gamesPerSide = args.games;
  console.log(`ROUND ROBIN TOURNAMENT — ${args.alphabet} (${gamesPerSide} games per side per matchup)`);
  console.log('='.repeat(70));
  console.log('');

  // Build column labels (abbreviated tier names)
  const labels = tierNames.map(t => {
    const name = TIERS[t].name;
    return name.length > 8 ? name.substring(0, 8) : name;
  });

  const colWidth = 10;
  let header = ''.padEnd(12);
  for (const label of labels) {
    header += label.padStart(colWidth);
  }
  console.log(header);

  for (let i = 0; i < tierNames.length; i++) {
    let row = TIERS[tierNames[i]].name.padEnd(12);
    const rowMap = winMatrix.get(tierNames[i]);

    for (let j = 0; j < tierNames.length; j++) {
      const rate = rowMap.get(tierNames[j]);
      if (rate === null) {
        row += '—'.padStart(colWidth);
      } else {
        row += `${Math.round(rate * 100)}%`.padStart(colWidth);
      }
    }
    console.log(row);
  }

  console.log('');

  // Avg scores per tier
  let scoreLine = 'Avg Scores:  ';
  for (const t of tierNames) {
    const ts = tierStats.get(t);
    const avg = ts.totalGames > 0 ? Math.round(ts.totalScore / ts.totalGames) : 0;
    scoreLine += `${TIERS[t].name}: ${avg}  `;
  }
  console.log(scoreLine);

  const avgTurns = totalMatchupGames > 0 ? Math.round(totalTurns / totalMatchupGames) : 0;
  const completionRate = totalMatchupGames > 0 ? Math.round((totalCompleted / totalMatchupGames) * 100) : 0;
  console.log(`Avg Game Length: ${avgTurns} turns`);
  console.log(`Completion Rate: ${completionRate}%`);
}

main();
