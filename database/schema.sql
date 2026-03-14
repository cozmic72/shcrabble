-- Shcrabble Database Schema

CREATE DATABASE IF NOT EXISTS shcrabble;
USE shcrabble;

-- Sessions table (for now, just tracking game sessions)
-- We can add user authentication later
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  status ENUM('waiting', 'active', 'completed') DEFAULT 'waiting',
  max_players INT DEFAULT 4,
  current_turn INT DEFAULT 0,
  game_state JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Players table
CREATE TABLE IF NOT EXISTS players (
  id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  player_name VARCHAR(100) NOT NULL,
  player_index INT NOT NULL,
  score INT DEFAULT 0,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  INDEX idx_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional: Add user accounts later for persistent profiles
-- CREATE TABLE IF NOT EXISTS users (
--   id VARCHAR(36) PRIMARY KEY,
--   username VARCHAR(50) UNIQUE NOT NULL,
--   password_hash VARCHAR(255) NOT NULL,
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
