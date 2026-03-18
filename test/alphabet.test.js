'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { ALPHABETS, buildWordList } = require('../ai/alphabet');

const READLEX_PATH = path.join(__dirname, '../data/readlex/readlex.json');

// ---------------------------------------------------------------------------
// Alphabet config validation
// ---------------------------------------------------------------------------

describe('Alphabet - Config validation', () => {
  it('all alphabet configs have required properties', () => {
    for (const [key, config] of Object.entries(ALPHABETS)) {
      assert.ok(config.name, `${key} should have name`);
      assert.ok(Array.isArray(config.letters), `${key} should have letters array`);
      assert.ok(config.letters.length > 0, `${key} should have non-empty letters`);
      assert.ok(config.splits !== undefined, `${key} should have splits`);
      assert.ok(config.tiles, `${key} should have tiles filename`);
      assert.ok(config.vowels instanceof Set, `${key} should have vowels Set`);
    }
  });

  it('Shavian vowel set has expected size (18)', () => {
    const shavianVowels = ALPHABETS.split.vowels;
    assert.equal(shavianVowels.size, 18);
  });

  it('Roman vowel set has 5 letters', () => {
    const romanVowels = ALPHABETS.roman.vowels;
    assert.equal(romanVowels.size, 5);
    assert.ok(romanVowels.has('a'));
    assert.ok(romanVowels.has('e'));
    assert.ok(romanVowels.has('i'));
    assert.ok(romanVowels.has('o'));
    assert.ok(romanVowels.has('u'));
  });

  it('split alphabet has compound splits', () => {
    const splits = ALPHABETS.split.splits;
    assert.ok(Object.keys(splits).length > 0);
    // Check specific compound split
    assert.equal(splits['\u{1047C}'], '\u{10469}\u{1046E}'); // 𐑼 -> 𐑩𐑮
  });

  it('compound alphabet has no splits (uses compound tiles directly)', () => {
    assert.equal(Object.keys(ALPHABETS.compound.splits).length, 0);
  });

  it('rotatable alphabet has rotationPairs', () => {
    assert.ok(ALPHABETS.rotatable.rotationPairs);
    assert.ok(ALPHABETS.rotatable.rotationPairs.length > 0);
  });

  it('roman alphabet uses Latn field', () => {
    assert.equal(ALPHABETS.roman.field, 'Latn');
  });
});

// ---------------------------------------------------------------------------
// buildWordList
// ---------------------------------------------------------------------------

describe('Alphabet - buildWordList()', () => {
  it('returns non-empty word list for split alphabet', () => {
    const words = buildWordList(READLEX_PATH, ALPHABETS.split);
    assert.ok(words.length > 0, `Split alphabet should produce words, got ${words.length}`);
  });

  it('returns non-empty word list for roman alphabet', () => {
    const words = buildWordList(READLEX_PATH, ALPHABETS.roman);
    assert.ok(words.length > 0, `Roman alphabet should produce words, got ${words.length}`);
  });

  it('returns non-empty word list for compound alphabet', () => {
    const words = buildWordList(READLEX_PATH, ALPHABETS.compound);
    assert.ok(words.length > 0, `Compound alphabet should produce words, got ${words.length}`);
  });

  it('returns non-empty word list for rotatable alphabet', () => {
    const words = buildWordList(READLEX_PATH, ALPHABETS.rotatable);
    assert.ok(words.length > 0, `Rotatable alphabet should produce words, got ${words.length}`);
  });

  it('maxVocab limits output size', () => {
    const limit = 100;
    const words = buildWordList(READLEX_PATH, ALPHABETS.split, limit);
    assert.equal(words.length, limit);
  });

  it('words only contain letters from the alphabet letter set', () => {
    const config = ALPHABETS.split;
    const letterSet = new Set(config.letters);
    const words = buildWordList(READLEX_PATH, config, 500);

    for (const word of words) {
      for (const ch of word) {
        assert.ok(letterSet.has(ch), `Letter "${ch}" (U+${ch.codePointAt(0).toString(16)}) in word not in split alphabet`);
      }
    }
  });

  it('roman words only contain lowercase a-z', () => {
    const config = ALPHABETS.roman;
    const letterSet = new Set(config.letters);
    const words = buildWordList(READLEX_PATH, config, 500);

    for (const word of words) {
      for (const ch of word) {
        assert.ok(letterSet.has(ch), `Letter "${ch}" in roman word not in alphabet`);
      }
    }
  });

  it('compound splits are applied correctly', () => {
    const config = ALPHABETS.split;
    const words = buildWordList(READLEX_PATH, config, 5000);
    // None of the words should contain compound letters since they are split
    const compoundChars = new Set(['\u{1047C}', '\u{1047D}', '\u{10478}', '\u{10479}', '\u{1047E}', '\u{1047F}']);

    for (const word of words) {
      for (const ch of word) {
        assert.ok(!compoundChars.has(ch), `Split word should not contain compound char U+${ch.codePointAt(0).toString(16)}`);
      }
    }
  });

  it('all words have at least 2 characters', () => {
    const words = buildWordList(READLEX_PATH, ALPHABETS.split, 1000);
    for (const word of words) {
      assert.ok([...word].length >= 2, `Word should have at least 2 chars: "${word}"`);
    }
  });
});
