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

initializeDatabase()
	.then(() => app.listen(port, () => console.log(`RESTART is running on port ${port}`)))
	.catch(error => { console.error('Ошибка инициализации:', error); app.listen(port, () => console.log(`RESTART is running on port ${port}`)); });
