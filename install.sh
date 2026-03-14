#!/bin/bash
set -e

# Shcrabble Installation Script
# Run as root: sudo ./install.sh

INSTALL_DIR="/var/www/shcrabble"
SERVICE_USER="www-data"
NODE_PORT="3000"

echo "Installing Shcrabble to $INSTALL_DIR..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./install.sh)"
  exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is not installed. Please install Node.js first."
  exit 1
fi

# Create installation directory
echo "Creating installation directory..."
mkdir -p "$INSTALL_DIR"

# Copy application files
echo "Copying application files..."
cp -r server "$INSTALL_DIR/"
cp -r public "$INSTALL_DIR/"
cp -r database "$INSTALL_DIR/"
cp package.json "$INSTALL_DIR/"
cp package-lock.json "$INSTALL_DIR/" 2>/dev/null || true

# Copy dictionary file
echo "Copying dictionary file..."
mkdir -p "$INSTALL_DIR/data"
cp data/readlex/readlex.json "$INSTALL_DIR/data/"

# Install dependencies
echo "Installing Node.js dependencies..."
cd "$INSTALL_DIR"
npm install --production

# Set ownership
echo "Setting file ownership to $SERVICE_USER..."
chown -R $SERVICE_USER:$SERVICE_USER "$INSTALL_DIR"

# Create systemd service
echo "Creating systemd service..."
cat > /etc/systemd/system/shcrabble.service <<EOF
[Unit]
Description=Shcrabble - Shavian Scrabble Game Server
After=network.target mysql.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
Environment="NODE_ENV=production"
Environment="PORT=$NODE_PORT"
ExecStart=/usr/bin/node $INSTALL_DIR/server/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=shcrabble

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable service to start on boot
echo "Enabling shcrabble service..."
systemctl enable shcrabble

echo ""
echo "======================================"
echo "Installation complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Configure MySQL database (see database/schema.sql)"
echo "2. Update server/db.js with your MySQL credentials"
echo "3. Add Apache configuration (see apache-config.conf)"
echo "4. Enable Apache proxy modules: sudo a2enmod proxy proxy_http"
echo "5. Restart Apache: sudo systemctl restart apache2"
echo "6. Start the service: sudo systemctl start shcrabble"
echo "7. Check status: sudo systemctl status shcrabble"
echo ""
echo "Logs: sudo journalctl -u shcrabble -f"
echo ""
