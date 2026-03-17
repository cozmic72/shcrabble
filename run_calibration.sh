#!/bin/bash
# Automated calibration loop: sim → calibrate → sim → average → calibrate → sim
# Usage: ./run_calibration.sh <alphabet> [iterations]

ALPHABET=${1:-split}
ITERATIONS=${2:-3}
GAMES=5000
VOCAB=10000
TOPN=3

echo "Calibrating $ALPHABET: $ITERATIONS iterations, $GAMES games each"

for iter in $(seq 1 $ITERATIONS); do
  echo ""
  echo "=== Iteration $iter ==="

  # Run simulation and capture per-letter output
  OUTPUT=$(node simulate_games.js --alphabet $ALPHABET --games $GAMES --vocab $VOCAB --top-n $TOPN 2>&1)

  COMPLETION=$(echo "$OUTPUT" | grep "Completion rate" | grep -o '[0-9.]*%')
  PASS_RATE=$(echo "$OUTPUT" | grep "Pass rate" | grep -o '[0-9.]*%')
  STRAND_R=$(echo "$OUTPUT" | grep "stranded rate" | grep -o '[0-9.-]*$')

  echo "  Completion: $COMPLETION  Pass: $PASS_RATE  Strand r: $STRAND_R"

  # Extract strand rates and build Python dict
  STRAND_DICT=$(echo "$OUTPUT" | sed -n '/PER-LETTER/,/CORRELATION/p' | \
    grep -v "Letter\|---\|PER-LET\|CORR\|blank" | \
    awk 'NF >= 6 && $6 ~ /%/ { gsub(/%/, "", $6); printf "    '\''%s'\'': %.4f,\n", $1, $6/100 }')

  if [ -z "$STRAND_DICT" ]; then
    echo "  ERROR: Could not extract strand rates"
    exit 1
  fi

  # Determine tile CSV path
  TILES_PATH=$(node -e "const {ALPHABETS} = require('./ai/alphabet'); console.log('data/' + ALPHABETS['$ALPHABET'].tiles)")

  # If iter > 1, average with previous strand rates
  if [ $iter -gt 1 ] && [ -f /tmp/prev_strand_$ALPHABET.py ]; then
    # Build averaged rates
    python3 -c "
prev = {$(cat /tmp/prev_strand_$ALPHABET.py)}
curr = {$STRAND_DICT}
avg = {}
for k in set(list(prev.keys()) + list(curr.keys())):
    p = prev.get(k, curr.get(k, 0))
    c = curr.get(k, prev.get(k, 0))
    avg[k] = (p + c) / 2
# Write to calibrate_points.py
import re
with open('calibrate_points.py', 'r') as f:
    content = f.read()
new_rates = 'STRAND_RATES = {\n'
for k, v in sorted(avg.items(), key=lambda x: -x[1]):
    new_rates += f\"    '{k}': {v:.4f},\n\"
new_rates += '}'
content = re.sub(r'STRAND_RATES = \{[^}]*\}', new_rates, content, flags=re.DOTALL)
with open('calibrate_points.py', 'w') as f:
    f.write(content)
print('  Averaged strand rates written')
"
  else
    # First iteration: use raw rates
    python3 -c "
import re
rates = {$STRAND_DICT}
with open('calibrate_points.py', 'r') as f:
    content = f.read()
new_rates = 'STRAND_RATES = {\n'
for k, v in sorted(rates.items(), key=lambda x: -x[1]):
    new_rates += f\"    '{k}': {v:.4f},\n\"
new_rates += '}'
content = re.sub(r'STRAND_RATES = \{[^}]*\}', new_rates, content, flags=re.DOTALL)
with open('calibrate_points.py', 'w') as f:
    f.write(content)
print('  Raw strand rates written')
"
  fi

  # Save current rates for averaging next iteration
  echo "$STRAND_DICT" > /tmp/prev_strand_$ALPHABET.py

  # Calibrate
  python3 calibrate_points.py $TILES_PATH 2>&1 | grep -E "Point dist|Updating"
done

echo ""
echo "=== Final validation ==="
node simulate_games.js --alphabet $ALPHABET --games $GAMES --vocab $VOCAB --top-n $TOPN 2>&1 | grep -E "Completion|Pass rate|Point value|stranded"
