const db     = require('../../config/database');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════
const login = async (req, res, next) => {
  try {
    const { email, passwort } = req.body;
    if (!email || !passwort) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
    const { rows } = await db.query('SELECT * FROM benutzer WHERE email=$1', [email.toLowerCase().trim()]);
    const u = rows[0];
    if (!u || !u.aktiv || !(await bcrypt.compare(passwort, u.passwort_hash)))
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    await db.query('UPDATE benutzer SET letzter_login=NOW() WHERE id=$1', [u.id]);
    const token = jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, benutzer: { id:u.id, vorname:u.vorname, nachname:u.nachname, email:u.email, rolle:u.rolle } });
  } catch(e) { next(e); }
};

const register = async (req, res, next) => {
  try {
    const { email, passwort, vorname, nachname, rolle } = req.body;
    if (!email||!passwort||!vorname||!nachname) return res.status(400).json({error:'Alle Felder erforderlich'});
    const hash = await bcrypt.hash(passwort, 12);
    const { rows } = await db.query(
      `INSERT INTO benutzer(email,passwort_hash,vorname,nachname,rolle) VALUES($1,$2,$3,$4,$5) RETURNING id,vorname,nachname,email,rolle`,
      [email.toLowerCase().trim(), hash, vorname, nachname, rolle||'pflegekraft']
    );
    res.status(201).json({ benutzer: rows[0] });
  } catch(e) { next(e); }
};

const me = (req, res) => res.json({ benutzer: req.user });

const passwortAendern = async (req, res, next) => {
  try {
    const { altesPasswort, neuesPasswort } = req.body;
    const { rows } = await db.query('SELECT passwort_hash FROM benutzer WHERE id=$1', [req.user.id]);
    if (!(await bcrypt.compare(altesPasswort, rows[0].passwort_hash)))
      return res.status(400).json({error:'Altes Passwort falsch'});
    await db.query('UPDATE benutzer SET passwort_hash=$1 WHERE id=$2', [await bcrypt.hash(neuesPasswort,12), req.user.id]);
    res.json({message:'Passwort geändert'});
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// BENUTZERVERWALTUNG
// ════════════════════════════════════════
const benutzerGetAll = async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT id,vorname,nachname,email,rolle,aktiv,letzter_login,erstellt_am FROM benutzer ORDER BY nachname,vorname`);
    res.json({ benutzer: rows });
  } catch(e) { next(e); }
};

const benutzerUpdate = async (req, res, next) => {
  try {
    const { vorname, nachname, email, rolle, aktiv } = req.body;
    const { rows } = await db.query(
      `UPDATE benutzer SET vorname=COALESCE($1,vorname),nachname=COALESCE($2,nachname),email=COALESCE($3,email),rolle=COALESCE($4,rolle),aktiv=COALESCE($5,aktiv) WHERE id=$6 RETURNING id,vorname,nachname,email,rolle,aktiv`,
      [vorname, nachname, email?.toLowerCase(), rolle, aktiv, req.params.id]
    );
    if (!rows.length) return res.status(404).json({error:'Nicht gefunden'});
    res.json({ benutzer: rows[0] });
  } catch(e) { next(e); }
};

const benutzerPasswortReset = async (req, res, next) => {
  try {
    const hash = await bcrypt.hash(req.body.neuesPasswort, 12);
    await db.query('UPDATE benutzer SET passwort_hash=$1 WHERE id=$2', [hash, req.params.id]);
    res.json({message:'Passwort zurückgesetzt'});
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════
const dashboard = async (req, res, next) => {
  try {
    const heute = new Date().toISOString().split('T')[0];
    const ms = heute.substring(0,7)+'-01';
    const [pat,tour,ma,abr,wg,medi,doku] = await Promise.all([
      db.query(`SELECT COUNT(*) AS aktiv,COUNT(*) FILTER(WHERE aufnahmedatum>=NOW()-INTERVAL '7 days') AS neu FROM patienten WHERE aktiv=true`),
      db.query(`SELECT COUNT(*) AS gesamt,COUNT(*) FILTER(WHERE status='abgeschlossen') AS abgeschlossen,COUNT(*) FILTER(WHERE status='laeuft') AS laufend,COUNT(*) FILTER(WHERE status='verzoegert') AS verzoegert,COUNT(*) FILTER(WHERE status='offen') AS offen FROM touren WHERE datum=$1`,[heute]),
      db.query(`SELECT COUNT(*) AS gesamt,(SELECT COUNT(*) FROM abwesenheiten WHERE $1::DATE BETWEEN von_datum AND bis_datum AND typ='krank') AS krank,(SELECT COUNT(*) FROM abwesenheiten WHERE $1::DATE BETWEEN von_datum AND bis_datum AND typ='urlaub') AS urlaub FROM mitarbeiter WHERE status='aktiv'`,[heute]),
      db.query(`SELECT COALESCE(SUM(gesamtbetrag) FILTER(WHERE status='bezahlt'),0) AS abgerechnet,COALESCE(SUM(gesamtbetrag) FILTER(WHERE status IN ('offen','eingereicht')),0) AS offen FROM abrechnungen WHERE leistungsdatum>=$1`,[ms]),
      db.query(`SELECT COUNT(*) AS wgs,(SELECT COUNT(*) FROM patienten WHERE wg_id IS NOT NULL AND aktiv=true) AS bewohner FROM wohngemeinschaften WHERE aktiv=true`),
      db.query(`SELECT COUNT(*) FILTER(WHERE bestand<mindestbestand*0.5 OR bestand=0) AS kritisch,COUNT(*) FILTER(WHERE bestand>=mindestbestand*0.5 AND bestand<mindestbestand) AS niedrig FROM medikament_bestand`),
      db.query(`SELECT COUNT(*) FILTER(WHERE status='ueberfaellig') AS ueberfaellig,COUNT(*) FILTER(WHERE status='entwurf') AS offen FROM dokumentationen`),
    ]);
    res.json({patienten:pat.rows[0],touren:tour.rows[0],mitarbeiter:ma.rows[0],abrechnung:abr.rows[0],wgs:wg.rows[0],medikamente:medi.rows[0],dokumentation:doku.rows[0],zeitstempel:new Date().toISOString()});
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// PATIENTEN
// ════════════════════════════════════════
const patientenGetAll = async (req, res, next) => {
  try {
    const {page=1,limit=20,suche,pflegegrad,bezirk_id,nur_wg,nur_ambulant} = req.query;
    const offset=(page-1)*limit,params=[],where=["p.aktiv=true"];
    if(suche){params.push(`%${suche}%`);where.push(`(p.vorname ILIKE $${params.length} OR p.nachname ILIKE $${params.length} OR p.pat_nummer ILIKE $${params.length})`);}
    if(pflegegrad) where.push(`p.pflegegrad=$${params.push(pflegegrad)}`);
    if(bezirk_id)  where.push(`p.bezirk_id=$${params.push(bezirk_id)}`);
    if(nur_wg==='true') where.push('p.wg_id IS NOT NULL');
    if(nur_ambulant==='true') where.push('p.wg_id IS NULL');
    const w=where.join(' AND ');
    const [data,count] = await Promise.all([
      db.query(`SELECT p.id,p.pat_nummer,p.vorname,p.nachname,p.geburtsdatum,DATE_PART('year',AGE(p.geburtsdatum))::INT AS alter,p.pflegegrad,p.krankenkasse,p.telefon,p.aufnahmedatum,b.name AS bezirk,wg.name AS wg FROM patienten p LEFT JOIN bezirke b ON p.bezirk_id=b.id LEFT JOIN wohngemeinschaften wg ON p.wg_id=wg.id WHERE ${w} ORDER BY p.nachname,p.vorname LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(offset)}`,params),
      db.query(`SELECT COUNT(*) FROM patienten p WHERE ${w}`,params.slice(0,-2)),
    ]);
    res.json({patienten:data.rows,gesamt:parseInt(count.rows[0].count),seite:parseInt(page),seiten:Math.ceil(count.rows[0].count/limit)});
  } catch(e) { next(e); }
};

const patientGetOne = async (req, res, next) => {
  try {
    const {rows} = await db.query(`SELECT p.*,DATE_PART('year',AGE(p.geburtsdatum))::INT AS alter,b.name AS bezirk,wg.name AS wg FROM patienten p LEFT JOIN bezirke b ON p.bezirk_id=b.id LEFT JOIN wohngemeinschaften wg ON p.wg_id=wg.id WHERE p.id=$1`,[req.params.id]);
    if(!rows.length) return res.status(404).json({error:'Patient nicht gefunden'});
    const [doku,mplan,kontakte,aerzte,kt,la,abr] = await Promise.all([
      db.query(`SELECT d.*,m.vorname||' '||m.nachname AS ma FROM dokumentationen d LEFT JOIN mitarbeiter m ON d.mitarbeiter_id=m.id WHERE d.patient_id=$1 ORDER BY d.erstellt_am DESC LIMIT 20`,[req.params.id]),
      db.query(`SELECT pm.*,med.name,med.staerke,med.btm_pflichtig FROM patient_medikamentenplan pm JOIN medikamente med ON pm.medikament_id=med.id WHERE pm.patient_id=$1 AND pm.aktiv=true`,[req.params.id]),
      db.query(`SELECT * FROM patient_kontakte WHERE patient_id=$1 ORDER BY sortierung`,[req.params.id]).catch(()=>({rows:[]})),
      db.query(`SELECT * FROM patient_aerzte WHERE patient_id=$1 ORDER BY sortierung`,[req.params.id]).catch(()=>({rows:[]})),
      db.query(`SELECT * FROM patient_kostentraeger WHERE patient_id=$1 ORDER BY sortierung`,[req.params.id]).catch(()=>({rows:[]})),
      db.query(`SELECT * FROM leistungsauftraege WHERE patient_id=$1 ORDER BY erstellt_am DESC`,[req.params.id]).catch(()=>({rows:[]})),
      db.query(`SELECT a.*,kt.name AS kostentraeger_name FROM abrechnungen a LEFT JOIN kostentraeger kt ON a.kostentraeger_id=kt.id WHERE a.patient_id=$1 ORDER BY a.leistungsdatum DESC LIMIT 30`,[req.params.id]).catch(()=>({rows:[]})),
    ]);
    res.json({patient:rows[0],dokumentationen:doku.rows,medikamentenplan:mplan.rows,kontakte:kontakte.rows,aerzte:aerzte.rows,kostentraeger:kt.rows,leistungsauftraege:la.rows,abrechnungen:abr.rows});
  } catch(e) { next(e); }
};

const patientCreate = async (req, res, next) => {
  try {
    const {vorname,nachname,geburtsdatum,strasse,plz,ort,telefon,pflegegrad,krankenkasse,versicherungsnr,bezirk_id,wg_id,diagnosen,allergien,notizen} = req.body;
    const {rows:nr} = await db.query(`SELECT 'P-'||LPAD((COUNT(*)+1)::TEXT,4,'0') AS n FROM patienten`);
    const {rows} = await db.query(`INSERT INTO patienten(pat_nummer,vorname,nachname,geburtsdatum,strasse,plz,ort,telefon,pflegegrad,krankenkasse,versicherungsnr,bezirk_id,wg_id,diagnosen,allergien,notizen) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[nr[0].n,vorname,nachname,geburtsdatum,strasse,plz,ort,telefon,pflegegrad,krankenkasse,versicherungsnr,bezirk_id,wg_id,diagnosen||[],allergien||[],notizen]);
    res.status(201).json({patient:rows[0]});
  } catch(e) { next(e); }
};

const patientUpdate = async (req, res, next) => {
  try {
    const felder=['vorname','nachname','telefon','pflegegrad','krankenkasse','bezirk_id','wg_id','diagnosen','allergien','notizen','aktiv'];
    const upd=[],params=[];
    felder.forEach(f=>{if(req.body[f]!==undefined){params.push(req.body[f]);upd.push(`${f}=$${params.length}`);}});
    if(!upd.length) return res.status(400).json({error:'Keine Felder'});
    params.push(req.params.id);upd.push('aktualisiert_am=NOW()');
    const {rows} = await db.query(`UPDATE patienten SET ${upd.join(',')} WHERE id=$${params.length} RETURNING *`,params);
    if(!rows.length) return res.status(404).json({error:'Nicht gefunden'});
    res.json({patient:rows[0]});
  } catch(e) { next(e); }
};

const patientStatistik = async (req, res, next) => {
  try {
    const [g,pg,bz] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM patienten WHERE aktiv=true`),
      db.query(`SELECT pflegegrad,COUNT(*) AS anzahl FROM patienten WHERE aktiv=true GROUP BY pflegegrad ORDER BY pflegegrad`),
      db.query(`SELECT b.name AS bezirk,COUNT(p.id) AS anzahl FROM patienten p JOIN bezirke b ON p.bezirk_id=b.id WHERE p.aktiv=true GROUP BY b.name ORDER BY anzahl DESC`),
    ]);
    res.json({gesamt:parseInt(g.rows[0].count),nach_pflegegrad:pg.rows,nach_bezirk:bz.rows});
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// TOUREN
// ════════════════════════════════════════
const tourenGetAll = async (req, res, next) => {
  try {
    const {datum,bezirk_id,status,page=1,limit=20} = req.query;
    const offset=(page-1)*limit,params=[],where=[];
    if(datum)     where.push(`t.datum=$${params.push(datum)}`);
    if(bezirk_id) where.push(`t.bezirk_id=$${params.push(bezirk_id)}`);
    if(status)    where.push(`t.status=$${params.push(status)}`);
    const w=where.length?'WHERE '+where.join(' AND '):'';
    const [data,count] = await Promise.all([
      db.query(`SELECT t.*,b.name AS bezirk,m.vorname||' '||m.nachname AS mitarbeiter_name,COUNT(tp.id)::INT AS patient_anzahl FROM touren t LEFT JOIN bezirke b ON t.bezirk_id=b.id LEFT JOIN mitarbeiter m ON t.mitarbeiter_id=m.id LEFT JOIN tour_patienten tp ON t.id=tp.tour_id ${w} GROUP BY t.id,b.name,m.vorname,m.nachname ORDER BY t.datum DESC,t.startzeit LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(offset)}`,params),
      db.query(`SELECT COUNT(*) FROM touren t ${w}`,params.slice(0,-2)),
    ]);
    res.json({touren:data.rows,gesamt:parseInt(count.rows[0].count),seite:parseInt(page),seiten:Math.ceil(count.rows[0].count/limit)});
  } catch(e) { next(e); }
};

const tourCreate = async (req, res, next) => {
  try {
    const {datum,startzeit,endzeit_geplant,bezirk_id,mitarbeiter_id,fahrzeug,km_geplant,notizen,patient_ids=[]} = req.body;
    const {rows:nr} = await db.query(`SELECT 'T-'||LPAD((COUNT(*)+1)::TEXT,3,'0') AS n FROM touren`);
    const {rows} = await db.query(`INSERT INTO touren(tour_nummer,datum,startzeit,endzeit_geplant,bezirk_id,mitarbeiter_id,fahrzeug,km_geplant,notizen) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[nr[0].n,datum,startzeit,endzeit_geplant,bezirk_id,mitarbeiter_id,fahrzeug,km_geplant,notizen]);
    for(let i=0;i<patient_ids.length;i++) await db.query(`INSERT INTO tour_patienten(tour_id,patient_id,reihenfolge) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[rows[0].id,patient_ids[i],i+1]);
    res.status(201).json({tour:rows[0]});
  } catch(e) { next(e); }
};

const tourStatus = async (req, res, next) => {
  try {
    const {status,verspaetung_min,endzeit_actual} = req.body;
    const {rows} = await db.query(`UPDATE touren SET status=$1,verspaetung_min=$2,endzeit_actual=$3,aktualisiert_am=NOW() WHERE id=$4 RETURNING *`,[status,verspaetung_min||0,endzeit_actual,req.params.id]);
    if(!rows.length) return res.status(404).json({error:'Tour nicht gefunden'});
    res.json({tour:rows[0]});
  } catch(e) { next(e); }
};

const tourTagesstatistik = async (req, res, next) => {
  try {
    const datum=req.query.datum||new Date().toISOString().split('T')[0];
    const {rows} = await db.query(`SELECT COUNT(*) FILTER(WHERE status='abgeschlossen') AS abgeschlossen,COUNT(*) FILTER(WHERE status='laeuft') AS laufend,COUNT(*) FILTER(WHERE status='verzoegert') AS verzoegert,COUNT(*) FILTER(WHERE status='offen') AS offen,COUNT(*) AS gesamt FROM touren WHERE datum=$1`,[datum]);
    res.json(rows[0]);
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// MITARBEITER
// ════════════════════════════════════════
const maGetAll = async (req, res, next) => {
  try {
    const {page=1,limit=20,suche,qualifikation,bezirk_id,status} = req.query;
    const offset=(page-1)*limit,params=[],where=["m.status!='gekuendigt'"];
    if(suche){params.push(`%${suche}%`);where.push(`(m.vorname ILIKE $${params.length} OR m.nachname ILIKE $${params.length} OR m.ma_nummer ILIKE $${params.length})`);}
    if(qualifikation) where.push(`m.qualifikation=$${params.push(qualifikation)}`);
    if(bezirk_id)     where.push(`m.bezirk_id=$${params.push(bezirk_id)}`);
    if(status)        where.push(`m.status=$${params.push(status)}`);
    const w=where.join(' AND ');
    const [data,count] = await Promise.all([
      db.query(`SELECT m.id,m.ma_nummer,m.vorname,m.nachname,m.qualifikation,m.beschaeftigung,m.stunden_woche,m.telefon,m.email,m.status,m.eintrittsdatum,b.name AS bezirk FROM mitarbeiter m LEFT JOIN bezirke b ON m.bezirk_id=b.id WHERE ${w} ORDER BY m.nachname,m.vorname LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(offset)}`,params),
      db.query(`SELECT COUNT(*) FROM mitarbeiter m WHERE ${w}`,params.slice(0,-2)),
    ]);
    res.json({mitarbeiter:data.rows,gesamt:parseInt(count.rows[0].count),seite:parseInt(page),seiten:Math.ceil(count.rows[0].count/limit)});
  } catch(e) { next(e); }
};

const maCreate = async (req, res, next) => {
  try {
    const {vorname,nachname,geburtsdatum,telefon,mobil,email,qualifikation,beschaeftigung,stunden_woche,bezirk_id,eintrittsdatum,notizen} = req.body;
    const {rows:nr} = await db.query(`SELECT 'MA-'||LPAD((COUNT(*)+1)::TEXT,3,'0') AS n FROM mitarbeiter`);
    const {rows} = await db.query(`INSERT INTO mitarbeiter(ma_nummer,vorname,nachname,geburtsdatum,telefon,mobil,email,qualifikation,beschaeftigung,stunden_woche,bezirk_id,eintrittsdatum,notizen) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[nr[0].n,vorname,nachname,geburtsdatum,telefon,mobil,email,qualifikation,beschaeftigung||'vollzeit',stunden_woche||40,bezirk_id,eintrittsdatum,notizen]);
    res.status(201).json({mitarbeiter:rows[0]});
  } catch(e) { next(e); }
};

const maVerfuegbar = async (req, res, next) => {
  try {
    const {datum,bezirk_id} = req.query;
    const params=[datum||new Date().toISOString().split('T')[0]];
    let extra='';
    if(bezirk_id){params.push(bezirk_id);extra='AND m.bezirk_id=$2';}
    const {rows} = await db.query(`SELECT m.id,m.ma_nummer,m.vorname,m.nachname,m.qualifikation,b.name AS bezirk FROM mitarbeiter m LEFT JOIN bezirke b ON m.bezirk_id=b.id WHERE m.status='aktiv' AND NOT EXISTS(SELECT 1 FROM abwesenheiten a WHERE a.mitarbeiter_id=m.id AND a.genehmigt=true AND $1::DATE BETWEEN a.von_datum AND a.bis_datum) AND NOT EXISTS(SELECT 1 FROM touren t WHERE t.mitarbeiter_id=m.id AND t.datum=$1) ${extra} ORDER BY m.nachname`,params);
    res.json({mitarbeiter:rows});
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// PFLEGEDOKUMENTATION
// ════════════════════════════════════════
const dokuGetAll = async (req, res, next) => {
  try {
    const {page=1,limit=20,patient_id,status,typ} = req.query;
    const offset=(page-1)*limit,params=[],where=[];
    if(patient_id) where.push(`d.patient_id=$${params.push(patient_id)}`);
    if(status)     where.push(`d.status=$${params.push(status)}`);
    if(typ)        where.push(`d.typ=$${params.push(typ)}`);
    const w=where.length?'WHERE '+where.join(' AND '):'';
    const [data,count] = await Promise.all([
      db.query(`SELECT d.*,p.vorname||' '||p.nachname AS patient_name,p.pflegegrad,m.vorname||' '||m.nachname AS ma_name FROM dokumentationen d LEFT JOIN patienten p ON d.patient_id=p.id LEFT JOIN mitarbeiter m ON d.mitarbeiter_id=m.id ${w} ORDER BY d.erstellt_am DESC LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(offset)}`,params),
      db.query(`SELECT COUNT(*) FROM dokumentationen d ${w}`,params.slice(0,-2)),
    ]);
    res.json({dokumentationen:data.rows,gesamt:parseInt(count.rows[0].count),seite:parseInt(page),seiten:Math.ceil(count.rows[0].count/limit)});
  } catch(e) { next(e); }
};

const dokuGetOne = async (req, res, next) => {
  try {
    const {rows} = await db.query(`SELECT d.*,p.vorname||' '||p.nachname AS patient_name,p.pflegegrad,p.geburtsdatum,m.vorname||' '||m.nachname AS ma_name FROM dokumentationen d LEFT JOIN patienten p ON d.patient_id=p.id LEFT JOIN mitarbeiter m ON d.mitarbeiter_id=m.id WHERE d.id=$1`,[req.params.id]);
    if(!rows.length) return res.status(404).json({error:'Nicht gefunden'});
    res.json({dokumentation:rows[0]});
  } catch(e) { next(e); }
};

const dokuCreate = async (req, res, next) => {
  try {
    const {patient_id,tour_id,typ,inhalt,faellig_bis,sis_daten,leistungen} = req.body;
    const mid = req.body.mitarbeiter_id || req.user.id;
    const finalInhalt = sis_daten ? JSON.stringify({text:inhalt,sis:sis_daten,leistungen}) : inhalt;
    const {rows} = await db.query(`INSERT INTO dokumentationen(patient_id,tour_id,mitarbeiter_id,typ,inhalt,faellig_bis) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[patient_id,tour_id,mid,typ,finalInhalt,faellig_bis]);
    res.status(201).json({dokumentation:rows[0]});
  } catch(e) { next(e); }
};

const dokuUpdate = async (req, res, next) => {
  try {
    const {inhalt,status,sis_daten,leistungen} = req.body;
    const fi = sis_daten ? JSON.stringify({text:inhalt,sis:sis_daten,leistungen}) : inhalt;
    const {rows} = await db.query(`UPDATE dokumentationen SET inhalt=$1,status=$2,aktualisiert_am=NOW() WHERE id=$3 RETURNING *`,[fi,status,req.params.id]);
    if(!rows.length) return res.status(404).json({error:'Nicht gefunden'});
    res.json({dokumentation:rows[0]});
  } catch(e) { next(e); }
};

const dokuQuote = async (req, res, next) => {
  try {
    const {rows} = await db.query(`SELECT COUNT(*) FILTER(WHERE status='fertig') AS fertig,COUNT(*) FILTER(WHERE status='entwurf') AS entwurf,COUNT(*) FILTER(WHERE status='ueberfaellig') AS ueberfaellig,COUNT(*) FILTER(WHERE typ='sis' AND status='fertig') AS sis_fertig,COUNT(*) FILTER(WHERE typ='sis') AS sis_gesamt,COUNT(*) FILTER(WHERE erstellt_am::date=CURRENT_DATE) AS heute FROM dokumentationen`);
    res.json(rows[0]);
  } catch(e) { next(e); }
};

const leistungCreate = async (req, res, next) => {
  try {
    const {patient_id,tour_id,leistungen_ids,datum} = req.body;
    const mid = req.user.id;
    const text = `Leistungserfassung ${datum||new Date().toLocaleDateString('de-DE')}. Positionen: ${leistungen_ids?.join(', ')||''}`;
    const {rows} = await db.query(`INSERT INTO dokumentationen(patient_id,tour_id,mitarbeiter_id,typ,inhalt,status) VALUES($1,$2,$3,'leistungsnachweis',$4,'fertig') RETURNING *`,[patient_id,tour_id,mid,text]);
    if(leistungen_ids?.length) {
      for(const lpId of leistungen_ids) {
        const lp = await db.query('SELECT * FROM leistungspositionen WHERE id=$1',[lpId]);
        if(lp.rows.length) {
          const l=lp.rows[0];
          await db.query(`INSERT INTO abrechnungen(patient_id,tour_id,leistungsdatum,sgb_typ,leistungsposition,leistungsbeschreibung,menge,einzelpreis,gesamtbetrag) VALUES($1,$2,$3,$4,$5,$6,1,$7,$7) ON CONFLICT DO NOTHING`,[patient_id,tour_id,datum||new Date().toISOString().split('T')[0],l.sgb_typ,l.kuerzel,l.bezeichnung,l.preis]);
        }
      }
    }
    res.status(201).json({dokumentation:rows[0]});
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// MEDIKAMENTE
// ════════════════════════════════════════
const mediGetAll = async (req, res, next) => {
  try {
    const {rows} = await db.query(`SELECT med.*,COUNT(mb.id)::INT AS bestand_eintraege FROM medikamente med LEFT JOIN medikament_bestand mb ON med.id=mb.medikament_id GROUP BY med.id ORDER BY med.name`);
    res.json({medikamente:rows});
  } catch(e) { next(e); }
};

const mediGetBestand = async (req, res, next) => {
  try {
    const {rows} = await db.query(`SELECT mb.*,med.name,med.wirkstoff,med.staerke,med.btm_pflichtig,wg.name AS wg_name, CASE WHEN mb.bestand=0 OR mb.bestand<mb.mindestbestand*0.5 THEN 'kritisch' WHEN mb.bestand<mb.mindestbestand THEN 'niedrig' ELSE 'ok' END AS status FROM medikament_bestand mb JOIN medikamente med ON mb.medikament_id=med.id LEFT JOIN wohngemeinschaften wg ON mb.wg_id=wg.id ORDER BY CASE WHEN mb.bestand=0 OR mb.bestand<mb.mindestbestand*0.5 THEN 0 WHEN mb.bestand<mb.mindestbestand THEN 1 ELSE 2 END,med.name`);
    res.json({bestand:rows});
  } catch(e) { next(e); }
};

const mediCreate = async (req, res, next) => {
  try {
    const {name,wirkstoff,staerke,btm_pflichtig} = req.body;
    const {rows} = await db.query(`INSERT INTO medikamente(name,wirkstoff,staerke,btm_pflichtig) VALUES($1,$2,$3,$4) RETURNING *`,[name,wirkstoff,staerke,btm_pflichtig||false]);
    res.status(201).json({medikament:rows[0]});
  } catch(e) { next(e); }
};

const mediBestandCreate = async (req, res, next) => {
  try {
    const {medikament_id,lagerort,wg_id,bestand,mindestbestand,verfalldatum} = req.body;
    const {rows} = await db.query(`INSERT INTO medikament_bestand(medikament_id,lagerort,wg_id,bestand,mindestbestand,verfalldatum) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[medikament_id,lagerort,wg_id||null,bestand||0,mindestbestand||50,verfalldatum||null]);
    res.status(201).json({bestand:rows[0]});
  } catch(e) { next(e); }
};

const mediBestandUpdate = async (req, res, next) => {
  try {
    const {bestand,mindestbestand} = req.body;
    const {rows} = await db.query(`UPDATE medikament_bestand SET bestand=$1,mindestbestand=COALESCE($2,mindestbestand),aktualisiert_am=NOW() WHERE id=$3 RETURNING *`,[bestand,mindestbestand,req.params.id]);
    if(!rows.length) return res.status(404).json({error:'Nicht gefunden'});
    res.json({bestand:rows[0]});
  } catch(e) { next(e); }
};

const mediVergabe = async (req, res, next) => {
  try {
    const {patient_id,medikament_id,dosierung,tour_id,verweigert,notiz} = req.body;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const {rows} = await client.query(`INSERT INTO medikament_vergaben(patient_id,medikament_id,mitarbeiter_id,tour_id,dosierung,verweigert,notiz) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[patient_id,medikament_id,req.user.id,tour_id,dosierung,verweigert||false,notiz]);
      if(!verweigert) await client.query(`UPDATE medikament_bestand SET bestand=GREATEST(0,bestand-1),aktualisiert_am=NOW() WHERE medikament_id=$1`,[medikament_id]);
      await client.query('COMMIT');
      res.status(201).json({vergabe:rows[0]});
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch(e) { next(e); }
};

const mediVergabenGetPatient = async (req, res, next) => {
  try {
    const {rows} = await db.query(`SELECT mv.*,med.name,med.staerke,med.btm_pflichtig,m.vorname||' '||m.nachname AS ma_name FROM medikament_vergaben mv JOIN medikamente med ON mv.medikament_id=med.id LEFT JOIN mitarbeiter m ON mv.mitarbeiter_id=m.id WHERE mv.patient_id=$1 ORDER BY mv.vergabe_zeit DESC LIMIT 50`,[req.params.id]);
    res.json({vergaben:rows});
  } catch(e) { next(e); }
};

const mediNachbestellung = async (req, res, next) => {
  try {
    const {rows} = await db.query(`SELECT mb.*,med.name,med.wirkstoff,med.staerke,wg.name AS wg_name,(mb.mindestbestand-mb.bestand) AS fehlmenge FROM medikament_bestand mb JOIN medikamente med ON mb.medikament_id=med.id LEFT JOIN wohngemeinschaften wg ON mb.wg_id=wg.id WHERE mb.bestand<mb.mindestbestand ORDER BY fehlmenge DESC`);
    res.json({nachbestellliste:rows,erstellt_am:new Date().toISOString()});
  } catch(e) { next(e); }
};

const mediBtmNachweis = async (req, res, next) => {
  try {
    const {von,bis} = req.query;
    const vd=von||new Date(new Date().setDate(1)).toISOString().split('T')[0];
    const bd=bis||new Date().toISOString().split('T')[0];
    const {rows} = await db.query(`SELECT mv.*,med.name AS medi_name,med.staerke,p.vorname||' '||p.nachname AS patient,m.vorname||' '||m.nachname AS mitarbeiter FROM medikament_vergaben mv JOIN medikamente med ON mv.medikament_id=med.id AND med.btm_pflichtig=true JOIN patienten p ON mv.patient_id=p.id LEFT JOIN mitarbeiter m ON mv.mitarbeiter_id=m.id WHERE mv.vergabe_zeit::date BETWEEN $1 AND $2 ORDER BY mv.vergabe_zeit DESC`,[vd,bd]);
    res.json({btm_vergaben:rows,zeitraum:{von:vd,bis:bd}});
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// DIENSTPLAN
// ════════════════════════════════════════
const dienstplanGetWoche = async (req, res, next) => {
  try {
    const {von,bis,bezirk_id} = req.query;
    const params=[von,bis];
    let extra='';
    if(bezirk_id){params.push(bezirk_id);extra=`AND d.bezirk_id=$${params.length}`;}
    const {rows} = await db.query(`SELECT d.*,m.vorname||' '||m.nachname AS ma_name,m.qualifikation,m.ma_nummer,b.name AS bezirk FROM dienstplaene d JOIN mitarbeiter m ON d.mitarbeiter_id=m.id LEFT JOIN bezirke b ON d.bezirk_id=b.id WHERE d.datum BETWEEN $1 AND $2 ${extra} ORDER BY d.datum,d.schicht,m.nachname`,params);
    const stats={frueh:0,spaet:0,nacht:0,gesamt:rows.length,stunden:0};
    rows.forEach(r=>{if(r.schicht in stats)stats[r.schicht]++;stats.stunden+=parseFloat(r.stunden_soll||0);});
    res.json({dienstplan:rows,statistik:stats});
  } catch(e) { next(e); }
};

const dienstplanCreate = async (req, res, next) => {
  try {
    const schichten = Array.isArray(req.body)?req.body:[req.body];
    const ergebnisse=[];
    for(const s of schichten) {
      const {mitarbeiter_id,datum,schicht,beginn,ende,bezirk_id} = s;
      const h=beginn&&ende?(new Date(`2000-01-01T${ende}`)-new Date(`2000-01-01T${beginn}`))/3600000:null;
      const {rows} = await db.query(`INSERT INTO dienstplaene(mitarbeiter_id,datum,schicht,beginn,ende,stunden_soll,bezirk_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(mitarbeiter_id,datum,schicht) DO UPDATE SET beginn=$4,ende=$5,stunden_soll=$6 RETURNING *`,[mitarbeiter_id,datum,schicht,beginn,ende,h&&Math.abs(h),bezirk_id]);
      ergebnisse.push(rows[0]);
    }
    res.status(201).json({dienstplaene:ergebnisse});
  } catch(e) { next(e); }
};

const dienstplanDelete = async (req, res, next) => {
  try {
    await db.query('DELETE FROM dienstplaene WHERE id=$1',[req.params.id]);
    res.json({message:'Schicht gelöscht'});
  } catch(e) { next(e); }
};

const dienstplanGenerieren = async (req, res, next) => {
  try {
    const {von,bis,bezirk_id,min_frueh=10,min_spaet=8,min_nacht=4} = req.body;
    const params=[von,bis];
    let extra='';
    if(bezirk_id){params.push(bezirk_id);extra=`AND m.bezirk_id=$${params.length}`;}
    const {rows:ma} = await db.query(`SELECT m.id,m.bezirk_id FROM mitarbeiter m WHERE m.status='aktiv' ${extra} AND NOT EXISTS(SELECT 1 FROM abwesenheiten a WHERE a.mitarbeiter_id=m.id AND a.genehmigt=true AND ($1::date,($2::date+1)) OVERLAPS (a.von_datum,a.bis_datum+1)) ORDER BY m.nachname`,params);
    const tage=[];
    let d=new Date(von);
    while(d<=new Date(bis)){tage.push(new Date(d).toISOString().split('T')[0]);d.setDate(d.getDate()+1);}
    const schichten=[{typ:'frueh',b:'06:00',e:'14:00',min:parseInt(min_frueh)},{typ:'spaet',b:'14:00',e:'22:00',min:parseInt(min_spaet)},{typ:'nacht',b:'22:00',e:'06:00',min:parseInt(min_nacht)}];
    let idx=0,generiert=0;
    for(const tag of tage) {
      for(const sch of schichten) {
        for(let i=0;i<sch.min;i++) {
          const m=ma[idx%ma.length];
          const h=Math.abs((new Date(`2000-01-01T${sch.e}`)-new Date(`2000-01-01T${sch.b}`))/3600000);
          const r=await db.query(`INSERT INTO dienstplaene(mitarbeiter_id,datum,schicht,beginn,ende,stunden_soll,bezirk_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[m.id,tag,sch.typ,sch.b,sch.e,h,m.bezirk_id]);
          if(r.rows.length) generiert++;
          idx++;
        }
      }
    }
    res.json({generiert,von,bis,ma_eingesetzt:ma.length});
  } catch(e) { next(e); }
};

const abwesenheitCreate = async (req, res, next) => {
  try {
    const {mitarbeiter_id,typ,von_datum,bis_datum,notiz} = req.body;
    const {rows} = await db.query(`INSERT INTO abwesenheiten(mitarbeiter_id,typ,von_datum,bis_datum,notiz) VALUES($1,$2,$3,$4,$5) RETURNING *`,[mitarbeiter_id,typ,von_datum,bis_datum,notiz]);
    res.status(201).json({abwesenheit:rows[0]});
  } catch(e) { next(e); }
};

const abwesenheitGenehmigen = async (req, res, next) => {
  try {
    const {rows} = await db.query(`UPDATE abwesenheiten SET genehmigt=true,genehmigt_von=$1 WHERE id=$2 RETURNING *`,[req.user.id,req.params.id]);
    if(!rows.length) return res.status(404).json({error:'Nicht gefunden'});
    res.json({abwesenheit:rows[0]});
  } catch(e) { next(e); }
};

const abwesenheitGetAll = async (req, res, next) => {
  try {
    const {von,bis,mitarbeiter_id} = req.query;
    const params=[],where=[];
    if(von) where.push(`a.bis_datum>=$${params.push(von)}`);
    if(bis) where.push(`a.von_datum<=$${params.push(bis)}`);
    if(mitarbeiter_id) where.push(`a.mitarbeiter_id=$${params.push(mitarbeiter_id)}`);
    const w=where.length?'WHERE '+where.join(' AND '):'';
    const {rows} = await db.query(`SELECT a.*,m.vorname||' '||m.nachname AS ma_name,m.qualifikation FROM abwesenheiten a JOIN mitarbeiter m ON a.mitarbeiter_id=m.id ${w} ORDER BY a.von_datum DESC`,params);
    res.json({abwesenheiten:rows});
  } catch(e) { next(e); }
};

const stundenUebersicht = async (req, res, next) => {
  try {
    const {von,bis} = req.query;
    const {rows} = await db.query(`SELECT m.id,m.ma_nummer,m.vorname||' '||m.nachname AS name,m.stunden_woche AS soll_pro_woche,COALESCE(SUM(d.stunden_soll),0) AS stunden_geplant,COALESCE(SUM(d.stunden_ist),0) AS stunden_ist,COALESCE(SUM(d.stunden_ist),0)-COALESCE(SUM(d.stunden_soll),0) AS ueberstunden FROM mitarbeiter m LEFT JOIN dienstplaene d ON d.mitarbeiter_id=m.id AND d.datum BETWEEN $1 AND $2 WHERE m.status='aktiv' GROUP BY m.id,m.ma_nummer,m.vorname,m.nachname,m.stunden_woche ORDER BY m.nachname`,[von,bis]);
    res.json({uebersicht:rows});
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// ABRECHNUNG
// ════════════════════════════════════════
const abrMonat = async (req, res, next) => {
  try {
    const {jahr=new Date().getFullYear(),monat=new Date().getMonth()+1} = req.query;
    const von=`${jahr}-${String(monat).padStart(2,'0')}-01`;
    const bis=`${jahr}-${String(monat).padStart(2,'0')}-${new Date(jahr,monat,0).getDate()}`;
    const [u,t,kk,o,jv] = await Promise.all([
      db.query(`SELECT COALESCE(SUM(gesamtbetrag) FILTER(WHERE status='bezahlt'),0) AS bezahlt,COALESCE(SUM(gesamtbetrag) FILTER(WHERE status='offen'),0) AS offen,COALESCE(SUM(gesamtbetrag) FILTER(WHERE status='eingereicht'),0) AS eingereicht,COALESCE(SUM(gesamtbetrag),0) AS gesamt,COUNT(*) AS positionen FROM abrechnungen WHERE leistungsdatum BETWEEN $1 AND $2`,[von,bis]),
      db.query(`SELECT sgb_typ,COALESCE(SUM(gesamtbetrag),0) AS betrag,COUNT(*) AS anzahl FROM abrechnungen WHERE leistungsdatum BETWEEN $1 AND $2 GROUP BY sgb_typ ORDER BY betrag DESC`,[von,bis]),
      db.query(`SELECT krankenkasse,COALESCE(SUM(gesamtbetrag),0) AS betrag,COUNT(*) AS anzahl FROM abrechnungen WHERE leistungsdatum BETWEEN $1 AND $2 AND status IN ('offen','eingereicht') GROUP BY krankenkasse ORDER BY betrag DESC LIMIT 10`,[von,bis]),
      db.query(`SELECT a.*,p.vorname||' '||p.nachname AS patient,p.krankenkasse FROM abrechnungen a JOIN patienten p ON a.patient_id=p.id WHERE a.leistungsdatum BETWEEN $1 AND $2 AND a.status IN ('offen','ueberfaellig') ORDER BY a.leistungsdatum LIMIT 20`,[von,bis]),
      db.query(`SELECT EXTRACT(MONTH FROM leistungsdatum)::INT AS monat,COALESCE(SUM(gesamtbetrag) FILTER(WHERE status='bezahlt'),0) AS umsatz FROM abrechnungen WHERE EXTRACT(YEAR FROM leistungsdatum)=$1 GROUP BY monat ORDER BY monat`,[jahr]),
    ]);
    res.json({zeitraum:{von,bis,monat,jahr},umsatz:u.rows[0],nach_typ:t.rows,offene_kk:kk.rows,offene_posten:o.rows,jahresverlauf:jv.rows});
  } catch(e) { next(e); }
};

const abrCreate = async (req, res, next) => {
  try {
    const {patient_id,tour_id,leistungsdatum,sgb_typ,leistungsposition,leistungsbeschreibung,menge,einzelpreis,krankenkasse} = req.body;
    const gesamt=(parseFloat(menge)||1)*(parseFloat(einzelpreis)||0);
    let kk=krankenkasse;
    if(!kk&&patient_id){const p=await db.query('SELECT krankenkasse FROM patienten WHERE id=$1',[patient_id]);kk=p.rows[0]?.krankenkasse;}
    const {rows} = await db.query(`INSERT INTO abrechnungen(patient_id,tour_id,leistungsdatum,sgb_typ,leistungsposition,leistungsbeschreibung,menge,einzelpreis,gesamtbetrag,krankenkasse) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[patient_id,tour_id,leistungsdatum,sgb_typ,leistungsposition,leistungsbeschreibung,menge||1,einzelpreis,gesamt,kk]);
    res.status(201).json({abrechnung:rows[0]});
  } catch(e) { next(e); }
};

const abrStatus = async (req, res, next) => {
  try {
    const {status,eingereicht_am,bezahlt_am} = req.body;
    const {rows} = await db.query(`UPDATE abrechnungen SET status=$1,eingereicht_am=$2,bezahlt_am=$3,aktualisiert_am=NOW() WHERE id=$4 RETURNING *`,[status,eingereicht_am,bezahlt_am,req.params.id]);
    if(!rows.length) return res.status(404).json({error:'Nicht gefunden'});
    res.json({abrechnung:rows[0]});
  } catch(e) { next(e); }
};

const abrEinreichen = async (req, res, next) => {
  try {
    const {krankenkasse,bis_datum} = req.body;
    const {rows} = await db.query(`UPDATE abrechnungen SET status='eingereicht',eingereicht_am=CURRENT_DATE WHERE status='offen' AND krankenkasse=$1 AND leistungsdatum<=$2 RETURNING id`,[krankenkasse,bis_datum||new Date().toISOString().split('T')[0]]);
    res.json({eingereicht:rows.length,krankenkasse,datum:new Date().toISOString().split('T')[0]});
  } catch(e) { next(e); }
};

const abrExport = async (req, res, next) => {
  try {
    const {von,bis,krankenkasse,sgb_typ} = req.query;
    const params=[von,bis],where=[`a.leistungsdatum BETWEEN $1 AND $2`];
    if(krankenkasse) where.push(`a.krankenkasse=$${params.push(krankenkasse)}`);
    if(sgb_typ) where.push(`a.sgb_typ=$${params.push(sgb_typ)}`);
    const {rows} = await db.query(`SELECT a.*,p.vorname||' '||p.nachname AS patient_name,p.geburtsdatum,p.versicherungsnr,p.pflegegrad FROM abrechnungen a JOIN patienten p ON a.patient_id=p.id WHERE ${where.join(' AND ')} ORDER BY a.krankenkasse,a.leistungsdatum`,params);
    res.json({export_daten:rows,gesamt:rows.length,zeitraum:{von,bis},erstellt_am:new Date().toISOString()});
  } catch(e) { next(e); }
};

const abrJahr = async (req, res, next) => {
  try {
    const {jahr=new Date().getFullYear()} = req.query;
    const {rows} = await db.query(`SELECT EXTRACT(MONTH FROM leistungsdatum)::INT AS monat,COALESCE(SUM(gesamtbetrag) FILTER(WHERE status='bezahlt'),0) AS umsatz,COALESCE(SUM(gesamtbetrag),0) AS gesamt FROM abrechnungen WHERE EXTRACT(YEAR FROM leistungsdatum)=$1 GROUP BY monat ORDER BY monat`,[jahr]);
    res.json({jahr,monate:rows});
  } catch(e) { next(e); }
};

// ════════════════════════════════════════
// WGs & STAMMDATEN
// ════════════════════════════════════════
const wgGetAll = async (req, res, next) => {
  try {
    const {rows} = await db.query(`SELECT w.*,b.name AS bezirk,(SELECT COUNT(*) FROM patienten p WHERE p.wg_id=w.id AND p.aktiv=true)::INT AS bewohner_aktuell FROM wohngemeinschaften w LEFT JOIN bezirke b ON w.bezirk_id=b.id WHERE w.aktiv=true ORDER BY w.name`);
    res.json({wgs:rows});
  } catch(e) { next(e); }
};

const wgCreate = async (req, res, next) => {
  try {
    const {name,strasse,plz,ort,bezirk_id,kapazitaet,monatspauschale} = req.body;
    const {rows} = await db.query(`INSERT INTO wohngemeinschaften(name,strasse,plz,ort,bezirk_id,kapazitaet,monatspauschale) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[name,strasse,plz,ort,bezirk_id,kapazitaet||12,monatspauschale||0]);
    res.status(201).json({wg:rows[0]});
  } catch(e) { next(e); }
};

const bezirkeGetAll = async (req, res, next) => {
  try {
    const {rows} = await db.query('SELECT * FROM bezirke WHERE aktiv=true ORDER BY name');
    res.json({bezirke:rows});
  } catch(e) { next(e); }
};

const leistungenGetAll = async (req, res, next) => {
  try {
    const {rows} = await db.query('SELECT * FROM leistungspositionen WHERE aktiv=true ORDER BY kuerzel');
    res.json({leistungen:rows});
  } catch(e) { next(e); }
};

module.exports = {
  // Auth
  login, register, me, passwortAendern,
  // Benutzerverwaltung
  benutzerGetAll, benutzerUpdate, benutzerPasswortReset,
  // Dashboard
  dashboard,
  // Patienten
  patientenGetAll, patientGetOne, patientCreate, patientUpdate, patientStatistik,
  // Touren
  tourenGetAll, tourCreate, tourStatus, tourTagesstatistik,
  // Mitarbeiter
  maGetAll, maCreate, maVerfuegbar,
  // Pflegedokumentation
  dokuGetAll, dokuGetOne, dokuCreate, dokuUpdate, dokuQuote, leistungCreate,
  // Medikamente
  mediGetAll, mediGetBestand, mediCreate, mediBestandCreate, mediBestandUpdate,
  mediVergabe, mediVergabenGetPatient, mediNachbestellung, mediBtmNachweis,
  // Dienstplan
  dienstplanGetWoche, dienstplanCreate, dienstplanDelete, dienstplanGenerieren,
  abwesenheitCreate, abwesenheitGenehmigen, abwesenheitGetAll, stundenUebersicht,
  // Abrechnung
  abrMonat, abrCreate, abrStatus, abrEinreichen, abrExport, abrJahr,
  // WGs & Stammdaten
  wgGetAll, wgCreate, bezirkeGetAll, leistungenGetAll,
};
