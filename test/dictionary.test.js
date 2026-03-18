'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const Dictionary = require('../server/dictionary');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempReadlex(entries) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, 'test-readlex-' + Date.now() + '.json');
  fs.writeFileSync(tmpFile, JSON.stringify(entries), 'utf8');
  return tmpFile;
}

// ---------------------------------------------------------------------------
// splitCompounds()
// ---------------------------------------------------------------------------

describe('Dictionary - splitCompounds()', () => {
  it('splits known compound letters', () => {
    const dict = new Dictionary();
    // \u{1047D} = 𐑽 -> 𐑦𐑩𐑮
    assert.equal(dict.splitCompounds('\u{1047D}'), '\u{10466}\u{10469}\u{1046E}');
  });

  it('splits multiple compound letters in one word', () => {
    const dict = new Dictionary();
    // 𐑼 -> 𐑩𐑮, 𐑸 -> 𐑭𐑮
    const input = '\u{1047C}\u{10478}';
    const result = dict.splitCompounds(input);
    assert.equal(result, '\u{10469}\u{1046E}\u{1046D}\u{1046E}');
  });

  it('returns unchanged string when no compounds present', () => {
    const dict = new Dictionary();
    const input = '\u{10450}\u{10451}';
    assert.equal(dict.splitCompounds(input), input);
  });

  it('handles empty string', () => {
    const dict = new Dictionary();
    assert.equal(dict.splitCompounds(''), '');
  });
});

// ---------------------------------------------------------------------------
// isLikelyAbbreviation()
// ---------------------------------------------------------------------------

describe('Dictionary - isLikelyAbbreviation()', () => {
  it('detects all-caps abbreviations', () => {
    const dict = new Dictionary();
    assert.equal(dict.isLikelyAbbreviation('USA'), true);
    assert.equal(dict.isLikelyAbbreviation('BBC'), true);
    assert.equal(dict.isLikelyAbbreviation('NATO'), true);
  });

  it('detects abbreviations with periods', () => {
    const dict = new Dictionary();
    assert.equal(dict.isLikelyAbbreviation('U.S.A.'), true);
    assert.equal(dict.isLikelyAbbreviation('Ph.D.'), true);
  });

  it('detects single letters', () => {
    const dict = new Dictionary();
    assert.equal(dict.isLikelyAbbreviation('A'), true);
    assert.equal(dict.isLikelyAbbreviation('x'), true);
  });

  it('returns false for normal words', () => {
    const dict = new Dictionary();
    assert.equal(dict.isLikelyAbbreviation('hello'), false);
    assert.equal(dict.isLikelyAbbreviation('World'), false);
    assert.equal(dict.isLikelyAbbreviation('Scrabble'), false);
  });
});

// ---------------------------------------------------------------------------
// loadDictionary()
// ---------------------------------------------------------------------------

describe('Dictionary - loadDictionary()', () => {
  it('loads words from a readlex JSON file', async () => {
    const readlex = {
      'hello': [
        { Shaw: '\u{10450}\u{10451}', Latn: 'hello', pos: 'NN1' }
      ],
      'world': [
        { Shaw: '\u{10452}\u{10453}', Latn: 'world', pos: 'NN1' }
      ]
    };
    const tmpFile = makeTempReadlex(readlex);

    try {
      const dict = new Dictionary();
      const count = await dict.loadDictionary(tmpFile);
      assert.ok(count >= 2);
      assert.equal(dict.loaded, true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('excludes entries with excluded POS tags', async () => {
    const readlex = {
      'a': [
        { Shaw: '\u{10450}', Latn: 'a', pos: 'ZZ0' }  // single letter POS
      ],
      'hello': [
        { Shaw: '\u{10451}\u{10452}', Latn: 'hello', pos: 'NN1' }
      ]
    };
    const tmpFile = makeTempReadlex(readlex);

    try {
      const dict = new Dictionary();
      await dict.loadDictionary(tmpFile);
      // The ZZ0 entry should be excluded
      assert.equal(dict.isValidWord('\u{10450}'), false);
      assert.equal(dict.isValidWord('\u{10451}\u{10452}'), true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('excludes abbreviations based on Latin form', async () => {
    const readlex = {
      'USA': [
        { Shaw: '\u{10460}\u{10461}\u{10462}', Latn: 'USA', pos: 'NP0' }
      ],
      'cat': [
        { Shaw: '\u{10463}\u{10464}\u{10465}', Latn: 'cat', pos: 'NN1' }
      ]
    };
    const tmpFile = makeTempReadlex(readlex);

    try {
      const dict = new Dictionary();
      await dict.loadDictionary(tmpFile);
      assert.equal(dict.isValidWord('\u{10460}\u{10461}\u{10462}'), false);
      assert.equal(dict.isValidWord('\u{10463}\u{10464}\u{10465}'), true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('splits compound letters when adding words', async () => {
    const readlex = {
      'here': [
        // 𐑽 (\u{1047D}) should be split to 𐑦𐑩𐑮
        { Shaw: '\u{10450}\u{1047D}', Latn: 'here', pos: 'NN1' }
      ]
    };
    const tmpFile = makeTempReadlex(readlex);

    try {
      const dict = new Dictionary();
      await dict.loadDictionary(tmpFile);
      // The stored word should have the compound split
      assert.equal(dict.isValidWord('\u{10450}\u{10466}\u{10469}\u{1046E}'), true);
      // The unsplit form should not be found directly
      assert.equal(dict.isValidWord('\u{10450}\u{1047D}'), true); // isValidWord also splits
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ---------------------------------------------------------------------------
// isValidWord()
// ---------------------------------------------------------------------------

describe('Dictionary - isValidWord()', () => {
  it('throws when dictionary is not loaded', () => {
    const dict = new Dictionary();
    assert.throws(() => dict.isValidWord('test'), /Dictionary not loaded/);
  });

  it('returns true for known words', async () => {
    const readlex = {
      'test': [
        { Shaw: '\u{10450}\u{10451}', Latn: 'test', pos: 'NN1' }
      ]
    };
    const tmpFile = makeTempReadlex(readlex);

    try {
      const dict = new Dictionary();
      await dict.loadDictionary(tmpFile);
      assert.equal(dict.isValidWord('\u{10450}\u{10451}'), true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('returns false for unknown words', async () => {
    const readlex = {
      'test': [
        { Shaw: '\u{10450}\u{10451}', Latn: 'test', pos: 'NN1' }
      ]
    };
    const tmpFile = makeTempReadlex(readlex);

    try {
      const dict = new Dictionary();
      await dict.loadDictionary(tmpFile);
      assert.equal(dict.isValidWord('\u{10460}\u{10461}\u{10462}'), false);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('normalizes compound letters before checking', async () => {
    const readlex = {
      'test': [
        { Shaw: '\u{10450}\u{1047C}', Latn: 'test', pos: 'NN1' }
      ]
    };
    const tmpFile = makeTempReadlex(readlex);

    try {
      const dict = new Dictionary();
      await dict.loadDictionary(tmpFile);
      // Query with compound letter should still match (isValidWord splits compounds)
      assert.equal(dict.isValidWord('\u{10450}\u{1047C}'), true);
      // Query with split form should also match
      assert.equal(dict.isValidWord('\u{10450}\u{10469}\u{1046E}'), true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ---------------------------------------------------------------------------
// getAllWords()
// ---------------------------------------------------------------------------

describe('Dictionary - getAllWords()', () => {
  it('returns array of strings', async () => {
    const readlex = {
      'hello': [{ Shaw: '\u{10450}', Latn: 'hello', pos: 'NN1' }],
      'world': [{ Shaw: '\u{10451}', Latn: 'world', pos: 'NN1' }]
    };
    const tmpFile = makeTempReadlex(readlex);

    try {
      const dict = new Dictionary();
      await dict.loadDictionary(tmpFile);
      const words = dict.getAllWords();
      assert.ok(Array.isArray(words));
      assert.ok(words.length >= 2);
      for (const w of words) {
        assert.equal(typeof w, 'string');
      }
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('returns empty array when no words loaded', () => {
    const dict = new Dictionary();
    const words = dict.getAllWords();
    assert.ok(Array.isArray(words));
    assert.equal(words.length, 0);
  });
});
