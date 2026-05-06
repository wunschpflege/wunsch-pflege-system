const jwt = require('jsonwebtoken');
const db  = require('../../config/database');

const authenticate = async (req, res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Nicht eingeloggt' });
  try {
    const decoded = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    const { rows } = await db.query(
      'SELECT id,vorname,nachname,email,rolle,aktiv FROM benutzer WHERE id=$1', [decoded.id]
    );
    if (!rows.length || !rows[0].aktiv) return res.status(401).json({ error: 'Benutzer nicht gefunden' });
    req.user = rows[0];
    next();
  } catch { res.status(401).json({ error: 'Token ungültig' }); }
};

const authorize = (...rollen) => (req, res, next) => {
  if (!rollen.includes(req.user.rolle))
    return res.status(403).json({ error: 'Keine Berechtigung' });
  next();
};

module.exports = { authenticate, authorize };
