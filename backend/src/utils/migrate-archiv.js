/**
 * Wunsch-Pflege GmbH — Archiv-Migration
 * DSGVO-konformes Archiv- und Löschsystem
 * Ausführen: node src/utils/migrate-archiv.js
 */
require('dotenv').config();
const db = require('../../config/database');

const sql = `
-- ── ARCHIV-FELDER in bestehende Tabellen ──
ALTER TABLE patienten
  ADD COLUMN IF NOT EXISTS archiviert_am    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archiv_grund     TEXT,
  ADD COLUMN IF NOT EXISTS loeschfreigabe_am TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS loeschfreigabe_von UUID REFERENCES benutzer(id);

ALTER TABLE mitarbeiter
  ADD COLUMN IF NOT EXISTS archiviert_am    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archiv_grund     TEXT;

ALTER TABLE dokumentationen
  ADD COLUMN IF NOT EXISTS archiviert_am    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS loeschfreigabe_am TIMESTAMPTZ;

ALTER TABLE abrechnungen
  ADD COLUMN IF NOT EXISTS archiviert_am    TIMESTAMPTZ;

-- ── LÖSCHPROTOKOLL ──
CREATE TABLE IF NOT EXISTS loeschprotokoll (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tabelle         VARCHAR(100) NOT NULL,
  datensatz_id    UUID NOT NULL,
  kategorie       VARCHAR(100),
  beschreibung    TEXT,
  geloescht_am    TIMESTAMPTZ DEFAULT NOW(),
  geloescht_von   UUID REFERENCES benutzer(id),
  aufbewahrungsfrist_jahre INTEGER,
  archiviert_seit TIMESTAMPTZ,
  freigegeben_von UUID REFERENCES benutzer(id),
  erstellt_am     TIMESTAMPTZ DEFAULT NOW()
);

-- ── ARCHIV-ANFRAGEN (Betroffenenrechte) ──
CREATE TABLE IF NOT EXISTS archiv_anfragen (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  typ             VARCHAR(50) NOT NULL,
  betroffener     VARCHAR(200),
  betroffener_id  UUID,
  beschreibung    TEXT,
  status          VARCHAR(30) DEFAULT 'offen',
  eingegangen_am  TIMESTAMPTZ DEFAULT NOW(),
  faellig_bis     TIMESTAMPTZ GENERATED ALWAYS AS (eingegangen_am + INTERVAL '30 days') STORED,
  bearbeitet_von  UUID REFERENCES benutzer(id),
  bearbeitet_am   TIMESTAMPTZ,
  antwort         TEXT,
  erstellt_am     TIMESTAMPTZ DEFAULT NOW()
);

-- ── DATENPANNE-REGISTER ──
CREATE TABLE IF NOT EXISTS datenpannen (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entdeckt_am     TIMESTAMPTZ NOT NULL,
  beschreibung    TEXT NOT NULL,
  betroffene_daten TEXT,
  betroffene_personen INTEGER DEFAULT 0,
  massnahmen      TEXT,
  gemeldet_behoerde BOOLEAN DEFAULT false,
  gemeldet_am     TIMESTAMPTZ,
  bearbeiter_id   UUID REFERENCES benutzer(id),
  status          VARCHAR(30) DEFAULT 'offen',
  erstellt_am     TIMESTAMPTZ DEFAULT NOW()
);

-- ── EINWILLIGUNGEN ──
CREATE TABLE IF NOT EXISTS einwilligungen (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id      UUID REFERENCES patienten(id),
  mitarbeiter_id  UUID REFERENCES mitarbeiter(id),
  zweck           VARCHAR(200) NOT NULL,
  erteilt_am      TIMESTAMPTZ DEFAULT NOW(),
  widerrufen_am   TIMESTAMPTZ,
  widerruf_grund  TEXT,
  erstellt_von    UUID REFERENCES benutzer(id),
  erstellt_am     TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDIZES ──
CREATE INDEX IF NOT EXISTS idx_pat_archiv   ON patienten(archiviert_am) WHERE archiviert_am IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pat_entlass  ON patienten(entlassdatum)  WHERE entlassdatum IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ma_archiv    ON mitarbeiter(archiviert_am) WHERE archiviert_am IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loeschprot   ON loeschprotokoll(geloescht_am);
CREATE INDEX IF NOT EXISTS idx_anfragen     ON archiv_anfragen(status, faellig_bis);

-- ── VIEW: Patienten die archiviert werden müssen ──
CREATE OR REPLACE VIEW v_archivierung_faellig AS
SELECT
  p.id, p.pat_nummer, p.vorname, p.nachname,
  p.entlassdatum,
  p.archiviert_am,
  DATE_PART('year', AGE(COALESCE(p.entlassdatum, NOW()::date))) AS jahre_seit_entlassung,
  CASE
    WHEN p.archiviert_am IS NULL AND p.entlassdatum IS NOT NULL
      AND p.entlassdatum < NOW() - INTERVAL '1 day'
    THEN 'Archivierung faellig'
    WHEN p.archiviert_am IS NOT NULL
      AND p.archiviert_am < NOW() - INTERVAL '10 years'
      AND p.loeschfreigabe_am IS NULL
    THEN 'Loeschung faellig (10 Jahre erreicht)'
    ELSE 'OK'
  END AS status
FROM patienten p
WHERE p.aktiv = false
  OR p.archiviert_am IS NOT NULL
ORDER BY p.entlassdatum;

-- ── VIEW: Löschfällige Datensätze ──
CREATE OR REPLACE VIEW v_loeschung_faellig AS
SELECT 'patient' AS typ, id, vorname || ' ' || nachname AS name,
  archiviert_am, loeschfreigabe_am,
  EXTRACT(YEAR FROM AGE(archiviert_am))::INT AS archiviert_vor_jahren,
  10 AS aufbewahrung_jahre
FROM patienten
WHERE archiviert_am IS NOT NULL
  AND archiviert_am < NOW() - INTERVAL '10 years'
  AND loeschfreigabe_am IS NULL
UNION ALL
SELECT 'mitarbeiter', id, vorname || ' ' || nachname,
  archiviert_am, NULL,
  EXTRACT(YEAR FROM AGE(archiviert_am))::INT,
  10
FROM mitarbeiter
WHERE archiviert_am IS NOT NULL
  AND archiviert_am < NOW() - INTERVAL '10 years';
`;

async function migrate() {
  console.log('🗄️  Starte Archiv-Migration …');
  try {
    await db.query(sql);
    console.log('✅  Archiv-System eingerichtet!');
    console.log('');
    console.log('Neue Tabellen:');
    console.log('  ✓  loeschprotokoll   — Nachweis aller Löschungen');
    console.log('  ✓  archiv_anfragen   — Betroffenenrechte (DSGVO Art. 15-21)');
    console.log('  ✓  datenpannen       — Datenpanne-Register (Art. 33 DSGVO)');
    console.log('  ✓  einwilligungen    — Einwilligungsverwaltung');
    console.log('');
    console.log('Neue Views:');
    console.log('  ✓  v_archivierung_faellig  — Patienten die archiviert werden müssen');
    console.log('  ✓  v_loeschung_faellig     — Datensätze deren Frist abgelaufen ist');
  } catch(e) {
    console.error('Fehler:', e.message);
  }
  process.exit(0);
}
migrate();
