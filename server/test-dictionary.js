const Dictionary = require('./dictionary');
const path = require('path');

async function test() {
  const dict = new Dictionary();
  const readlexPath = path.join(process.env.HOME, 'Code/shavian-info/readlex/readlex.json');

  await dict.loadDictionary(readlexPath);

  // Test some words
  console.log('\nTesting some words:');
  console.log('𐑣𐑧𐑤𐑴 (hello):', dict.isValidWord('𐑣𐑧𐑤𐑴'));
  console.log('𐑢𐑩𐑮𐑤𐑛 (world):', dict.isValidWord('𐑢𐑩𐑮𐑤𐑛'));
  console.log('𐑒𐑨𐑑 (cat):', dict.isValidWord('𐑒𐑨𐑑'));

  // Show some sample words
  const words = dict.getAllWords();
  console.log('\nFirst 20 words in dictionary:');
  words.slice(0, 20).forEach(w => console.log('  ', w));
}

test().catch(console.error);
