const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app      = express();
const PORT     = 3000;
const DB_FILE  = path.join(__dirname, 'data', 'db.json');

// Créer le fichier de données s'il n'existe pas
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ r: [], a: [] }, null, 2));
}

app.use(express.json());
app.use(express.static(__dirname));

// ── Lecture / écriture base de données ──────────────────────────────────────
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { return { r: [], a: [] }; }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── COMPTES RENDUS ───────────────────────────────────────────────────────────
app.get('/api/reports', (req, res) => {
  const db = readDB();
  const items = req.query.date
    ? db.r.filter(r => r.date === req.query.date)
    : db.r;
  res.json(items.sort((a, b) => new Date(b.ts) - new Date(a.ts)));
});

app.post('/api/reports', (req, res) => {
  const db  = readDB();
  const rec = { ...req.body, id: Date.now().toString(), ts: new Date().toISOString() };
  const idx = db.r.findIndex(r => r.tech === rec.tech && r.date === rec.date);
  if (idx >= 0) db.r[idx] = rec; else db.r.push(rec);
  writeDB(db);
  res.json(rec);
});

app.delete('/api/reports/:id', (req, res) => {
  const db = readDB();
  db.r = db.r.filter(r => r.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ── AFFECTATIONS ─────────────────────────────────────────────────────────────
app.get('/api/affectations', (req, res) => {
  const db = readDB();
  let items = db.a;
  if (req.query.date)   items = items.filter(a => a.date === req.query.date);
  if (req.query.from)   items = items.filter(a => a.date >= req.query.from);
  if (req.query.to)     items = items.filter(a => a.date <= req.query.to);
  if (req.query.tech)   items = items.filter(a => a.tech === req.query.tech);
  if (req.query.status) items = items.filter(a => a.status === req.query.status);
  res.json(items.sort((a, b) => b.date.localeCompare(a.date)));
});

app.post('/api/affectations', (req, res) => {
  const db  = readDB();
  const rec = { ...req.body, id: Date.now().toString(), status: 'À faire', ts: new Date().toISOString() };
  db.a.push(rec);
  writeDB(db);
  res.json(rec);
});

app.put('/api/affectations/:id', (req, res) => {
  const db  = readDB();
  const idx = db.a.findIndex(a => a.id === req.params.id);
  if (idx >= 0) {
    db.a[idx] = { ...db.a[idx], ...req.body };
    writeDB(db);
    res.json(db.a[idx]);
  } else {
    res.status(404).json({ error: 'Introuvable' });
  }
});

app.delete('/api/affectations/:id', (req, res) => {
  const db = readDB();
  db.a = db.a.filter(a => a.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ── DÉMARRAGE ────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ✅  MaintenanceOps est en ligne !');
  console.log('');
  console.log('  👉  Votre PC       : http://localhost:' + PORT);
  console.log('');
  console.log('  📱  Les techniciens ouvrent leur navigateur et tapent :');
  console.log('       http://[VOTRE-IP]:' + PORT);
  console.log('');
  console.log('  ℹ️   Pour trouver votre IP : ouvrez un autre cmd et tapez  ipconfig');
  console.log('      Cherchez "Adresse IPv4"');
  console.log('');
  console.log('  ⚠️   Ne fermez pas cette fenêtre, sinon le serveur s\'arrête.');
  console.log('');
});
