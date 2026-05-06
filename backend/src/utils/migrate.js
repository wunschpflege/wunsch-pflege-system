require('dotenv').config();
const db = require('../../config/database');
const sql = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$ BEGIN
  CREATE TYPE pflegegrad_enum AS ENUM ('1','2','3','4','5');
  CREATE TYPE tour_status_enum AS ENUM ('geplant','laeuft','abgeschlossen','verzoegert','offen');
  CREATE TYPE schicht_enum AS ENUM ('frueh','spaet','nacht','kuechendienst','pflegeplanung','teamsitzung');
  CREATE TYPE abw_typ_enum AS ENUM ('krank','urlaub','frei','fortbildung','ausgleich');
  CREATE TYPE doku_typ_enum AS ENUM ('sis','leistungsnachweis','pflegebericht','wundprotokoll','medikamentennachweis','sturzprotokoll','pflegeanamnese','massnahmenplan');
  CREATE TYPE doku_status_enum AS ENUM ('entwurf','fertig','ueberfaellig');
  CREATE TYPE qual_enum AS ENUM ('examiniert_3j','pflegehelfer','hilfskraft','wundmanager','palliativ','stationsleitung','verwaltung','auszubildender','aushilfe','apothekenfahrer','tagespflegefahrer','kuechenhilfe');
  CREATE TYPE beschaeft_enum AS ENUM ('vollzeit','teilzeit','minijob','springer','aushilfe');
  CREATE TYPE benutzer_rolle_enum AS ENUM ('admin','geschaeftsfuehrung','stationsleitung','pflegekraft','verwaltung','buchhaltung');
  CREATE TYPE sgb_typ_enum AS ENUM ('sgb_xi_36','sgb_xi_37','sgb_xi_38','sgb_xi_45b','sgb_v_37_2','privat','wg_betreuung','verhinderung','nachtpflege','entlastungsbetrag');
  CREATE TYPE abr_status_enum AS ENUM ('offen','eingereicht','bezahlt','abgelehnt','ueberfaellig','storniert');
  CREATE TYPE geschlecht_enum AS ENUM ('weiblich','maennlich','divers');
  CREATE TYPE kostentraeger_typ_enum AS ENUM ('krankenkasse','pflegekasse','selbstzahler','beihilfe','sozialhilfe');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS bezirke (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name VARCHAR(100) NOT NULL UNIQUE, aktiv BOOLEAN DEFAULT true, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS wohngemeinschaften (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name VARCHAR(200) NOT NULL, kuerzel VARCHAR(20), strasse VARCHAR(200), plz VARCHAR(10), ort VARCHAR(100), bezirk_id UUID REFERENCES bezirke(id), kapazitaet INTEGER DEFAULT 12, monatspauschale NUMERIC(10,2) DEFAULT 0, aktiv BOOLEAN DEFAULT true, erstellt_am TIMESTAMPTZ DEFAULT NOW(), aktualisiert_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS benutzer (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), email VARCHAR(255) NOT NULL UNIQUE, passwort_hash VARCHAR(255) NOT NULL, vorname VARCHAR(100) NOT NULL, nachname VARCHAR(100) NOT NULL, rolle benutzer_rolle_enum NOT NULL DEFAULT 'pflegekraft', aktiv BOOLEAN DEFAULT true, letzter_login TIMESTAMPTZ, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS aerzte (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), titel VARCHAR(50), vorname VARCHAR(100), nachname VARCHAR(100) NOT NULL, fachrichtung VARCHAR(200), strasse VARCHAR(200), plz VARCHAR(10), ort VARCHAR(100), telefon VARCHAR(50), fax VARCHAR(50), email VARCHAR(255), aktiv BOOLEAN DEFAULT true, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS kostentraeger (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name VARCHAR(300) NOT NULL, kuerzel VARCHAR(50), typ kostentraeger_typ_enum NOT NULL DEFAULT 'krankenkasse', ik_nummer VARCHAR(20), strasse VARCHAR(200), plz VARCHAR(10), ort VARCHAR(100), telefon VARCHAR(50), fax VARCHAR(50), email VARCHAR(255), aktiv BOOLEAN DEFAULT true, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS mitarbeiter (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  benutzer_id UUID REFERENCES benutzer(id) ON DELETE SET NULL,
  ma_nummer VARCHAR(20) UNIQUE, handzeichen VARCHAR(10),
  vorname VARCHAR(100) NOT NULL, nachname VARCHAR(100) NOT NULL,
  geburtsdatum DATE, geschlecht geschlecht_enum,
  strasse VARCHAR(200), plz VARCHAR(10), ort VARCHAR(100),
  telefon1 VARCHAR(50), telefon2 VARCHAR(50), mobiltelefon VARCHAR(50), telefax VARCHAR(50), email VARCHAR(255),
  qualifikation qual_enum NOT NULL DEFAULT 'pflegehelfer',
  beschaeftigung beschaeft_enum NOT NULL DEFAULT 'vollzeit',
  stunden_woche NUMERIC(5,2) DEFAULT 40,
  beschaeftigungsnummer VARCHAR(50),
  ist_pflegekraft BOOLEAN DEFAULT true, ist_springer BOOLEAN DEFAULT false,
  bezirk_id UUID REFERENCES bezirke(id),
  wg_id UUID REFERENCES wohngemeinschaften(id),
  pflegeteam VARCHAR(200),
  eintrittsdatum DATE, austrittsdatum DATE,
  status VARCHAR(20) DEFAULT 'aktiv', aktiv BOOLEAN DEFAULT true,
  foto_url VARCHAR(500), notizen TEXT, bemerkungen TEXT,
  erstellt_am TIMESTAMPTZ DEFAULT NOW(), aktualisiert_am TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ma_fahrzeuge (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), mitarbeiter_id UUID NOT NULL REFERENCES mitarbeiter(id) ON DELETE CASCADE, kennzeichen VARCHAR(20), fahrzeugtyp VARCHAR(100), aktiv BOOLEAN DEFAULT true, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS ma_geraete (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), mitarbeiter_id UUID NOT NULL REFERENCES mitarbeiter(id) ON DELETE CASCADE, geraete_nr VARCHAR(50), telefon_nr VARCHAR(50), geraetetyp VARCHAR(100), aktiv BOOLEAN DEFAULT true, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS patienten (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pat_nummer VARCHAR(20) UNIQUE,
  titel VARCHAR(50), vorname VARCHAR(100) NOT NULL, nachname VARCHAR(100) NOT NULL, geburtsname VARCHAR(100),
  geburtsdatum DATE NOT NULL, geschlecht geschlecht_enum,
  strasse VARCHAR(200), hausnummer VARCHAR(20), adresszusatz VARCHAR(200), plz VARCHAR(10), ort VARCHAR(100),
  telefon1 VARCHAR(50), telefon2 VARCHAR(50), mobiltelefon VARCHAR(50), telefax VARCHAR(50), email VARCHAR(255),
  pflegegrad pflegegrad_enum NOT NULL, pflegegrad_seit DATE,
  versicherungsnr VARCHAR(100), versicherungsstatus VARCHAR(20), aktenzeichen VARCHAR(100), schluessel_nr VARCHAR(100),
  sgb_xi_36 BOOLEAN DEFAULT false, sgb_xi_37_3 BOOLEAN DEFAULT false,
  hausnotruf BOOLEAN DEFAULT false, entlastungsbetrag_45b BOOLEAN DEFAULT false, pflegehilfsmittel_40 BOOLEAN DEFAULT false,
  apotheke VARCHAR(300),
  bezirk_id UUID REFERENCES bezirke(id), wg_id UUID REFERENCES wohngemeinschaften(id), zustaendige_ma_id UUID REFERENCES mitarbeiter(id),
  aufnahmedatum DATE DEFAULT CURRENT_DATE, entlassdatum DATE,
  aktiv BOOLEAN DEFAULT true, archiviert_am TIMESTAMPTZ, archiv_grund TEXT, loeschfreigabe_am TIMESTAMPTZ,
  foto_url VARCHAR(500), diagnosen TEXT[], allergien TEXT[], bemerkungen TEXT, notizen TEXT,
  erstellt_am TIMESTAMPTZ DEFAULT NOW(), aktualisiert_am TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_kontakte (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), patient_id UUID NOT NULL REFERENCES patienten(id) ON DELETE CASCADE, vorname VARCHAR(100), nachname VARCHAR(100), beziehung VARCHAR(100), telefon VARCHAR(50), mobil VARCHAR(50), email VARCHAR(255), ist_bevollmaechtigt BOOLEAN DEFAULT false, ist_hauptkontakt BOOLEAN DEFAULT false, sortierung INTEGER DEFAULT 0, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS patient_aerzte (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), patient_id UUID NOT NULL REFERENCES patienten(id) ON DELETE CASCADE, arzt_id UUID REFERENCES aerzte(id), arzt_name VARCHAR(300), fachrichtung VARCHAR(200), telefon VARCHAR(50), ist_hausarzt BOOLEAN DEFAULT false, sortierung INTEGER DEFAULT 0, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS patient_kostentraeger (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), patient_id UUID NOT NULL REFERENCES patienten(id) ON DELETE CASCADE, kostentraeger_id UUID REFERENCES kostentraeger(id), kostentraeger_name VARCHAR(300), typ kostentraeger_typ_enum NOT NULL, telefon VARCHAR(50), anteil_prozent NUMERIC(5,2) DEFAULT 100, aktiv BOOLEAN DEFAULT true, sortierung INTEGER DEFAULT 0, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS leistungsauftraege (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), patient_id UUID NOT NULL REFERENCES patienten(id), beleg_nr VARCHAR(50), leistungsgrundlage sgb_typ_enum NOT NULL, beschreibung VARCHAR(500), von_datum DATE, bis_datum DATE, aktiv BOOLEAN DEFAULT true, bearbeitungsstand VARCHAR(200), genehmigt BOOLEAN DEFAULT false, erstellt_am TIMESTAMPTZ DEFAULT NOW(), aktualisiert_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS patient_ma_praeferenzen (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), patient_id UUID NOT NULL REFERENCES patienten(id) ON DELETE CASCADE, mitarbeiter_id UUID NOT NULL REFERENCES mitarbeiter(id) ON DELETE CASCADE, typ VARCHAR(20) NOT NULL CHECK (typ IN ('vorzug','unerwuenscht')), notiz TEXT, erstellt_am TIMESTAMPTZ DEFAULT NOW(), UNIQUE(patient_id, mitarbeiter_id, typ));

CREATE TABLE IF NOT EXISTS touren (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tour_nummer VARCHAR(20) UNIQUE, datum DATE NOT NULL, startzeit TIME, endzeit_geplant TIME, endzeit_actual TIME, bezirk_id UUID REFERENCES bezirke(id), mitarbeiter_id UUID REFERENCES mitarbeiter(id), fahrzeug VARCHAR(100), km_geplant NUMERIC(6,1), km_gefahren NUMERIC(6,1), status tour_status_enum DEFAULT 'geplant', verspaetung_min INTEGER DEFAULT 0, notizen TEXT, erstellt_am TIMESTAMPTZ DEFAULT NOW(), aktualisiert_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS tour_patienten (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tour_id UUID NOT NULL REFERENCES touren(id) ON DELETE CASCADE, patient_id UUID NOT NULL REFERENCES patienten(id), reihenfolge INTEGER DEFAULT 0, geplante_ankunft TIME, tatsaechl_ankunft TIME, dauer_min INTEGER DEFAULT 30, abgeschlossen BOOLEAN DEFAULT false, UNIQUE(tour_id, patient_id));

CREATE TABLE IF NOT EXISTS dienstplaene (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), mitarbeiter_id UUID NOT NULL REFERENCES mitarbeiter(id), datum DATE NOT NULL, schicht schicht_enum, schicht_kuerzel VARCHAR(10), beginn TIME, ende TIME, stunden_soll NUMERIC(5,2), stunden_ist NUMERIC(5,2), ist_abwesend BOOLEAN DEFAULT false, abwesenheit_typ abw_typ_enum, bezirk_id UUID REFERENCES bezirke(id), wg_id UUID REFERENCES wohngemeinschaften(id), notiz VARCHAR(200), erstellt_am TIMESTAMPTZ DEFAULT NOW(), UNIQUE(mitarbeiter_id, datum, schicht_kuerzel));

CREATE TABLE IF NOT EXISTS abwesenheiten (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), mitarbeiter_id UUID NOT NULL REFERENCES mitarbeiter(id), typ abw_typ_enum NOT NULL, von_datum DATE NOT NULL, bis_datum DATE NOT NULL, stunden NUMERIC(6,2), genehmigt BOOLEAN DEFAULT false, genehmigt_von UUID REFERENCES benutzer(id), notiz TEXT, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS zeiterfassung (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), mitarbeiter_id UUID NOT NULL REFERENCES mitarbeiter(id), datum DATE NOT NULL, beginn TIMESTAMPTZ, ende TIMESTAMPTZ, pause_min INTEGER DEFAULT 0, stunden_ist NUMERIC(5,2), tour_id UUID REFERENCES touren(id), notiz TEXT, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS dokumentationen (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), patient_id UUID NOT NULL REFERENCES patienten(id), tour_id UUID REFERENCES touren(id), mitarbeiter_id UUID NOT NULL REFERENCES mitarbeiter(id), typ doku_typ_enum NOT NULL, inhalt TEXT, sis_daten JSONB, status doku_status_enum DEFAULT 'entwurf', faellig_bis TIMESTAMPTZ, archiviert_am TIMESTAMPTZ, erstellt_am TIMESTAMPTZ DEFAULT NOW(), aktualisiert_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS medikamente (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name VARCHAR(300) NOT NULL, wirkstoff VARCHAR(300), staerke VARCHAR(100), btm_pflichtig BOOLEAN DEFAULT false, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS medikament_bestand (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), medikament_id UUID NOT NULL REFERENCES medikamente(id), lagerort VARCHAR(200), wg_id UUID REFERENCES wohngemeinschaften(id), bestand INTEGER NOT NULL DEFAULT 0, mindestbestand INTEGER NOT NULL DEFAULT 50, verfalldatum DATE, aktualisiert_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS patient_medikamentenplan (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), patient_id UUID NOT NULL REFERENCES patienten(id), medikament_id UUID NOT NULL REFERENCES medikamente(id), dosierung VARCHAR(100), morgens BOOLEAN DEFAULT false, mittags BOOLEAN DEFAULT false, abends BOOLEAN DEFAULT false, nachts BOOLEAN DEFAULT false, bedarfsmedikament BOOLEAN DEFAULT false, aktiv BOOLEAN DEFAULT true, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS medikament_vergaben (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), patient_id UUID NOT NULL REFERENCES patienten(id), medikament_id UUID NOT NULL REFERENCES medikamente(id), mitarbeiter_id UUID NOT NULL REFERENCES mitarbeiter(id), tour_id UUID REFERENCES touren(id), dosierung VARCHAR(100), vergabe_zeit TIMESTAMPTZ NOT NULL DEFAULT NOW(), verweigert BOOLEAN DEFAULT false, notiz TEXT);

CREATE TABLE IF NOT EXISTS abrechnungen (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), patient_id UUID NOT NULL REFERENCES patienten(id), leistungsauftrag_id UUID REFERENCES leistungsauftraege(id), tour_id UUID REFERENCES touren(id), leistungsdatum DATE NOT NULL, sgb_typ sgb_typ_enum NOT NULL, leistungsposition VARCHAR(50), leistungsbeschreibung TEXT, menge NUMERIC(8,2) DEFAULT 1, einzelpreis NUMERIC(10,2), gesamtbetrag NUMERIC(10,2), kostentraeger_id UUID REFERENCES kostentraeger(id), kostentraeger_name VARCHAR(300), anteil_prozent NUMERIC(5,2) DEFAULT 100, beleg_nr VARCHAR(50), rechnung_nr VARCHAR(50), rechnung_datum DATE, buchung_datum DATE, status abr_status_enum DEFAULT 'offen', eingereicht_am DATE, bezahlt_am DATE, gedruckt BOOLEAN DEFAULT false, archiviert_am TIMESTAMPTZ, erstellt_am TIMESTAMPTZ DEFAULT NOW(), aktualisiert_am TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS leistungspositionen (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), kuerzel VARCHAR(20) NOT NULL UNIQUE, bezeichnung TEXT NOT NULL, sgb_typ sgb_typ_enum NOT NULL, preis NUMERIC(10,2) NOT NULL, einheit VARCHAR(50) DEFAULT 'Einheit', aktiv BOOLEAN DEFAULT true);

CREATE TABLE IF NOT EXISTS loeschprotokoll (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tabelle VARCHAR(100) NOT NULL, datensatz_id UUID NOT NULL, kategorie VARCHAR(100), beschreibung TEXT, geloescht_am TIMESTAMPTZ DEFAULT NOW(), geloescht_von UUID REFERENCES benutzer(id), aufbewahrungsfrist_jahre INTEGER, erstellt_am TIMESTAMPTZ DEFAULT NOW());

CREATE INDEX IF NOT EXISTS idx_pat_aktiv ON patienten(aktiv);
CREATE INDEX IF NOT EXISTS idx_pat_name ON patienten(nachname, vorname);
CREATE INDEX IF NOT EXISTS idx_pat_pg ON patienten(pflegegrad);
CREATE INDEX IF NOT EXISTS idx_pat_bezirk ON patienten(bezirk_id);
CREATE INDEX IF NOT EXISTS idx_ma_name ON mitarbeiter(nachname, vorname);
CREATE INDEX IF NOT EXISTS idx_dp_datum ON dienstplaene(datum);
CREATE INDEX IF NOT EXISTS idx_dp_ma ON dienstplaene(mitarbeiter_id);
CREATE INDEX IF NOT EXISTS idx_tour_datum ON touren(datum);
CREATE INDEX IF NOT EXISTS idx_abr_pat ON abrechnungen(patient_id);
CREATE INDEX IF NOT EXISTS idx_abr_status ON abrechnungen(status);
CREATE INDEX IF NOT EXISTS idx_ze_ma ON zeiterfassung(mitarbeiter_id, datum);
`;

async function migrate() {
  console.log('🚀  Starte Migration v5 …');
  try { await db.query(sql); console.log('✅  Migration erfolgreich!'); }
  catch(e) { console.error('Fehler:', e.message); }
  // fertig
}
module.exports = { migrate };
