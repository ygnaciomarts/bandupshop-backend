const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const avatarsDir = path.join(__dirname, '../../uploads/avatars');

if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    cb(null, `user-${req.user.id}-${Date.now()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_, file, cb) => {
    const allowedTypes = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/gif'
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Formato de imagen no permitido'));
    }

    cb(null, true);
  }
});

const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL,
    pass: process.env.ZOHO_APP_PASSWORD
  }
});

// GET /profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const [rows] = await pool.query(
      `SELECT id, usuario, nombre, apellido, email, su, creado, phone_number, avatar_url
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error('Profile error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /avatar
router.post(
  '/avatar',
  requireAuth,
  upload.single('avatar'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Imagen requerida' });
      }

      const avatarUrl = `/uploads/avatars/${req.file.filename}`;

      await pool.query(
        `UPDATE usuarios
         SET avatar_url = ?
         WHERE id = ?`,
        [avatarUrl, req.user.id]
      );

      return res.status(200).json({
        success: true,
        avatar_url: avatarUrl
      });
    } catch (err) {
      console.error('Avatar upload error:', err);
      return res.status(500).json({
        error: 'Error al subir avatar'
      });
    }
  }
);

// POST /reset-password/request
router.post('/reset-password/request', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email válido es requerido' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Formato de email inválido' });
    }

    const [rows] = await pool.query(
      `SELECT id, email
       FROM usuarios
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Si el correo existe, se enviaron instrucciones de recuperación'
      });
    }

    const user = rows[0];

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(rawToken, 10);

    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

    await pool.query(
      `UPDATE usuarios
       SET reset_token = ?, reset_token_expires = ?
       WHERE id = ?`,
      [hashedToken, expiresAt, user.id]
    );

    const resetLink = `https://new-bandup.ygnaciomarts.com/reset-password?token=${rawToken}&email=${encodeURIComponent(normalizedEmail)}`;

    await transporter.sendMail({
      from: `"BandUp Account Updates" <auth@ygnaciomarts.com>`,
      to: normalizedEmail,
      subject: 'Restablece tu contraseña',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h1>BandUp</h1>
          <p>Recibimos una solicitud para restablecer tu contraseña.</p>
          <p>Haz clic en el siguiente enlace:</p>
          <a href="${resetLink}">${resetLink}</a>
          <p>Este enlace expirará en 30 minutos.</p>
        </div>
      `
    });

    return res.status(200).json({
      success: true,
      message: 'Si el correo existe, se enviaron instrucciones de recuperación'
    });
  } catch (err) {
    console.error('Reset password request error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /reset-password/confirm
router.post('/reset-password/confirm', async (req, res) => {
  try {
    const { email, token, password } = req.body;

    if (!email || !token || !password) {
      return res.status(400).json({
        error: 'Email, token y contraseña son requeridos'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 8 caracteres'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [rows] = await pool.query(
      `SELECT id, reset_token, reset_token_expires
       FROM usuarios
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Solicitud inválida' });
    }

    const user = rows[0];

    if (!user.reset_token || !user.reset_token_expires) {
      return res.status(400).json({ error: 'Solicitud inválida' });
    }

    const isExpired = new Date(user.reset_token_expires) < new Date();

    if (isExpired) {
      return res.status(400).json({ error: 'El token expiró' });
    }

    const isValidToken = await bcrypt.compare(token, user.reset_token);

    if (!isValidToken) {
      return res.status(400).json({ error: 'Token inválido' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `UPDATE usuarios
       SET password = ?,
           reset_token = NULL,
           reset_token_expires = NULL
       WHERE id = ?`,
      [hashedPassword, user.id]
    );

    return res.status(200).json({
      success: true,
      message: 'Contraseña actualizada correctamente'
    });
  } catch (err) {
    console.error('Reset password confirm error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
