const express = require('express');
const multer = require('multer');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Multer config for avatar upload (5MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido'));
    }
  }
});

// GET /api/user/profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, usuario, nombre, apellido, email, direccion, telefono, img FROM usuarios WHERE id = ?',
      [req.user.id]
    );

    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({
      id: user.id,
      username: user.usuario,
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      direccion: user.direccion,
      telefono: user.telefono,
      avatar: user.img ? Buffer.from(user.img).toString('base64') : null
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/user/avatar
router.post('/avatar', requireAuth, upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó una imagen válida' });
    }

    await pool.query('UPDATE usuarios SET img = ? WHERE id = ?', [req.file.buffer, req.user.id]);

    res.json({ message: 'Avatar actualizado' });
  } catch (err) {
    if (err.message === 'Tipo de archivo no permitido') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Avatar error:', err);
    res.status(500).json({ error: 'Error al actualizar avatar' });
  }
});

// POST /api/user/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email es requerido' });
    }

    // Don't reveal if email exists or not
    const [rows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [email]);

    // In production: generate token and send email
    if (rows.length > 0) {
      // TODO: send email with reset link
    }

    res.json({ message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
