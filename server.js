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

// Инициализация таблиц базы данных
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS active_runs (
        key VARCHAR(50) PRIMARY KEY,
        type VARCHAR(20),
        id INT,
        start_time INT,
        end_time INT,
        is_open BOOLEAN
      );

      CREATE TABLE IF NOT EXISTS active_bookings (
        id BIGINT PRIMARY KEY,
        name VARCHAR(255),
        phone VARCHAR(50),
        time VARCHAR(20),
        room VARCHAR(10)
      );

      CREATE TABLE IF NOT EXISTS payments (
        id BIGINT PRIMARY KEY,
        cash INT DEFAULT 0,
        qr INT DEFAULT 0,
        timestamp BIGINT,
        date_key VARCHAR(20),
        time VARCHAR(20),
        start_str VARCHAR(20),
        end_str VARCHAR(20),
        total INT DEFAULT 0,
        duration VARCHAR(20),
        zone VARCHAR(50)
      );

      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        login VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(100) NOT NULL,
        fixed BOOLEAN DEFAULT FALSE
      );
    `);

    await pool.query(`
      INSERT INTO employees (name, login, password, role, fixed)
      VALUES 
        ('Мади', 'Madi', 'Asd1230123', 'owner', true),
        ('Еламан', 'Elaman', 'Asd1230123', 'owner', true),
        ('Нурбол', 'Nurbol', 'Asd1230123', 'owner', true),
        ('IT', 'brngzn03', 'Cocolimbo03', 'it', true)
      ON CONFLICT (login) DO NOTHING;
    `);

    console.log('PostgreSQL Full Sync Database Ready');
  } catch (err) {
    console.error('Error DB Init:', err);
  }
}
initDB();

// --- API ТАЙМЕРОВ (VIP-КОМНАТЫ) ---
app.get('/api/runs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM active_runs');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/runs', async (req, res) => {
  const { key, type, id, startTime, endTime, isOpen } = req.body;
  try {
    await pool.query(
      `INSERT INTO active_runs (key, type, id, start_time, end_time, is_open)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO UPDATE SET type=$2, start_time=$4, end_time=$5, is_open=$6`,
      [key, type, id, startTime, endTime, isOpen]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/runs/:key', async (req, res) => {
  try {
    await pool.query('DELETE FROM active_runs WHERE key = $1', [req.params.key]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API БРОНИРОВАНИЙ ---
app.get('/api/bookings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM active_bookings ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bookings', async (req, res) => {
  const { id, name, phone, time, room } = req.body;
  try {
    await pool.query(
      `INSERT INTO active_bookings (id, name, phone, time, room) VALUES ($1, $2, $3, $4, $5)`,
      [id, name, phone, time, room]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM active_bookings WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API ОПЛАТ И КАССЫ ---
app.get('/api/payments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payments ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/payments', async (req, res) => {
  const { id, cash, qr, timestamp, dateKey, time, startStr, endStr, total, duration, zone } = req.body;
  try {
    await pool.query(
      `INSERT INTO payments (id, cash, qr, timestamp, date_key, time, start_str, end_str, total, duration, zone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, cash, qr, timestamp, dateKey, time, startStr, endStr, total, duration, zone]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API СОТРУДНИКОВ ---
app.get('/api/employees', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, login, password, role, fixed FROM employees ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/employees', async (req, res) => {
  const { name, login, password, role } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO employees (name, login, password, role, fixed) VALUES ($1, $2, $3, $4, false) RETURNING *',
      [name, login, password, role]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM employees WHERE id = $1 AND fixed = false', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(port, () => console.log(`RESTART is running on port ${port}`));
