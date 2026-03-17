# Tile Distribution & AI Engine — Session Report

## What was done

### 1. Rotatable tile generation (`generate_rotatable_tiles.py`)

New game mode where rotationally symmetric Shavian letter pairs share a single physical tile played in either orientation. 15 confirmed pairs reduce the 42-letter split alphabet to 27 distinct tiles:

```
𐑐↔𐑚  𐑑↔𐑛  𐑒↔𐑜  𐑓↔𐑝  𐑔↔𐑞  𐑕↔𐑟  𐑖↔𐑠  𐑗↔𐑡
𐑙↔𐑣  𐑤↔𐑮  𐑧↔𐑪  𐑨↔𐑩  𐑫↔𐑵  𐑬↔𐑶  𐑭↔𐑷
```

12 unpaired: 𐑘 𐑢 𐑥 𐑯 𐑦 𐑰 𐑱 𐑲 𐑳 𐑴 𐑺 𐑻

**CSV format:** Fourth column `rotated_points` — present for rotatable tiles, empty for single-sided. Game code uses a hard-coded rotation map to determine which letter the rotated tile represents.

**Key parameters:**
- `ROTATABLE_DEFLATION = 0.8` — paired tiles' combined frequency is reduced by 20% to leave room for unique tiles
- `RACK_SIZE = 9` — words longer than this are excluded from playability analysis

**Extended variant** also generated: replaces 𐑺/𐑻 (err/air) with yea/oevre. These are unofficial Shavian letters at codepoints U+104AC (yea) and U+1049F (oevre). Compound splits 𐑺→yea+𐑮 and 𐑻→oevre+𐑮 give them real frequency from the dictionary.

**Output files:** `data/tiles-rotatable.csv`, `data/tiles-rotatable-extended.csv`

### 2. Playability-based point values

Replaced the old frequency-inverse scoring with a word-formation playability heuristic.

**Algorithm:** For each word W containing letter L:
```
co_score = (Π tile_probability[c] for c in W where c ≠ L) ^ (1/|co_letters|)
playability[L] += word_freq * co_score
```

The geometric mean of co-letter tile probabilities normalizes for word length so longer words aren't exponentially penalized. Points are assigned on a 1–10 log scale inversely proportional to playability.

Applied to both `generate_tiles.py` (split) and `generate_rotatable_tiles.py`.

### 3. Monte Carlo simulation — rack playability (`simulate_racks.py`)

Python script. 100K rack draws, checks which words can be formed from each rack.

**Key findings:**
- 99.7% of racks have at least one playable word — tile distribution is healthy
- Avg 344 playable words per rack — very flexible
- Per-letter contribution rates are all 93–100% — rack-level analysis can't differentiate difficulty (9 tiles is too many for any single letter to be a bottleneck)
- **Correlation between point values and rack-level difficulty: ~0.1 (weak)**

**Vocab model added** (log-normal player vocabulary, sigmoid knowledge curve) — dropped avg playable words from 344→82 but still 99.4% playable. Correlation remained weak. Rack-level analysis validates distribution health but not point values.

### 4. AI engine (`ai/`)

Node.js modules for Scrabble move generation:

- **`ai/trie.js`** — Dictionary trie with `isWord()`, `isPrefix()`, `static fromDictionary(dict)`
- **`ai/movegen.js`** — Anchor-based move generator. Cross-check sets, recursive left/right extension, full scoring (letter bonuses, word multipliers, cross-words, bingo). Accepts optional `alphabet` parameter for blank expansion.
- **`ai/player.js`** — `AIPlayer` with greedy `findBestMove()`. Accepts optional alphabet.
- **`ai/alphabet.js`** — Centralized alphabet config. Bundles letters, compound splitting rules, tile CSV path, and rotation pairs. `buildWordList(readlexPath, alphabet)` generates the dictionary for any mode. Three alphabets: `split`, `compound`, `rotatable`.

**Performance:** ~2ms per move generation, 208 moves from a first-move rack.

**Known bug:** Rare edge case where blank + same-letter in a single move causes `placeTiles` to reject. Happens ~1 in 500 games. Simulation treats these as passes. Root cause likely in movegen rack state tracking during recursion with blanks.

### 5. Full game simulation (`simulate_games.js`)

Node.js with `worker_threads`. Simulates 2-player games with greedy AI.

**CLI:** `node simulate_games.js --alphabet split|compound --games N`

**Metrics collected:**
- Game completion rate, pass rate, turns per game
- Score distribution with percentiles
- Per-letter strand rate (% of games where letter is stuck in hand at end)
- Per-letter linger time (avg turns from draw to play)
- Pearson correlation of point values vs strand rate and linger time

### 6. Simulation-calibrated point values

Iterative calibration loop:
1. Run 5000-game simulation → get per-letter strand rates
2. Map strand rates to 1–10 points via log scale
3. Re-run simulation → check convergence
4. Average strand rates across iterations to dampen oscillation

**Split mode final state:** r=0.66 (strand), 82% completion, 3.4% pass rate
**Compound mode final state:** r=0.61 (strand), 65% completion, 5.5% pass rate

The calibration script is `calibrate_points.py` — paste strand rates, run, it updates the CSV.

**Key insight:** Greedy AI prioritizes high-point tiles, which *reduces* their linger time regardless of actual difficulty. Strand rate is the better metric — it measures whether a tile can be played at all. The negative linger correlation is an artifact of greedy selection, not reality.

## Files created/modified

| File | Status | Purpose |
|------|--------|---------|
| `generate_rotatable_tiles.py` | New | Generates rotatable + extended tile sets |
| `data/tiles-rotatable.csv` | New | 27-tile rotatable distribution |
| `data/tiles-rotatable-extended.csv` | New | With yea/oevre instead of err/air |
| `data/tiles.csv` | Modified | Split tiles with sim-calibrated points |
| `data/tiles-compound.csv` | Modified | Compound tiles with sim-calibrated points |
| `generate_tiles.py` | Modified | Uses playability heuristic for points, path changed to `data/readlex/readlex.json` |
| `simulate_racks.py` | New | Rack-level Monte Carlo (Python) |
| `simulate_games.js` | New | Full game Monte Carlo (Node.js) |
| `calibrate_points.py` | New | Maps strand rates → point values |
| `ai/alphabet.js` | New | Alphabet configurations + dictionary builder |
| `ai/trie.js` | New | Dictionary trie |
| `ai/movegen.js` | New | Anchor-based move generator |
| `ai/player.js` | New | AI player (greedy) |
| `ai/test.js` | New | AI smoke test |

## Roman Scrabble baseline

Standard English Scrabble was added as a control experiment (`--alphabet roman`). Key finding: tile density is the dominant factor for playability.

| Alphabet | Tiles | Greedy Comp% | Dumb Comp% | Dumb Strand r |
|----------|-------|-------------|------------|---------------|
| Roman | 26 | 98.6% | 87.9% | 0.38 |
| Rotatable | 27 | 93.4% | 63.2% | 0.87 |
| Split | 42 | 81.5% | 19.5% | 0.66 |
| Compound | 48 | 64.9% | — | 0.61 |
| Split-ext | 42 | 36.5% | 9.6% | — |
| Rot-ext | 27 | — | 46.2% | 0.87 |

"Dumb AI" = vocab 10K, pick from top 3 moves. Standard Scrabble points have *negative* greedy correlation (-0.43) but positive dumb correlation (0.38) — the dumb AI is a better calibration model.

Extended split is hard because replacing 𐑺/𐑻 with yea+𐑮/oevre+𐑮 inflates word lengths — every affected word needs one more tile from the rack.

## What's next

### Rotation mode in the production game
The rotatable tile CSV is generated but the game doesn't support rotation yet. Needs:
- UI for flipping tiles (click to rotate?)
- Server validation accepting rotated letters
- Tile loading understanding `rotated_points` column
- Rotation pair map in game code

### AI skill levels
Current greedy AI is strong but strategically naive. Planned tiers:
- **Easy/Medium:** Limit vocabulary via word frequency (reuse readlex freq data), randomize move selection from top N
- **Expert:** Add rack-leave evaluation — penalize moves that leave bad remaining tiles (vowel/consonant imbalance, rare letters). This is the single biggest strategic improvement and would likely push completion rate above 90%.

### AI bot client
`bot_client.js` — WebSocket client that joins games as a player. The AI engine is ready; just needs the socket.io wrapper.

### Simulation for rotatable tiles
Needs rotation support in the game/movegen first. The movegen would treat rotatable tiles as having two possible letter identities (like a constrained blank). The `ai/alphabet.js` already has `rotationPairs` in the rotatable config.

## Design decisions and rationale

**Why geometric mean for playability?** Raw product of co-letter probabilities decays exponentially with word length, making all long words contribute near-zero. 𐑩 (schwa) appears in 73K words but has avg length 8.6 — raw product made it look harder than it is. Geometric mean normalizes per co-letter.

**Why strand rate over linger time?** Greedy AI creates a confound: high-point tiles are played fast *because* the AI prioritizes them, not because they're easy. Strand rate (whether a tile can be played at all) is independent of AI scoring preferences.

**Why average across calibration iterations?** Direct mapping from strand rates to points creates feedback oscillation. A tile priced low → AI ignores it → high strand → we price it high → AI loves it → low strand → we price it low → ... Averaging consecutive iterations dampens this.

**Why the alphabet module?** Dictionary, tile set, and valid letters are intrinsically coupled. Controlling them through separate flags is tech debt. The alphabet enum bundles all three so they can't get out of sync.
