#!/usr/bin/env python3
"""
Calibrate tile point values from simulation strand rates.

Reads the current tiles.csv, applies new point values derived from
simulation-measured strand rates, and writes the updated CSV.

Usage: python3 calibrate_points.py [tiles_csv_path]
"""

import csv
import math
import sys

# Strand rates from simulation (paste from simulate_games.js output)
# Letter -> strand rate as fraction (not percentage)
# Split-extended iter 1
STRAND_RATES = {
    '𐒬': 0.4580,
    '𐒟': 0.4355,
    '𐑘': 0.3400,
    '𐑔': 0.1930,
    '𐑖': 0.1320,
    '𐑢': 0.1230,
    '𐑳': 0.0980,
    '𐑙': 0.0885,
    '𐑓': 0.0820,
    '𐑬': 0.0675,
    '𐑗': 0.0660,
    '𐑧': 0.0615,
    '𐑐': 0.0575,
    '𐑭': 0.0570,
    '𐑥': 0.0495,
    '𐑨': 0.0490,
    '𐑫': 0.0435,
    '𐑒': 0.0390,
    '𐑱': 0.0370,
    '𐑯': 0.0320,
    '𐑦': 0.0320,
    '𐑲': 0.0315,
    '𐑴': 0.0305,
    '𐑰': 0.0230,
    '𐑤': 0.0145,
    '𐑑': 0.0130,
    '𐑕': 0.0100,
}

MIN_STRAND = 0.001  # floor for log scale (avoid log(0))


def compute_points(strand_rates):
    log_scores = {}
    for letter, rate in strand_rates.items():
        log_scores[letter] = math.log(max(rate, MIN_STRAND))

    min_log = min(log_scores.values())
    max_log = max(log_scores.values())
    log_range = max_log - min_log if max_log != min_log else 1.0

    point_values = {}
    for letter, log_score in log_scores.items():
        normalized = (log_score - min_log) / log_range
        point_values[letter] = max(1, min(10, int(1 + normalized * 9)))

    return point_values


def update_csv(csv_path, point_values):
    rows = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        rows.append(header)
        for row in reader:
            letter = row[0].strip()
            if letter in point_values:
                row[2] = str(point_values[letter])
            rows.append(row)

    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(rows)


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else 'data/tiles.csv'

    point_values = compute_points(STRAND_RATES)

    print("Simulation-calibrated point values:")
    print(f"{'Letter':<6} {'Strand%':>8} {'Points':>6}")
    print("-" * 24)

    for letter in sorted(STRAND_RATES, key=STRAND_RATES.get, reverse=True):
        rate = STRAND_RATES[letter]
        pts = point_values[letter]
        print(f"{letter:<6} {rate*100:>7.1f}% {pts:>6}")

    print(f"\nPoint distribution: {sorted(set(point_values.values()))}")
    print(f"Updating {csv_path}...")

    update_csv(csv_path, point_values)
    print("Done.")


if __name__ == '__main__':
    main()
