'use strict';

const fs = require('fs');

const BASIC_LETTERS = [
  '𐑐','𐑚','𐑑','𐑛','𐑒','𐑜','𐑓','𐑝','𐑔','𐑞','𐑕','𐑟','𐑖','𐑠','𐑗','𐑡',
  '𐑘','𐑢','𐑣','𐑤','𐑮','𐑥','𐑯','𐑙','𐑦','𐑰','𐑧','𐑱','𐑨','𐑲','𐑩','𐑳',
  '𐑴','𐑪','𐑵','𐑶','𐑷','𐑭','𐑺','𐑻','𐑫','𐑬'
];

const COMPOUND_LETTERS = ['𐑼','𐑽','𐑸','𐑹','𐑾','𐑿'];

const COMPOUND_SPLITS = {
  '𐑽': '𐑦𐑩𐑮',
  '𐑼': '𐑩𐑮',
  '𐑸': '𐑭𐑮',
  '𐑹': '𐑷𐑮',
  '𐑾': '𐑦𐑩',
  '𐑿': '𐑘𐑵'
};

const EXCLUDED_POS = ['ZZ0', 'UNC'];

const SHAVIAN_VOWELS = new Set([...'𐑦𐑰𐑧𐑱𐑨𐑲𐑩𐑳𐑴𐑪𐑵𐑶𐑷𐑭𐑺𐑻𐑫𐑬']);
const SHAVIAN_COMPOUND_VOWELS = new Set([...SHAVIAN_VOWELS, ...'𐑼𐑽𐑸𐑹𐑾']);
const ROMAN_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

const ALPHABETS = {
  split: {
    name: 'split',
    letters: BASIC_LETTERS,
    splits: Object.assign({}, COMPOUND_SPLITS),
    tiles: 'tiles.csv',
    vowels: SHAVIAN_VOWELS,
  },
  compound: {
    name: 'compound',
    letters: BASIC_LETTERS.concat(COMPOUND_LETTERS),
    splits: {},
    tiles: 'tiles-compound.csv',
    vowels: SHAVIAN_COMPOUND_VOWELS,
  },
  rotatable: {
    name: 'rotatable',
    letters: BASIC_LETTERS.slice(),
    splits: Object.assign({}, COMPOUND_SPLITS),
    tiles: 'tiles-rotatable.csv',
    rotationPairs: [
      ['𐑐','𐑚'], ['𐑑','𐑛'], ['𐑒','𐑜'], ['𐑓','𐑝'],
      ['𐑔','𐑞'], ['𐑕','𐑟'], ['𐑖','𐑠'], ['𐑗','𐑡'],
      ['𐑙','𐑣'], ['𐑤','𐑮'], ['𐑧','𐑪'], ['𐑨','𐑩'],
      ['𐑫','𐑵'], ['𐑬','𐑶'], ['𐑭','𐑷'],
    ],
    vowels: SHAVIAN_VOWELS,
  },
  'rotatable-extended': {
    name: 'rotatable-extended',
    letters: BASIC_LETTERS.filter(l => l !== '𐑺' && l !== '𐑻').concat(['\u{1049E}', '\u{1049F}']),
    splits: Object.assign({}, COMPOUND_SPLITS, {
      '𐑺': '\u{1049E}𐑮',
      '𐑻': '\u{1049F}𐑮',
    }),
    tiles: 'tiles-rotatable-extended.csv',
    rotationPairs: [
      ['𐑐','𐑚'], ['𐑑','𐑛'], ['𐑒','𐑜'], ['𐑓','𐑝'],
      ['𐑔','𐑞'], ['𐑕','𐑟'], ['𐑖','𐑠'], ['𐑗','𐑡'],
      ['𐑙','𐑣'], ['𐑤','𐑮'], ['𐑧','𐑪'], ['𐑨','𐑩'],
      ['𐑫','𐑵'], ['𐑬','𐑶'], ['𐑭','𐑷'],
    ],
    vowels: SHAVIAN_VOWELS,
  },
  roman: {
    name: 'roman',
    letters: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    splits: {},
    tiles: 'tiles-roman.csv',
    field: 'Latn',
    vowels: ROMAN_VOWELS,
  },
  'split-extended': {
    name: 'split-extended',
    letters: BASIC_LETTERS.filter(l => l !== '𐑺' && l !== '𐑻').concat(['\u{1049E}', '\u{1049F}']),
    splits: Object.assign({}, COMPOUND_SPLITS, {
      '𐑺': '\u{1049E}𐑮',
      '𐑻': '\u{1049F}𐑮',
    }),
    tiles: 'tiles-extended.csv',
    vowels: SHAVIAN_VOWELS,
  },
};

function applySplits(word, splits) {
  let result = '';
  for (const ch of word) {
    if (splits[ch] !== undefined) {
      result += splits[ch];
    } else {
      result += ch;
    }
  }
  return result;
}

function buildWordList(readlexPath, alphabet, maxVocab) {
  const data = fs.readFileSync(readlexPath, 'utf8');
  const readlex = JSON.parse(data);
  const letterSet = new Set(alphabet.letters);

  // Collect words with their max frequency
  const wordFreq = new Map();

  const field = alphabet.field || 'Shaw';

  for (const entries of Object.values(readlex)) {
    for (const entry of entries) {
      if (EXCLUDED_POS.includes(entry.pos)) continue;
      const raw = entry[field] || '';
      if (!raw || raw.includes(' ')) continue;

      const processed = applySplits(field === 'Latn' ? raw.toLowerCase() : raw, alphabet.splits);

      let allValid = true;
      let charCount = 0;
      for (const ch of processed) {
        if (!letterSet.has(ch)) {
          allValid = false;
          break;
        }
        charCount++;
      }

      if (!allValid) continue;
      if (charCount < 2) continue;

      const freq = entry.freq || 0;
      const existing = wordFreq.get(processed) || 0;
      if (freq > existing) wordFreq.set(processed, freq);
    }
  }

  if (maxVocab && maxVocab < wordFreq.size) {
    const sorted = Array.from(wordFreq.entries()).sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, maxVocab).map(([word]) => word);
  }

  return Array.from(wordFreq.keys());
}

module.exports = { ALPHABETS, buildWordList };
