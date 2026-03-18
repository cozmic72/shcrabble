#!/bin/bash
set -e

# Shcrabble Installation Script
# Run as root: sudo ./install.sh

INSTALL_DIR="/var/www/shcrabble"
SERVICE_USER="www-data"
NODE_PORT="3000"
DB_NAME="shcrabble"
DB_USER="shcrabble"
DB_PASSWORD=$(openssl rand -base64 24)

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

# Check if MySQL is installed
if ! command -v mysql &> /dev/null; then
  echo "Error: MySQL is not installed. Please install MySQL first."
  exit 1
fi

# Prompt for MySQL root password
echo ""
echo "======================================"
echo "Database Setup"
echo "======================================"
read -sp "Enter MySQL root password: " MYSQL_ROOT_PASSWORD
echo ""

# Setup database
echo "Setting up database..."
mysql -u root -p"$MYSQL_ROOT_PASSWORD" <<MYSQL_SCRIPT
CREATE DATABASE IF NOT EXISTS $DB_NAME;
DROP USER IF EXISTS '$DB_USER'@'localhost';
CREATE USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
MYSQL_SCRIPT

if [ $? -ne 0 ]; then
  echo "Error: Failed to setup database. Please check your MySQL root password."
  exit 1
fi

echo "Database created and user configured."

# Import database schema
echo "Importing database schema..."
mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < database/schema.sql

if [ $? -ne 0 ]; then
  echo "Error: Failed to import database schema."
  exit 1
fi

echo "Database schema imported successfully."

# Initialize git submodules
echo "Initializing git submodules..."
git submodule update --init --recursive

# Create installation directory
echo "Creating installation directory..."
mkdir -p "$INSTALL_DIR"

# Copy application files
echo "Copying application files..."
cp -r server "$INSTALL_DIR/"
cp -r public "$INSTALL_DIR/"
cp -r database "$INSTALL_DIR/"
cp -r ai "$INSTALL_DIR/"
cp package.json "$INSTALL_DIR/"
cp package-lock.json "$INSTALL_DIR/" 2>/dev/null || true

# Copy dictionary file
echo "Copying dictionary file..."
mkdir -p "$INSTALL_DIR/data/readlex"
cp -r data/readlex "$INSTALL_DIR/data/"

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
Environment="DB_HOST=127.0.0.1"
Environment="DB_USER=$DB_USER"
Environment="DB_PASSWORD=$DB_PASSWORD"
Environment="DB_NAME=$DB_NAME"
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
echo "Database credentials (saved in systemd service):"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo "  Password: $DB_PASSWORD"
echo ""
echo "Next steps:"
echo "1. Add Apache configuration (see apache-config.conf)"
echo "2. Enable Apache proxy modules: sudo a2enmod proxy proxy_http proxy_wstunnel"
echo "3. Restart Apache: sudo systemctl restart apache2"
echo "4. Start the service: sudo systemctl start shcrabble"
echo "5. Check status: sudo systemctl status shcrabble"
echo ""
echo "Logs: sudo journalctl -u shcrabble -f"
echo ""
