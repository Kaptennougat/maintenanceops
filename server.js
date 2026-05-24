require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const webpush      = require('web-push');
const path         = require('path');
const fs           = require('fs');

const { pool, initDB }              = require('./db');
const { authMiddleware, managerOnly, SECRET } = require('./middleware/auth');

const app  = express();

// ── VAPID ──────────────────────────────────────────────────────────────────────
const VAPID_FILE = path.join(__dirname, 'data', 'vapid.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
let vapidKeys;
if (fs.existsSync(VAPID_FILE)) {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE));
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys));
}
webpush.setVapidDetails('mailto:maintenance@entreprise.com', vapidKeys.publicKey, vapidKeys.privateKey);

// ── MIDDLEWARE ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname + '/public'));

// ════════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  const { login, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM users WHERE login=$1 AND actif=true', [login]);
    if (!r.rows.length) return res.status(401).json({ error: 'Identifiant incorrect' });
    const user = r.rows[0];
    const ok   = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect' });
    const token = jwt.sign({ id: user.id, login: user.login, nom: user.nom, role: user.role }, SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 86400000 });
    res.json({ ok: true, user: { id: user.id, login: user.login, nom: user.nom, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

app.put('/api/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  try {
    const r    = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = r.rows[0];
    const ok   = await bcrypt.compare(oldPassword, user.password);
    if (!ok) return res.status(401).json({ error: 'Ancien mot de passe incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════════
// COMPTES RENDUS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/comptes-rendus', authMiddleware, async (req, res) => {
  try {
    let q, params;
    if (req.user.role === 'responsable') {
      q = `SELECT cr.*, u.nom, u.login FROM comptes_rendus cr
           JOIN users u ON cr.user_id = u.id
           WHERE ($1::date IS NULL OR cr.date = $1::date)
           ORDER BY cr.date DESC, u.nom`;
      params = [req.query.date || null];
    } else {
      q = `SELECT cr.*, u.nom FROM comptes_rendus cr
           JOIN users u ON cr.user_id = u.id
           WHERE cr.user_id = $1 AND ($2::date IS NULL OR cr.date = $2::date)
           ORDER BY cr.date DESC`;
      params = [req.user.id, req.query.date || null];
    }
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/comptes-rendus', authMiddleware, async (req, res) => {
  const { date, ot_clotures, ot_en_cours, ot_attente, realise, a_faire, besoin, blocage, commentaire } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO comptes_rendus (user_id, date, ot_clotures, ot_en_cours, ot_attente, realise, a_faire, besoin, blocage, commentaire)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (user_id, date) DO UPDATE SET
        ot_clotures=$3, ot_en_cours=$4, ot_attente=$5,
        realise=$6, a_faire=$7, besoin=$8, blocage=$9, commentaire=$10,
        created_at=NOW()
      RETURNING *
    `, [req.user.id, date, ot_clotures||0, ot_en_cours||0, ot_attente||0, realise, a_faire, besoin, blocage, commentaire]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/comptes-rendus/:id', authMiddleware, managerOnly, async (req, res) => {
  await pool.query('DELETE FROM comptes_rendus WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// AFFECTATIONS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/affectations', authMiddleware, async (req, res) => {
  try {
    let q, params;
    if (req.user.role === 'responsable') {
      q = `SELECT a.*, u.nom as tech_nom, u.login as tech_login
           FROM affectations a JOIN users u ON a.user_id = u.id
           WHERE ($1::date IS NULL OR a.date = $1::date)
           AND ($2::date IS NULL OR a.date >= $2::date)
           AND ($3::date IS NULL OR a.date <= $3::date)
           AND ($4::text IS NULL OR a.statut = $4::text)
           ORDER BY a.date DESC, a.priorite`;
      params = [req.query.date||null, req.query.from||null, req.query.to||null, req.query.statut||null];
    } else {
      q = `SELECT a.*, u.nom as tech_nom FROM affectations a
           JOIN users u ON a.user_id = u.id
           WHERE a.user_id = $1
           AND ($2::date IS NULL OR a.date = $2::date)
           ORDER BY a.date DESC, a.priorite`;
      params = [req.user.id, req.query.date||null];
    }
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/affectations', authMiddleware, managerOnly, async (req, res) => {
  const { user_id, date, deadline, tache, ot, atelier, priorite, note_resp } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO affectations (user_id, created_by, date, deadline, tache, ot, atelier, priorite, note_resp)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [user_id, req.user.id, date, deadline||null, tache, ot||null, atelier||null, priorite||'Moyenne', note_resp||null]);
    const af = r.rows[0];

    // Notif push
    try {
      const sub = await pool.query('SELECT subscription FROM push_subs WHERE user_id=$1', [user_id]);
      if (sub.rows.length) {
        const dl = deadline ? ` — Deadline : ${deadline}` : '';
        await webpush.sendNotification(sub.rows[0].subscription, JSON.stringify({
          title: '📋 Nouvelle affectation',
          body:  `${tache}${dl}`,
          url:   '/'
        }));
      }
    } catch {}

    res.json(af);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/affectations/:id', authMiddleware, async (req, res) => {
  const allowed = req.user.role === 'responsable'
    ? ['statut', 'priorite', 'deadline', 'note_resp', 'cr_ot']
    : ['statut', 'cr_ot'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (!Object.keys(updates).length) return res.json({ ok: true });
  const sets   = Object.keys(updates).map((k, i) => `${k}=$${i+2}`).join(',');
  const vals   = Object.values(updates);
  const r = await pool.query(`UPDATE affectations SET ${sets} WHERE id=$1 RETURNING *`, [req.params.id, ...vals]);
  res.json(r.rows[0]);
});

app.delete('/api/affectations/:id', authMiddleware, managerOnly, async (req, res) => {
  await pool.query('DELETE FROM affectations WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// USERS (responsable uniquement)
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/users', authMiddleware, managerOnly, async (req, res) => {
  const r = await pool.query('SELECT id, login, nom, role, actif FROM users ORDER BY role, nom');
  res.json(r.rows);
});

// ════════════════════════════════════════════════════════════════════════════════
// STOCK PIÈCES
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/stock', authMiddleware, async (req, res) => {
  const r = await pool.query('SELECT * FROM stock_pieces ORDER BY designation');
  res.json(r.rows);
});

app.post('/api/stock', authMiddleware, managerOnly, async (req, res) => {
  const { reference, designation, marque, categorie, stock_actuel, stock_min, unite, emplacement, fournisseur, prix_unitaire } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO stock_pieces (reference, designation, marque, categorie, stock_actuel, stock_min, unite, emplacement, fournisseur, prix_unitaire)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [reference, designation, marque||null, categorie||null, stock_actuel||0, stock_min||0, unite||'pcs', emplacement||null, fournisseur||null, prix_unitaire||null]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/stock/:id', authMiddleware, managerOnly, async (req, res) => {
  const { reference, designation, marque, categorie, stock_actuel, stock_min, unite, emplacement, fournisseur, prix_unitaire } = req.body;
  const r = await pool.query(`
    UPDATE stock_pieces SET reference=$2,designation=$3,marque=$4,categorie=$5,
    stock_actuel=$6,stock_min=$7,unite=$8,emplacement=$9,fournisseur=$10,prix_unitaire=$11
    WHERE id=$1 RETURNING *
  `, [req.params.id, reference, designation, marque||null, categorie||null, stock_actuel||0, stock_min||0, unite||'pcs', emplacement||null, fournisseur||null, prix_unitaire||null]);
  res.json(r.rows[0]);
});

app.delete('/api/stock/:id', authMiddleware, managerOnly, async (req, res) => {
  await pool.query('DELETE FROM stock_pieces WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/mouvements', authMiddleware, async (req, res) => {
  const r = await pool.query(`
    SELECT m.*, p.designation, p.unite, u.nom as user_nom
    FROM mouvements_stock m
    JOIN stock_pieces p ON m.piece_id = p.id
    JOIN users u ON m.user_id = u.id
    ORDER BY m.created_at DESC LIMIT 100
  `);
  res.json(r.rows);
});

app.post('/api/mouvements', authMiddleware, async (req, res) => {
  const { piece_id, type, quantite, motif, ot, equipement } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sign = type === 'sortie' ? -1 : 1;
    await client.query('UPDATE stock_pieces SET stock_actuel=stock_actuel+$1 WHERE id=$2', [sign * quantite, piece_id]);
    const r = await client.query(`
      INSERT INTO mouvements_stock (piece_id, user_id, type, quantite, motif, ot, equipement)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [piece_id, req.user.id, type, quantite, motif||null, ot||null, equipement||null]);
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ════════════════════════════════════════════════════════════════════════════════
// BASE DE CONNAISSANCES
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/equipements', authMiddleware, async (req, res) => {
  const r = await pool.query('SELECT * FROM equipements ORDER BY atelier, nom');
  res.json(r.rows);
});

app.post('/api/equipements', authMiddleware, managerOnly, async (req, res) => {
  const { nom, atelier, categorie, marque, modele, mise_en_service } = req.body;
  const r = await pool.query(`
    INSERT INTO equipements (nom, atelier, categorie, marque, modele, mise_en_service)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [nom, atelier||null, categorie||null, marque||null, modele||null, mise_en_service||null]);
  res.json(r.rows[0]);
});

app.get('/api/procedures', authMiddleware, async (req, res) => {
  const q = req.query.equipement_id
    ? 'SELECT * FROM procedures WHERE equipement_id=$1 ORDER BY type, titre'
    : 'SELECT * FROM procedures ORDER BY type, titre';
  const r = await pool.query(q, req.query.equipement_id ? [req.query.equipement_id] : []);
  res.json(r.rows);
});

app.post('/api/procedures', authMiddleware, managerOnly, async (req, res) => {
  const { equipement_id, titre, type, contenu } = req.body;
  const r = await pool.query(`
    INSERT INTO procedures (equipement_id, titre, type, contenu, created_by)
    VALUES ($1,$2,$3,$4,$5) RETURNING *
  `, [equipement_id, titre, type||null, contenu||null, req.user.id]);
  res.json(r.rows[0]);
});

app.put('/api/procedures/:id', authMiddleware, managerOnly, async (req, res) => {
  const { titre, type, contenu } = req.body;
  const r = await pool.query('UPDATE procedures SET titre=$2,type=$3,contenu=$4 WHERE id=$1 RETURNING *', [req.params.id, titre, type||null, contenu||null]);
  res.json(r.rows[0]);
});

app.delete('/api/procedures/:id', authMiddleware, managerOnly, async (req, res) => {
  await pool.query('DELETE FROM procedures WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// RAPPORTS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/rapport', authMiddleware, managerOnly, async (req, res) => {
  const { type, debut, fin } = req.query;
  try {
    const cr = await pool.query(`
      SELECT u.nom, SUM(cr.ot_clotures) as total_clotures,
             SUM(cr.ot_en_cours) as total_en_cours,
             COUNT(cr.id) as jours_renseignes
      FROM comptes_rendus cr JOIN users u ON cr.user_id = u.id
      WHERE cr.date BETWEEN $1 AND $2
      GROUP BY u.nom ORDER BY u.nom
    `, [debut, fin]);

    const af = await pool.query(`
      SELECT u.nom,
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE a.statut='Terminé') as terminees,
             COUNT(*) FILTER (WHERE a.statut='En cours') as en_cours,
             COUNT(*) FILTER (WHERE a.deadline < NOW()::date AND a.statut != 'Terminé') as retard
      FROM affectations a JOIN users u ON a.user_id = u.id
      WHERE a.date BETWEEN $1 AND $2
      GROUP BY u.nom ORDER BY u.nom
    `, [debut, fin]);

    const ruptures = await pool.query(`
      SELECT designation, stock_actuel, stock_min, unite
      FROM stock_pieces WHERE stock_actuel <= stock_min ORDER BY designation
    `);

    res.json({ cr: cr.rows, affectations: af.rows, ruptures: ruptures.rows, periode: { debut, fin, type } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/vapid-public-key', (req, res) => res.json({ publicKey: vapidKeys.publicKey }));

app.post('/api/subscribe', authMiddleware, async (req, res) => {
  const { subscription } = req.body;
  await pool.query(`
    INSERT INTO push_subs (user_id, subscription) VALUES ($1,$2)
    ON CONFLICT (user_id) DO UPDATE SET subscription=$2
  `, [req.user.id, subscription]);
  res.json({ ok: true });
});

// ── Vérification deadlines toutes les heures ──────────────────────────────────
async function checkDeadlines() {
  try {
    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const afs = await pool.query(`
      SELECT a.*, ps.subscription FROM affectations a
      JOIN push_subs ps ON a.user_id = ps.user_id
      WHERE a.statut != 'Terminé' AND a.deadline IS NOT NULL
    `);
    for (const af of afs.rows) {
      let title, body;
      if (af.deadline === today)     { title = '⏰ Deadline aujourd\'hui !'; body = `"${af.tache}" doit être terminée aujourd'hui.`; }
      else if (af.deadline === tomorrow) { title = '📅 Deadline demain'; body = `Rappel : "${af.tache}" doit être terminée demain.`; }
      else if (af.deadline < today)  { title = '🚨 Deadline dépassée !'; body = `"${af.tache}" est en retard depuis le ${af.deadline}.`; }
      else continue;
      try { await webpush.sendNotification(af.subscription, JSON.stringify({ title, body, url: '/' })); } catch {}
    }
  } catch {}
}
setInterval(checkDeadlines, 3600000);
setTimeout(checkDeadlines, 5000);

// ════════════════════════════════════════════════════════════════════════════════
// DÉMARRAGE
// ════════════════════════════════════════════════════════════════════════════════
initDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ✅  MaintenanceOps V2 en ligne sur le port ${PORT}\n`);
  });
});
