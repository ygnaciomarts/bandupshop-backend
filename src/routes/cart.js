const express = require('express');
const pool = require('../config/database');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/cart
router.get('/', optionalAuth, (req, res) => {
  // Cart is managed client-side with localStorage
  res.json({ items: [], total: 0, total_items: 0 });
});

// POST /api/cart/add
router.post('/add', async (req, res) => {
  try {
    const { product_id, qty = 1 } = req.body;
    const productId = parseInt(product_id);
    const quantity = Math.max(1, parseInt(qty));

    if (!productId) {
      return res.status(400).json({ error: 'product_id es requerido' });
    }

    const [rows] = await pool.query(
      'SELECT id, nombre, artista, tipo, precioV, precioD, img, existencias FROM productos WHERE id = ?',
      [productId]
    );

    const product = rows[0];
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const precioD = parseFloat(product.precioD) || 0;
    const precio = precioD > 0 ? precioD : parseFloat(product.precioV);

    res.json({
      message: 'Producto agregado al carrito',
      item: {
        id: product.id,
        nombre: product.nombre,
        artista: product.artista,
        tipo: product.tipo,
        cover: product.img ? Buffer.from(product.img).toString('base64') : null,
        precio,
        qty: quantity
      }
    });
  } catch (err) {
    console.error('Cart add error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/cart/update
router.put('/update', (req, res) => {
  const { product_id, qty } = req.body;

  if (!product_id) {
    return res.status(400).json({ error: 'product_id es requerido' });
  }

  res.json({
    message: 'Cantidad actualizada',
    product_id,
    qty: parseInt(qty) || 0
  });
});

// DELETE /api/cart/remove/:id
router.delete('/remove/:id', (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'ID es requerido' });
  }
  res.json({ message: 'Producto eliminado del carrito' });
});

// DELETE /api/cart/clear
router.delete('/clear', (req, res) => {
  res.json({ message: 'Carrito vaciado' });
});

module.exports = router;
