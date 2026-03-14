# Shcrabble Deployment Guide

This guide explains how to deploy Shcrabble to a production server with Apache and SSL.

## Prerequisites

- Ubuntu/Debian server with root access
- Apache2 installed with SSL configured (e.g., via certbot)
- Node.js installed (v14 or higher)
- MySQL installed and running
- Git (to clone the repository)

## Installation Steps

### 1. Prepare the Database

```bash
# Log into MySQL as root
sudo mysql -u root -p

# Create database and user
CREATE DATABASE shcrabble;
CREATE USER 'shcrabble'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON shcrabble.* TO 'shcrabble'@'localhost';
FLUSH PRIVILEGES;
EXIT;

# Import schema
sudo mysql -u shcrabble -p shcrabble < database/schema.sql
```

### 2. Configure Database Connection

Edit `server/db.js` with your MySQL credentials:

```javascript
const pool = mysql.createPool({
  host: 'localhost',
  user: 'shcrabble',
  password: 'your_secure_password',
  database: 'shcrabble',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
```

### 3. Run Installation Script

```bash
# Make script executable (if not already)
chmod +x install.sh

# Run as root
sudo ./install.sh
```

This script will:
- Copy files to `/var/www/shcrabble`
- Install Node.js dependencies
- Set ownership to `www-data`
- Create systemd service
- Enable auto-start on boot

### 4. Enable Apache Modules

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite
```

### 5. Configure Apache Virtual Host

Edit your Apache virtual host configuration (typically `/etc/apache2/sites-available/your-site.conf`):

```apache
<VirtualHost *:443>
    ServerName yourdomain.com

    # SSL Configuration (managed by certbot)
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/yourdomain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/yourdomain.com/privkey.pem

    # ... other site configuration ...

    # Shcrabble WebSocket support
    ProxyPass /shcrabble/socket.io/ ws://localhost:3000/socket.io/
    ProxyPassReverse /shcrabble/socket.io/ ws://localhost:3000/socket.io/

    # Shcrabble HTTP proxy
    ProxyPass /shcrabble/ http://localhost:3000/shcrabble/
    ProxyPassReverse /shcrabble/ http://localhost:3000/shcrabble/
    ProxyPreserveHost On

    <Location /shcrabble/>
        RewriteEngine On
        RewriteCond %{HTTP:Upgrade} websocket [NC]
        RewriteCond %{HTTP:Connection} upgrade [NC]
        RewriteRule ^/shcrabble/?(.*) ws://localhost:3000/shcrabble/$1 [P,L]
    </Location>
</VirtualHost>
```

See `apache-config.conf` for the complete example.

### 6. Restart Services

```bash
# Test Apache configuration
sudo apache2ctl configtest

# Restart Apache
sudo systemctl restart apache2

# Start Shcrabble service
sudo systemctl start shcrabble

# Check status
sudo systemctl status shcrabble
```

## Service Management

### View Logs

```bash
# Follow live logs
sudo journalctl -u shcrabble -f

# View recent logs
sudo journalctl -u shcrabble -n 100
```

### Control Service

```bash
# Start
sudo systemctl start shcrabble

# Stop
sudo systemctl stop shcrabble

# Restart
sudo systemctl restart shcrabble

# Status
sudo systemctl status shcrabble

# Disable auto-start
sudo systemctl disable shcrabble

# Re-enable auto-start
sudo systemctl enable shcrabble
```

## Updating the Application

```bash
# Pull latest changes
cd /path/to/your/local/repo
git pull

# Re-run installation
sudo ./install.sh

# Restart service
sudo systemctl restart shcrabble
```

## Troubleshooting

### Service won't start

```bash
# Check logs
sudo journalctl -u shcrabble -n 50

# Common issues:
# - Database connection failed (check credentials in server/db.js)
# - Port 3000 already in use (change PORT in install.sh)
# - Missing dependencies (run: cd /var/www/shcrabble && sudo npm install)
```

### WebSocket connection fails

```bash
# Ensure proxy_wstunnel module is enabled
sudo a2enmod proxy_wstunnel
sudo systemctl restart apache2

# Check Apache error logs
sudo tail -f /var/log/apache2/error.log
```

### Permission issues

```bash
# Fix ownership
sudo chown -R www-data:www-data /var/www/shcrabble
```

## File Locations

- Application: `/var/www/shcrabble`
- Systemd service: `/etc/systemd/system/shcrabble.service`
- Logs: `sudo journalctl -u shcrabble`
- Apache config: `/etc/apache2/sites-available/your-site.conf`

## Security Notes

- The Node.js server runs as `www-data` (non-root)
- Only localhost:3000 is exposed (not accessible from internet)
- Apache handles SSL termination
- Database credentials should be kept secure in `server/db.js`
- Consider setting up a firewall (ufw) to only allow ports 80/443
