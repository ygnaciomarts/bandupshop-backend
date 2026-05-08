const express = require('express');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/orders
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, total, estado, created_at FROM ordenes WHERE usuario_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    res.json({ orders: rows });
  } catch (err) {
    console.error('Orders error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/orders/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [rows] = await pool.query('SELECT * FROM ordenes WHERE id = ? AND usuario_id = ?', [id, req.user.id]);

    const order = rows[0];
    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    res.json(order);
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/orders
router.post('/', requireAuth, async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items son requeridos' });
    }

    // Calculate total
    let total = 0;
    for (const item of items) {
      const [rows] = await pool.query('SELECT precioV, precioD FROM productos WHERE id = ?', [item.product_id]);
      const product = rows[0];
      if (!product) continue;

      const precio = parseFloat(product.precioD) > 0 ? parseFloat(product.precioD) : parseFloat(product.precioV);
      total += precio * item.qty;
    }

    // Create order
    const [result] = await pool.query(
      'INSERT INTO ordenes (usuario_id, total, estado) VALUES (?, ?, ?)',
      [req.user.id, total, 'pendiente']
    );

    res.json({
      success: true,
      order: {
        id: result.insertId,
        total,
        estado: 'pendiente',
        items
      }
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Error al crear la orden' });
  }
});

module.exports = router;
