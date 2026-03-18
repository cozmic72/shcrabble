# 𐑖𐑒𐑮𐑨𐑚𐑩𐑤 Shcrabble

A multiplayer Scrabble game using the Shavian alphabet with real-time WebSocket gameplay.

## Features

### Gameplay
- 2-4 player multiplayer with real-time WebSocket connections
- Standard 15x15 Scrabble board with bonus squares (DW, TW, DL, TL)
- Dictionary validation using Readlex (Shavian/English)
- AI bot opponents at four difficulty levels
- Live opponent tile preview (see tiles placed before submission)
- Click a player to highlight their tiles on the board
- Spectator mode with rack viewing
- Player reconnection support
- 50 point bonus for using all tiles in rack

### Tile Modes
- **Rotation** (default): 15 rotationally symmetric letter pairs share flippable tiles (27 types). Click to rotate.
- **Standard**: All 42 Shavian letters as separate tiles. Compounds split.
- **Extended**: Either mode can add yea and oevre — rare high-value letters replacing err (𐑺) and air (𐑻).
- Custom tile distributions per mode

### AI Bot Opponents
- Four tiers: Beginner, Casual, Intermediate, Expert
- Rack management and endgame strategy at higher tiers
- Can be added before or during a game
- Tile-by-tile move animation

### Game Rules
- Casual rules (2-4 players) or Tournament rules (2 players)
- Configurable rack size (5-12 tiles, default 9)
- Optional accumulative timer (default 25 minutes per player)
- Voting on word validity

### Internationalization
- English and Shavian (𐑖𐑱𐑝𐑾𐑯) UI translations
- Roman and Shavian script display modes

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Plain HTML/CSS/JavaScript
- **Database**: SQLite3
- **Dictionary**: Readlex (Shavian/English dictionary)
- **AI**: Anchor-based move generator with trie dictionary

## Project Structure

```
shcrabble/
├── server/           # Game logic, WebSocket handlers, database
├── public/           # Client-side UI
├── ai/               # AI engine (trie, move generator, player tiers, alphabet config)
├── data/             # Tile distributions (CSV) and dictionary
├── test/             # Test suite (node:test)
└── database/         # Database schema
```

## Setup

```bash
npm install
npm start
# → http://localhost:3000/shcrabble
```

## Testing

```bash
node --test test/*.test.js
node --test --experimental-test-coverage test/*.test.js
```

## Tile Distribution

Tiles are defined in CSV files in `data/`. Point values are calibrated via Monte Carlo game simulation.

| Mode | File | Tiles | Letters |
|------|------|-------|---------|
| Rotation | tiles-rotatable.csv | 27 types | 42 letters (15 paired) |
| Rotation+ | tiles-rotatable-extended.csv | 27 types | + yea/oevre |
| Standard | tiles.csv | 42 types | 42 letters |
| Standard+ | tiles-extended.csv | 42 types | + yea/oevre |

## License

ISC
