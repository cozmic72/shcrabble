#!/usr/bin/env python3
"""
Generate optimal tile distribution and point values for Shcrabble
based on letter frequency analysis of the Readlex dictionary.

This script:
1. Loads readlex.json
2. Filters out excluded POS tags (ZZ0, UNC)
3. Splits compound letters into constituent letters
4. Analyzes letter frequencies (optionally weighted by word frequency)
5. Calculates tile counts (100 total tiles)
6. Calculates point values (inverse of frequency)
7. Outputs tiles.csv
"""

import json
import math
from collections import Counter

# Compound letter mappings (same as in game)
COMPOUND_SPLITS = {
    '𐑽': '𐑦𐑩𐑮',
    '𐑼': '𐑩𐑮',
    '𐑸': '𐑭𐑮',
    '𐑹': '𐑷𐑮',
    '𐑾': '𐑦𐑩',
    '𐑿': '𐑘𐑵'
}

# Valid Shavian alphabet letters (42 basic letters, excluding compounds)
VALID_LETTERS = set('𐑐𐑚𐑑𐑛𐑒𐑜𐑓𐑝𐑔𐑞𐑕𐑟𐑖𐑠𐑗𐑡𐑘𐑢𐑣𐑤𐑮𐑥𐑯𐑙𐑦𐑰𐑧𐑱𐑨𐑲𐑩𐑳𐑴𐑪𐑵𐑶𐑷𐑭𐑺𐑻𐑫𐑬')

# POS tags to exclude (same as in game)
EXCLUDED_POS = ['ZZ0', 'UNC']

# Configuration
TOTAL_TILES = 100
BLANK_TILES = 2
READLEX_PATH = '../shavian-info/readlex/readlex.json'
OUTPUT_PATH = 'data/tiles.csv'
USE_WORD_FREQUENCY = True  # Weight by word frequency

# Gameplay tuning
MAX_TILES_PER_LETTER = 6  # Prevent any single letter from dominating
CONSONANT_BOOST = 1.15  # Boost consonant counts by 15%

# Shavian consonants and vowels
CONSONANTS = set('𐑐𐑚𐑑𐑛𐑒𐑜𐑓𐑝𐑔𐑞𐑕𐑟𐑖𐑠𐑗𐑡𐑘𐑢𐑣𐑤𐑮𐑥𐑯𐑙')
VOWELS = set('𐑦𐑰𐑧𐑱𐑨𐑲𐑩𐑳𐑴𐑪𐑵𐑶𐑷𐑭𐑺𐑻𐑫𐑬')


def split_compounds(text):
    """Replace compound letters with their split forms."""
    for compound, split in COMPOUND_SPLITS.items():
        text = text.replace(compound, split)
    return text


def load_and_analyze():
    """Load readlex and analyze letter frequencies."""
    print(f"Loading {READLEX_PATH}...")

    with open(READLEX_PATH, 'r', encoding='utf-8') as f:
        readlex = json.load(f)

    letter_counts = Counter()
    total_words = 0
    filtered_words = 0

    for key, entries in readlex.items():
        for entry in entries:
            pos = entry.get('pos', '')

            # Skip excluded POS tags
            if pos in EXCLUDED_POS:
                filtered_words += 1
                continue

            shaw_word = entry.get('Shaw', '')
            if not shaw_word:
                continue

            # Split compounds
            shaw_word = split_compounds(shaw_word)

            # Weight by word frequency if enabled
            freq = entry.get('freq', 1)
            weight = freq if USE_WORD_FREQUENCY else 1

            # Count letters (only valid Shavian letters)
            for letter in shaw_word:
                if letter in VALID_LETTERS:
                    letter_counts[letter] += weight

            total_words += 1

    print(f"Processed {total_words} words (filtered {filtered_words})")
    print(f"Found {len(letter_counts)} unique letters")

    return letter_counts


def calculate_tile_distribution(letter_counts):
    """Calculate how many tiles each letter should have."""
    # Remove compounds if they somehow got in
    for compound in COMPOUND_SPLITS.keys():
        if compound in letter_counts:
            del letter_counts[compound]

    # Calculate total letter occurrences
    total_letters = sum(letter_counts.values())

    # Available tiles (excluding blanks)
    available_tiles = TOTAL_TILES - BLANK_TILES

    # Calculate raw tile counts based on frequency with consonant boost
    tile_distribution = {}
    for letter, count in letter_counts.items():
        frequency = count / total_letters
        # Scale to available tiles
        raw_count = frequency * available_tiles

        # Boost consonants to prevent vowel-heavy hands
        if letter in CONSONANTS:
            raw_count *= CONSONANT_BOOST

        tile_distribution[letter] = raw_count

    # Round to integers while maintaining total
    # Use largest remainder method
    tile_counts = {}
    remainder_heap = []

    for letter, raw_count in tile_distribution.items():
        base = int(raw_count)
        remainder = raw_count - base
        tile_counts[letter] = base
        remainder_heap.append((remainder, letter))

    # Sort by remainder (descending)
    remainder_heap.sort(reverse=True)

    # Distribute remaining tiles
    current_total = sum(tile_counts.values())
    tiles_to_distribute = available_tiles - current_total

    for i in range(tiles_to_distribute):
        _, letter = remainder_heap[i]
        tile_counts[letter] += 1

    # Ensure at least 1 tile per letter
    for letter in tile_counts:
        if tile_counts[letter] < 1:
            tile_counts[letter] = 1

    # Apply maximum cap per letter to prevent dominance
    redistributed = 0
    for letter in list(tile_counts.keys()):
        if tile_counts[letter] > MAX_TILES_PER_LETTER:
            excess = tile_counts[letter] - MAX_TILES_PER_LETTER
            tile_counts[letter] = MAX_TILES_PER_LETTER
            redistributed += excess

    # Redistribute capped tiles to letters with fewer tiles
    if redistributed > 0:
        # Give to letters with fewest tiles (but not already at max)
        sorted_by_count = sorted(tile_counts.items(), key=lambda x: x[1])
        for i in range(int(redistributed)):
            letter, count = sorted_by_count[i % len(sorted_by_count)]
            if tile_counts[letter] < MAX_TILES_PER_LETTER:
                tile_counts[letter] += 1

    # Adjust if we exceeded total
    current_total = sum(tile_counts.values())
    if current_total > available_tiles:
        # Remove from most common letters
        sorted_letters = sorted(tile_counts.items(), key=lambda x: x[1], reverse=True)
        excess = current_total - available_tiles
        for i in range(excess):
            letter, count = sorted_letters[i]
            if count > 1:
                tile_counts[letter] -= 1
    elif current_total < available_tiles:
        # Add to least common letters
        sorted_letters = sorted(tile_counts.items(), key=lambda x: x[1])
        deficit = available_tiles - current_total
        for i in range(deficit):
            letter, count = sorted_letters[i % len(sorted_letters)]
            if tile_counts[letter] < MAX_TILES_PER_LETTER:
                tile_counts[letter] += 1

    return tile_counts


def calculate_point_values(letter_counts, tile_counts):
    """Calculate point values inversely proportional to frequency."""
    # Calculate total occurrences
    total_occurrences = sum(letter_counts.values())

    # Calculate inverse frequency scores
    inverse_scores = {}
    for letter, count in letter_counts.items():
        if letter not in tile_counts:
            continue
        if count == 0:
            continue
        frequency = count / total_occurrences
        if frequency == 0:
            continue
        # Inverse score (less frequent = higher score)
        inverse_scores[letter] = 1.0 / frequency

    # Normalize to a reasonable point scale (1-10)
    min_score = min(inverse_scores.values())
    max_score = max(inverse_scores.values())

    point_values = {}
    for letter, inv_score in inverse_scores.items():
        # Scale to 1-10 range
        normalized = (inv_score - min_score) / (max_score - min_score)
        # Map to points: very common = 1, very rare = 10
        points = int(1 + normalized * 9)

        # Apply some smoothing based on standard Scrabble distribution
        # Very common letters (>5% frequency) should be 1 point
        frequency = letter_counts[letter] / total_occurrences
        if frequency > 0.05:
            points = 1
        elif frequency > 0.03:
            points = min(points, 2)
        elif frequency > 0.02:
            points = min(points, 3)
        elif frequency > 0.01:
            points = min(points, 4)

        point_values[letter] = points

    return point_values


def generate_csv(tile_counts, point_values):
    """Generate tiles.csv file."""
    # Sort letters by Unicode codepoint for consistency
    sorted_letters = sorted(tile_counts.keys())

    lines = ['letter,count,points']

    # Add letter tiles
    for letter in sorted_letters:
        count = tile_counts[letter]
        points = point_values[letter]
        lines.append(f'{letter},{count},{points}')

    # Add blank tiles
    lines.append(f'blank,{BLANK_TILES},0')

    csv_content = '\n'.join(lines) + '\n'

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        f.write(csv_content)

    print(f"\nGenerated {OUTPUT_PATH}")


def print_statistics(letter_counts, tile_counts, point_values):
    """Print statistics about the distribution."""
    print("\n" + "="*60)
    print("TILE DISTRIBUTION AND POINT VALUES")
    print("="*60)
    print(f"{'Letter':<8} {'Count':<8} {'Points':<8} {'Frequency %':<12}")
    print("-"*60)

    total_occurrences = sum(letter_counts.values())
    sorted_letters = sorted(tile_counts.keys(),
                           key=lambda x: letter_counts[x],
                           reverse=True)

    for letter in sorted_letters:
        count = tile_counts[letter]
        points = point_values[letter]
        frequency = (letter_counts[letter] / total_occurrences) * 100
        print(f'{letter:<8} {count:<8} {points:<8} {frequency:<12.2f}')

    print("-"*60)
    print(f'blank    {BLANK_TILES:<8} 0')
    print("-"*60)

    total_tiles = sum(tile_counts.values()) + BLANK_TILES
    total_points = sum(c * point_values[l] for l, c in tile_counts.items())
    avg_points = total_points / (total_tiles - BLANK_TILES)

    print(f"\nTotal tiles: {total_tiles}")
    print(f"Average points per tile: {avg_points:.2f}")
    print(f"Point distribution: {sorted(set(point_values.values()))}")


def main():
    print("Shcrabble Tile Generator")
    print("="*60)

    # Analyze letter frequencies
    letter_counts = load_and_analyze()

    # Calculate tile distribution
    print("\nCalculating tile distribution...")
    tile_counts = calculate_tile_distribution(letter_counts)

    # Calculate point values
    print("Calculating point values...")
    point_values = calculate_point_values(letter_counts, tile_counts)

    # Print statistics
    print_statistics(letter_counts, tile_counts, point_values)

    # Generate CSV
    generate_csv(tile_counts, point_values)

    print("\nDone!")


if __name__ == '__main__':
    main()
