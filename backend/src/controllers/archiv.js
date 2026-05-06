const db = require('../../config/database');

// ── ARCHIV-ÜBERSICHT ──
const archivUebersicht = async (req, res, next) => {
  try {
    const [faellig, loeschung, anfragen, protokoll] = await Promise.all([
      db.query(`SELECT COUNT(*) AS anzahl FROM v_archivierung_faellig WHERE status != 'OK'`),
      db.query(`SELECT COUNT(*) AS anzahl FROM v_loeschung_faellig`),
      db.query(`SELECT COUNT(*) FILTER(WHERE status='offen') AS offen, COUNT(*) FILTER(WHERE faellig_bis < NOW() AND status='offen') AS ueberfaellig FROM archiv_anfragen`),
      db.query(`SELECT COUNT(*) AS gesamt, MAX(geloescht_am) AS letzte_loeschung FROM loeschprotokoll`),
    ]);
    res.json({
      archivierung_faellig: parseInt(faellig.rows[0].anzahl),
      loeschung_faellig:    parseInt(loeschung.rows[0].anzahl),
      anfragen:             anfragen.rows[0],
      loeschprotokoll:      protokoll.rows[0],
    });
  } catch(e) { next(e); }
};

// ── PATIENT ARCHIVIEREN ──
const patientArchivieren = async (req, res, next) => {
  try {
    const { grund } = req.body;
    const { rows } = await db.query(`
      UPDATE patienten
      SET aktiv = false,
          archiviert_am = NOW(),
          archiv_grund = $1,
          aktualisiert_am = NOW()
      WHERE id = $2
      RETURNING id, pat_nummer, vorname, nachname, archiviert_am
    `, [grund || 'Pflegebeziehung beendet', req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Patient nicht gefunden' });

    // Dokumentationen ebenfalls archivieren
    await db.query(`UPDATE dokumentationen SET archiviert_am = NOW() WHERE patient_id = $1 AND archiviert_am IS NULL`, [req.params.id]);
    await db.query(`UPDATE abrechnungen SET archiviert_am = NOW() WHERE patient_id = $1 AND archiviert_am IS NULL`, [req.params.id]);

    res.json({ patient: rows[0], message: 'Patient archiviert — Daten werden 10 Jahre aufbewahrt' });
  } catch(e) { next(e); }
};

// ── ARCHIVIERTE PATIENTEN ABRUFEN ──
const archivPatientenGetAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, suche } = req.query;
    const offset = (page - 1) * limit;
    const params = [], where = ['p.aktiv = false', 'p.archiviert_am IS NOT NULL'];
    if (suche) {
      params.push(`%${suche}%`);
      where.push(`(p.vorname ILIKE $${params.length} OR p.nachname ILIKE $${params.length} OR p.pat_nummer ILIKE $${params.length})`);
    }
    const w = where.join(' AND ');
    const [data, count] = await Promise.all([
      db.query(`
        SELECT p.id, p.pat_nummer, p.vorname, p.nachname, p.pflegegrad,
          p.entlassdatum, p.archiviert_am, p.archiv_grund, p.loeschfreigabe_am,
          DATE_PART('year', AGE(p.archiviert_am))::INT AS archiviert_vor_jahren,
          CASE WHEN p.archiviert_am < NOW() - INTERVAL '10 years' THEN true ELSE false END AS loeschung_faellig
        FROM patienten p WHERE ${w}
        ORDER BY p.archiviert_am DESC
        LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(offset)}
      `, params),
      db.query(`SELECT COUNT(*) FROM patienten p WHERE ${w}`, params.slice(0, -2)),
    ]);
    res.json({
      patienten: data.rows,
      gesamt:    parseInt(count.rows[0].count),
      seite:     parseInt(page),
      seiten:    Math.ceil(count.rows[0].count / limit),
    });
  } catch(e) { next(e); }
};

// ── LÖSCHFREIGABE ──
const loeschFreigabe = async (req, res, next) => {
  try {
    // 4-Augen-Prinzip: Nur GF oder Admin darf freigeben
    const { rows } = await db.query(`
      UPDATE patienten
      SET loeschfreigabe_am = NOW(),
          loeschfreigabe_von = $1
      WHERE id = $2
        AND archiviert_am < NOW() - INTERVAL '10 years'
        AND loeschfreigabe_am IS NULL
      RETURNING id, pat_nummer, vorname, nachname
    `, [req.user.id, req.params.id]);

    if (!rows.length) return res.status(400).json({ error: 'Freigabe nicht möglich — Frist noch nicht abgelaufen oder bereits freigegeben' });

    res.json({ message: 'Löschfreigabe erteilt', patient: rows[0] });
  } catch(e) { next(e); }
};

// ── ENDGÜLTIG LÖSCHEN (nach Freigabe) ──
const endgueltigLoeschen = async (req, res, next) => {
  try {
    // Prüfen ob Freigabe vorhanden
    const { rows: check } = await db.query(`
      SELECT id, pat_nummer, vorname, nachname, loeschfreigabe_am, loeschfreigabe_von
      FROM patienten WHERE id = $1
    `, [req.params.id]);

    if (!check.length) return res.status(404).json({ error: 'Patient nicht gefunden' });
    if (!check[0].loeschfreigabe_am) return res.status(403).json({ error: 'Keine Löschfreigabe vorhanden' });

    const pat = check[0];
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Protokoll-Eintrag vor der Löschung
      await client.query(`
        INSERT INTO loeschprotokoll (tabelle, datensatz_id, kategorie, beschreibung, geloescht_von, aufbewahrungsfrist_jahre, archiviert_seit, freigegeben_von)
        VALUES ('patienten', $1, 'Patientenakte', $2, $3, 10, $4, $5)
      `, [pat.id, `${pat.vorname} ${pat.nachname} (${pat.pat_nummer})`, req.user.id, pat.loeschfreigabe_am, pat.loeschfreigabe_von]);

      // Abhängige Daten löschen
      await client.query(`DELETE FROM tour_patienten WHERE patient_id = $1`, [pat.id]);
      await client.query(`DELETE FROM medikament_vergaben WHERE patient_id = $1`, [pat.id]);
      await client.query(`DELETE FROM patient_medikamentenplan WHERE patient_id = $1`, [pat.id]);
      await client.query(`DELETE FROM dokumentationen WHERE patient_id = $1`, [pat.id]);
      await client.query(`DELETE FROM abrechnungen WHERE patient_id = $1`, [pat.id]);
      await client.query(`DELETE FROM kontaktpersonen WHERE patient_id = $1`, [pat.id]);
      await client.query(`DELETE FROM einwilligungen WHERE patient_id = $1`, [pat.id]);
      await client.query(`DELETE FROM patienten WHERE id = $1`, [pat.id]);

      await client.query('COMMIT');
      res.json({ message: 'Patient endgültig gelöscht — Löschprotokoll erstellt', pat_nummer: pat.pat_nummer });
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch(e) { next(e); }
};

// ── LÖSCHPROTOKOLL ABRUFEN ──
const loeschprotokollGetAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const [data, count] = await Promise.all([
      db.query(`
        SELECT lp.*, b.vorname || ' ' || b.nachname AS geloescht_von_name
        FROM loeschprotokoll lp
        LEFT JOIN benutzer b ON lp.geloescht_von = b.id
        ORDER BY lp.geloescht_am DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset]),
      db.query(`SELECT COUNT(*) FROM loeschprotokoll`),
    ]);
    res.json({ protokoll: data.rows, gesamt: parseInt(count.rows[0].count), seite: parseInt(page), seiten: Math.ceil(count.rows[0].count / limit) });
  } catch(e) { next(e); }
};

// ── BETROFFENENANFRAGEN ──
const anfragenGetAll = async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT a.*, b.vorname || ' ' || b.nachname AS bearbeiter
      FROM archiv_anfragen a
      LEFT JOIN benutzer b ON a.bearbeitet_von = b.id
      ORDER BY a.eingegangen_am DESC
    `);
    res.json({ anfragen: rows });
  } catch(e) { next(e); }
};

const anfragCreate = async (req, res, next) => {
  try {
    const { typ, betroffener, betroffener_id, beschreibung } = req.body;
    const { rows } = await db.query(`
      INSERT INTO archiv_anfragen (typ, betroffener, betroffener_id, beschreibung)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [typ, betroffener, betroffener_id, beschreibung]);
    res.status(201).json({ anfrage: rows[0] });
  } catch(e) { next(e); }
};

const anfragBeantworten = async (req, res, next) => {
  try {
    const { antwort, status } = req.body;
    const { rows } = await db.query(`
      UPDATE archiv_anfragen
      SET antwort = $1, status = $2, bearbeitet_von = $3, bearbeitet_am = NOW()
      WHERE id = $4 RETURNING *
    `, [antwort, status || 'beantwortet', req.user.id, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    res.json({ anfrage: rows[0] });
  } catch(e) { next(e); }
};

// ── DATENPANNE MELDEN ──
const datenpanneMelden = async (req, res, next) => {
  try {
    const { entdeckt_am, beschreibung, betroffene_daten, betroffene_personen, massnahmen } = req.body;
    const { rows } = await db.query(`
      INSERT INTO datenpannen (entdeckt_am, beschreibung, betroffene_daten, betroffene_personen, massnahmen, bearbeiter_id)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [entdeckt_am, beschreibung, betroffene_daten, betroffene_personen || 0, massnahmen, req.user.id]);
    res.status(201).json({
      datenpanne: rows[0],
      hinweis: 'WICHTIG: Datenpannen müssen innerhalb von 72 Stunden an die zuständige Datenschutzbehörde gemeldet werden (Art. 33 DSGVO)!',
    });
  } catch(e) { next(e); }
};

// ── ARCHIV-BERICHT (Jahresbericht) ──
const archivBericht = async (req, res, next) => {
  try {
    const [gesamt, archiviert, geloescht, faellig, anfragen] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM patienten WHERE aktiv = true`),
      db.query(`SELECT COUNT(*) FROM patienten WHERE archiviert_am IS NOT NULL`),
      db.query(`SELECT COUNT(*), MAX(geloescht_am) AS letzte FROM loeschprotokoll`),
      db.query(`SELECT COUNT(*) FROM v_loeschung_faellig`),
      db.query(`SELECT COUNT(*) FILTER(WHERE status='offen') AS offen, COUNT(*) AS gesamt FROM archiv_anfragen`),
    ]);
    res.json({
      erstellt_am:       new Date().toISOString(),
      patienten_aktiv:   parseInt(gesamt.rows[0].count),
      patienten_archiv:  parseInt(archiviert.rows[0].count),
      loeschungen:       geloescht.rows[0],
      loeschung_faellig: parseInt(faellig.rows[0].count),
      anfragen:          anfragen.rows[0],
    });
  } catch(e) { next(e); }
};

module.exports = {
  archivUebersicht,
  patientArchivieren,
  archivPatientenGetAll,
  loeschFreigabe,
  endgueltigLoeschen,
  loeschprotokollGetAll,
  anfragenGetAll,
  anfragCreate,
  anfragBeantworten,
  datenpanneMelden,
  archivBericht,
};
