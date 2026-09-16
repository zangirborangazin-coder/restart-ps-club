const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Создание таблицы сотрудников в PostgreSQL
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        login VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(100) NOT NULL,
        fixed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Вставка системных аккаунтов по умолчанию, если их нет
    await pool.query(`
      INSERT INTO employees (name, login, password, role, fixed)
      VALUES 
        ('Мади', 'Madi', 'Asd1230123', 'owner', true),
        ('Еламан', 'Elaman', 'Asd1230123', 'owner', true),
        ('Нурбол', 'Nurbol', 'Asd1230123', 'owner', true),
        ('IT', 'brngzn03', 'Cocolimbo03', 'it', true)
      ON CONFLICT (login) DO NOTHING;
    `);

    console.log('PostgreSQL Database Initialized');
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
}
initDB();

// API: Получение всех сотрудников
app.get('/api/employees', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, login, password, role, fixed FROM employees ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Добавление сотрудника
app.post('/api/employees', async (req, res) => {
  const { name, login, password, role } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO employees (name, login, password, role, fixed) VALUES ($1, $2, $3, $4, false) RETURNING *',
      [name, login, password, role]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Удаление сотрудника
app.delete('/api/employees/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM employees WHERE id = $1 AND fixed = false', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html')); // или 'new version.html'
});

app.listen(port, () => console.log(`RESTART is running on port ${port}`));
