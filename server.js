// CampusBite backend: Express (web server) + SQLite (database) + JWT (login tokens)
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECRET = 'change-this-secret';          // used to sign login tokens
const db = new Database('campusbite.db');       // creates the database file
const app = express();
app.use(express.json());
app.use(express.static('public'));              // serves the frontend files

// ---------- 1. DATABASE TABLES ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT, goal INTEGER DEFAULT 2200);
CREATE TABLE IF NOT EXISTS foods (id INTEGER PRIMARY KEY, name TEXT, source TEXT, section TEXT, cal REAL, pro REAL, carbs REAL, fat REAL, fibre REAL);
CREATE TABLE IF NOT EXISTS logs  (id INTEGER PRIMARY KEY, user_id INTEGER, food_id INTEGER, meal TEXT, date TEXT, qty REAL DEFAULT 1, price REAL DEFAULT 0, status TEXT DEFAULT 'eaten');
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT NOT NULL, description TEXT NOT NULL, category TEXT DEFAULT 'Other', amount REAL NOT NULL CHECK(amount >= 0));
`);
// fill foods table from the spreadsheet data the first time
if (db.prepare('SELECT COUNT(*) c FROM foods').get().c === 0) {
  const ins = db.prepare('INSERT INTO foods (name,source,section,cal,pro,carbs,fat,fibre) VALUES (?,?,?,?,?,?,?,?)');
  for (const f of require('./data/foods.json')) ins.run(f.name, f.source, f.section, f.cal, f.pro, f.carbs, f.fat, f.fibre);
}

// ---------- 2. LOGIN / REGISTER ----------
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Fill all fields' });
  try {
    const r = db.prepare('INSERT INTO users (name,email,password) VALUES (?,?,?)').run(name, email.toLowerCase(), bcrypt.hashSync(password, 8));
    res.json({ token: jwt.sign({ id: r.lastInsertRowid }, SECRET) });
  } catch { res.status(400).json({ error: 'Email already registered' }); }
});
app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password)) return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token: jwt.sign({ id: u.id }, SECRET) });
});
// middleware: runs before protected routes and finds out WHO is calling
function auth(req, res, next) {
  try { req.uid = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Please log in' }); }
}

// ---------- 3. DATA ROUTES ----------
app.get('/api/me', auth, (req, res) => {
  const user = db.prepare(
    'SELECT id, name, email, goal FROM users WHERE id = ?'
  ).get(req.uid);

  if (!user) {
    return res.status(401).json({ error: 'Please log in again' });
  }

  return res.json(user);
});
app.get('/api/foods', auth, (req, res) => res.json(db.prepare('SELECT * FROM foods ORDER BY source, section, name').all()));

// all logs of one day, joined with food info
app.get('/api/day/:date', auth, (req, res) => res.json(db.prepare(
  `SELECT logs.*, foods.name, foods.source, foods.cal*logs.qty AS cal, foods.pro*logs.qty AS pro, foods.carbs*logs.qty AS carbs,
          foods.fat*logs.qty AS fat, foods.fibre*logs.qty AS fibre
   FROM logs LEFT JOIN foods ON foods.id=logs.food_id WHERE user_id=? AND date=?`).all(req.uid, req.params.date)));

app.post('/api/log', auth, (req, res) => {
  const { food_id, meal, date, qty, price, status } = req.body;
  db.prepare('INSERT INTO logs (user_id,food_id,meal,date,qty,price,status) VALUES (?,?,?,?,?,?,?)')
    .run(req.uid, food_id || null, meal, date, qty || 1, price || 0, status || 'eaten');
  res.json({ ok: true });
});
app.delete('/api/log/:id', auth, (req, res) => {
  db.prepare('DELETE FROM logs WHERE id=? AND user_id=?').run(req.params.id, req.uid);
  res.json({ ok: true });
});

// calories + spend per day for the last N days (for charts)
app.get('/api/stats/:days', auth, (req, res) => res.json(db.prepare(
  `SELECT logs.date, SUM(foods.cal*logs.qty) AS cal, SUM(foods.pro*logs.qty) AS pro, SUM(logs.price) AS spend
   FROM logs LEFT JOIN foods ON foods.id=logs.food_id
   WHERE user_id=? AND status='eaten' AND date >= date('now', ?) GROUP BY logs.date ORDER BY logs.date`)
  .all(req.uid, `-${+req.params.days} day`)));

// every purchase (anything with a price) for the expenses page
app.get('/api/expenses/:days', auth, (req, res) => res.json(db.prepare(
  `SELECT logs.id, logs.date, logs.meal, logs.price, foods.name, foods.source, 'meal' AS type
   FROM logs LEFT JOIN foods ON foods.id=logs.food_id
   WHERE logs.user_id=? AND logs.price>0 AND logs.date >= date('now', ?)
   UNION ALL
   SELECT expenses.id, expenses.date, expenses.category AS meal, expenses.amount AS price,
          expenses.description AS name, expenses.category AS source, 'manual' AS type
   FROM expenses WHERE expenses.user_id=? AND expenses.date >= date('now', ?)
   ORDER BY date DESC`).all(req.uid, `-${+req.params.days} day`, req.uid, `-${+req.params.days} day`)));

app.post('/api/expenses/manual', auth, (req, res) => {
  const { date, description, category, amount } = req.body;
  const value = Number(amount);
  if (!date || !description || !description.trim() || !Number.isFinite(value) || value <= 0)
    return res.status(400).json({ error: 'Enter a description, date, and amount greater than zero.' });
  const result = db.prepare('INSERT INTO expenses (user_id,date,description,category,amount) VALUES (?,?,?,?,?)')
    .run(req.uid, date, description.trim().slice(0,120), category || 'Other', value);
  res.json({ ok: true, id: result.lastInsertRowid });
});
app.delete('/api/expenses/manual/:id', auth, (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id=? AND user_id=?').run(req.params.id, req.uid);
  res.json({ ok: true });
});

// ---------- 4. AI ASSISTANT ----------
// Answers using ONLY this user's own records. Uses Claude if ANTHROPIC_API_KEY is set, else simple rules.
app.post('/api/ai', auth, async (req, res) => {
  const q = req.body.question || '';
  const week = db.prepare(`SELECT logs.date, logs.meal, logs.status, logs.price, foods.name, foods.source, foods.cal*logs.qty cal, foods.pro*logs.qty pro
    FROM logs LEFT JOIN foods ON foods.id=logs.food_id WHERE user_id=? AND date >= date('now','-30 day') ORDER BY date`).all(req.uid);
  const today = new Date().toISOString().slice(0, 10);
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500,
          system: `You are CampusBite AI. Today is ${today}. Answer briefly using ONLY this student's records (JSON). Nutrition values are estimates. Records: ${JSON.stringify(week)}`,
          messages: [{ role: 'user', content: q }] })
      });
      return res.json({ answer: (await r.json()).content[0].text });
    } catch { /* fall through to simple rules */ }
  }
  const eaten = week.filter(l => l.status === 'eaten'), t = eaten.filter(l => l.date === today), L = q.toLowerCase();
  const sum = (a, k) => Math.round(a.reduce((s, l) => s + (l[k] || 0), 0));
  let a = 'Try: "calories today", "protein this week", "how much did I spend", or "meals not reported".';
  if (L.includes('calor')) a = `You consumed about ${sum(t, 'cal')} kcal today (estimate).`;
  else if (L.includes('protein')) a = `Protein in the last 30 days: ${sum(eaten, 'pro')} g (estimate).`;
  else if (L.includes('spen') || L.includes('mingo')) a = `You spent ₹${sum(week, 'price')} in the last 30 days.`;
  else if (L.includes('skip')) a = `You skipped ${week.filter(l => l.status === 'skipped').length} meals in the last 30 days.`;
  else if (L.includes('report')) { const done = t.concat(week.filter(l => l.date === today && l.status === 'skipped')).map(l => l.meal);
    a = 'Not reported today: ' + (['Breakfast', 'Lunch', 'Dinner', 'Snacks'].filter(m => !done.includes(m)).join(', ') || 'none'); }
  res.json({ answer: a });
});

app.listen(3000, () => console.log('CampusBite running → http://localhost:3000'));
