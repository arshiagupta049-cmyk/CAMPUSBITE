// CampusBite frontend. Plain JavaScript: it talks to the server using fetch().
let token = localStorage.getItem('token'), me = null, foods = [], currentMeal = '';
const $ = id => document.getElementById(id);
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const dateToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const CAL_UNCERTAINTY = 0.15; // preparation and portion sizes vary
const calorieRange = n => { const v = Math.round(n || 0); return `${v} ± ${Math.round(v * CAL_UNCERTAINTY)} kcal`; };
function foodBalance(f) {
  if (!f) return { score: 3, label: 'Not enough data' };
  const n = `${f.name || ''} ${f.section || ''}`.toLowerCase();
  let score = 3;
  if (/fruit|sprout|salad|green leafy|vegetable|dal|channa|chana|rajma|bean|rasam|sambar|curd|buttermilk|milk|nuts/.test(n)) score += 1;
  if ((f.fibre || 0) >= 4) score += 1;
  if ((f.pro || 0) >= 10) score += 1;
  if (/fries|popcorn|pastry|doughnut|chocolava|brownie|cake|cold chocolate|lemonade|sugar|cheese maggi|french fries/.test(n)) score -= 1;
  score = Math.max(1, Math.min(5, score));
  return { score, label: score >= 4 ? 'More nutrient-dense' : score <= 2 ? 'Enjoy sometimes' : 'Mixed / depends on portion' };
}
function foodForLog(l) { return foods.find(f => f.id === l.food_id) || { name: l.name, section: '', pro: l.pro, fibre: l.fibre }; }
function balanceBadge(l) { const b = foodBalance(foodForLog(l)); return `<span class="badge">${b.score}/5 · ${b.label}</span>`; }

// helper: call the server with the login token attached
async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body && JSON.stringify(body) });
  if (r.status === 401 && token) return logout();
  return r.json();
}

// ---------- login / register ----------
async function auth(kind) {
  const d = await api('/' + kind, 'POST', { name: $('name').value, email: $('email').value, password: $('pw').value });
  if (d.error) return $('err').textContent = d.error;
  token = d.token; localStorage.setItem('token', token); start();
}
function logout() { localStorage.removeItem('token'); token = null; location.reload(); }

async function start() {
  if (!token) return $('loginBox').classList.remove('hidden');
  me = await api('/me'); if (!me || me.error) return logout();
  foods = await api('/foods');
  $('loginBox').classList.add('hidden'); $('appBox').classList.remove('hidden');
  $('date').value = dateToday(); show('today');
}

// ---------- switching pages ----------
function show(page) {
  ['today', 'history', 'expenses', 'health', 'ai'].forEach(p => { $(p).classList.toggle('hidden', p != page); $('t-' + p).classList.toggle('on', p == page); });
  if (page == 'today') loadToday(); if (page == 'history') loadHistory(7); if (page == 'expenses') { $('expenseDate').value = dateToday(); loadExpenses(); } if (page == 'health') loadHealth(); if (page == 'ai') initAI();
}

// ---------- TODAY page ----------
async function loadToday() {
  const date = $('date').value, logs = await api('/day/' + date);
  const h = new Date().getHours();
  $('dateText').textContent = new Date(date).toDateString().toUpperCase();
  $('hello').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + ', ' + me.name;
  const eaten = logs.filter(l => l.status == 'eaten'), sum = (a, k) => Math.round(a.reduce((s, l) => s + (l[k] || 0), 0));
  const skipped = MEALS.filter(m => logs.some(l => l.meal == m && l.status == 'skipped'));
  const reported = MEALS.filter(m => logs.some(l => l.meal == m));
  const cal = sum(eaten, 'cal');
  $('counters').innerHTML = [['Consumed (estimate)', calorieRange(cal)], ['Foods logged', eaten.length], ['Skipped', skipped.length], ['Not reported', MEALS.length - reported.length], ['Spent', '₹' + sum(logs, 'price')]]
    .map(([a, b]) => `<div class="stat"><small>${a}</small><b>${b}</b></div>`).join('');
  $('meals').innerHTML = MEALS.map(m => {
    const items = logs.filter(l => l.meal == m);
    const state = items.length ? (items[0].status == 'skipped' ? 'Skipped' : 'Logged') : 'Not reported';
    return `<div class="card"><div class="meal"><h3>${m}</h3><span class="badge">${state}</span></div>
      ${items.map(l => `<div class="row"><span>${l.name || 'Skipped meal'} ${l.qty > 1 ? '×' + l.qty : ''} <span class="mut">${l.source || ''}</span> ${l.status === 'eaten' ? balanceBadge(l) : ''}</span>
        <span>${calorieRange(l.cal)} <button class="ghost" onclick="del(${l.id})">✕</button></span></div>`).join('')}
      <div class="meal" style="margin-top:10px"><b>${calorieRange(sum(items, 'cal'))}</b>
      <span><button class="ghost" onclick="skip('${m}')">Skip</button> <button onclick="openLog('${m}')">+ Log meal</button></span></div></div>`;
  }).join('');
  const goals = { pro: 110, carbs: 280, fat: 65, fibre: 30 };
  $('macros').innerHTML = Object.entries(goals).map(([k, g]) => `<div class="meal"><span>${k.toUpperCase()}</span><span>${sum(eaten, k)} / ${g} g</span></div>
    <div class="bar"><i style="width:${Math.min(100, sum(eaten, k) / g * 100)}%"></i></div>`).join('');
}

// ---------- log meal popup ----------
function openLog(meal) { currentMeal = meal; $('dlgTitle').textContent = 'Log ' + meal; fillFoods(); $('dlg').showModal(); }
function fillFoods() {
  const src = $('src').value;
  $('priceBox').classList.toggle('hidden', src == 'Hostel Mess');   // hostel mess is free
  $('food').innerHTML = foods.filter(f => f.source == src).map(f => `<option value="${f.id}">${f.name} (${calorieRange(f.cal)} · ${foodBalance(f).score}/5 balance)</option>`).join('');
}
async function saveLog() {
  const qty = Number($('qty').value), price = Number($('price').value || 0);
  if (!Number.isFinite(qty) || qty <= 0) return alert('Please enter a quantity greater than zero.');
  if (!Number.isFinite(price) || price < 0) return alert('Please enter a valid price.');
  await api('/log', 'POST', { food_id: +$('food').value, meal: currentMeal, date: $('date').value, qty,
    price: $('src').value == 'Mini Mingos' ? price : 0 });
  $('dlg').close(); loadToday();
}
async function skip(meal) { await api('/log', 'POST', { meal, date: $('date').value, status: 'skipped' }); loadToday(); }
async function del(id) { await api('/log/' + id, 'DELETE'); loadToday(); }

// ---------- HISTORY page (chart) ----------
let calChart, spendChart;
async function loadHistory(days) {
  const d = await api('/stats/' + days);
  calChart?.destroy();
  calChart = new Chart($('calChart'), { type: 'bar', data: { labels: d.map(x => x.date.slice(5)), datasets: [{ label: 'kcal', data: d.map(x => Math.round(x.cal)), backgroundColor: '#c2410c' }] } });
}

// ---------- EXPENSES page ----------
async function loadExpenses() {
  const d = await api('/expenses/30'), t = dateToday(), total = a => a.reduce((s, x) => s + x.price, 0);
  const week = d.filter(x => (new Date(t) - new Date(x.date)) / 864e5 < 7);
  $('spendStats').innerHTML = [['Today', d.filter(x => x.date == t)], ['This week', week], ['Last 30 days', d]]
    .map(([a, b]) => `<div class="stat"><small>${a}</small><b>₹${total(b)}</b></div>`).join('');
  const byDay = {}; d.forEach(x => byDay[x.date] = (byDay[x.date] || 0) + x.price);
  const days = Object.keys(byDay).sort();
  spendChart?.destroy();
  spendChart = new Chart($('spendChart'), { type: 'line', data: { labels: days.map(x => x.slice(5)), datasets: [{ label: '₹ per day', data: days.map(x => byDay[x]), borderColor: '#c2410c' }] } });
  $('expList').innerHTML = d.map(x => `<div class="row"><span>${x.name || 'Outside meal'} <span class="mut">${x.date} · ${x.meal}</span></span><span><b>₹${Number(x.price).toFixed(2)}</b> ${x.type === 'manual' ? `<button class="ghost" onclick="deleteExpense(${x.id})">✕</button>` : ''}</span></div>`).join('') || '<p class="mut">No expenses recorded yet.</p>';
}
async function addExpense() {
  const description = $('expenseDesc').value.trim(), amount = Number($('expenseAmount').value), date = $('expenseDate').value;
  if (!description || !date || !Number.isFinite(amount) || amount <= 0) {
    $('expenseMsg').textContent = ' Enter a description, date, and amount greater than zero.';
    return;
  }
  const result = await api('/expenses/manual', 'POST', { description, amount, date, category: $('expenseCategory').value });
  if (result.error) { $('expenseMsg').textContent = ' ' + result.error; return; }
  $('expenseDesc').value = ''; $('expenseAmount').value = ''; $('expenseMsg').textContent = ' Saved.';
  await loadExpenses();
}
async function deleteExpense(id) {
  await api('/expenses/manual/' + id, 'DELETE');
  await loadExpenses();
}

// ---------- NUTRITION & WELLBEING ----------
function saveHealthProfile() {
  const h = Number($('heightCm').value), w = Number($('weightKg').value);
  if (!h || !w || h < 50 || h > 250 || w < 10 || w > 300) {
    $('bmiResult').textContent = 'Enter a valid height and weight, or leave the profile blank.';
    return;
  }
  localStorage.setItem('cb_height_cm', String(h));
  localStorage.setItem('cb_weight_kg', String(w));
  const bmi = w / ((h / 100) ** 2);
  $('bmiResult').textContent = `BMI: ${bmi.toFixed(1)}. This is only a screening measure, not a diagnosis or a calorie target. For anyone under 18, adult BMI categories should not be used; a clinician can interpret age-specific growth charts.`;
}
async function loadHealth() {
  $('heightCm').value = localStorage.getItem('cb_height_cm') || '';
  $('weightKg').value = localStorage.getItem('cb_weight_kg') || '';
  if ($('heightCm').value && $('weightKg').value) saveHealthProfile();
  const date = $('date').value || dateToday();
  const todayLogs = await api('/day/' + date);
  const eaten = todayLogs.filter(l => l.status === 'eaten');
  const sum = (a, k) => Math.round(a.reduce((s, l) => s + (Number(l[k]) || 0), 0));
  const avg = eaten.length ? (eaten.reduce((s,l) => s + foodBalance(foodForLog(l)).score,0) / eaten.length).toFixed(1) : '—';
  $('healthStats').innerHTML = [
    ['Foods logged', eaten.length],
    ['Average balance guide', avg === '—' ? avg : `${avg}/5`],
    ['Calories (estimate)', calorieRange(sum(eaten,'cal'))]
  ].map(([k,v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('');
  $('healthLog').innerHTML = eaten.length ? eaten.map(l => {
    const b = foodBalance(foodForLog(l));
    return `<div class="row"><span>${l.name || 'Food'} × ${l.qty || 1}<br><span class="mut">${b.label}</span></span><b>${b.score}/5</b></div>`;
  }).join('') : '<p class="mut">Log a meal to start your food-balance history.</p>';
  const skipped = todayLogs.filter(l => l.status === 'skipped');
  const groups = new Set(eaten.map(l => {
    const n = `${l.name || ''} ${l.section || ''}`.toLowerCase();
    if (/fruit|banana|apple|orange/.test(n)) return 'fruit';
    if (/vegetable|salad|sambar|rasam|palya|subzi|saagu/.test(n)) return 'vegetables';
    if (/dal|chana|channa|sprout|bean|paneer|milk|curd|chicken|egg/.test(n)) return 'protein';
    if (/rice|chapati|dosa|idly|poha|bread|pasta|maggi|noodle|paratha/.test(n)) return 'grains';
    if (/nut|almond|peanut/.test(n)) return 'nuts';
    return 'other';
  }));
  const alerts = [];
  if (skipped.length) alerts.push('You marked a meal as skipped. If you are hungry, it is okay to eat; this app is not asking you to compensate or restrict later.');
  if (eaten.length && groups.size < 3) alerts.push('Your logged foods show limited variety so far. When convenient, consider adding a different food group such as fruit, vegetables, pulses, or dairy/alternatives.');
  if (!eaten.length) alerts.push('No foods logged for this date yet. Remember, an empty log does not mean you have eaten nothing.');
  alerts.push('Calories and the 1–5 food-balance guide are rough estimates. They cannot diagnose health, and a single food or day does not define your overall diet.');
  $('safeAlerts').innerHTML = alerts.map(a => `<p>${a}</p>`).join('');
}

// ---------- AI page ----------
function initAI() {
  $('chips').innerHTML = ['How many calories did I consume today?', 'How much protein did I get this week?', 'How much did I spend this month?', 'Which meals have I not reported?']
    .map(q => `<span class="chip" onclick="$('q').value=this.textContent;ask()">${q}</span>`).join('');
}
async function ask() {
  const q = $('q').value.trim(); if (!q) return;
  $('chat').innerHTML += `<div class="m u">${q}</div>`; $('q').value = '';
  const r = await api('/ai', 'POST', { question: q });
  $('chat').innerHTML += `<div class="m b">${r.answer}</div>`;
}
start();
