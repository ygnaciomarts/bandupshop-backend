const express = require('express');
const pool = require('../config/database');

const router = express.Router();

// =============================================
// GET /api/collections - List active collections
// =============================================
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, slug, description, cover_image, position
       FROM collections WHERE is_active = 1 ORDER BY position ASC`
    );
    res.json({ collections: rows });
  } catch (err) {
    console.error('Collections error:', err);
    res.status(500).json({ error: 'Error al obtener colecciones' });
  }
});

// =============================================
// GET /api/collections/:slug - Get collection with products
// =============================================
router.get('/:slug', async (req, res) => {
  try {
    const [cols] = await pool.query(
      'SELECT * FROM collections WHERE slug = ? AND is_active = 1',
      [req.params.slug]
    );
    if (cols.length === 0) {
      return res.status(404).json({ error: 'Colección no encontrada' });
    }

    const collection = cols[0];
    const [products] = await pool.query(
      `SELECT p.* FROM products p
       JOIN collection_products cp ON cp.product_id = p.id
       WHERE cp.collection_id = ? AND p.isActive = 1
       ORDER BY cp.position ASC`,
      [collection.id]
    );

    res.json({
      collection: {
        id: collection.id,
        title: collection.title,
        slug: collection.slug,
        description: collection.description,
        coverImage: collection.cover_image,
      },
      products: products.map(formatProduct),
    });
  } catch (err) {
    console.error('Collection detail error:', err);
    res.status(500).json({ error: 'Error al obtener colección' });
  }
});

function formatProduct(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    type: row.type || 'CD',
    price: {
      original: parseInt(row.price_original) || 0,
      final: parseInt(row.price_final) || parseInt(row.price_original) || 0,
      currency: row.currency || 'MXN',
    },
    stock: row.stock || 0,
    coverImage: row.coverImage || null,
    rating: parseFloat(row.rating) || 0,
    isFeatured: Boolean(row.isFeatured),
  };
}

module.exports = router;
