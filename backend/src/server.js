require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use('/api/auth/login', rateLimit({ windowMs: 15*60*1000, max: 10 }));
app.use('/api/', rateLimit({ windowMs: 60*1000, max: 500 }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('tiny'));

// Frontend: /app/frontend/index.html
// Server läuft in: /app/backend/src/
// Pfad: ../../frontend
const frontendPath = path.join(__dirname, '../../frontend');
console.log('Frontend Pfad:', frontendPath);
app.use(express.static(frontendPath));

app.get('/health', (req, res) => res.json({ status: 'ok', frontend: frontendPath }));
app.use('/api', routes);

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendPath, 'index.html'));
  }
});

app.use((err, req, res, next) => {
  console.error(err.message);
  if(err.code==='23505') return res.status(409).json({error:'Datensatz existiert bereits'});
  if(err.code==='23503') return res.status(400).json({error:'Referenz nicht gefunden'});
  res.status(err.status||500).json({ error: process.env.NODE_ENV==='production' ? 'Serverfehler' : err.message });
});

app.listen(PORT, () => console.log(`\n🚀 Wunsch-Pflege GmbH läuft auf Port ${PORT}\n`));
module.exports = app;
