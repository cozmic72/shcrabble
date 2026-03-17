#!/usr/bin/env python3

import argparse
import csv
import json
import math
import multiprocessing
import os
import random
import sys
import time
from collections import defaultdict
from itertools import combinations, product
from pathlib import Path

COMPOUND_SPLITS = {
    '𐑽': '𐑦𐑩𐑮',
    '𐑼': '𐑩𐑮',
    '𐑸': '𐑭𐑮',
    '𐑹': '𐑷𐑮',
    '𐑾': '𐑦𐑩',
    '𐑿': '𐑘𐑵',
}

VALID_LETTERS = set(
    '𐑐𐑚𐑑𐑛𐑒𐑜𐑓𐑝𐑔𐑞𐑕𐑟𐑖𐑠𐑗𐑡𐑘𐑢𐑣𐑤𐑮𐑥𐑯𐑙'
    '𐑦𐑰𐑧𐑱𐑨𐑲𐑩𐑳𐑴𐑪𐑵𐑶𐑷𐑭𐑺𐑻𐑫𐑬'
)

ROTATION_PAIRS = [
    ('𐑐', '𐑚'), ('𐑑', '𐑛'), ('𐑒', '𐑜'), ('𐑓', '𐑝'),
    ('𐑔', '𐑞'), ('𐑕', '𐑟'), ('𐑖', '𐑠'), ('𐑗', '𐑡'),
    ('𐑙', '𐑣'), ('𐑤', '𐑮'), ('𐑧', '𐑪'), ('𐑨', '𐑩'),
    ('𐑫', '𐑵'), ('𐑬', '𐑶'), ('𐑭', '𐑷'),
]

ROTATION_MAP = {}
for a, b in ROTATION_PAIRS:
    ROTATION_MAP[a] = b
    ROTATION_MAP[b] = a

EXCLUDED_POS = {'ZZ0', 'UNC'}

# Vocabulary model: player vocab size drawn from log-normal distribution
VOCAB_MEDIAN = 5000       # median vocabulary size (word ranks)
VOCAB_LOG_SIGMA = 0.5     # spread in log-space (~2000-15000 range)
VOCAB_SIGMOID_K = 5.0     # steepness of the knowledge S-curve

T_LETTER = 0
T_POINTS = 1
T_IS_BLANK = 2
T_IS_ROTATABLE = 3
T_ROTATED_LETTER = 4
T_ROTATED_POINTS = 5


def split_compounds(shaw_word):
    result = []
    for ch in shaw_word:
        if ch in COMPOUND_SPLITS:
            result.extend(COMPOUND_SPLITS[ch])
        else:
            result.append(ch)
    return result


def load_dictionary(dict_path):
    with open(dict_path, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    anagram_map = defaultdict(set)
    word_freq = defaultdict(int)
    words_loaded = 0
    words_skipped_pos = 0
    words_skipped_letters = 0
    words_skipped_short = 0
    words_skipped_spaces = 0

    for key, entries in raw.items():
        for entry in entries:
            pos = entry.get('pos', '')
            pos_tags = set(pos.split('+')) if pos else set()
            if pos_tags & EXCLUDED_POS:
                words_skipped_pos += 1
                continue

            shaw = entry.get('Shaw', '')
            if not shaw:
                continue

            if ' ' in shaw:
                words_skipped_spaces += 1
                continue

            letters = split_compounds(shaw)

            if len(letters) < 2:
                words_skipped_short += 1
                continue

            if not all(ch in VALID_LETTERS for ch in letters):
                words_skipped_letters += 1
                continue

            sorted_key = tuple(sorted(letters))
            anagram_map[sorted_key].add(shaw)
            freq = entry.get('freq', 1)
            word_freq[shaw] = max(word_freq[shaw], freq)
            words_loaded += 1

    print(f"Dictionary loaded: {words_loaded} word entries")
    print(f"  Skipped (excluded POS): {words_skipped_pos}")
    print(f"  Skipped (invalid letters): {words_skipped_letters}")
    print(f"  Skipped (too short): {words_skipped_short}")
    print(f"  Skipped (multi-word): {words_skipped_spaces}")
    print(f"  Unique anagram keys: {len(anagram_map)}")
    print(f"  Unique words with frequency: {len(word_freq)}")

    return dict(anagram_map), dict(word_freq)


def build_word_ranks(word_freq):
    sorted_words = sorted(word_freq.keys(), key=lambda w: word_freq[w], reverse=True)
    word_rank = {word: rank + 1 for rank, word in enumerate(sorted_words)}
    total_words = len(word_rank)
    print(f"Word ranks computed: {total_words} words "
          f"(freq range {min(word_freq.values())}-{max(word_freq.values())})")
    return word_rank, total_words


def load_tiles(tiles_path):
    tiles = []
    with open(tiles_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            letter = row['letter'].strip()
            count = int(row['count'].strip())
            points = int(row['points'].strip())
            rotated_points_str = row.get('rotated_points', '').strip()
            rotated_points = int(rotated_points_str) if rotated_points_str else None

            is_blank = (letter == 'blank')
            is_rotatable = (not is_blank and rotated_points is not None)
            rotated_letter = ROTATION_MAP.get(letter) if is_rotatable else None

            tile = (letter, points, is_blank, is_rotatable, rotated_letter, rotated_points)
            for _ in range(count):
                tiles.append(tile)

    blank_count = sum(1 for t in tiles if t[T_IS_BLANK])
    rotatable_count = sum(1 for t in tiles if t[T_IS_ROTATABLE])
    print(f"Tile bag loaded: {len(tiles)} tiles "
          f"({blank_count} blanks, {rotatable_count} rotatable)")
    return tiles


def build_indices(anagram_map, max_length):
    keys_by_length = defaultdict(set)
    for key in anagram_map:
        if len(key) <= max_length:
            keys_by_length[len(key)].add(key)

    # 1-blank partial index: (word_length, sorted_partial) -> set of completing letters
    partial_1 = defaultdict(set)
    for key in anagram_map:
        if len(key) > max_length:
            continue
        for i in range(len(key)):
            partial = key[:i] + key[i+1:]
            partial_1[(len(key), partial)].add(key[i])

    # 2-blank partial index: (word_length, sorted_partial) -> set of sorted letter pairs
    partial_2 = defaultdict(set)
    for key in anagram_map:
        if len(key) > max_length:
            continue
        n = len(key)
        for i in range(n):
            for j in range(i + 1, n):
                partial = key[:i] + key[i+1:j] + key[j+1:]
                partial_2[(n, partial)].add((key[i], key[j]))

    return dict(keys_by_length), dict(partial_1), dict(partial_2)


def find_playable_words(rack, anagram_map, keys_by_length, partial_1, partial_2):
    playable_words = set()
    contributed = set()

    tile_opts = []
    for tile in rack:
        if tile[T_IS_BLANK]:
            tile_opts.append(None)
        elif tile[T_IS_ROTATABLE]:
            tile_opts.append((tile[T_LETTER], tile[T_ROTATED_LETTER]))
        else:
            tile_opts.append((tile[T_LETTER],))

    rack_size = len(rack)
    _sorted = sorted

    for subset_size in range(2, rack_size + 1):
        length_keys = keys_by_length.get(subset_size)
        if not length_keys:
            continue

        for indices in combinations(range(rack_size), subset_size):
            blank_count = 0
            fixed_opt_lists = []
            for rack_idx in indices:
                opts = tile_opts[rack_idx]
                if opts is None:
                    blank_count += 1
                else:
                    fixed_opt_lists.append(opts)

            if blank_count == 0:
                for combo in product(*fixed_opt_lists):
                    key = tuple(_sorted(combo))
                    if key in length_keys:
                        playable_words.update(anagram_map[key])
                        contributed.update(indices)

            elif blank_count == 1:
                for combo in product(*fixed_opt_lists):
                    sorted_partial = tuple(_sorted(combo))
                    completions = partial_1.get((subset_size, sorted_partial))
                    if completions:
                        for blank_letter in completions:
                            key = tuple(_sorted(combo + (blank_letter,)))
                            if key in length_keys:
                                playable_words.update(anagram_map[key])
                                contributed.update(indices)

            elif blank_count == 2:
                for combo in product(*fixed_opt_lists):
                    sorted_partial = tuple(_sorted(combo))
                    completions = partial_2.get((subset_size, sorted_partial))
                    if completions:
                        for pair in completions:
                            key = tuple(_sorted(combo + pair))
                            if key in length_keys:
                                playable_words.update(anagram_map[key])
                                contributed.update(indices)

    return playable_words, contributed


def player_knows_word(word_rank, vocab_size, rng):
    x = VOCAB_SIGMOID_K * (1.0 - word_rank / vocab_size)
    # Clamp to avoid overflow
    if x > 20:
        return True
    if x < -20:
        return False
    prob = 1.0 / (1.0 + math.exp(-x))
    return rng.random() < prob


def run_worker_chunk(args):
    tiles, anagram_map, keys_by_length, partial_1, partial_2, \
        word_ranks, total_ranked_words, \
        chunk_size, rack_size, seed, worker_id, report_progress = args

    rng = random.Random(seed)
    sample = rng.sample
    lognormvariate = rng.lognormvariate

    vocab_log_mu = math.log(VOCAB_MEDIAN)

    total_playable_count = 0
    racks_with_words = 0
    histogram = [0, 0, 0, 0, 0]
    letter_stats = defaultdict(lambda: [0, 0, 0])

    # Vocab-adjusted metrics
    vocab_total_known = 0
    vocab_racks_with_known = 0
    vocab_histogram = [0, 0, 0, 0, 0]
    vocab_letter_stats = defaultdict(lambda: [0, 0, 0])

    start_time = time.time()

    for i in range(chunk_size):
        if report_progress and (i + 1) % 10000 == 0:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed
            eta = (chunk_size - i - 1) / rate
            print(f"  Worker {worker_id}: {i + 1:,}/{chunk_size:,} "
                  f"({rate:.0f} iter/s, ETA {eta:.0f}s)", flush=True)

        rack = sample(tiles, rack_size)
        playable_words, contributed_indices = find_playable_words(
            rack, anagram_map, keys_by_length, partial_1, partial_2
        )

        word_count = len(playable_words)
        total_playable_count += word_count
        has_words = word_count > 0

        if has_words:
            racks_with_words += 1

        if word_count == 0:
            histogram[0] += 1
        elif word_count <= 5:
            histogram[1] += 1
        elif word_count <= 20:
            histogram[2] += 1
        elif word_count <= 50:
            histogram[3] += 1
        else:
            histogram[4] += 1

        # Vocab-adjusted: which playable words does this player know?
        vocab_size = lognormvariate(vocab_log_mu, VOCAB_LOG_SIGMA)
        known_words = set()
        for word in playable_words:
            rank = word_ranks.get(word, total_ranked_words)
            if player_knows_word(rank, vocab_size, rng):
                known_words.add(word)

        known_count = len(known_words)
        vocab_total_known += known_count
        has_known = known_count > 0

        if has_known:
            vocab_racks_with_known += 1

        if known_count == 0:
            vocab_histogram[0] += 1
        elif known_count <= 5:
            vocab_histogram[1] += 1
        elif known_count <= 20:
            vocab_histogram[2] += 1
        elif known_count <= 50:
            vocab_histogram[3] += 1
        else:
            vocab_histogram[4] += 1

        for idx in range(rack_size):
            tile = rack[idx]
            if tile[T_IS_BLANK]:
                continue
            primary = tile[T_LETTER]

            # Raw stats
            stats = letter_stats[primary]
            stats[0] += 1
            if idx in contributed_indices:
                stats[1] += 1
            if not has_words:
                stats[2] += 1

            # Vocab stats
            vstats = vocab_letter_stats[primary]
            vstats[0] += 1
            if idx in contributed_indices and has_known:
                vstats[1] += 1
            if not has_known:
                vstats[2] += 1

            if tile[T_IS_ROTATABLE]:
                rotated = tile[T_ROTATED_LETTER]

                stats_r = letter_stats[rotated]
                stats_r[0] += 1
                if idx in contributed_indices:
                    stats_r[1] += 1
                if not has_words:
                    stats_r[2] += 1

                vstats_r = vocab_letter_stats[rotated]
                vstats_r[0] += 1
                if idx in contributed_indices and has_known:
                    vstats_r[1] += 1
                if not has_known:
                    vstats_r[2] += 1

    return (total_playable_count, racks_with_words, histogram,
            dict(letter_stats),
            vocab_total_known, vocab_racks_with_known, vocab_histogram,
            dict(vocab_letter_stats),
            chunk_size)


def simulate(tiles, anagram_map, word_ranks, total_ranked_words,
             iterations, rack_size):
    print("Building lookup indices...")
    keys_by_length, partial_1, partial_2 = build_indices(anagram_map, rack_size)
    print(f"  Anagram keys (length <= {rack_size}): "
          f"{sum(len(v) for v in keys_by_length.values()):,}")
    print(f"  1-blank partial entries: {len(partial_1):,}")
    print(f"  2-blank partial entries: {len(partial_2):,}")

    n_workers = min(os.cpu_count() or 1, iterations)
    n_workers = min(n_workers, 16)
    chunk_size = math.ceil(iterations / n_workers)
    actual_iterations = chunk_size * n_workers

    print(f"Running {actual_iterations:,} iterations across {n_workers} workers "
          f"(rack size {rack_size})...\n")

    base_seed = random.randint(0, 2**32 - 1)
    worker_args = []
    for w in range(n_workers):
        report = (w == 0)
        worker_args.append((
            tiles, anagram_map, keys_by_length, partial_1, partial_2,
            word_ranks, total_ranked_words,
            chunk_size, rack_size, base_seed + w, w, report
        ))

    start_time = time.time()

    with multiprocessing.Pool(n_workers) as pool:
        results = pool.map(run_worker_chunk, worker_args)

    elapsed = time.time() - start_time

    total_playable_count = 0
    racks_with_words = 0
    histogram = [0, 0, 0, 0, 0]
    letter_stats = defaultdict(lambda: [0, 0, 0])

    vocab_total_known = 0
    vocab_racks_with_known = 0
    vocab_histogram = [0, 0, 0, 0, 0]
    vocab_letter_stats = defaultdict(lambda: [0, 0, 0])

    for result in results:
        (tpc, rww, hist, lstats,
         vtk, vrwk, vhist, vlstats, _) = result
        total_playable_count += tpc
        racks_with_words += rww
        vocab_total_known += vtk
        vocab_racks_with_known += vrwk
        for i in range(5):
            histogram[i] += hist[i]
            vocab_histogram[i] += vhist[i]
        for letter, stats in lstats.items():
            combined = letter_stats[letter]
            combined[0] += stats[0]
            combined[1] += stats[1]
            combined[2] += stats[2]
        for letter, stats in vlstats.items():
            combined = vocab_letter_stats[letter]
            combined[0] += stats[0]
            combined[1] += stats[1]
            combined[2] += stats[2]

    print(f"\nSimulation complete in {elapsed:.1f}s "
          f"({actual_iterations / elapsed:.0f} iter/s)\n")

    print_report(actual_iterations, racks_with_words, total_playable_count,
                 histogram, letter_stats, tiles, "RAW (all dictionary words)")

    print_report(actual_iterations, vocab_racks_with_known, vocab_total_known,
                 vocab_histogram, vocab_letter_stats, tiles,
                 f"VOCAB-ADJUSTED (median {VOCAB_MEDIAN} words, "
                 f"σ={VOCAB_LOG_SIGMA})")


HIST_LABELS = ['0', '1-5', '6-20', '21-50', '51+']


def print_report(iterations, racks_with_words, total_playable_count,
                 histogram, letter_stats, tiles, label=""):
    print("=" * 70)
    print(f"SHCRABBLE RACK PLAYABILITY REPORT — {label}")
    print("=" * 70)

    playable_pct = 100.0 * racks_with_words / iterations
    avg_words = total_playable_count / iterations
    print(f"\nRacks with at least one playable word: "
          f"{racks_with_words:,}/{iterations:,} ({playable_pct:.1f}%)")
    print(f"Average playable words per rack: {avg_words:.1f}")

    print(f"\nWord count distribution:")
    for label, count in zip(HIST_LABELS, histogram):
        pct = 100.0 * count / iterations
        bar = '#' * int(pct / 2)
        print(f"  {label:>5s}: {count:>7,} ({pct:5.1f}%) {bar}")

    tile_points = {}
    for tile in tiles:
        if not tile[T_IS_BLANK]:
            letter = tile[T_LETTER]
            if letter not in tile_points:
                tile_points[letter] = tile[T_POINTS]
            if tile[T_IS_ROTATABLE] and tile[T_ROTATED_LETTER]:
                rotated = tile[T_ROTATED_LETTER]
                if rotated not in tile_points:
                    tile_points[rotated] = tile[T_ROTATED_POINTS]

    print(f"\nPer-letter contribution rate "
          f"(when letter is in rack, % of time it's in a playable word):")
    print(f"  {'Letter':>6s}  {'Pts':>3s}  {'In Rack':>8s}  "
          f"{'Contributed':>12s}  {'Rate':>6s}")
    print(f"  {'------':>6s}  {'---':>3s}  {'--------':>8s}  "
          f"{'------------':>12s}  {'------':>6s}")

    sorted_letters = sorted(letter_stats.keys(),
                            key=lambda l: letter_stats[l][1] / max(letter_stats[l][0], 1))

    contribution_rates = {}
    for letter in sorted_letters:
        in_rack, contributed_count, _ = letter_stats[letter]
        rate = contributed_count / max(in_rack, 1)
        contribution_rates[letter] = rate
        pts = tile_points.get(letter, '?')
        print(f"  {letter:>6s}  {pts:>3}  {in_rack:>8,}  "
              f"{contributed_count:>12,}  {100 * rate:>5.1f}%")

    print(f"\nPer-letter stuck rate "
          f"(when NO word playable, how often is letter present):")
    print(f"  {'Letter':>6s}  {'Pts':>3s}  {'Dead Racks':>10s}  "
          f"{'In Rack':>8s}  {'Stuck Rate':>10s}")
    print(f"  {'------':>6s}  {'---':>3s}  {'----------':>10s}  "
          f"{'--------':>8s}  {'----------':>10s}")

    sorted_by_stuck = sorted(letter_stats.keys(),
                             key=lambda l: letter_stats[l][2] / max(letter_stats[l][0], 1),
                             reverse=True)

    for letter in sorted_by_stuck:
        in_rack, _, in_dead = letter_stats[letter]
        stuck_rate = in_dead / max(in_rack, 1)
        pts = tile_points.get(letter, '?')
        print(f"  {letter:>6s}  {pts:>3}  {in_dead:>10,}  "
              f"{in_rack:>8,}  {100 * stuck_rate:>9.1f}%")

    # Pearson correlation between point values and (1 - contribution_rate)
    letters_with_both = [l for l in contribution_rates
                         if l in tile_points and tile_points[l] != '?']
    if len(letters_with_both) >= 2:
        points_list = [tile_points[l] for l in letters_with_both]
        difficulty_list = [1.0 - contribution_rates[l] for l in letters_with_both]

        n = len(points_list)
        mean_p = sum(points_list) / n
        mean_d = sum(difficulty_list) / n

        cov = sum((p - mean_p) * (d - mean_d)
                  for p, d in zip(points_list, difficulty_list))
        var_p = sum((p - mean_p) ** 2 for p in points_list)
        var_d = sum((d - mean_d) ** 2 for d in difficulty_list)

        if var_p > 0 and var_d > 0:
            correlation = cov / (var_p ** 0.5 * var_d ** 0.5)
            print(f"\nPoint value vs difficulty (1 - contribution_rate) "
                  f"correlation: {correlation:.3f}")
            if correlation > 0.5:
                print("  Strong positive correlation: "
                      "higher-point tiles are harder to play (good!)")
            elif correlation > 0.2:
                print("  Moderate positive correlation: "
                      "point values partially reflect difficulty")
            elif correlation > -0.2:
                print("  Weak/no correlation: "
                      "point values don't strongly track playability")
            else:
                print("  Negative correlation: "
                      "higher-point tiles are EASIER to play (inverted!)")
        else:
            print("\nCould not compute correlation (zero variance)")


def parse_args():
    parser = argparse.ArgumentParser(
        description='Shcrabble rack playability Monte Carlo simulator')
    parser.add_argument('--tiles', type=str, default='data/tiles-rotatable.csv',
                        help='Path to tile CSV file (default: data/tiles-rotatable.csv)')
    parser.add_argument('--iterations', type=int, default=100000,
                        help='Number of simulation iterations (default: 100000)')
    parser.add_argument('--rack-size', type=int, default=9,
                        help='Number of tiles per rack (default: 9)')
    return parser.parse_args()


def main():
    args = parse_args()

    script_dir = Path(__file__).parent
    tiles_path = script_dir / args.tiles
    dict_path = script_dir / 'data' / 'readlex' / 'readlex.json'

    print(f"Tile file: {tiles_path}")
    print(f"Dictionary: {dict_path}")
    print(f"Iterations: {args.iterations:,}")
    print(f"Rack size: {args.rack_size}\n")

    anagram_map, word_freq = load_dictionary(dict_path)
    word_ranks, total_ranked_words = build_word_ranks(word_freq)
    tiles = load_tiles(tiles_path)

    if args.rack_size > len(tiles):
        print(f"ERROR: Rack size ({args.rack_size}) exceeds bag size ({len(tiles)})")
        sys.exit(1)

    simulate(tiles, anagram_map, word_ranks, total_ranked_words,
             args.iterations, args.rack_size)


if __name__ == '__main__':
    main()
