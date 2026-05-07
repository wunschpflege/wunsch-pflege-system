const express = require('express');
const router  = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/index');

const ADM    = ['admin','geschaeftsfuehrung'];
const ADM_VW = ['admin','geschaeftsfuehrung','verwaltung'];
const PFLEGE = ['admin','geschaeftsfuehrung','stationsleitung','pflegekraft','verwaltung'];
const BUCH   = ['admin','geschaeftsfuehrung','buchhaltung','verwaltung'];

router.post('/auth/login',              c.login);
router.post('/auth/register',           authenticate, authorize('admin'), c.register);
router.get( '/auth/me',                 authenticate, c.me);
router.post('/auth/passwort-aendern',   authenticate, c.passwortAendern);

router.get(   '/benutzer',                    authenticate, authorize(...ADM), c.benutzerGetAll);
router.patch( '/benutzer/:id',                authenticate, authorize('admin'), c.benutzerUpdate);
router.post(  '/benutzer/:id/passwort-reset', authenticate, authorize('admin'), c.benutzerPasswortReset);

router.get('/dashboard',  authenticate, c.dashboard);
router.get('/bezirke',    authenticate, c.bezirkeGetAll);
router.get('/leistungen', authenticate, c.leistungenGetAll);

router.get(   '/patienten',           authenticate, c.patientenGetAll);
router.get(   '/patienten/statistik', authenticate, c.patientStatistik);
router.get(   '/patienten/:id',       authenticate, c.patientGetOne);
router.post(  '/patienten',           authenticate, authorize(...PFLEGE), c.patientCreate);
router.patch( '/patienten/:id',       authenticate, authorize(...PFLEGE), c.patientUpdate);

router.get(   '/touren',              authenticate, c.tourenGetAll);
router.get(   '/touren/statistik',    authenticate, c.tourTagesstatistik);
router.post(  '/touren',              authenticate, authorize(...ADM_VW,'stationsleitung'), c.tourCreate);
router.patch( '/touren/:id/status',   authenticate, c.tourStatus);

router.get(  '/mitarbeiter',              authenticate, c.maGetAll);
router.get(  '/mitarbeiter/verfuegbar',   authenticate, c.maVerfuegbar);
router.post( '/mitarbeiter',              authenticate, authorize(...ADM_VW), c.maCreate);

router.get(   '/dokumentation',        authenticate, c.dokuGetAll);
router.get(   '/dokumentation/quote',  authenticate, c.dokuQuote);
router.get(   '/dokumentation/:id',    authenticate, c.dokuGetOne);
router.post(  '/dokumentation',        authenticate, c.dokuCreate);
router.patch( '/dokumentation/:id',    authenticate, c.dokuUpdate);
router.post(  '/leistungserfassung',   authenticate, c.leistungCreate);

router.get(   '/medikamente',                 authenticate, c.mediGetAll);
router.post(  '/medikamente',                 authenticate, authorize(...ADM_VW,'stationsleitung'), c.mediCreate);
router.get(   '/medikamente/bestand',          authenticate, c.mediGetBestand);
router.post(  '/medikamente/bestand',          authenticate, authorize(...ADM_VW,'stationsleitung'), c.mediBestandCreate);
router.patch( '/medikamente/bestand/:id',      authenticate, authorize(...ADM_VW,'stationsleitung'), c.mediBestandUpdate);
router.post(  '/medikamente/vergabe',          authenticate, c.mediVergabe);
router.get(   '/medikamente/vergaben/:id',     authenticate, c.mediVergabenGetPatient);
router.get(   '/medikamente/nachbestellung',   authenticate, c.mediNachbestellung);
router.get(   '/medikamente/btm-nachweis',     authenticate, authorize(...ADM_VW,'stationsleitung'), c.mediBtmNachweis);

router.get(   '/dienstplan',                   authenticate, c.dienstplanGetWoche);
router.post(  '/dienstplan',                   authenticate, authorize(...ADM_VW,'stationsleitung'), c.dienstplanCreate);
router.delete('/dienstplan/:id',               authenticate, authorize(...ADM_VW,'stationsleitung'), c.dienstplanDelete);
router.post(  '/dienstplan/generieren',        authenticate, authorize(...ADM,'stationsleitung'), c.dienstplanGenerieren);
router.get(   '/dienstplan/stunden',           authenticate, authorize(...ADM_VW), c.stundenUebersicht);
router.get(   '/abwesenheiten',                authenticate, c.abwesenheitGetAll);
router.post(  '/abwesenheiten',                authenticate, c.abwesenheitCreate);
router.patch( '/abwesenheiten/:id/genehmigen', authenticate, authorize(...ADM,'stationsleitung'), c.abwesenheitGenehmigen);

router.get(   '/abrechnung/monat',             authenticate, authorize(...BUCH), c.abrMonat);
router.get(   '/abrechnung/jahr',              authenticate, authorize(...BUCH), c.abrJahr);
router.get(   '/abrechnung/export',            authenticate, authorize(...BUCH), c.abrExport);
router.post(  '/abrechnung',                   authenticate, authorize(...BUCH), c.abrCreate);
router.patch( '/abrechnung/:id/status',        authenticate, authorize(...BUCH), c.abrStatus);
router.post(  '/abrechnung/einreichen',        authenticate, authorize(...BUCH), c.abrEinreichen);

router.get(  '/wohngemeinschaften',  authenticate, c.wgGetAll);
router.post( '/wohngemeinschaften',  authenticate, authorize(...ADM), c.wgCreate);

module.exports = router;

// ── ARCHIV & DSGVO ──
const archiv = require('../controllers/archiv');
const ADM_DSB = ['admin','geschaeftsfuehrung'];

router.get(   '/archiv/uebersicht',              authenticate, authorize(...ADM_DSB), archiv.archivUebersicht);
router.get(   '/archiv/patienten',               authenticate, authorize(...ADM_DSB,'stationsleitung'), archiv.archivPatientenGetAll);
router.post(  '/archiv/patient/:id',             authenticate, authorize(...ADM_DSB,'stationsleitung'), archiv.patientArchivieren);
router.post(  '/archiv/patient/:id/freigabe',    authenticate, authorize(...ADM_DSB), archiv.loeschFreigabe);
router.delete('/archiv/patient/:id',             authenticate, authorize('admin','geschaeftsfuehrung'), archiv.endgueltigLoeschen);
router.get(   '/archiv/loeschprotokoll',         authenticate, authorize(...ADM_DSB), archiv.loeschprotokollGetAll);
router.get(   '/archiv/bericht',                 authenticate, authorize(...ADM_DSB), archiv.archivBericht);
router.get(   '/archiv/anfragen',                authenticate, authorize(...ADM_DSB), archiv.anfragenGetAll);
router.post(  '/archiv/anfragen',                authenticate, archiv.anfragCreate);
router.patch( '/archiv/anfragen/:id',            authenticate, authorize(...ADM_DSB), archiv.anfragBeantworten);
router.post(  '/archiv/datenpanne',              authenticate, archiv.datenpanneMelden);

module.exports = router;

// ── KOSTENTRÄGER & ERWEITERUNGEN v5 ──
const db = require('../../config/database');

router.get('/kostentraeger', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM kostentraeger WHERE aktiv=true ORDER BY name');
    res.json({ kostentraeger: rows });
  } catch(e) { next(e); }
});

router.post('/kostentraeger', async (req, res, next) => {
  try {
    const { name, kuerzel, typ, ik_nummer, telefon, fax, email } = req.body;
    const { rows } = await db.query(
      `INSERT INTO kostentraeger(name,kuerzel,typ,ik_nummer,telefon,fax,email) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, kuerzel, typ||'krankenkasse', ik_nummer, telefon, fax, email]
    );
    res.status(201).json({ kostentraeger: rows[0] });
  } catch(e) { next(e); }
});

router.get('/patienten/:id/kontakte', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM patient_kontakte WHERE patient_id=$1 ORDER BY sortierung', [req.params.id]);
    res.json({ kontakte: rows });
  } catch(e) { next(e); }
});

router.get('/patienten/:id/aerzte', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM patient_aerzte WHERE patient_id=$1 ORDER BY sortierung', [req.params.id]);
    res.json({ aerzte: rows });
  } catch(e) { next(e); }
});

router.get('/patienten/:id/kostentraeger', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM patient_kostentraeger WHERE patient_id=$1 ORDER BY sortierung', [req.params.id]);
    res.json({ kostentraeger: rows });
  } catch(e) { next(e); }
});

router.get('/patienten/:id/leistungsauftraege', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM leistungsauftraege WHERE patient_id=$1 ORDER BY erstellt_am DESC', [req.params.id]);
    res.json({ leistungsauftraege: rows });
  } catch(e) { next(e); }
});

router.get('/mitarbeiter/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT m.*,b.name AS bezirk,wg.name AS wg_name FROM mitarbeiter m LEFT JOIN bezirke b ON m.bezirk_id=b.id LEFT JOIN wohngemeinschaften wg ON m.wg_id=wg.id WHERE m.id=$1`,[req.params.id]);
    if(!rows.length) return res.status(404).json({error:'Nicht gefunden'});
    const [fz, ger, abw] = await Promise.all([
      db.query('SELECT * FROM ma_fahrzeuge WHERE mitarbeiter_id=$1 AND aktiv=true',[req.params.id]),
      db.query('SELECT * FROM ma_geraete WHERE mitarbeiter_id=$1 AND aktiv=true',[req.params.id]),
      db.query('SELECT * FROM abwesenheiten WHERE mitarbeiter_id=$1 ORDER BY von_datum DESC LIMIT 10',[req.params.id]),
    ]);
    res.json({ mitarbeiter:rows[0], fahrzeuge:fz.rows, geraete:ger.rows, abwesenheiten:abw.rows });
  } catch(e) { next(e); }
});

router.patch('/mitarbeiter/:id', async (req, res, next) => {
  try {
   const felder=['vorname','nachname','handzeichen','telefon1','telefon2','mobiltelefon','telefax','email','qualifikation','beschaeftigung','stunden_woche','ist_pflegekraft','ist_springer','bezirk_id','wg_id','bemerkungen','notizen','status','aktiv','strasse','plz','ort','geburtsdatum','geschlecht','beschaeftigungsnummer','eintrittsdatum','austrittsdatum','austritt_grund','pflegeteam','personal_nr','steuerklasse','anzahl_kinder','steuer_id','krankenkasse','versicherten_nr','sozialversicherung_nr','iban','bic','blz','bank_name','konto_nr','freibetrag','stundenlohn','monatsgehalt','geburtsname','geburtsort','geburtsland','familienstand','nationalitaet','sprache','konfession','externe_id','berufsabschluss','taetigkeit_ambulant','urlaubstage','zeiterfassung_transponder','ki_ueberstunden_vermeiden','startort_ist_adresse','tour_typ','sortierkennzeichen','lobu_ausschluss','stundensatz_woche','stundensatz_sa','stundensatz_so','stundensatz_vfe','stundensatz_fe','stundensatz_nacht'];
    const upd=[],params=[];
    felder.forEach(f=>{if(req.body[f]!==undefined){params.push(req.body[f]);upd.push(`${f}=$${params.length}`);}});
    if(!upd.length) return res.status(400).json({error:'Keine Felder'});
    params.push(req.params.id); upd.push('aktualisiert_am=NOW()');
    const { rows } = await db.query(`UPDATE mitarbeiter SET ${upd.join(',')} WHERE id=$${params.length} RETURNING *`,params);
    res.json({ mitarbeiter: rows[0] });
  } catch(e) { next(e); }
});

module.exports = router;
