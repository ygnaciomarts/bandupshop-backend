const express = require('express');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/user/profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, usuario, nombre, apellido, email, su FROM usuarios WHERE id = ?',
      [req.user.id]
    );

    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(user);
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/user/reset-password
router.post('/reset-password', requireAuth, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email es requerido' });
  }

  // In a real app, send email with reset token
  res.json({ success: true, message: 'Se envió un correo con instrucciones para restablecer la contraseña' });
});

module.exports = router;
