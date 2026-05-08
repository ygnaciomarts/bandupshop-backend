const express = require('express');
const pool = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/products
router.get('/products', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM productos');
    const total = countResult[0].total;

    const [products] = await pool.query(
      'SELECT id, nombre, artista, tipo, precioV, precioD, existencias FROM productos ORDER BY id DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    res.json({
      products: products.map(p => ({
        ...p,
        precioV: parseFloat(p.precioV),
        precioD: parseFloat(p.precioD) || null
      })),
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Admin products error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/admin/products
router.post('/products', requireAdmin, async (req, res) => {
  try {
    const { nombre, artista, tipo, precio, existencias, descripcion } = req.body;

    if (!nombre || !artista || !tipo || !precio) {
      return res.status(400).json({ error: 'Campos requeridos faltantes' });
    }

    const [result] = await pool.query(
      'INSERT INTO productos (nombre, artista, tipo, precioV, existencias, descripcion) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, artista, tipo, parseFloat(precio), parseInt(existencias) || 0, descripcion || '']
    );

    res.json({
      success: true,
      product: {
        id: result.insertId,
        nombre,
        artista,
        tipo,
        precioV: parseFloat(precio),
        existencias: parseInt(existencias) || 0
      }
    });
  } catch (err) {
    console.error('Admin create product error:', err);
    res.status(500).json({ error: 'Error al crear el producto' });
  }
});

// PUT /api/admin/products/:id
router.put('/products/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nombre, artista, tipo, precio, existencias, descripcion } = req.body;

    await pool.query(
      'UPDATE productos SET nombre = ?, artista = ?, tipo = ?, precioV = ?, existencias = ?, descripcion = ? WHERE id = ?',
      [nombre, artista, tipo, parseFloat(precio), parseInt(existencias) || 0, descripcion || '', id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Admin update product error:', err);
    res.status(500).json({ error: 'Error al actualizar el producto' });
  }
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM productos WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete product error:', err);
    res.status(500).json({ error: 'Error al eliminar el producto' });
  }
});

// GET /api/admin/orders
router.get('/orders', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.id, o.total, o.estado, o.created_at, u.usuario, u.email
      FROM ordenes o
      JOIN usuarios u ON o.usuario_id = u.id
      ORDER BY o.created_at DESC
    `);

    res.json({ orders: rows });
  } catch (err) {
    console.error('Admin orders error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
