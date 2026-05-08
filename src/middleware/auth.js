const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(req) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return null;

  try {
    return jwt.verify(match[1], JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (user.su !== '1' && user.su !== 1) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  req.user = user;
  next();
}

function optionalAuth(req, res, next) {
  req.user = verifyToken(req);
  next();
}

module.exports = { generateToken, verifyToken, requireAuth, requireAdmin, optionalAuth };
