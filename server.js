const express = require('express');
const fs = require('fs');
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
	['IT', 'brngzn03', 'Cocolimbo03', 'it', true],
	['Zhangir', 'Zhangir', 'Cocolimbo03', 'admin', true],
	['Администратор', 'admin', 'Aa1234', 'admin', true]
];
let databaseAvailable = Boolean(pool);
let memoryEmployees = defaultEmployees.map(([name, login, password, role, fixed], index) => ({ id: index + 1, name, login, password, role, fixed }));
let memoryRuns = [];
let memoryBookings = [];
let memoryPayments = [];
let memoryShiftReports = [];
let memoryRevenueAdjustments = {};
let memoryPresence = [];
let memoryCashBalance = null;
const memoryStorePath = path.join(__dirname, 'restart-data.json');

function loadMemoryStore() {
	try {
		const stored = JSON.parse(fs.readFileSync(memoryStorePath, 'utf8'));
		if (Array.isArray(stored.employees) && stored.employees.length) memoryEmployees = stored.employees;
		if (Array.isArray(stored.runs)) memoryRuns = stored.runs;
		if (Array.isArray(stored.bookings)) memoryBookings = stored.bookings;
		if (Array.isArray(stored.payments)) memoryPayments = stored.payments;
		if (Array.isArray(stored.shiftReports)) memoryShiftReports = stored.shiftReports;
		if (stored.revenueAdjustments && typeof stored.revenueAdjustments === 'object') memoryRevenueAdjustments = stored.revenueAdjustments;
		if (stored.cashBalance) memoryCashBalance = stored.cashBalance;
	} catch (_error) {
		// Первый запуск: память заполнится системными значениями.
	}
}

function saveMemoryStore() {
	if (databaseAvailable) return;
	fs.writeFileSync(memoryStorePath, JSON.stringify({
		employees: memoryEmployees,
		runs: memoryRuns,
		bookings: memoryBookings,
		payments: memoryPayments,
		shiftReports: memoryShiftReports,
		revenueAdjustments: memoryRevenueAdjustments,
		cashBalance: memoryCashBalance
	}, null, 2), 'utf8');
}

loadMemoryStore();

async function initializeDatabase() {
	if (!pool) {
		databaseAvailable = false;
		saveMemoryStore();
		console.warn('DATABASE_URL не задан, сотрудники доступны только через PostgreSQL.');
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
			shift_date_key TEXT,
			is_open BOOLEAN NOT NULL DEFAULT FALSE,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await pool.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS shift_date_key TEXT');
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
	await pool.query(`
		CREATE TABLE IF NOT EXISTS cash_balance (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			amount INTEGER NOT NULL DEFAULT 0,
			denominations JSONB NOT NULL DEFAULT '{}'::jsonb,
			user_name TEXT NOT NULL,
			date_key TEXT NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await pool.query(`
		CREATE TABLE IF NOT EXISTS shift_reports (
			id BIGSERIAL PRIMARY KEY,
			date_key TEXT NOT NULL,
			report_date TEXT NOT NULL,
			timestamp BIGINT NOT NULL,
			admin TEXT NOT NULL,
			qr INTEGER NOT NULL DEFAULT 0,
			cash INTEGER NOT NULL DEFAULT 0,
			previous_cash INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL,
			final_cash INTEGER NOT NULL DEFAULT 0,
			total INTEGER NOT NULL DEFAULT 0,
			details JSONB NOT NULL DEFAULT '[]'::jsonb
		)
	`);
	await pool.query(`ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS expense_title TEXT NOT NULL DEFAULT ''`);
	await pool.query(`ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS expense_amount INTEGER NOT NULL DEFAULT 0`);
	await pool.query(`ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS shift_meta JSONB NOT NULL DEFAULT '{}'::jsonb`);
	await pool.query(`
		CREATE TABLE IF NOT EXISTS revenue_adjustments (
			date_key TEXT PRIMARY KEY,
			qr INTEGER NOT NULL DEFAULT 0,
			cash INTEGER NOT NULL DEFAULT 0,
			changed_by TEXT NOT NULL,
			changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await pool.query(`ALTER TABLE cash_balance ADD COLUMN IF NOT EXISTS denominations JSONB NOT NULL DEFAULT '{}'::jsonb`);
	for (const [name, login, password, role, fixed] of defaultEmployees) {
		await pool.query(
			`INSERT INTO employees (name, login, password, role, fixed)
			 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (login) DO NOTHING`,
			[name, login, password, role, fixed]
		);
	}
	} catch (error) {
		databaseAvailable = false;
		console.warn('PostgreSQL недоступен, сотрудники не будут загружены:', error.message);
	}
}

app.use(express.json({ limit: '25mb' }));
app.use((req, res, next) => {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
	res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	if (req.method === 'OPTIONS') return res.sendStatus(204);
	next();
});
app.use((_req, res, next) => {
	res.on('finish', () => {
		try { saveMemoryStore(); } catch (error) { console.error('Не удалось сохранить общие данные:', error.message); }
	});
	next();
});
app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/health', (_req, res) => {
	res.json({ ok: true, database: databaseAvailable ? 'postgresql' : 'fallback' });
});

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
	if (!name || !login || !password || role !== 'admin') {
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

app.get('/api/shift-reports', async (_req, res) => {
	if (!databaseAvailable) return res.json(memoryShiftReports);
	try {
		const { rows } = await pool.query('SELECT id,date_key,report_date AS date,timestamp,admin,qr,cash,previous_cash AS "previousCash",source,final_cash AS "finalCash",total,expense_title AS "expenseTitle",expense_amount AS "expenseAmount",details,shift_meta AS "shiftMeta" FROM shift_reports ORDER BY timestamp');
		res.json(rows);
	} catch (error) { console.error('GET /api/shift-reports:', error); res.status(500).json({ error: 'Не удалось загрузить отчёты смен' }); }
});

app.post('/api/shift-reports', async (req, res) => {
	const report = req.body || {};
	if (!report.dateKey || !report.admin || !Number.isFinite(Number(report.total))) return res.status(400).json({ error: 'Некорректный отчёт смены' });
	if (!databaseAvailable) {
		if (report.source === 'shift_opened') {
			const existing = memoryShiftReports.find(item => item.source === 'shift_opened' && item.dateKey === report.dateKey && item.admin === report.admin && item.shiftMeta?.status !== 'closed');
			if (existing) return res.status(200).json(existing);
		}
		const savedReport = { ...report, id: Date.now() };
		memoryShiftReports.push(savedReport);
		return res.status(201).json(savedReport);
	}
	try {
		if (report.source === 'shift_opened') {
			const existing = await pool.query(`SELECT id,date_key,report_date AS date,timestamp,admin,qr,cash,previous_cash AS "previousCash",source,final_cash AS "finalCash",total,expense_title AS "expenseTitle",expense_amount AS "expenseAmount",details,shift_meta AS "shiftMeta" FROM shift_reports WHERE date_key = $1 AND admin = $2 AND source = 'shift_opened' AND COALESCE(shift_meta->>'status', 'open') <> 'closed' ORDER BY timestamp DESC LIMIT 1`, [report.dateKey, report.admin]);
			if (existing.rows[0]) return res.status(200).json(existing.rows[0]);
		}
		const { rows } = await pool.query(
			`INSERT INTO shift_reports (date_key,report_date,timestamp,admin,qr,cash,previous_cash,source,final_cash,total,expense_title,expense_amount,details,shift_meta)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,date_key,report_date AS date,timestamp,admin,qr,cash,previous_cash AS "previousCash",source,final_cash AS "finalCash",total,expense_title AS "expenseTitle",expense_amount AS "expenseAmount",details,shift_meta AS "shiftMeta"`,
			[report.dateKey, report.date || report.dateKey, report.timestamp || Date.now(), report.admin, Number(report.qr) || 0, Number(report.cash) || 0, Number(report.previousCash) || 0, report.source || 'cash', Number(report.finalCash) || 0, Number(report.total) || 0, report.expenseTitle || '', Number(report.expenseAmount) || 0, JSON.stringify(report.details || []), JSON.stringify(report.shiftMeta || {})]
		);
		res.status(201).json(rows[0]);
	} catch (error) { console.error('POST /api/shift-reports:', error); res.status(500).json({ error: 'Не удалось сохранить отчёт смены' }); }
});

app.put('/api/shift-reports/:id/meta', async (req, res) => {
	const shiftMeta = req.body?.shiftMeta;
	if (!shiftMeta || typeof shiftMeta !== 'object') return res.status(400).json({ error: 'Некорректные данные смены' });
	if (!databaseAvailable) {
		const report = memoryShiftReports.find(item => String(item.id) === String(req.params.id));
		if (!report) return res.status(404).json({ error: 'Смена не найдена' });
		report.shiftMeta = shiftMeta;
		return res.json(report);
	}
	try {
		const { rows } = await pool.query('UPDATE shift_reports SET shift_meta = $1 WHERE id = $2 RETURNING id,shift_meta AS "shiftMeta"', [JSON.stringify(shiftMeta), req.params.id]);
		if (!rows[0]) return res.status(404).json({ error: 'Смена не найдена' });
		res.json(rows[0]);
	} catch (error) { console.error('PUT /api/shift-reports/:id/meta:', error); res.status(500).json({ error: 'Не удалось сохранить данные смены' }); }
});

app.put('/api/shift-reports/:id', async (req, res) => {
	const report = req.body || {};
	if (!report.dateKey || !report.admin || !Number.isFinite(Number(report.total))) return res.status(400).json({ error: 'Некорректный отчёт смены' });
	if (!databaseAvailable) {
		const index = memoryShiftReports.findIndex(item => String(item.id) === String(req.params.id));
		if (index === -1) return res.status(404).json({ error: 'Смена не найдена' });
		memoryShiftReports[index] = { ...memoryShiftReports[index], ...report, id: memoryShiftReports[index].id };
		return res.json(memoryShiftReports[index]);
	}
	try {
		const { rows } = await pool.query(
			`UPDATE shift_reports SET date_key=$1,report_date=$2,timestamp=$3,admin=$4,qr=$5,cash=$6,previous_cash=$7,source=$8,final_cash=$9,total=$10,details=$11,shift_meta=$12 WHERE id=$13 RETURNING id,date_key AS "dateKey",report_date AS date,timestamp,admin,qr,cash,previous_cash AS "previousCash",source,final_cash AS "finalCash",total,details,shift_meta AS "shiftMeta"`,
			[report.dateKey, report.date || report.dateKey, report.timestamp || Date.now(), report.admin, Number(report.qr) || 0, Number(report.cash) || 0, Number(report.previousCash) || 0, report.source || 'shift_closed', Number(report.finalCash) || 0, Number(report.total) || 0, JSON.stringify(report.details || []), JSON.stringify(report.shiftMeta || {}), req.params.id]
		);
		if (!rows[0]) return res.status(404).json({ error: 'Смена не найдена' });
		res.json(rows[0]);
	} catch (error) { console.error('PUT /api/shift-reports/:id:', error); res.status(500).json({ error: 'Не удалось закрыть смену' }); }
});

app.delete('/api/shift-reports/date/:dateKey', async (req, res) => {
	if (!databaseAvailable) {
		memoryShiftReports = memoryShiftReports.filter(report => report.dateKey !== req.params.dateKey);
		return res.status(204).end();
	}
	try {
		await pool.query('DELETE FROM shift_reports WHERE date_key = $1', [req.params.dateKey]);
		res.status(204).end();
	} catch (error) { console.error('DELETE /api/shift-reports/date:', error); res.status(500).json({ error: 'Не удалось очистить отчёты смен' }); }
});

app.get('/api/revenue-adjustments', async (_req, res) => {
	if (!databaseAvailable) return res.json(memoryRevenueAdjustments);
	try {
		const { rows } = await pool.query('SELECT date_key,qr,cash,changed_by AS "changedBy",changed_at AS "changedAt" FROM revenue_adjustments');
		res.json(Object.fromEntries(rows.map(row => [row.date_key, row])));
	} catch (error) { console.error('GET /api/revenue-adjustments:', error); res.status(500).json({ error: 'Не удалось загрузить корректировки выручки' }); }
});

app.put('/api/revenue-adjustments/:dateKey', async (req, res) => {
	const { qr, cash, changedBy } = req.body || {};
	if (!Number.isFinite(Number(qr)) || !Number.isFinite(Number(cash)) || Number(qr) < 0 || Number(cash) < 0 || !changedBy) return res.status(400).json({ error: 'Некорректная корректировка' });
	const adjustment = { qr: Number(qr), cash: Number(cash), changedBy: String(changedBy), changedAt: new Date().toISOString() };
	if (!databaseAvailable) {
		memoryRevenueAdjustments[req.params.dateKey] = adjustment;
		return res.json(adjustment);
	}
	try {
		const { rows } = await pool.query(`INSERT INTO revenue_adjustments (date_key,qr,cash,changed_by) VALUES ($1,$2,$3,$4) ON CONFLICT (date_key) DO UPDATE SET qr=$2,cash=$3,changed_by=$4,changed_at=NOW() RETURNING date_key,qr,cash,changed_by AS "changedBy",changed_at AS "changedAt"`, [req.params.dateKey, adjustment.qr, adjustment.cash, adjustment.changedBy]);
		res.json(rows[0]);
	} catch (error) { console.error('PUT /api/revenue-adjustments:', error); res.status(500).json({ error: 'Не удалось сохранить корректировку' }); }
});

app.delete('/api/revenue-adjustments/:dateKey', async (req, res) => {
	if (!databaseAvailable) {
		delete memoryRevenueAdjustments[req.params.dateKey];
		return res.status(204).end();
	}
	try { await pool.query('DELETE FROM revenue_adjustments WHERE date_key = $1', [req.params.dateKey]); res.status(204).end(); }
	catch (error) { console.error('DELETE /api/revenue-adjustments:', error); res.status(500).json({ error: 'Не удалось удалить корректировку' }); }
});

app.get('/api/runs', async (_req, res) => {
	if (!databaseAvailable) return res.json(memoryRuns);
	try {
		const { rows } = await pool.query('SELECT key, type, id, start_time, end_time, shift_date_key, is_open FROM runs ORDER BY key');
		res.json(rows);
	} catch (error) {
		console.error('GET /api/runs:', error);
		res.status(500).json({ error: 'Не удалось загрузить сессии' });
	}
});

app.post('/api/runs', async (req, res) => {
	const { key, type, id, startTime, endTime, isOpen, shiftDateKey } = req.body || {};
	if (!key || !type || !Number.isInteger(Number(id)) || !Number.isFinite(Number(startTime))) return res.status(400).json({ error: 'Некорректная сессия' });
	const run = { key, type, id: Number(id), start_time: Number(startTime), end_time: endTime === null ? null : Number(endTime), shift_date_key: shiftDateKey || null, is_open: Boolean(isOpen) };
	if (!databaseAvailable) {
		memoryRuns = memoryRuns.filter(item => item.key !== key).concat(run);
		return res.status(201).json(run);
	}
	try {
		const { rows } = await pool.query(`INSERT INTO runs (key, type, id, start_time, end_time, shift_date_key, is_open) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (key) DO UPDATE SET type=$2,id=$3,start_time=$4,end_time=$5,shift_date_key=$6,is_open=$7,updated_at=NOW() RETURNING key,type,id,start_time,end_time,shift_date_key,is_open`, [run.key, run.type, run.id, run.start_time, run.end_time, run.shift_date_key, run.is_open]);
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

app.get('/api/presence/check', async (req, res) => {
	const login = String(req.query.login || '').trim();
	const sessionId = String(req.query.sessionId || '').trim();
	if (!login || !sessionId) return res.status(400).json({ error: 'Некорректная проверка входа' });
	if (!databaseAvailable) {
		const activeSince = Date.now() - 20000;
		memoryPresence = memoryPresence.filter(user => user.last_seen > activeSince);
		const active = memoryPresence.find(user => user.login === login && user.session_id !== sessionId);
		return res.json({ available: !active, activeUser: active ? { name: active.name, role: active.role } : null });
	}
	try {
		const { rows } = await pool.query(`SELECT name, role FROM online_presence WHERE login = $1 AND session_id <> $2 AND last_seen > NOW() - INTERVAL '20 seconds' LIMIT 1`, [login, sessionId]);
		res.json({ available: !rows[0], activeUser: rows[0] || null });
	} catch (error) {
		console.error('GET /api/presence/check:', error);
		res.status(500).json({ error: 'Не удалось проверить активный вход' });
	}
});

app.post('/api/presence', async (req, res) => {
	const { sessionId, name, login, role } = req.body || {};
	if (!sessionId || !name || !login || !role) return res.status(400).json({ error: 'Некорректный онлайн-статус' });
	if (!databaseAvailable) {
		const activeSince = Date.now() - 20000;
		memoryPresence = memoryPresence.filter(user => user.last_seen > activeSince);
		if (memoryPresence.some(user => user.login === login && user.session_id !== sessionId)) return res.status(409).json({ error: 'Аккаунт уже используется на другом устройстве или во вкладке' });
		const user = { session_id: sessionId, name, login, role, last_seen: Date.now() };
		memoryPresence = memoryPresence.filter(item => item.session_id !== sessionId).concat(user);
		return res.status(204).end();
	}
	try {
		const active = await pool.query(`SELECT 1 FROM online_presence WHERE login = $1 AND session_id <> $2 AND last_seen > NOW() - INTERVAL '20 seconds' LIMIT 1`, [login, sessionId]);
		if (active.rows[0]) return res.status(409).json({ error: 'Аккаунт уже используется на другом устройстве или во вкладке' });
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

app.get('/api/cash-balance', async (_req, res) => {
	if (!databaseAvailable) return res.json(memoryCashBalance || { amount: 0, denominations: {}, user: '', dateKey: '', updatedAt: '' });
	try {
		const { rows } = await pool.query('SELECT amount, denominations, user_name AS user, date_key, updated_at FROM cash_balance WHERE id = 1');
		res.json(rows[0] || { amount: 0, denominations: {}, user: '', dateKey: '', updatedAt: '' });
	} catch (error) { console.error('GET /api/cash-balance:', error); res.status(500).json({ error: 'Не удалось загрузить кассу' }); }
});

app.post('/api/cash-balance', async (req, res) => {
	const { amount, denominations = {}, user, dateKey } = req.body || {};
	if (!Number.isFinite(Number(amount)) || Number(amount) < 0 || !user || !dateKey) return res.status(400).json({ error: 'Некорректная касса' });
	if (!databaseAvailable) {
		memoryCashBalance = { amount: Number(amount), denominations, user, dateKey, updatedAt: new Date().toLocaleTimeString('ru-RU') };
		return res.json(memoryCashBalance);
	}
	try {
		const { rows } = await pool.query(`INSERT INTO cash_balance (id, amount, denominations, user_name, date_key) VALUES (1,$1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET amount=$1,denominations=$2,user_name=$3,date_key=$4,updated_at=NOW() RETURNING amount,denominations,user_name AS user,date_key,updated_at`, [amount, JSON.stringify(denominations), user, dateKey]);
		res.json(rows[0]);
	} catch (error) { console.error('POST /api/cash-balance:', error); res.status(500).json({ error: 'Не удалось сохранить кассу' }); }
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

app.put('/api/payments/:id', async (req, res) => {
	const { qr, cash, total } = req.body || {};
	if (!Number.isFinite(Number(qr)) || !Number.isFinite(Number(cash)) || !Number.isFinite(Number(total)) || qr < 0 || cash < 0) return res.status(400).json({ error: 'Некорректные суммы' });
	if (!databaseAvailable) {
		const payment = memoryPayments.find(item => item.id === Number(req.params.id));
		if (!payment) return res.status(404).json({ error: 'Оплата не найдена' });
		Object.assign(payment, { qr: Number(qr), cash: Number(cash), total: Number(total) });
		return res.json(payment);
	}
	try {
		const { rows } = await pool.query('UPDATE payments SET qr = $1, cash = $2, total = $3 WHERE id = $4 RETURNING *', [qr, cash, total, req.params.id]);
		if (!rows[0]) return res.status(404).json({ error: 'Оплата не найдена' });
		res.json(rows[0]);
	} catch (error) {
		console.error('PUT /api/payments/:id:', error);
		res.status(500).json({ error: 'Не удалось изменить оплату' });
	}
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

app.get('/api/revenue-backup', async (_req, res) => {
	if (!databaseAvailable) return res.json({ payments: memoryPayments, shiftReports: memoryShiftReports, revenueAdjustments: memoryRevenueAdjustments, cashBalance: memoryCashBalance });
	try {
		const [paymentsResult, reportsResult, adjustmentsResult, cashResult] = await Promise.all([
			pool.query('SELECT id,cash,qr,timestamp,date_key AS "dateKey",time,start_str AS "startStr",end_str AS "endStr",total,duration,zone FROM payments ORDER BY timestamp'),
			pool.query('SELECT id,date_key AS "dateKey",report_date AS date,timestamp,admin,qr,cash,previous_cash AS "previousCash",source,final_cash AS "finalCash",total,expense_title AS "expenseTitle",expense_amount AS "expenseAmount",details,shift_meta AS "shiftMeta" FROM shift_reports ORDER BY timestamp'),
			pool.query('SELECT date_key AS "dateKey",qr,cash,changed_by AS "changedBy",changed_at AS "changedAt" FROM revenue_adjustments'),
			pool.query('SELECT amount,denominations,user_name AS user,date_key AS "dateKey",updated_at AS "updatedAt" FROM cash_balance WHERE id = 1')
		]);
		res.json({ payments: paymentsResult.rows, shiftReports: reportsResult.rows, revenueAdjustments: Object.fromEntries(adjustmentsResult.rows.map(row => [row.dateKey, row])), cashBalance: cashResult.rows[0] || null });
	} catch (error) { console.error('GET /api/revenue-backup:', error); res.status(500).json({ error: 'Не удалось создать резервную копию выручки' }); }
});

app.post('/api/revenue-backup', async (req, res) => {
	const backup = req.body || {};
	if (!Array.isArray(backup.payments) || !Array.isArray(backup.shiftReports) || !backup.revenueAdjustments || typeof backup.revenueAdjustments !== 'object') {
		return res.status(400).json({ error: 'Некорректная резервная копия выручки' });
	}
	if (!databaseAvailable) {
		memoryPayments = backup.payments;
		memoryShiftReports = backup.shiftReports;
		memoryRevenueAdjustments = backup.revenueAdjustments;
		memoryCashBalance = backup.cashBalance || null;
		return res.json({ ok: true });
	}
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query('DELETE FROM payments');
		await client.query('DELETE FROM shift_reports');
		await client.query('DELETE FROM revenue_adjustments');
		await client.query('DELETE FROM cash_balance');
		for (const payment of backup.payments) {
			await client.query(`INSERT INTO payments (id,cash,qr,timestamp,date_key,time,start_str,end_str,total,duration,zone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [payment.id, Number(payment.cash) || 0, Number(payment.qr) || 0, payment.timestamp || Date.now(), payment.dateKey || payment.date_key, payment.time || '', payment.startStr || payment.start_str || '', payment.endStr || payment.end_str || '', Number(payment.total) || 0, payment.duration || '', payment.zone || '']);
		}
		for (const report of backup.shiftReports) {
			await client.query(`INSERT INTO shift_reports (id,date_key,report_date,timestamp,admin,qr,cash,previous_cash,source,final_cash,total,expense_title,expense_amount,details,shift_meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [report.id, report.dateKey || report.date_key, report.date || report.dateKey, report.timestamp || Date.now(), report.admin || '', Number(report.qr) || 0, Number(report.cash) || 0, Number(report.previousCash) || 0, report.source || 'cash', Number(report.finalCash) || 0, Number(report.total) || 0, report.expenseTitle || '', Number(report.expenseAmount) || 0, JSON.stringify(report.details || []), JSON.stringify(report.shiftMeta || {})]);
		}
		for (const [dateKey, adjustment] of Object.entries(backup.revenueAdjustments)) {
			await client.query('INSERT INTO revenue_adjustments (date_key,qr,cash,changed_by) VALUES ($1,$2,$3,$4)', [dateKey, Number(adjustment.qr) || 0, Number(adjustment.cash) || 0, adjustment.changedBy || 'backup']);
		}
		if (backup.cashBalance) {
			const balance = backup.cashBalance;
			await client.query('INSERT INTO cash_balance (id,amount,denominations,user_name,date_key) VALUES (1,$1,$2,$3,$4)', [Number(balance.amount) || 0, JSON.stringify(balance.denominations || {}), balance.user || '', balance.dateKey || '']);
		}
		await client.query('COMMIT');
		res.json({ ok: true });
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('POST /api/revenue-backup:', error);
		res.status(500).json({ error: 'Не удалось восстановить резервную копию выручки' });
	} finally { client.release(); }
});

initializeDatabase()
	.then(() => app.listen(port, () => console.log(`RESTART is running on port ${port}`)))
	.catch(error => { console.error('Ошибка инициализации:', error); app.listen(port, () => console.log(`RESTART is running on port ${port}`)); });
