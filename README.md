# 𐑖𐑒𐑮𐑨𐑚𐑩𐑤 Shcrabble

A multiplayer Scrabble game using the Shavian alphabet with real-time WebSocket gameplay.

## Features

- 2-4 player multiplayer Scrabble
- Real-time gameplay using WebSocket connections
- Standard 15x15 Scrabble board with bonus squares
- 42 Shavian letters (compound letters split) + blank tiles
- Dictionary validation using the Readlex dictionary
- Simple invite link system (no authentication required initially)
- Score tracking and turn management

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Plain HTML/CSS/JavaScript
- **Database**: MySQL
- **Dictionary**: Readlex (Shavian/English dictionary)

## Project Structure

```
shcrabble/
├── server/
│   ├── index.js       # Main server & WebSocket handlers
│   ├── game.js        # Game logic (board, tiles, scoring)
│   ├── dictionary.js  # Dictionary processing & validation
│   └── db.js          # MySQL database connection
├── public/
│   ├── index.html     # Game UI
│   ├── style.css      # Styling
│   └── game.js        # Client-side game logic
├── data/
│   └── tiles.csv      # Tile distribution & scores
└── database/
    └── schema.sql     # MySQL schema
```

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- MySQL server
- Readlex dictionary at `~/Code/shavian-info/readlex/readlex.json`

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up MySQL database**
   ```bash
   mysql -u root -p < database/schema.sql
   ```

3. **Configure environment** (optional)
   ```bash
   cp .env.example .env
   # Edit .env with your MySQL credentials if needed
   ```

4. **Start the server**
   ```bash
   npm start
   ```

   The server will run on `http://localhost:3000`

### Testing Locally

1. Open your browser to `http://localhost:3000/shcrabble`
2. Create a new game or join an existing one
3. Share the invite link with other players
4. Play!

## Apache Deployment

To deploy under the `/shcrabble` subdirectory on your Apache server:

### 1. Install and run the application

Place the shcrabble directory in your desired location (e.g., `/var/www/shcrabble`)

### 2. Run as a service using PM2 (recommended)

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

### 3. Configure Apache as a reverse proxy

Add this to your Apache configuration (e.g., in a virtual host or `.htaccess`):

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

### 4. Alternative: Direct Apache configuration

If you prefer not to use a reverse proxy, you can configure Apache to serve the static files directly and use a separate port for the WebSocket server. However, the reverse proxy method is simpler.

## Tile Distribution

The tiles are defined in `data/tiles.csv`. The current distribution is a placeholder and should be updated with proper Shavian Scrabble scoring.

**Current tiles**: 42 Shavian letters + 2 blanks

**Compound letters** are split for gameplay:
- 𐑽 → 𐑦𐑩𐑮
- 𐑼 → 𐑩𐑮
- 𐑸 → 𐑭𐑮
- 𐑹 → 𐑷𐑮
- 𐑾 → 𐑦𐑩
- 𐑿 → 𐑘𐑵

## Dictionary

The game uses the Readlex dictionary located at `~/Code/shavian-info/readlex/readlex.json`.

Words are filtered to exclude:
- Single letters (POS tag: ZZ0)
- Abbreviations (all caps, periods)
- Unclassified words (POS tag: UNC)

Compound letters in the dictionary are automatically split during validation.

## Game Rules

Standard Scrabble rules apply:
- 15x15 board
- 7 tiles per player
- 2-4 players
- Standard bonus squares (DW, TW, DL, TL)
- 50 point bonus for using all 7 tiles
- First word must cover center square

## Development

### Running tests
```bash
# Test dictionary loading
node server/test-dictionary.js
```

### Environment Variables

See `.env.example` for available configuration options:
- `PORT`: Server port (default: 3000)
- `DB_HOST`: MySQL host (default: localhost)
- `DB_USER`: MySQL user (default: root)
- `DB_PASSWORD`: MySQL password
- `DB_NAME`: Database name (default: shcrabble)

## Future Enhancements

- [ ] User authentication and persistent profiles
- [ ] Game history and statistics
- [ ] AI opponent for single-player mode
- [ ] Turn timer option
- [ ] Chat system
- [ ] Proper Shavian tile scoring and distribution
- [ ] Word validation feedback
- [ ] Improved drag-and-drop interface
- [ ] Mobile-responsive design

## License

ISC
