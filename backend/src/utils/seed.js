require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../../config/database');

async function seed() {
  console.log('🌱  Seed startet …');

  const bezirke = ['Nord','Süd','Mitte','West','Ost','Nordwest','Südost','Zentrum'];
  const bIds = {};
  for (const n of bezirke) {
    const { rows } = await db.query(
      'INSERT INTO bezirke(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [n]
    );
    bIds[n] = rows[0].id;
  }

  const wgs = [
    {name:'WG Rosenweg',str:'Rosenweg 14',plz:'80331',ort:'München',bez:'Mitte',kap:14,pau:1650},
    {name:'WG Lindenstraße',str:'Lindenstr. 8',plz:'80339',ort:'München',bez:'Nord',kap:12,pau:1600},
    {name:'WG Am Park',str:'Parkallee 3',plz:'81667',ort:'München',bez:'West',kap:11,pau:1580},
    {name:'WG Bergblick',str:'Bergstr. 22',plz:'81547',ort:'München',bez:'Süd',kap:13,pau:1720},
    {name:'WG Sonnenblick',str:'Sonnenstr. 5',plz:'81735',ort:'München',bez:'Ost',kap:12,pau:1600},
    {name:'WG Kastanienallee',str:'Kastanienallee 17',plz:'80804',ort:'München',bez:'Nordwest',kap:10,pau:1550},
    {name:'WG Eichenweg',str:'Eichenweg 4',plz:'81379',ort:'München',bez:'Südost',kap:14,pau:1680},
    {name:'WG Birkenweg',str:'Birkenweg 9',plz:'80469',ort:'München',bez:'Zentrum',kap:11,pau:1750},
    {name:'WG Ahornstraße',str:'Ahornstr. 33',plz:'80809',ort:'München',bez:'Nord',kap:12,pau:1600},
    {name:'WG Tulpenweg',str:'Tulpenweg 7',plz:'81369',ort:'München',bez:'Süd',kap:13,pau:1650},
    {name:'WG Fichtenweg',str:'Fichtenweg 2',plz:'81241',ort:'München',bez:'West',kap:10,pau:1500},
    {name:'WG Weidenallee',str:'Weidenallee 11',plz:'80335',ort:'München',bez:'Mitte',kap:12,pau:1700},
  ];
  const wgIds = [];
  for (const w of wgs) {
    const { rows } = await db.query(
      `INSERT INTO wohngemeinschaften(name,strasse,plz,ort,bezirk_id,kapazitaet,monatspauschale)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
      [w.name,w.str,w.plz,w.ort,bIds[w.bez],w.kap,w.pau]
    );
    if (rows.length) wgIds.push(rows[0].id);
  }
  console.log('  ✓  Bezirke & WGs');

  // Benutzer
  for (const u of [
    {email:'admin@wunsch-pflege.de',pw:'Admin1234!',vn:'System',nn:'Admin',rolle:'admin'},
    {email:'gf@wunsch-pflege.de',pw:'GF1234!',vn:'Maria',nn:'Musterfrau',rolle:'geschaeftsfuehrung'},
    {email:'leitung@wunsch-pflege.de',pw:'Leitung1234!',vn:'Klaus',nn:'Meier',rolle:'stationsleitung'},
    {email:'pflege@wunsch-pflege.de',pw:'Pflege1234!',vn:'Anna',nn:'Müller',rolle:'pflegekraft'},
    {email:'verwaltung@wunsch-pflege.de',pw:'Verwaltung1234!',vn:'Peter',nn:'Schmidt',rolle:'verwaltung'},
    {email:'buchhaltung@wunsch-pflege.de',pw:'Buch1234!',vn:'Lisa',nn:'Weber',rolle:'buchhaltung'},
  ]) {
    const hash = await bcrypt.hash(u.pw, 12);
    await db.query(
      `INSERT INTO benutzer(email,passwort_hash,vorname,nachname,rolle)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING`,
      [u.email, hash, u.vn, u.nn, u.rolle]
    );
  }
  console.log('  ✓  Benutzer & Logins');

  // Medikamente
  const medis = [
    {name:'Metformin 500mg',wirkstoff:'Metformin',staerke:'500mg',btm:false},
    {name:'Ramipril 5mg',wirkstoff:'Ramipril',staerke:'5mg',btm:false},
    {name:'ASS 100mg',wirkstoff:'Acetylsalicylsäure',staerke:'100mg',btm:false},
    {name:'Pantoprazol 20mg',wirkstoff:'Pantoprazol',staerke:'20mg',btm:false},
    {name:'Bisoprolol 2,5mg',wirkstoff:'Bisoprolol',staerke:'2,5mg',btm:false},
    {name:'Insulin Novorapid',wirkstoff:'Insulin aspart',staerke:'100 IE/ml',btm:false},
    {name:'Morphin 10mg retard',wirkstoff:'Morphin',staerke:'10mg',btm:true},
    {name:'Lorazepam 1mg',wirkstoff:'Lorazepam',staerke:'1mg',btm:true},
  ];
  const mediIds = [];
  for (const m of medis) {
    const { rows } = await db.query(
      `INSERT INTO medikamente(name,wirkstoff,staerke,btm_pflichtig)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
      [m.name, m.wirkstoff, m.staerke, m.btm]
    );
    if (rows.length) mediIds.push(rows[0].id);
  }
  // Bestände
  const bestaende = [
    {idx:0,bestand:12,min:100,lager:'Zentrallager'},
    {idx:1,bestand:45,min:150,lager:'Zentrallager'},
    {idx:2,bestand:78,min:200,lager:'Zentrallager'},
    {idx:3,bestand:640,min:100,lager:'Zentrallager'},
    {idx:4,bestand:120,min:80,lager:'Zentrallager'},
    {idx:5,bestand:2,min:10,lager:'WG Rosenweg'},
    {idx:6,bestand:3,min:20,lager:'WG Lindenstraße'},
  ];
  for (const b of bestaende) {
    if (mediIds[b.idx]) {
      await db.query(
        `INSERT INTO medikament_bestand(medikament_id,lagerort,bestand,mindestbestand)
         VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [mediIds[b.idx], b.lager, b.bestand, b.min]
      );
    }
  }
  console.log('  ✓  Medikamente & Bestände');

  // Leistungspositionen
  const lp = [
    {k:'LK01',b:'Großer Pflegeeinsatz SGB XI',s:'sgb_xi',p:36.50},
    {k:'LK02',b:'Kleiner Pflegeeinsatz SGB XI',s:'sgb_xi',p:22.80},
    {k:'LK03',b:'Behandlungspflege SGB V',s:'sgb_v',p:28.40},
    {k:'LK04',b:'Medikamentengabe',s:'sgb_v',p:12.60},
    {k:'LK05',b:'Wundversorgung',s:'sgb_v',p:45.00},
    {k:'LK06',b:'WG-Betreuungspauschale',s:'wg_betreuung',p:1650.00},
    {k:'LK07',b:'Nachtpflege',s:'nachtpflege',p:80.00},
    {k:'LK08',b:'Verhinderungspflege',s:'verhinderung',p:95.00},
  ];
  for (const l of lp) {
    await db.query(
      `INSERT INTO leistungspositionen(kuerzel,bezeichnung,sgb_typ,preis)
       VALUES($1,$2,$3,$4) ON CONFLICT(kuerzel) DO NOTHING`,
      [l.k, l.b, l.s, l.p]
    );
  }

  // Mitarbeiter (30 Beispiele)
  const vnames = ['Hans','Maria','Klaus','Ingrid','Werner','Elfriede','Gerhard','Hildegard','Manfred','Brigitte','Heinrich','Lieselotte','Rudolf','Waltraud','Siegfried','Renate','Horst','Elke','Dieter','Monika','Herbert','Irmgard','Günter','Hannelore','Friedrich','Ursula','Joachim','Helga','Rainer','Petra'];
  const nnames = ['Müller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Schulz','Hoffmann','Koch','Richter','Klein','Wolf','Schröder','Neumann','Schwarz','Zimmermann','Braun','Krüger'];
  const quals = ['examiniert_3j','examiniert_3j','pflegehelfer','pflegehelfer','hilfskraft','wundmanager','palliativ','stationsleitung'];
  const beschs = ['vollzeit','vollzeit','vollzeit','teilzeit','teilzeit','minijob'];
  const bezListe = Object.keys(bIds);
  const maIds = [];
  for (let i = 0; i < 30; i++) {
    const vn = vnames[i % vnames.length];
    const nn = nnames[i % nnames.length];
    const nr = 'MA-' + String(i+1).padStart(3,'0');
    const { rows } = await db.query(
      `INSERT INTO mitarbeiter(ma_nummer,vorname,nachname,qualifikation,beschaeftigung,bezirk_id,eintrittsdatum)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(ma_nummer) DO NOTHING RETURNING id`,
      [nr, vn, nn, quals[i%quals.length], beschs[i%beschs.length], bIds[bezListe[i%bezListe.length]], '2020-01-01']
    );
    if (rows.length) maIds.push(rows[0].id);
  }
  console.log('  ✓  30 Mitarbeiter (von 312 gesamt — weitere über die App anlegen)');

  // Patienten (50 Beispiele)
  const pVnames = ['Herbert','Inge','Karl','Elfriede','Gerda','Werner','Maria','Heinrich','Lieselotte','Rudolf'];
  const pNnames = ['Bauer','Maier','Schmidt','Klein','Wolf','Müller','Huber','Fischer','Braun','Lange'];
  const pgs = ['1','2','2','3','3','3','4','4','5'];
  const kks = ['AOK Bayern','Barmer','TK','DAK','IKK Classic'];
  const patIds = [];
  for (let i = 0; i < 50; i++) {
    const vn = pVnames[i%pVnames.length];
    const nn = pNnames[i%pNnames.length];
    const nr = 'P-' + String(i+1).padStart(4,'0');
    const wg = i % 8 === 0 && wgIds.length ? wgIds[i % wgIds.length] : null;
    const { rows } = await db.query(
      `INSERT INTO patienten(pat_nummer,vorname,nachname,geburtsdatum,pflegegrad,krankenkasse,bezirk_id,wg_id,aufnahmedatum)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(pat_nummer) DO NOTHING RETURNING id`,
      [nr, vn, nn, `${1930 + (i%30)}-${String((i%12)+1).padStart(2,'0')}-15`,
       pgs[i%pgs.length], kks[i%kks.length],
       bIds[bezListe[i%bezListe.length]], wg, '2023-01-01']
    );
    if (rows.length) patIds.push(rows[0].id);
  }
  console.log('  ✓  50 Patienten (von 1500 gesamt — weitere über die App anlegen)');

  // Touren (10 für heute)
  const heute = new Date().toISOString().split('T')[0];
  const statuses = ['abgeschlossen','abgeschlossen','abgeschlossen','laeuft','verzoegert','offen'];
  for (let i = 0; i < 10; i++) {
    const nr = 'T-' + String(i+1).padStart(3,'0');
    const h = String(6 + Math.floor(i/2)).padStart(2,'0');
    const { rows } = await db.query(
      `INSERT INTO touren(tour_nummer,datum,startzeit,bezirk_id,mitarbeiter_id,status)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tour_nummer) DO NOTHING RETURNING id`,
      [nr, heute, `${h}:00`, bIds[bezListe[i%bezListe.length]],
       maIds.length ? maIds[i%maIds.length] : null, statuses[i%statuses.length]]
    );
    if (rows.length && patIds.length) {
      for (let j = 0; j < 3 && j < patIds.length; j++) {
        await db.query(
          `INSERT INTO tour_patienten(tour_id,patient_id,reihenfolge) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [rows[0].id, patIds[(i*3+j)%patIds.length], j+1]
        );
      }
    }
  }
  console.log('  ✓  10 Touren für heute');

  console.log('\n✅  Seed abgeschlossen!\n');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║         LOGIN-DATEN                      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  admin@wunsch-pflege.de     Admin1234!        ║');
  console.log('║  gf@wunsch-pflege.de        GF1234!           ║');
  console.log('║  leitung@wunsch-pflege.de   Leitung1234!      ║');
  console.log('║  pflege@wunsch-pflege.de    Pflege1234!       ║');
  console.log('║  verwaltung@wunsch-pflege.de Verwaltung1234!  ║');
  console.log('║  buchhaltung@wunsch-pflege.de Buch1234!       ║');
  console.log('╚══════════════════════════════════════════╝');
  // fertig
}
seed().catch(e => { console.error(e); // fehler });
