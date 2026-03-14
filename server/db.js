const mysql = require('mysql2/promise');

// Database configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'shcrabble',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
  }
  return pool;
}

async function query(sql, params = []) {
  const connection = await getPool();
  const [rows] = await connection.execute(sql, params);
  return rows;
}

async function testConnection() {
  try {
    const connection = await getPool();
    await connection.query('SELECT 1');
    console.log('Database connection successful');
    return true;
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return false;
  }
}

module.exports = {
  getPool,
  query,
  testConnection
};
