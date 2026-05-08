const express = require('express');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function formatProduct(row) {
  const precioV = parseFloat(row.precioV) || 0;
  const precioD = parseFloat(row.precioD) || 0;
  const hasDiscount = precioD > 0;

  return {
    id: row.id,
    nombre: row.nombre,
    artista: row.artista,
    tipo: row.tipo || '',
    precioOriginal: precioV,
    precioDescuento: hasDiscount ? precioD : null,
    precio: hasDiscount ? precioD : precioV,
    cover: row.img ? Buffer.from(row.img).toString('base64') : null,
    existencias: row.existencias || 0
  };
}

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const tipo = req.query.tipo || null;

    let where = '';
    const params = [];

    if (tipo) {
      where = 'WHERE tipo = ?';
      params.push(tipo);
    }

    // Count
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM productos ${where}`, params);
    const total = countResult[0].total;

    // Products
    const [products] = await pool.query(
      `SELECT id, nombre, artista, tipo, precioV, precioD, existencias, img FROM productos ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      products: products.map(formatProduct),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Products index error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/products/featured
router.get('/featured', async (req, res) => {
  try {
    let [products] = await pool.query(
      'SELECT p.id, p.nombre, p.artista, p.tipo, p.precioV, p.precioD, p.existencias, p.img FROM novedades n JOIN productos p ON n.id = p.id LIMIT 20'
    );

    if (products.length === 0) {
      [products] = await pool.query(
        'SELECT id, nombre, artista, tipo, precioV, precioD, img FROM novedades LIMIT 20'
      );
    }

    res.json({ products: products.map(formatProduct) });
  } catch (err) {
    console.error('Featured error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/products/search
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.json({ products: [] });
    }

    const searchTerm = `%${q}%`;
    const [products] = await pool.query(
      'SELECT id, nombre, artista, tipo, precioV, precioD, existencias, img FROM productos WHERE nombre LIKE ? OR artista LIKE ? LIMIT 50',
      [searchTerm, searchTerm]
    );

    res.json({ products: products.map(formatProduct) });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [rows] = await pool.query('SELECT * FROM productos WHERE id = ?', [id]);
    const row = rows[0];

    if (!row) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const product = formatProduct(row);
    product.descripcion = row.descripcion || '';
    product.tracklist = row.tracklist || '';
    product.existencias = row.existencias || 0;

    res.json(product);
  } catch (err) {
    console.error('Product show error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/products/:id/rate
router.post('/:id/rate', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating debe ser entre 1 y 5' });
    }

    await pool.query(
      'INSERT INTO ratings (producto_id, usuario_id, rating) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rating = ?',
      [id, req.user.id, rating, rating]
    );

    res.json({ message: 'Rating guardado', rating });
  } catch (err) {
    console.error('Rate error:', err);
    res.status(500).json({ error: 'Error al guardar rating' });
  }
});

module.exports = router;
