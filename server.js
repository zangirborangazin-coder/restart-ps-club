const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({
	connectionString: databaseUrl,
	ssl: { rejectUnauthorized: false },
	connectionTimeoutMillis: 3000
}) : null;

const defaultEmployees = [
	['Мади', 'Madi', 'Asd1230123', 'owner', true],
	['Еламан', 'Elaman', 'Asd1230123', 'owner', true],
	['Нурбол', 'Nurbol', 'Asd1230123', 'owner', true],
	['IT', 'brngzn03', 'Cocolimbo03', 'it', true]
];
let databaseAvailable = Boolean(pool);
let memoryEmployees = defaultEmployees.map(([name, login, password, role, fixed], index) => ({ id: index + 1, name, login, password, role, fixed }));
let memoryRuns = [];
let memoryBookings = [];
let memoryPayments = [];
let memoryPresence = [];

async function initializeDatabase() {
	if (!pool) {
		databaseAvailable = false;
		console.warn('DATABASE_URL не задан, используется временное хранилище сотрудников.');
		return;
	}

	try {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS employees (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			login TEXT NOT NULL UNIQUE,
			password TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('admin', 'owner', 'it')),
			fixed BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await pool.query(`
		CREATE TABLE IF NOT EXISTS runs (
			key TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			id INTEGER NOT NULL,
			start_time INTEGER NOT NULL,
			end_time INTEGER,
			is_open BOOLEAN NOT NULL DEFAULT FALSE,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await pool.query(`
		CREATE TABLE IF NOT EXISTS bookings (
			id BIGINT PRIMARY KEY,
			name TEXT NOT NULL,
			phone TEXT NOT NULL,
			time TEXT NOT NULL,
			room TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await pool.query(`
		CREATE TABLE IF NOT EXISTS payments (
			id BIGINT PRIMARY KEY,
			cash INTEGER NOT NULL DEFAULT 0,
			qr INTEGER NOT NULL DEFAULT 0,
			timestamp BIGINT NOT NULL,
			date_key TEXT NOT NULL,
			time TEXT NOT NULL,
			start_str TEXT NOT NULL,
			end_str TEXT NOT NULL,
			total INTEGER NOT NULL,
			duration TEXT NOT NULL,
			zone TEXT NOT NULL
		)
	`);
	await pool.query(`
		CREATE TABLE IF NOT EXISTS online_presence (
			session_id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			login TEXT NOT NULL,
			role TEXT NOT NULL,
			last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	for (const [name, login, password, role, fixed] of defaultEmployees) {
		await pool.query(
			`INSERT INTO employees (name, login, password, role, fixed)
			 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (login) DO NOTHING`,
			[name, login, password, role, fixed]
		);
	}
	} catch (error) {
		databaseAvailable = false;
		console.warn('PostgreSQL недоступен, используется временное хранилище сотрудников:', error.message);
	}
}

app.use(express.json());
app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/employees', async (_req, res) => {
	if (!databaseAvailable) return res.json(memoryEmployees);
	try {
		const { rows } = await pool.query('SELECT id, name, login, password, role, fixed FROM employees ORDER BY id');
		res.json(rows);
	} catch (error) {
		console.error('GET /api/employees:', error);
		res.status(500).json({ error: 'Не удалось загрузить сотрудников' });
	}
});

app.post('/api/employees', async (req, res) => {
	const { name, login, password, role } = req.body || {};
	if (!name || !login || !password || !['admin', 'owner', 'it'].includes(role)) {
		return res.status(400).json({ error: 'Некорректные данные сотрудника' });
	}
	if (!databaseAvailable) {
		if (memoryEmployees.some(employee => employee.login === login.trim())) return res.status(409).json({ error: 'Логин занят' });
		const employee = { id: Math.max(...memoryEmployees.map(item => item.id), 0) + 1, name: name.trim(), login: login.trim(), password, role, fixed: false };
		memoryEmployees.push(employee);
		return res.status(201).json(employee);
	}
	try {
		const { rows } = await pool.query(
			`INSERT INTO employees (name, login, password, role)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id, name, login, password, role, fixed`,
			[name.trim(), login.trim(), password, role]
		);
		res.status(201).json(rows[0]);
	} catch (error) {
		if (error.code === '23505') return res.status(409).json({ error: 'Логин занят' });
		console.error('POST /api/employees:', error);
		res.status(500).json({ error: 'Не удалось добавить сотрудника' });
	}
});

app.put('/api/employees/:id', async (req, res) => {
	const { name, login, password, role } = req.body || {};
	if (!name || !login || !password || !['admin', 'owner', 'it'].includes(role)) {
		return res.status(400).json({ error: 'Некорректные данные сотрудника' });
	}
	if (!databaseAvailable) {
		const index = memoryEmployees.findIndex(employee => employee.id === Number(req.params.id));
		if (index === -1) return res.status(404).json({ error: 'Сотрудник не найден' });
		if (memoryEmployees.some((employee, employeeIndex) => employee.login === login.trim() && employeeIndex !== index)) return res.status(409).json({ error: 'Логин занят' });
		memoryEmployees[index] = { ...memoryEmployees[index], name: name.trim(), login: login.trim(), password, role };
		return res.json(memoryEmployees[index]);
	}
	try {
		const { rows } = await pool.query(
			`UPDATE employees SET name = $1, login = $2, password = $3, role = $4
			 WHERE id = $5 RETURNING id, name, login, password, role, fixed`,
			[name.trim(), login.trim(), password, role, req.params.id]
		);
		if (!rows[0]) return res.status(404).json({ error: 'Сотрудник не найден' });
		res.json(rows[0]);
	} catch (error) {
		if (error.code === '23505') return res.status(409).json({ error: 'Логин занят' });
		console.error('PUT /api/employees/:id:', error);
		res.status(500).json({ error: 'Не удалось изменить сотрудника' });
	}
});

app.delete('/api/employees/:id', async (req, res) => {
	if (!databaseAvailable) {
		const index = memoryEmployees.findIndex(employee => employee.id === Number(req.params.id));
		if (index === -1 || memoryEmployees[index].fixed) return res.status(404).json({ error: 'Системного сотрудника удалить нельзя' });
		memoryEmployees.splice(index, 1);
		return res.status(204).end();
	}
	try {
		const result = await pool.query('DELETE FROM employees WHERE id = $1 AND fixed = FALSE', [req.params.id]);
		if (!result.rowCount) return res.status(404).json({ error: 'Системного сотрудника удалить нельзя' });
		res.status(204).end();
	} catch (error) {
		console.error('DELETE /api/employees/:id:', error);
		res.status(500).json({ error: 'Не удалось удалить сотрудника' });
	}
});

app.get('/api/runs', async (_req, res) => {
	if (!databaseAvailable) return res.json(memoryRuns);
	try {
		const { rows } = await pool.query('SELECT key, type, id, start_time, end_time, is_open FROM runs ORDER BY key');
		res.json(rows);
	} catch (error) {
		console.error('GET /api/runs:', error);
		res.status(500).json({ error: 'Не удалось загрузить сессии' });
	}
});

app.post('/api/runs', async (req, res) => {
	const { key, type, id, startTime, endTime, isOpen } = req.body || {};
	if (!key || !type || !Number.isInteger(Number(id)) || !Number.isFinite(Number(startTime))) return res.status(400).json({ error: 'Некорректная сессия' });
	const run = { key, type, id: Number(id), start_time: Number(startTime), end_time: endTime === null ? null : Number(endTime), is_open: Boolean(isOpen) };
	if (!databaseAvailable) {
		memoryRuns = memoryRuns.filter(item => item.key !== key).concat(run);
		return res.status(201).json(run);
	}
	try {
		const { rows } = await pool.query(`INSERT INTO runs (key, type, id, start_time, end_time, is_open) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO UPDATE SET type=$2,id=$3,start_time=$4,end_time=$5,is_open=$6,updated_at=NOW() RETURNING key,type,id,start_time,end_time,is_open`, [run.key, run.type, run.id, run.start_time, run.end_time, run.is_open]);
		res.status(201).json(rows[0]);
	} catch (error) { console.error('POST /api/runs:', error); res.status(500).json({ error: 'Не удалось сохранить сессию' }); }
});

app.delete('/api/runs/:key', async (req, res) => {
	if (!databaseAvailable) { memoryRuns = memoryRuns.filter(item => item.key !== req.params.key); return res.status(204).end(); }
	try { await pool.query('DELETE FROM runs WHERE key = $1', [req.params.key]); res.status(204).end(); }
	catch (error) { console.error('DELETE /api/runs:', error); res.status(500).json({ error: 'Не удалось завершить сессию' }); }
});

app.get('/api/bookings', async (_req, res) => {
	if (!databaseAvailable) return res.json(memoryBookings);
	try { const { rows } = await pool.query('SELECT id, name, phone, time, room FROM bookings ORDER BY created_at'); res.json(rows); }
	catch (error) { console.error('GET /api/bookings:', error); res.status(500).json({ error: 'Не удалось загрузить брони' }); }
});

app.post('/api/bookings', async (req, res) => {
	const { id, name, phone, time, room } = req.body || {};
	if (!id || !name || !phone || !time || !room) return res.status(400).json({ error: 'Некорректная бронь' });
	const booking = { id: Number(id), name: String(name), phone: String(phone), time: String(time), room: String(room) };
	if (!databaseAvailable) { memoryBookings.push(booking); return res.status(201).json(booking); }
	try { const { rows } = await pool.query('INSERT INTO bookings (id,name,phone,time,room) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,phone,time,room', [booking.id, booking.name, booking.phone, booking.time, booking.room]); res.status(201).json(rows[0]); }
	catch (error) { console.error('POST /api/bookings:', error); res.status(500).json({ error: 'Не удалось сохранить бронь' }); }
});

app.delete('/api/bookings/:id', async (req, res) => {
	if (!databaseAvailable) { memoryBookings = memoryBookings.filter(item => item.id !== Number(req.params.id)); return res.status(204).end(); }
	try { await pool.query('DELETE FROM bookings WHERE id = $1', [req.params.id]); res.status(204).end(); }
	catch (error) { console.error('DELETE /api/bookings:', error); res.status(500).json({ error: 'Не удалось удалить бронь' }); }
});

app.get('/api/presence', async (_req, res) => {
	if (!databaseAvailable) {
		const activeSince = Date.now() - 20000;
		memoryPresence = memoryPresence.filter(user => user.last_seen > activeSince);
		return res.json(memoryPresence);
	}
	try {
		const { rows } = await pool.query(`SELECT session_id, name, login, role, EXTRACT(EPOCH FROM last_seen) * 1000 AS last_seen FROM online_presence WHERE last_seen > NOW() - INTERVAL '20 seconds' ORDER BY name`);
		res.json(rows);
	} catch (error) {
		console.error('GET /api/presence:', error);
		res.status(500).json({ error: 'Не удалось загрузить онлайн-статусы' });
	}
});

app.post('/api/presence', async (req, res) => {
	const { sessionId, name, login, role } = req.body || {};
	if (!sessionId || !name || !login || !role) return res.status(400).json({ error: 'Некорректный онлайн-статус' });
	if (!databaseAvailable) {
		const user = { session_id: sessionId, name, login, role, last_seen: Date.now() };
		memoryPresence = memoryPresence.filter(item => item.session_id !== sessionId).concat(user);
		return res.status(204).end();
	}
	try {
		await pool.query(`INSERT INTO online_presence (session_id, name, login, role, last_seen) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (session_id) DO UPDATE SET name=$2,login=$3,role=$4,last_seen=NOW()`, [sessionId, name, login, role]);
		res.status(204).end();
	} catch (error) {
		console.error('POST /api/presence:', error);
		res.status(500).json({ error: 'Не удалось сохранить онлайн-статус' });
	}
});

app.delete('/api/presence/:sessionId', async (req, res) => {
	if (!databaseAvailable) {
		memoryPresence = memoryPresence.filter(user => user.session_id !== req.params.sessionId);
		return res.status(204).end();
	}
	try {
		await pool.query('DELETE FROM online_presence WHERE session_id = $1', [req.params.sessionId]);
		res.status(204).end();
	} catch (error) {
		console.error('DELETE /api/presence:', error);
		res.status(500).json({ error: 'Не удалось завершить онлайн-сессию' });
	}
});

app.get('/api/payments', async (_req, res) => {
	if (!databaseAvailable) return res.json(memoryPayments);
	try { const { rows } = await pool.query('SELECT id,cash,qr,timestamp,date_key,time,start_str,end_str,total,duration,zone FROM payments ORDER BY timestamp'); res.json(rows); }
	catch (error) { console.error('GET /api/payments:', error); res.status(500).json({ error: 'Не удалось загрузить оплаты' }); }
});

app.post('/api/payments', async (req, res) => {
	const payment = req.body || {};
	if (!payment.id || !Number.isFinite(Number(payment.cash)) || !Number.isFinite(Number(payment.qr)) || !payment.dateKey || !payment.zone) return res.status(400).json({ error: 'Некорректная оплата' });
	if (!databaseAvailable) { memoryPayments = memoryPayments.filter(item => item.id !== Number(payment.id)).concat(payment); return res.status(201).json(payment); }
	try {
		const { rows } = await pool.query(`INSERT INTO payments (id,cash,qr,timestamp,date_key,time,start_str,end_str,total,duration,zone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET cash=$2,qr=$3,total=$9 RETURNING *`, [payment.id, payment.cash, payment.qr, payment.timestamp, payment.dateKey, payment.time, payment.startStr, payment.endStr, payment.total, payment.duration, payment.zone]);
		res.status(201).json(rows[0]);
	} catch (error) { console.error('POST /api/payments:', error); res.status(500).json({ error: 'Не удалось сохранить оплату' }); }
});

app.delete('/api/payments/date/:dateKey', async (req, res) => {
	if (!databaseAvailable) {
		memoryPayments = memoryPayments.filter(payment => payment.dateKey !== req.params.dateKey);
		return res.status(204).end();
	}
	try {
		await pool.query('DELETE FROM payments WHERE date_key = $1', [req.params.dateKey]);
		res.status(204).end();
	} catch (error) {
		console.error('DELETE /api/payments/date:', error);
		res.status(500).json({ error: 'Не удалось очистить оплаты' });
	}
});

initializeDatabase()
	.then(() => app.listen(port, () => console.log(`RESTART is running on port ${port}`)))
	.catch(error => { console.error('Ошибка инициализации:', error); app.listen(port, () => console.log(`RESTART is running on port ${port}`)); });
