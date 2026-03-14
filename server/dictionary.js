const fs = require('fs');
const path = require('path');

// Compound letters to split: 𐑽->𐑦𐑩𐑮, 𐑼->𐑩𐑮, 𐑸->𐑭𐑮, 𐑹->𐑷𐑮, 𐑾->𐑦𐑩, 𐑿->𐑘𐑵
const COMPOUND_SPLITS = {
  '𐑽': '𐑦𐑩𐑮',
  '𐑼': '𐑩𐑮',
  '𐑸': '𐑭𐑮',
  '𐑹': '𐑷𐑮',
  '𐑾': '𐑦𐑩',
  '𐑿': '𐑘𐑵'
};

// POS tags to exclude (abbreviations, letters, etc.)
const EXCLUDED_POS = ['ZZ0', 'UNC']; // ZZ0 = single letters, UNC = unclassified

class Dictionary {
  constructor() {
    this.words = new Set();
    this.loaded = false;
  }

  // Split compound letters in a Shavian word
  splitCompounds(shavianWord) {
    let result = shavianWord;
    for (const [compound, split] of Object.entries(COMPOUND_SPLITS)) {
      result = result.split(compound).join(split);
    }
    return result;
  }

  // Check if a Latin word looks like an abbreviation
  isLikelyAbbreviation(latinWord) {
    // All uppercase and 2-5 characters (e.g., USA, BBC, NATO)
    if (/^[A-Z]{2,5}$/.test(latinWord)) return true;

    // Contains periods (e.g., U.S.A., Ph.D.)
    if (latinWord.includes('.')) return true;

    // Single letters
    if (latinWord.length === 1) return true;

    return false;
  }

  // Load and process the readlex dictionary
  async loadDictionary(readlexPath) {
    console.log('Loading dictionary from:', readlexPath);

    const data = fs.readFileSync(readlexPath, 'utf8');
    const readlex = JSON.parse(data);

    let totalEntries = 0;
    let excludedByPOS = 0;
    let excludedByAbbr = 0;
    let added = 0;

    for (const [key, entries] of Object.entries(readlex)) {
      for (const entry of entries) {
        totalEntries++;

        // Skip excluded POS tags
        if (EXCLUDED_POS.includes(entry.pos)) {
          excludedByPOS++;
          continue;
        }

        // Skip likely abbreviations based on Latin form
        if (this.isLikelyAbbreviation(entry.Latn)) {
          excludedByAbbr++;
          continue;
        }

        // Add the Shavian word with compounds split
        const shavianWord = this.splitCompounds(entry.Shaw);
        this.words.add(shavianWord);
        added++;
      }
    }

    this.loaded = true;
    console.log(`Dictionary loaded: ${this.words.size} unique words`);
    console.log(`  Total entries: ${totalEntries}`);
    console.log(`  Excluded by POS: ${excludedByPOS}`);
    console.log(`  Excluded as abbreviations: ${excludedByAbbr}`);
    console.log(`  Words added: ${added}`);

    return this.words.size;
  }

  // Check if a word is valid
  isValidWord(shavianWord) {
    if (!this.loaded) {
      throw new Error('Dictionary not loaded');
    }

    // Split compounds in the input word
    const normalizedWord = this.splitCompounds(shavianWord);
    return this.words.has(normalizedWord);
  }

  // Get all valid words (for testing/debugging)
  getAllWords() {
    return Array.from(this.words);
  }
}

module.exports = Dictionary;
