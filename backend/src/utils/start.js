/**
 * Start-Script: Migration + Seed + Server in einem Prozess
 */
require('dotenv').config();
const db = require('../../config/database');

async function start() {
  console.log('🚀 Wunsch-Pflege GmbH startet...');
  
  // Migration
  try {
    const { migrate } = require('./migrate-fn');
    await migrate();
    console.log('✅ Migration abgeschlossen');
  } catch(e) {
    console.log('ℹ️  Migration übersprungen (Tabellen existieren bereits):', e.message);
  }
  
  // Seed (nur wenn noch keine Benutzer)
  try {
    const { rows } = await db.query('SELECT COUNT(*) FROM benutzer');
    if(parseInt(rows[0].count) === 0) {
      const { seed } = require('./seed-fn');
      await seed();
      console.log('✅ Testdaten eingefügt');
    } else {
      console.log('ℹ️  Datenbank bereits befüllt');
    }
  } catch(e) {
    console.log('ℹ️  Seed übersprungen:', e.message);
  }
  
  // Server starten
  console.log('🌐 Server wird gestartet...');
  require('../server');
}

start().catch(e => {
  console.error('Startfehler:', e.message);
  require('../server'); // Server trotzdem starten
});
