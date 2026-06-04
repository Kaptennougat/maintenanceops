const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── USERS ──────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        login      VARCHAR(50) UNIQUE NOT NULL,
        password   VARCHAR(255) NOT NULL,
        nom        VARCHAR(100) NOT NULL,
        role       VARCHAR(20) DEFAULT 'technicien',
        actif      BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── COMPTES RENDUS JOURNALIERS ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS comptes_rendus (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id),
        date       DATE NOT NULL,
        ot_clotures INTEGER DEFAULT 0,
        ot_en_cours INTEGER DEFAULT 0,
        ot_attente  INTEGER DEFAULT 0,
        realise    TEXT,
        a_faire    TEXT,
        besoin     TEXT,
        blocage    TEXT,
        commentaire TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, date)
      )
    `);

    // ── AFFECTATIONS ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS affectations (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id),
        created_by  INTEGER REFERENCES users(id),
        date        DATE NOT NULL,
        deadline    DATE,
        tache       TEXT NOT NULL,
        ot          VARCHAR(50),
        atelier     VARCHAR(100),
        priorite    VARCHAR(20) DEFAULT 'Moyenne',
        statut      VARCHAR(30) DEFAULT 'À faire',
        note_resp   TEXT,
        cr_ot       TEXT,
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── STOCK PIÈCES ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_pieces (
        id            SERIAL PRIMARY KEY,
        reference     VARCHAR(100) UNIQUE NOT NULL,
        designation   VARCHAR(255) NOT NULL,
        marque        VARCHAR(100),
        categorie     VARCHAR(50),
        stock_actuel  DECIMAL(10,2) DEFAULT 0,
        stock_min     DECIMAL(10,2) DEFAULT 0,
        unite         VARCHAR(20) DEFAULT 'pcs',
        emplacement   VARCHAR(100),
        fournisseur   VARCHAR(100),
        prix_unitaire DECIMAL(10,2),
        created_at    TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── MOUVEMENTS STOCK ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mouvements_stock (
        id          SERIAL PRIMARY KEY,
        piece_id    INTEGER REFERENCES stock_pieces(id),
        user_id     INTEGER REFERENCES users(id),
        type        VARCHAR(10) NOT NULL,
        quantite    DECIMAL(10,2) NOT NULL,
        motif       TEXT,
        ot          VARCHAR(50),
        equipement  VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── BASE DE CONNAISSANCES ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS equipements (
        id               SERIAL PRIMARY KEY,
        nom              VARCHAR(255) NOT NULL,
        atelier          VARCHAR(100),
        categorie        VARCHAR(50),
        marque           VARCHAR(100),
        modele           VARCHAR(100),
        mise_en_service  DATE,
        statut           VARCHAR(20) DEFAULT 'actif',
        created_at       TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS procedures (
        id           SERIAL PRIMARY KEY,
        equipement_id INTEGER REFERENCES equipements(id),
        titre        VARCHAR(255) NOT NULL,
        type         VARCHAR(50),
        contenu      TEXT,
        created_by   INTEGER REFERENCES users(id),
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── PUSH SUBSCRIPTIONS ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subs (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) UNIQUE,
        subscription JSONB NOT NULL,
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── MIGRATIONS (colonnes ajoutées ultérieurement) ──────────────────────────
    await client.query(`ALTER TABLE comptes_rendus ADD COLUMN IF NOT EXISTS pannes JSONB DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE affectations ADD COLUMN IF NOT EXISTS cr_realise TEXT`);
    await client.query(`ALTER TABLE affectations ADD COLUMN IF NOT EXISTS cr_resultat TEXT`);
    await client.query(`ALTER TABLE affectations ADD COLUMN IF NOT EXISTS cr_temps DECIMAL(10,2)`);
    await client.query(`ALTER TABLE affectations ADD COLUMN IF NOT EXISTS cr_pieces TEXT`);
    await client.query(`ALTER TABLE affectations ADD COLUMN IF NOT EXISTS cr_observations TEXT`);

    await client.query('COMMIT');
    console.log('✅ Base de données initialisée');

    // ── Insérer les utilisateurs par défaut ────────────────────────────────────
    await seedUsers();

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur DB:', e.message);
  } finally {
    client.release();
  }
}

async function seedUsers() {
  const bcrypt = require('bcryptjs');
  const users = [
    { login: 'AmineA',       nom: 'Amine (Responsable)',  role: 'responsable', pwd: '0701'     },
    { login: 'AbdjebbarK',   nom: 'Abdjebbar KADDARA',    role: 'technicien',  pwd: 'maint2025' },
    { login: 'NabilE',       nom: 'Nabil ELMALYANI',      role: 'technicien',  pwd: 'maint2025' },
    { login: 'HamzaM',       nom: 'Hamza MAATAOUI',       role: 'technicien',  pwd: 'maint2025' },
    { login: 'OthmanB',      nom: 'Othman BRAYM',         role: 'technicien',  pwd: 'maint2025' },
    { login: 'AbdellahA',    nom: 'Abdellah AMHLOUD',     role: 'technicien',  pwd: 'maint2025' },
    { login: 'HafidZ',       nom: 'Hafid ZNIBER',         role: 'technicien',  pwd: 'maint2025' },
    { login: 'YassineB',     nom: 'Yassine BOURIQUI',     role: 'technicien',  pwd: 'maint2025' },
    { login: 'AymenB',       nom: 'Aymen BOUKHOUBZA',     role: 'technicien',  pwd: 'maint2025' },
    { login: 'YassineE',     nom: 'Yassine ENEMILI',      role: 'technicien',  pwd: 'maint2025' },
    { login: 'AbdelhakmiA',  nom: 'Abdelhakmi AMINE',     role: 'technicien',  pwd: 'maint2025' },
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.pwd, 10);
    await pool.query(`
      INSERT INTO users (login, password, nom, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (login) DO NOTHING
    `, [u.login, hash, u.nom, u.role]);
  }
  console.log('✅ Utilisateurs créés');
}

module.exports = { pool, initDB };
