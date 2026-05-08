const express = require('express');
const pool = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/products
router.get('/products', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM productos');
    const total = countResult[0].total;

    const [products] = await pool.query(
      'SELECT id, nombre, artista, tipo, precioV, precioD, existencias FROM productos ORDER BY id DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    res.json({
      products: products.map(p => ({
        id: p.id,
        nombre: p.nombre,
        artista: p.artista,
        tipo: p.tipo,
        precioV: parseFloat(p.precioV),
        precioD: parseFloat(p.precioD),
        existencias: p.existencias
      })),
      pagination: {
        page,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Admin list products error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/admin/products
router.post('/products', requireAdmin, async (req, res) => {
  try {
    const { nombre, artista, tipo, precioV, precioD, descripcion, tracklist, existencias } = req.body;

    if (!nombre || !artista || !precioV || precioV <= 0) {
      return res.status(400).json({ error: 'Nombre, artista y precio son requeridos' });
    }

    const [result] = await pool.query(
      'INSERT INTO productos (nombre, artista, tipo, precioV, precioD, descripcion, tracklist, existencias) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [nombre, artista, tipo || '', precioV, precioD || 0, descripcion || '', tracklist || '', existencias || 0]
    );

    res.json({
      message: 'Producto creado',
      product: { id: result.insertId, nombre }
    });
  } catch (err) {
    console.error('Admin create product error:', err);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PUT /api/admin/products/:id
router.put('/products/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const allowedFields = ['nombre', 'artista', 'tipo', 'precioV', 'precioD', 'descripcion', 'tracklist', 'existencias'];

    const fields = [];
    const values = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    values.push(id);
    await pool.query(`UPDATE productos SET ${fields.join(', ')} WHERE id = ?`, values);

    res.json({ message: 'Producto actualizado' });
  } catch (err) {
    console.error('Admin update product error:', err);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM productos WHERE id = ?', [id]);
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    console.error('Admin delete product error:', err);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

module.exports = router;
