'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Trie = require('../ai/trie');

describe('Trie - insert and lookup', () => {
  it('inserts and looks up a single word', () => {
    const trie = new Trie();
    trie.insert('hello');
    assert.equal(trie.isWord('hello'), true);
  });

  it('returns false for non-words', () => {
    const trie = new Trie();
    trie.insert('hello');
    assert.equal(trie.isWord('world'), false);
  });

  it('returns false for prefixes that are not complete words', () => {
    const trie = new Trie();
    trie.insert('hello');
    assert.equal(trie.isWord('hel'), false);
  });

  it('handles multiple words', () => {
    const trie = new Trie();
    trie.insert('cat');
    trie.insert('car');
    trie.insert('card');
    assert.equal(trie.isWord('cat'), true);
    assert.equal(trie.isWord('car'), true);
    assert.equal(trie.isWord('card'), true);
    assert.equal(trie.isWord('ca'), false);
  });
});

describe('Trie - isPrefix()', () => {
  it('returns true for valid prefixes', () => {
    const trie = new Trie();
    trie.insert('hello');
    assert.equal(trie.isPrefix('h'), true);
    assert.equal(trie.isPrefix('he'), true);
    assert.equal(trie.isPrefix('hel'), true);
    assert.equal(trie.isPrefix('hell'), true);
    assert.equal(trie.isPrefix('hello'), true);
  });

  it('returns false for non-prefixes', () => {
    const trie = new Trie();
    trie.insert('hello');
    assert.equal(trie.isPrefix('x'), false);
    assert.equal(trie.isPrefix('ha'), false);
    assert.equal(trie.isPrefix('helloo'), false);
  });

  it('empty string is always a prefix', () => {
    const trie = new Trie();
    trie.insert('hello');
    assert.equal(trie.isPrefix(''), true);
  });
});

describe('Trie - single-character words', () => {
  it('handles single-character words correctly', () => {
    const trie = new Trie();
    trie.insert('a');
    assert.equal(trie.isWord('a'), true);
    assert.equal(trie.isPrefix('a'), true);
    assert.equal(trie.isWord('ab'), false);
  });
});

describe('Trie - Unicode Shavian characters', () => {
  it('inserts and looks up Shavian words', () => {
    const trie = new Trie();
    // 𐑞𐑩 = "the" in Shavian
    trie.insert('\u{1045E}\u{10469}');
    assert.equal(trie.isWord('\u{1045E}\u{10469}'), true);
    assert.equal(trie.isPrefix('\u{1045E}'), true);
    assert.equal(trie.isWord('\u{1045E}'), false);
  });

  it('handles multi-character Shavian words', () => {
    const trie = new Trie();
    // 𐑖𐑱𐑝𐑾𐑯 = "Shavian"
    const word = '\u{10456}\u{10471}\u{1045D}\u{1047E}\u{10469}\u{1046F}';
    trie.insert(word);
    assert.equal(trie.isWord(word), true);
    // Check prefix
    assert.equal(trie.isPrefix('\u{10456}\u{10471}'), true);
  });

  it('distinguishes between different Shavian characters', () => {
    const trie = new Trie();
    trie.insert('\u{10450}\u{10451}'); // 𐑐𐑑
    trie.insert('\u{1045A}\u{1045B}'); // 𐑚𐑛
    assert.equal(trie.isWord('\u{10450}\u{10451}'), true);
    assert.equal(trie.isWord('\u{1045A}\u{1045B}'), true);
    assert.equal(trie.isWord('\u{10450}\u{1045B}'), false);
  });
});

describe('Trie - getNode()', () => {
  it('returns node for valid prefix', () => {
    const trie = new Trie();
    trie.insert('abc');
    const node = trie.getNode('ab');
    assert.ok(node);
    assert.equal(node.isEnd, false);
    assert.ok(node.children.has('c'));
  });

  it('returns null for invalid prefix', () => {
    const trie = new Trie();
    trie.insert('abc');
    assert.equal(trie.getNode('xyz'), null);
  });
});

describe('Trie - fromDictionary()', () => {
  it('builds trie from dictionary object', () => {
    const mockDictionary = {
      getAllWords() {
        return ['cat', 'car', 'card', 'dog'];
      }
    };

    const trie = Trie.fromDictionary(mockDictionary);
    assert.equal(trie.isWord('cat'), true);
    assert.equal(trie.isWord('car'), true);
    assert.equal(trie.isWord('card'), true);
    assert.equal(trie.isWord('dog'), true);
    assert.equal(trie.isWord('dot'), false);
  });

  it('handles Shavian dictionary', () => {
    const mockDictionary = {
      getAllWords() {
        return ['\u{1045E}\u{10469}', '\u{10466}\u{10470}'];
      }
    };

    const trie = Trie.fromDictionary(mockDictionary);
    assert.equal(trie.isWord('\u{1045E}\u{10469}'), true);
    assert.equal(trie.isWord('\u{10466}\u{10470}'), true);
    assert.equal(trie.isWord('\u{1045E}\u{10470}'), false);
  });
});
