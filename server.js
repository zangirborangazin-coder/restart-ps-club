const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Автоматическое создание таблиц при старте
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        room_name VARCHAR(100) NOT NULL,
        client_name VARCHAR(255),
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active'
      );
    `);
    console.log('PostgreSQL Tables Initialized Successfully');
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
}
initDB();

// Маршруты API для работы с сотрудниками
app.get('/api/employees', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM employees ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/employees', async (req, res) => {
  const { name, role } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO employees (name, role) VALUES ($1, $2) RETURNING *',
      [name, role]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Главная страница
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'new version.html')));

app.listen(port, () => console.log(`RESTART is running on port ${port}`));
