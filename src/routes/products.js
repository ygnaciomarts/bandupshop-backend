const express = require('express');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function formatProduct(row) {
  const priceOriginal = parseFloat(row.price_original) || 0;
  const priceFinal = parseFloat(row.price_final) || priceOriginal;

  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,

    title: row.title,
    artist: row.artist,
    type: row.type || 'CD',

    description: row.description || '',

    price: {
      original: priceOriginal,
      final: priceFinal,
      currency: row.currency || 'MXN'
    },

    stock: row.stock || 0,
    reservedStock: row.reserved_stock || 0,

    coverImage: row.coverImage || null,

    reservedStock: row.reservedStock || 0,

    isActive: Boolean(row.isActive),
    isFeatured: Boolean(row.isFeatured),

    price: {
      original: row.price_original,
      final: row.price_final,
      currency: row.currency
    },

    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const type = req.query.type || null;

    let where = '';
    const params = [];

    if (type) {
      where = 'WHERE type = ?';
      params.push(type);
    }

    // Count
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM products ${where}`, params);
    const total = countResult[0].total;

    // Products
    const [products] = await pool.query(
      `SELECT * FROM products ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
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
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

// GET /api/products/featured
router.get('/featured', async (req, res) => {
  try {
    let [products] = await pool.query(
      'SELECT * FROM products WHERE isFeatured = 1 LIMIT 20'
    );

    if (products.length === 0) {
      [products] = await pool.query(
        'SELECT * FROM products ORDER BY rating DESC LIMIT 20'
      );
    }

    res.json({ products: products.map(formatProduct) });
  } catch (err) {
    console.error('Featured error:', err);
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
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
      `SELECT * FROM products
       WHERE title LIKE ?
       OR artist LIKE ?
       OR sku LIKE ?
       LIMIT 50`,
      [searchTerm, searchTerm, searchTerm]
    );

    res.json({ products: products.map(formatProduct) });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    const row = rows[0];

    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = formatProduct(row);

    res.json(product);
  } catch (err) {
    console.error('Product show error:', err);
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

// POST /api/products/:id/rate
router.post('/:id/rate', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    await pool.query(
      'INSERT INTO ratings (product_id, user_id, rating) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rating = ?',
      [id, req.user.id, rating, rating]
    );

    res.json({ message: 'Rating saved', rating });
  } catch (err) {
    console.error('Rate error:', err);
    res.status(500).json({
      error: 'Error saving rating',
      details: err.message
    });
  }
});

module.exports = router;
