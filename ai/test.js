'use strict';

const path = require('path');
const Trie = require('./trie');
const { generateMoves, BONUS_LAYOUT } = require('./movegen');
const AIPlayer = require('./player');
const { ALPHABETS, buildWordList } = require('./alphabet');

const BOARD_SIZE = 15;

function createEmptyBoard() {
  const board = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    board[r] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      board[r][c] = { letter: null, bonus: BONUS_LAYOUT[r][c], isBlank: false, points: 0 };
    }
  }
  return board;
}

function printTopMoves(moves, count) {
  const top = moves.slice(0, count);
  for (let i = 0; i < top.length; i++) {
    const m = top[i];
    const placementStr = m.placements
      .map(p => `${p.letter}@(${p.row},${p.col})${p.isBlank ? '[blank]' : ''}`)
      .join(', ');
    console.log(`  #${i + 1}: score=${m.score}, words=[${m.words.join(', ')}], placements=[${placementStr}]`);
  }
}

async function main() {
  console.log('Loading dictionary...');
  const alphabet = ALPHABETS.split;
  const readlexPath = path.join(__dirname, '../data/readlex/readlex.json');
  const wordList = buildWordList(readlexPath, alphabet);
  console.log(`Dictionary ready: ${wordList.length} words`);

  console.log('\nBuilding trie...');
  const startTime = Date.now();
  const trie = new Trie();
  for (const word of wordList) {
    trie.insert(word);
  }
  console.log(`Trie built in ${Date.now() - startTime}ms`);

  // Quick trie sanity check
  const sampleWords = wordList.slice(0, 5);
  console.log('\nTrie sanity check:');
  for (const word of sampleWords) {
    console.log(`  "${word}" isWord=${trie.isWord(word)}, isPrefix=${trie.isPrefix(word)}`);
    if (word.length > 1) {
      const prefix = [...word].slice(0, 1).join('');
      console.log(`  "${prefix}" isWord=${trie.isWord(prefix)}, isPrefix=${trie.isPrefix(prefix)}`);
    }
  }

  // Test 1: Empty board, first move
  console.log('\n--- Test 1: First move on empty board ---');
  const board1 = createEmptyBoard();
  const rack1 = [
    { letter: '𐑞', points: 1, isBlank: false },
    { letter: '𐑩', points: 1, isBlank: false },
    { letter: '𐑯', points: 1, isBlank: false },
    { letter: '𐑛', points: 1, isBlank: false },
    { letter: '𐑦', points: 1, isBlank: false },
    { letter: '𐑑', points: 1, isBlank: false },
    { letter: '𐑕', points: 1, isBlank: false },
  ];
  console.log('Rack:', rack1.map(t => t.letter).join(' '));

  let t0 = Date.now();
  const moves1 = generateMoves(board1, rack1, trie, BONUS_LAYOUT);
  console.log(`Generated ${moves1.length} moves in ${Date.now() - t0}ms`);
  console.log('Top 5 moves:');
  printTopMoves(moves1, 5);

  // Test 2: Board with a word placed, second move
  console.log('\n--- Test 2: Second move with existing word ---');
  const board2 = createEmptyBoard();
  // Place a word horizontally at row 7
  const existingWord = '𐑞𐑩';
  const existingLetters = [...existingWord];
  for (let i = 0; i < existingLetters.length; i++) {
    board2[7][7 + i] = { letter: existingLetters[i], bonus: null, isBlank: false, points: 1 };
  }
  const rack2 = [
    { letter: '𐑯', points: 1, isBlank: false },
    { letter: '𐑛', points: 1, isBlank: false },
    { letter: '𐑦', points: 1, isBlank: false },
    { letter: '𐑑', points: 1, isBlank: false },
    { letter: '𐑕', points: 1, isBlank: false },
    { letter: '𐑮', points: 1, isBlank: false },
    { letter: '𐑤', points: 1, isBlank: false },
  ];
  console.log('Existing word on board: "' + existingWord + '" at row 7, cols 7-8');
  console.log('Rack:', rack2.map(t => t.letter).join(' '));

  t0 = Date.now();
  const moves2 = generateMoves(board2, rack2, trie, BONUS_LAYOUT);
  console.log(`Generated ${moves2.length} moves in ${Date.now() - t0}ms`);
  console.log('Top 5 moves:');
  printTopMoves(moves2, 5);

  // Test 3: AIPlayer
  console.log('\n--- Test 3: AIPlayer findBestMove ---');
  const ai = new AIPlayer(trie);
  const bestMove = ai.findBestMove(board1, rack1);
  if (bestMove) {
    console.log(`Best move: score=${bestMove.score}, words=[${bestMove.words.join(', ')}]`);
    console.log(`Placements: ${bestMove.placements.map(p => `${p.letter}@(${p.row},${p.col})`).join(', ')}`);
  } else {
    console.log('No valid move found');
  }

  console.log('\nAll tests completed.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
