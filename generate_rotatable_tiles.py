#!/usr/bin/env python3
"""
Generate tile distribution for Shcrabble rotatable mode.

In rotatable mode, rotationally symmetric Shavian letter pairs share
a single physical tile that can be played in either orientation.
This reduces the 42-letter split alphabet to 27 distinct tiles.

Output CSV has an optional fourth column (rotated_points) for tiles
that can be rotated. The game code uses a hard-coded rotation map to
determine which letter the rotated tile represents.
"""

import json
import math
from collections import Counter

# Extended alphabet: yea and oevre replace err and air.
# Mapped to unofficial codepoints in the Shavian block.
YEA = '\U000104AC'
OEVRE = '\U0001049F'

COMPOUND_SPLITS = {
    '𐑽': '𐑦𐑩𐑮',
    '𐑼': '𐑩𐑮',
    '𐑸': '𐑭𐑮',
    '𐑹': '𐑷𐑮',
    '𐑾': '𐑦𐑩',
    '𐑿': '𐑘𐑵'
}

VALID_LETTERS = set(
    '𐑐𐑚𐑑𐑛𐑒𐑜𐑓𐑝𐑔𐑞𐑕𐑟𐑖𐑠𐑗𐑡𐑘𐑢𐑣𐑤𐑮𐑥𐑯𐑙'
    '𐑦𐑰𐑧𐑱𐑨𐑲𐑩𐑳𐑴𐑪𐑵𐑶𐑷𐑭𐑺𐑻𐑫𐑬'
)

# Extended alphabet: err/air split into yea/oevre + roar
EXTENDED_COMPOUND_SPLITS = {
    '𐑺': YEA + '𐑮',
    '𐑻': OEVRE + '𐑮',
}
EXTENDED_VALID_LETTERS = (VALID_LETTERS - {'𐑺', '𐑻'}) | {YEA, OEVRE}

# Rotationally symmetric pairs: (primary, rotated)
ROTATION_PAIRS = [
    ('𐑐', '𐑚'),  # peep / bib
    ('𐑑', '𐑛'),  # tot / dead
    ('𐑒', '𐑜'),  # kick / gag
    ('𐑓', '𐑝'),  # fee / vow
    ('𐑔', '𐑞'),  # thigh / they
    ('𐑕', '𐑟'),  # so / zoo
    ('𐑖', '𐑠'),  # sure / measure
    ('𐑗', '𐑡'),  # church / judge
    ('𐑙', '𐑣'),  # hung / ha-ha
    ('𐑤', '𐑮'),  # loll / roar
    ('𐑧', '𐑪'),  # egg / on
    ('𐑨', '𐑩'),  # ash / ado
    ('𐑫', '𐑵'),  # wool / ooze
    ('𐑬', '𐑶'),  # out / oil
    ('𐑭', '𐑷'),  # are / or
]

EXCLUDED_POS = ['ZZ0', 'UNC']

TOTAL_TILES = 100
BLANK_TILES = 2
READLEX_PATH = 'data/readlex/readlex.json'
OUTPUT_PATH = 'data/tiles-rotatable.csv'
OUTPUT_PATH_EXTENDED = 'data/tiles-rotatable-extended.csv'
USE_WORD_FREQUENCY = True

MAX_TILES_PER_LETTER = 6
CONSONANT_BOOST = 1.15

# Rotatable tiles are more versatile (two letters in one), so we deflate
# their combined frequency to leave room for unique tiles.
ROTATABLE_DEFLATION = 0.8

RACK_SIZE = 9

CONSONANTS = set('𐑐𐑚𐑑𐑛𐑒𐑜𐑓𐑝𐑔𐑞𐑕𐑟𐑖𐑠𐑗𐑡𐑘𐑢𐑣𐑤𐑮𐑥𐑯𐑙')


def split_compounds(text, extra_splits=None):
    for compound, split in COMPOUND_SPLITS.items():
        text = text.replace(compound, split)
    if extra_splits:
        for compound, split in extra_splits.items():
            text = text.replace(compound, split)
    return text


def load_and_analyze(valid_letters, extra_splits=None):
    """Load readlex, return letter frequency counts and word list for playability analysis."""
    print(f"Loading {READLEX_PATH}...")

    with open(READLEX_PATH, 'r', encoding='utf-8') as f:
        readlex = json.load(f)

    letter_counts = Counter()
    words = []
    total_words = 0
    filtered_words = 0

    for key, entries in readlex.items():
        for entry in entries:
            if entry.get('pos', '') in EXCLUDED_POS:
                filtered_words += 1
                continue

            shaw_word = entry.get('Shaw', '')
            if not shaw_word:
                continue

            shaw_word = split_compounds(shaw_word, extra_splits)
            freq = entry.get('freq', 1)
            weight = freq if USE_WORD_FREQUENCY else 1

            letters_in_word = [c for c in shaw_word if c in valid_letters]
            for letter in letters_in_word:
                letter_counts[letter] += weight

            if letters_in_word:
                words.append((letters_in_word, freq))

            total_words += 1

    print(f"Processed {total_words} words (filtered {filtered_words})")
    print(f"Found {len(letter_counts)} unique letters")
    print(f"Collected {len(words)} words for playability analysis")
    return letter_counts, words


def build_rotation_maps():
    primary_to_rotated = {}
    rotated_to_primary = {}
    for primary, rotated in ROTATION_PAIRS:
        primary_to_rotated[primary] = rotated
        rotated_to_primary[rotated] = primary
    return primary_to_rotated, rotated_to_primary


def calculate_tile_distribution(letter_counts, valid_letters):
    primary_to_rotated, rotated_to_primary = build_rotation_maps()

    tile_frequencies = {}
    for letter in sorted(valid_letters):
        if letter in rotated_to_primary:
            continue
        if letter in primary_to_rotated:
            rotated = primary_to_rotated[letter]
            combined = letter_counts.get(letter, 0) + letter_counts.get(rotated, 0)
            tile_frequencies[letter] = combined * ROTATABLE_DEFLATION
        else:
            tile_frequencies[letter] = letter_counts.get(letter, 0)

    total_freq = sum(tile_frequencies.values())
    available_tiles = TOTAL_TILES - BLANK_TILES

    raw_counts = {}
    for letter, freq in tile_frequencies.items():
        raw_count = (freq / total_freq) * available_tiles
        if letter in CONSONANTS:
            raw_count *= CONSONANT_BOOST
        raw_counts[letter] = raw_count

    # Largest remainder method
    tile_counts = {}
    remainders = []
    for letter, raw_count in raw_counts.items():
        base = int(raw_count)
        tile_counts[letter] = base
        remainders.append((raw_count - base, letter))

    remainders.sort(reverse=True)
    tiles_to_distribute = available_tiles - sum(tile_counts.values())
    for i in range(tiles_to_distribute):
        _, letter = remainders[i]
        tile_counts[letter] += 1

    for letter in tile_counts:
        if tile_counts[letter] < 1:
            tile_counts[letter] = 1

    # Cap per tile type
    redistributed = 0
    for letter in list(tile_counts.keys()):
        if tile_counts[letter] > MAX_TILES_PER_LETTER:
            excess = tile_counts[letter] - MAX_TILES_PER_LETTER
            tile_counts[letter] = MAX_TILES_PER_LETTER
            redistributed += excess

    if redistributed > 0:
        sorted_by_count = sorted(tile_counts.items(), key=lambda x: x[1])
        for i in range(int(redistributed)):
            letter, _ = sorted_by_count[i % len(sorted_by_count)]
            if tile_counts[letter] < MAX_TILES_PER_LETTER:
                tile_counts[letter] += 1

    # Adjust total
    current_total = sum(tile_counts.values())
    if current_total > available_tiles:
        sorted_desc = sorted(
            tile_counts.items(), key=lambda x: x[1], reverse=True
        )
        for i in range(current_total - available_tiles):
            letter, count = sorted_desc[i]
            if count > 1:
                tile_counts[letter] -= 1
    elif current_total < available_tiles:
        sorted_asc = sorted(tile_counts.items(), key=lambda x: x[1])
        deficit = available_tiles - current_total
        for i in range(deficit):
            letter, _ = sorted_asc[i % len(sorted_asc)]
            if tile_counts[letter] < MAX_TILES_PER_LETTER:
                tile_counts[letter] += 1

    return tile_counts


def calculate_playability(words, tile_counts):
    """Calculate per-letter playability based on word formation probability.

    For each word containing letter L, we compute:
      score = word_freq * Π(tile_count[c] / total_tiles) for c ≠ L

    This captures how likely you are to have the *other* letters needed
    to play a word using L. Letters whose words require rare co-letters
    score lower (harder to play → more points).
    """
    total_tiles = sum(tile_counts.values())
    tile_probability = {
        letter: count / total_tiles for letter, count in tile_counts.items()
    }

    # For letters not in tile_counts (rotated secondaries), map them
    # to their primary tile's probability
    primary_to_rotated, rotated_to_primary = build_rotation_maps()
    for rotated, primary in rotated_to_primary.items():
        if primary in tile_probability:
            tile_probability[rotated] = tile_probability[primary]

    playability = Counter()

    for letters_in_word, word_freq in words:
        if len(letters_in_word) < 2 or len(letters_in_word) > RACK_SIZE:
            continue

        for i, target_letter in enumerate(letters_in_word):
            co_letters = letters_in_word[:i] + letters_in_word[i + 1:]

            co_probability = 1.0
            for co_letter in co_letters:
                co_probability *= tile_probability.get(co_letter, 0.01)

            # Geometric mean normalizes for word length so longer words
            # aren't exponentially penalized vs short ones
            co_score = co_probability ** (1.0 / len(co_letters))

            playability[target_letter] += word_freq * co_score

    return playability


def calculate_point_values(tile_counts, words):
    primary_to_rotated, _ = build_rotation_maps()

    playability = calculate_playability(words, tile_counts)

    # Use log scale — playability spans many orders of magnitude
    log_scores = {}
    for letter, score in playability.items():
        if score > 0:
            log_scores[letter] = math.log(score)

    if not log_scores:
        return {l: (1, None) for l in tile_counts}

    min_log = min(log_scores.values())
    max_log = max(log_scores.values())
    log_range = max_log - min_log if max_log != min_log else 1.0

    def score_letter(letter):
        if letter not in log_scores:
            return 10
        # Invert: high playability → low points, low playability → high points
        normalized = 1.0 - (log_scores[letter] - min_log) / log_range
        return max(1, min(10, int(1 + normalized * 9)))

    point_values = {}
    for letter in tile_counts:
        primary_points = score_letter(letter)
        if letter in primary_to_rotated:
            rotated_points = score_letter(primary_to_rotated[letter])
            point_values[letter] = (primary_points, rotated_points)
        else:
            point_values[letter] = (primary_points, None)

    return point_values


def generate_csv_to(tile_counts, point_values, output_path):
    sorted_letters = sorted(tile_counts.keys())
    lines = ['letter,count,points,rotated_points']

    for letter in sorted_letters:
        count = tile_counts[letter]
        primary_points, rotated_points = point_values[letter]
        rotated_str = str(rotated_points) if rotated_points is not None else ''
        lines.append(f'{letter},{count},{primary_points},{rotated_str}')

    lines.append(f'blank,{BLANK_TILES},0,')
    csv_content = '\n'.join(lines) + '\n'

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(csv_content)

    print(f"\nGenerated {output_path}")


def print_statistics(letter_counts, tile_counts, point_values):
    primary_to_rotated, _ = build_rotation_maps()
    total_occurrences = sum(letter_counts.values())

    print("\n" + "=" * 70)
    print("ROTATABLE TILE DISTRIBUTION")
    print("=" * 70)
    print(
        f"{'Tile':<6} {'Rot':<6} {'Count':<7} "
        f"{'Pts':<5} {'RPts':<6} {'Freq %':<8}"
    )
    print("-" * 70)

    sorted_letters = sorted(
        tile_counts.keys(),
        key=lambda x: tile_counts[x],
        reverse=True,
    )

    for letter in sorted_letters:
        count = tile_counts[letter]
        primary_points, rotated_points = point_values[letter]
        rotated = primary_to_rotated.get(letter, '')

        freq = letter_counts.get(letter, 0)
        if letter in primary_to_rotated:
            freq += letter_counts.get(primary_to_rotated[letter], 0)
        frequency = (freq / total_occurrences) * 100

        rpts = str(rotated_points) if rotated_points is not None else '-'
        rot = rotated if rotated else '-'
        print(
            f'{letter:<6} {rot:<6} {count:<7} '
            f'{primary_points:<5} {rpts:<6} {frequency:<8.2f}'
        )

    print("-" * 70)
    print(f'blank  -      {BLANK_TILES:<7} 0     -')
    print("-" * 70)

    total_tiles = sum(tile_counts.values()) + BLANK_TILES
    total_points = sum(
        count * point_values[letter][0]
        for letter, count in tile_counts.items()
    )
    avg_points = total_points / (total_tiles - BLANK_TILES)

    rotatable_count = sum(1 for v in point_values.values() if v[1] is not None)
    single_count = sum(1 for v in point_values.values() if v[1] is None)

    print(f"\nTotal tiles: {total_tiles}")
    print(f"Unique tile types: {len(tile_counts)}")
    print(f"  Rotatable pairs: {rotatable_count}")
    print(f"  Single-sided: {single_count}")
    print(f"Rotatable deflation factor: {ROTATABLE_DEFLATION}")
    print(f"Average points per tile (primary): {avg_points:.2f}")


def generate_variant(label, valid_letters, output_path, extra_splits=None):
    letter_counts, words = load_and_analyze(valid_letters, extra_splits)

    print(f"\nCalculating rotatable tile distribution ({label})...")
    tile_counts = calculate_tile_distribution(letter_counts, valid_letters)

    print("Calculating point values via playability analysis...")
    point_values = calculate_point_values(tile_counts, words)

    print_statistics(letter_counts, tile_counts, point_values)
    generate_csv_to(tile_counts, point_values, output_path)


def main():
    print("Shcrabble Rotatable Tile Generator")
    print("=" * 70)

    generate_variant("standard", VALID_LETTERS, OUTPUT_PATH)

    print("\n--- Extended alphabet (yea + oevre) ---")
    generate_variant(
        "extended", EXTENDED_VALID_LETTERS, OUTPUT_PATH_EXTENDED,
        extra_splits=EXTENDED_COMPOUND_SPLITS,
    )

    print("\nDone!")


if __name__ == '__main__':
    main()
