const express = require('express');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/orders
router.post('/', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'El carrito está vacío' });
    }

    // Calculate total
    let subtotal = 0;
    for (const item of items) {
      subtotal += parseFloat(item.precio) * parseInt(item.qty);
    }

    const shipping = subtotal >= 799 ? 0 : Math.round(subtotal * 0.07 * 100) / 100;
    const grandTotal = subtotal + shipping;

    await connection.beginTransaction();

    // Insert order
    const [orderResult] = await connection.query(
      'INSERT INTO ordenes (usuario_id, precio_total, creado, modificado) VALUES (?, ?, NOW(), NOW())',
      [req.user.id, grandTotal]
    );
    const orderId = orderResult.insertId;

    // Insert items and update stock
    for (const item of items) {
      const productId = parseInt(item.id);
      const qty = parseInt(item.qty);

      await connection.query(
        'INSERT INTO orden_items (orden_id, producto_id, cantidad) VALUES (?, ?, ?)',
        [orderId, productId, qty]
      );

      await connection.query(
        'UPDATE productos SET existencias = existencias - ? WHERE id = ?',
        [qty, productId]
      );
    }

    await connection.commit();

    res.json({
      message: 'Orden creada exitosamente',
      order: {
        id: orderId,
        total: grandTotal,
        shipping,
        subtotal,
        items_count: items.length
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Error al crear la orden' });
  } finally {
    connection.release();
  }
});

// GET /api/orders
router.get('/', requireAuth, async (req, res) => {
  try {
    const [orders] = await pool.query(
      'SELECT id, precio_total, creado FROM ordenes WHERE usuario_id = ? ORDER BY creado DESC',
      [req.user.id]
    );

    res.json({
      orders: orders.map(o => ({
        id: o.id,
        total: parseFloat(o.precio_total),
        fecha: o.creado
      }))
    });
  } catch (err) {
    console.error('List orders error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/orders/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);

    const [orders] = await pool.query(
      'SELECT id, precio_total, creado FROM ordenes WHERE id = ? AND usuario_id = ?',
      [orderId, req.user.id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const order = orders[0];

    const [items] = await pool.query(
      `SELECT oi.cantidad, p.id, p.nombre, p.artista, p.tipo, p.precioV, p.precioD
       FROM orden_items oi
       JOIN productos p ON oi.producto_id = p.id
       WHERE oi.orden_id = ?`,
      [orderId]
    );

    res.json({
      order: {
        id: order.id,
        total: parseFloat(order.precio_total),
        fecha: order.creado,
        items: items.map(item => {
          const precioD = parseFloat(item.precioD) || 0;
          return {
            id: item.id,
            nombre: item.nombre,
            artista: item.artista,
            tipo: item.tipo,
            precio: precioD > 0 ? precioD : parseFloat(item.precioV),
            cantidad: item.cantidad
          };
        })
      }
    });
  } catch (err) {
    console.error('Show order error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
