const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'mops_secret_2025';

function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non connecté' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée' });
  }
}

function managerOnly(req, res, next) {
  if (req.user?.role !== 'responsable') {
    return res.status(403).json({ error: 'Accès réservé au responsable' });
  }
  next();
}

module.exports = { authMiddleware, managerOnly, SECRET };
