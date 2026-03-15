# 𐑖𐑒𐑮𐑨𐑚𐑩𐑤 Shcrabble

A multiplayer Scrabble game using the Shavian alphabet with real-time WebSocket gameplay.

## Features

### Gameplay
- 2-4 player multiplayer with real-time WebSocket connections
- Standard 15x15 Scrabble board with bonus squares (DW, TW, DL, TL)
- Dictionary validation using Readlex (Shavian/English)
- Spectator mode with rack viewing
- Player reconnection support
- Turn management with pass/exchange options
- 50 point bonus for using all tiles in rack
- Automatic game end suggestion after 6 consecutive scoreless turns

### Game Modes
- Casual rules (2-4 players)
- Tournament rules (2 players only)
- Configurable rack size (5-12 tiles, default 9)
- Custom tile distributions
- Compound letter mode (split vs. compound tiles)
- Optional accumulative timer (default 25 minutes per player)
  - Live countdown display
  - Auto-pause on disconnect
  - Owner pause/unpause control

### Tile Options
- Default: 42 Shavian letters split mode + blanks
- Compound mode: Includes 𐑼, 𐑽, 𐑸, 𐑹, 𐑾, 𐑿 as single tiles
- Custom distributions via game creation

### Voting System
- Optional voting on word validity (casual mode default)
- Players vote to accept/reject challenged words
- Majority rule resolution

### Administration
- Game owner controls (remove players, end game, delete game, transfer ownership)
- Invite link sharing
- Persistent game state (reconnect to active games)

### Internationalization
- English and Shavian (𐑖𐑱𐑝𐑾𐑯) UI translations
- Roman and Shavian script display modes

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Plain HTML/CSS/JavaScript
- **Database**: SQLite3
- **Dictionary**: Readlex (Shavian/English dictionary)

## Project Structure

```
shcrabble/
├── server/           # Server-side code (game logic, WebSocket handlers, database)
├── public/           # Client-side code (UI, game client)
├── data/             # Tile distributions (CSV)
└── database/         # Database schema
```

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- Readlex dictionary at `~/Code/shavian-info/readlex/readlex.json`

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start the server**
   ```bash
   npm start
   ```

   The server will run on `http://localhost:3000`
   Database will be created automatically at `shcrabble.db`

### Testing Locally

1. Open `http://localhost:3000/shcrabble`
2. Create a new game or join an existing one
3. Share the invite link with other players

## Apache Deployment

### 1. Install and run as a service using PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start server/index.js --name shcrabble

# Save the process list
pm2 save

# Set up PM2 to start on boot
pm2 startup
```

### 2. Configure Apache as a reverse proxy

```apache
# Enable required modules (run as root)
a2enmod proxy
a2enmod proxy_http
a2enmod proxy_wstunnel
systemctl restart apache2

# Add to your VirtualHost configuration
<Location /shcrabble>
    ProxyPass http://localhost:3000/shcrabble
    ProxyPassReverse http://localhost:3000/shcrabble
</Location>

# WebSocket support
<Location /shcrabble/socket.io>
    ProxyPass ws://localhost:3000/socket.io
    ProxyPassReverse ws://localhost:3000/socket.io
</Location>
```

## Tile Distribution

Tiles are defined in `data/tiles.csv` and `data/tiles-compound.csv`.

**Split mode (default)**: 42 Shavian letters + 2 blanks
- Compound letters split: 𐑼→𐑩𐑮, 𐑽→𐑦𐑩𐑮, 𐑸→𐑭𐑮, 𐑹→𐑷𐑮, 𐑾→𐑦𐑩, 𐑿→𐑘𐑵

**Compound mode**: 48 Shavian letters + 2 blanks
- Includes compound letters as single tiles

## Dictionary

Uses Readlex dictionary at `~/Code/shavian-info/readlex/readlex.json`.

Filters out:
- Single letters (POS tag: ZZ0)
- Abbreviations (all caps, periods)
- Unclassified words (POS tag: UNC)

Compound letters in dictionary are automatically normalized based on game mode.

## Game Rules

Standard Scrabble rules:
- 15x15 board
- Configurable rack size (default 9 tiles for Shavian)
- 2-4 players (casual) or 2 players (tournament)
- Standard bonus squares
- 50 point bonus for using all rack tiles
- First word must cover center square
- Optional timer: accumulative time bank per player

## Development

### Environment Variables

Create `.env` file with:
```
PORT=3000
DICT_PATH=/path/to/readlex.json
```

Defaults:
- Port: 3000
- Dictionary: `~/Code/shavian-info/readlex/readlex.json`
- Database: `./shcrabble.db` (SQLite)

## License

ISC
