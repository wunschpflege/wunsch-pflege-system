require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../../config/database');

async function seed() {
  console.log('🌱  Seed startet …');

  // Bezirke für Dortmund
  const bezirke = ['Aplerbeck','Bodelschwingh','Frohlinde','Kirchlinde','Nette','Rahm','Sölde','Sölderholz','Mitte','Nord'];
  const bIds = {};
  for (const n of bezirke) {
    const { rows } = await db.query(
      'INSERT INTO bezirke(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [n]
    );
    bIds[n] = rows[0].id;
  }

  // Wohngemeinschaften Wunsch-Pflege Dortmund
  const wgs = [
    {name:'WG Aplerbeck',           kuerzel:'WG-AP', bez:'Aplerbeck',     kap:12, pau:1650},
    {name:'WG Bodelschwingh',       kuerzel:'WG-BO', bez:'Bodelschwingh', kap:12, pau:1600},
    {name:'WG Frohlinde',           kuerzel:'WG-FR', bez:'Frohlinde',     kap:12, pau:1580},
    {name:'Wohnpark Kirchlinde Betreutes Wohnen', kuerzel:'WP-KL-BW', bez:'Kirchlinde', kap:20, pau:1200},
    {name:'Wohnpark Kirchlinde WG', kuerzel:'WP-KL-WG', bez:'Kirchlinde', kap:12, pau:1650},
    {name:'WG Nette',               kuerzel:'WG-NE', bez:'Nette',         kap:12, pau:1600},
    {name:'Wohnpark Rahm Betreutes Wohnen', kuerzel:'WP-RA-BW', bez:'Rahm', kap:20, pau:1200},
    {name:'Wohnpark Rahm WG',       kuerzel:'WP-RA-WG', bez:'Rahm',       kap:12, pau:1650},
    {name:'WG Sölde',               kuerzel:'WG-SO', bez:'Sölde',         kap:12, pau:1600},
    {name:'WG Sölderholz',          kuerzel:'WG-SH', bez:'Sölderholz',    kap:12, pau:1650},
  ];

  for (const w of wgs) {
    await db.query(
      `INSERT INTO wohngemeinschaften(name,kuerzel,ort,bezirk_id,kapazitaet,monatspauschale)
       VALUES($1,$2,'Dortmund',$3,$4,$5) ON CONFLICT DO NOTHING`,
      [w.name, w.kuerzel, bIds[w.bez], w.kap, w.pau]
    );
  }
  console.log('  ✓  Bezirke & WGs Dortmund');

  // Benutzer
  for (const u of [
    {email:'admin@wunsch-pflege.de',     pw:'Admin1234!',      vn:'System',  nn:'Admin',       rolle:'admin'},
    {email:'gf@wunsch-pflege.de',        pw:'GF1234!',         vn:'Maria',   nn:'Musterfrau',  rolle:'geschaeftsfuehrung'},
    {email:'leitung@wunsch-pflege.de',   pw:'Leitung1234!',    vn:'Klaus',   nn:'Meier',       rolle:'stationsleitung'},
    {email:'pflege@wunsch-pflege.de',    pw:'Pflege1234!',     vn:'Anna',    nn:'Müller',      rolle:'pflegekraft'},
    {email:'verwaltung@wunsch-pflege.de',pw:'Verwaltung1234!', vn:'Peter',   nn:'Schmidt',     rolle:'verwaltung'},
    {email:'buchhaltung@wunsch-pflege.de',pw:'Buch1234!',      vn:'Lisa',    nn:'Weber',       rolle:'buchhaltung'},
  ]) {
    const hash = await bcrypt.hash(u.pw, 10);
    await db.query(
      `INSERT INTO benutzer(email,passwort_hash,vorname,nachname,rolle)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING`,
      [u.email, hash, u.vn, u.nn, u.rolle]
    );
  }
  console.log('  ✓  Benutzer angelegt');
  console.log('🎉  Seed abgeschlossen!');
}

require('./migrate').migrate().then(() => seed()).catch(console.error);
