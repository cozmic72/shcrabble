#!/usr/bin/env python3
"""
Analyze consonant/vowel distribution in current tiles.csv
"""

import csv

# Shavian consonants (24 letters)
CONSONANTS = set('𐑐𐑚𐑑𐑛𐑒𐑜𐑓𐑝𐑔𐑞𐑕𐑟𐑖𐑠𐑗𐑡𐑘𐑢𐑣𐑤𐑮𐑥𐑯𐑙')

# Shavian vowels (18 letters)
VOWELS = set('𐑦𐑰𐑧𐑱𐑨𐑲𐑩𐑳𐑴𐑪𐑵𐑶𐑷𐑭𐑺𐑻𐑫𐑬')

def analyze():
    consonant_tiles = 0
    vowel_tiles = 0

    with open('data/tiles.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            letter = row['letter']
            count = int(row['count'])

            if letter in CONSONANTS:
                consonant_tiles += count
                print(f"Consonant: {letter} x{count}")
            elif letter in VOWELS:
                vowel_tiles += count
                print(f"Vowel: {letter} x{count}")

    total = consonant_tiles + vowel_tiles
    print(f"\n{'='*50}")
    print(f"Consonant tiles: {consonant_tiles} ({consonant_tiles/total*100:.1f}%)")
    print(f"Vowel tiles: {vowel_tiles} ({vowel_tiles/total*100:.1f}%)")
    print(f"Total letter tiles: {total}")
    print(f"\nConsonant types: {len(CONSONANTS)}")
    print(f"Vowel types: {len(VOWELS)}")
    print(f"\nAvg tiles per consonant: {consonant_tiles/len(CONSONANTS):.1f}")
    print(f"Avg tiles per vowel: {vowel_tiles/len(VOWELS):.1f}")

if __name__ == '__main__':
    analyze()
