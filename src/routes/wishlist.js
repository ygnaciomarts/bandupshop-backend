const express = require('express');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// =============================================
// GET /api/wishlist - Get user's wishlist
// =============================================
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.title, p.artist, p.slug, p.coverImage, p.rating,
              w.variant_id, pv.type as variant_type, pv.label as variant_label,
              pv.cover_image as variant_cover, pv.price_final as variant_price_final,
              pv.price_original as variant_price_original, pv.stock as variant_stock,
              w.created_at as added_at
       FROM wishlists w
       JOIN products p ON w.product_id = p.id
       LEFT JOIN product_variants pv ON pv.id = w.variant_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`,
      [req.user.id]
    );

    res.json({
      items: rows.map(r => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        slug: r.slug,
        coverImage: r.variant_cover || r.coverImage,
        variant_id: r.variant_id,
        variant_type: r.variant_type,
        variant_label: r.variant_label,
        price: {
          original: parseInt(r.variant_price_original) || 0,
          final: parseInt(r.variant_price_final) || 0,
        },
        stock: parseInt(r.variant_stock) || 0,
        rating: parseFloat(r.rating) || 0,
        addedAt: r.added_at,
      })),
    });
  } catch (err) {
    console.error('Get wishlist error:', err);
    res.status(500).json({ error: 'Error al obtener wishlist' });
  }
});

// =============================================
// POST /api/wishlist/:productId - Add to wishlist
// =============================================
router.post('/:productId', requireAuth, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    const variantId = req.body.variant_id ? parseInt(req.body.variant_id) : null;
    await pool.query(
      'INSERT IGNORE INTO wishlists (user_id, product_id, variant_id) VALUES (?, ?, ?)',
      [req.user.id, productId, variantId]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Add to wishlist error:', err);
    res.status(500).json({ error: 'Error al agregar a wishlist' });
  }
});

// =============================================
// DELETE /api/wishlist/:productId - Remove from wishlist
// =============================================
router.delete('/:productId', requireAuth, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    const variantId = (req.query.variant_id || req.body?.variant_id) ? parseInt(req.query.variant_id || req.body.variant_id) : null;
    if (variantId) {
      await pool.query(
        'DELETE FROM wishlists WHERE user_id = ? AND product_id = ? AND variant_id = ?',
        [req.user.id, productId, variantId]
      );
    } else {
      await pool.query(
        'DELETE FROM wishlists WHERE user_id = ? AND product_id = ? AND variant_id IS NULL',
        [req.user.id, productId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Remove from wishlist error:', err);
    res.status(500).json({ error: 'Error al remover de wishlist' });
  }
});

// =============================================
// GET /api/wishlist/check/:productId - Check if product is in wishlist
// =============================================
router.get('/check/:productId', requireAuth, async (req, res) => {
  try {
    const variantId = req.query.variant_id ? parseInt(req.query.variant_id) : null;
    let query, params;
    if (variantId) {
      query = 'SELECT id FROM wishlists WHERE user_id = ? AND product_id = ? AND variant_id = ?';
      params = [req.user.id, parseInt(req.params.productId), variantId];
    } else {
      query = 'SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?';
      params = [req.user.id, parseInt(req.params.productId)];
    }
    const [rows] = await pool.query(query, params);
    res.json({ inWishlist: rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
