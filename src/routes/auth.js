const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../config/database');
const { generateToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    const [rows] = await pool.query(
      'SELECT id, usuario, password, nombre, apellido, email, su FROM usuarios WHERE usuario = ?',
      [username]
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = generateToken({
      id: user.id,
      username: user.usuario,
      nombre: user.nombre,
      su: user.su
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.usuario,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        su: user.su
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, confirm_password, nombre, apellido } = req.body;

    const errors = [];
    if (!username) errors.push('El usuario es requerido');
    if (!email) errors.push('El email es requerido');
    if (!password) errors.push('La contraseña es requerida');
    if (password && password.length < 8) errors.push('La contraseña debe tener al menos 8 caracteres');
    if (password !== confirm_password) errors.push('Las contraseñas no coinciden');
    if (!nombre) errors.push('El nombre es requerido');

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // Check username
    const [existingUser] = await pool.query('SELECT id FROM usuarios WHERE usuario = ?', [username]);
    if (existingUser.length > 0) {
      return res.status(409).json({ error: 'Este nombre de usuario ya está en uso' });
    }

    // Check email
    const [existingEmail] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existingEmail.length > 0) {
      return res.status(409).json({ error: 'Este correo electrónico ya está registrado' });
    }

    // Insert
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO usuarios (usuario, email, password, nombre, apellido) VALUES (?, ?, ?, ?, ?)',
      [username, email, hashedPassword, nombre, apellido || '']
    );

    const token = generateToken({
      id: result.insertId,
      username,
      nombre,
      su: '0'
    });

    res.json({
      token,
      user: {
        id: result.insertId,
        username,
        nombre,
        apellido: apellido || '',
        email,
        su: '0'
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Error al registrar el usuario' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Sesión cerrada' });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, usuario, nombre, apellido, email, su, img FROM usuarios WHERE id = ?',
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
      su: user.su,
      avatar: user.img ? Buffer.from(user.img).toString('base64') : null
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
