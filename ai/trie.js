'use strict';

class TrieNode {
  constructor() {
    this.children = new Map();
    this.isEnd = false;
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  insert(word) {
    let node = this.root;
    for (const ch of word) {
      let child = node.children.get(ch);
      if (!child) {
        child = new TrieNode();
        node.children.set(ch, child);
      }
      node = child;
    }
    node.isEnd = true;
  }

  isWord(str) {
    let node = this.root;
    for (const ch of str) {
      node = node.children.get(ch);
      if (!node) return false;
    }
    return node.isEnd;
  }

  isPrefix(str) {
    let node = this.root;
    for (const ch of str) {
      node = node.children.get(ch);
      if (!node) return false;
    }
    return true;
  }

  getNode(str) {
    let node = this.root;
    for (const ch of str) {
      node = node.children.get(ch);
      if (!node) return null;
    }
    return node;
  }

  static fromDictionary(dictionary) {
    const trie = new Trie();
    const words = dictionary.getAllWords();
    for (let i = 0; i < words.length; i++) {
      trie.insert(words[i]);
    }
    return trie;
  }
}

module.exports = Trie;
