const express = require('express');
const pool = require('../config/database');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// =============================================
// GET /api/reviews/:productId - Get reviews for a product
// =============================================
router.get('/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    const [reviews] = await pool.query(
      `SELECT r.id, r.user_id, r.rating, r.title, r.body, r.is_verified, r.created_at,
              u.nombre, u.apellido, u.usuario, u.avatar_url
       FROM reviews r
       LEFT JOIN usuarios u ON r.user_id = u.id
       WHERE r.product_id = ?
       ORDER BY r.created_at DESC`,
      [productId]
    );

    // Get stats
    const [stats] = await pool.query(
      `SELECT COUNT(*) as total, AVG(rating) as avg_rating,
              SUM(rating=5) as r5, SUM(rating=4) as r4,
              SUM(rating=3) as r3, SUM(rating=2) as r2, SUM(rating=1) as r1
       FROM reviews WHERE product_id = ?`,
      [productId]
    );

    res.json({
      reviews: reviews.map(r => ({
        id: r.id,
        userId: r.user_id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        isVerified: Boolean(r.is_verified),
        createdAt: r.created_at,
        author: {
          nombre: [r.nombre, r.apellido].filter(Boolean).join(' ') || 'Usuario',
          username: r.usuario || null,
          avatar: r.avatar_url || null,
        },
      })),
      stats: {
        total: stats[0].total || 0,
        average: parseFloat(stats[0].avg_rating) || 0,
        distribution: {
          5: parseInt(stats[0].r5) || 0,
          4: parseInt(stats[0].r4) || 0,
          3: parseInt(stats[0].r3) || 0,
          2: parseInt(stats[0].r2) || 0,
          1: parseInt(stats[0].r1) || 0,
        },
      },
    });
  } catch (err) {
    console.error('Get reviews error:', err);
    res.status(500).json({ error: 'Error al obtener reseñas' });
  }
});

// =============================================
// POST /api/reviews/:productId - Create a review
// =============================================
router.post('/:productId', requireAuth, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    const userId = req.user.id;
    const { rating, title, body } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating debe ser entre 1 y 5' });
    }
    if (!body || body.trim().length < 5) {
      return res.status(400).json({ error: 'La reseña debe tener al menos 5 caracteres' });
    }

    // Check if user already reviewed
    const [existing] = await pool.query(
      'SELECT id FROM reviews WHERE product_id = ? AND user_id = ?',
      [productId, userId]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ya has dejado una reseña para este producto' });
    }

    // Check if user purchased this product (verified review)
    let isVerified = 0;
    try {
      const [purchased] = await pool.query(
        `SELECT o.id FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE o.user_id = ? AND oi.product_id = ? AND o.status != 'cancelled'
         LIMIT 1`,
        [userId, productId]
      );
      isVerified = purchased.length > 0 ? 1 : 0;
    } catch {
      // order_items table may not exist yet - treat as unverified
      isVerified = 0;
    }

    await pool.query(
      'INSERT INTO reviews (product_id, user_id, rating, title, body, is_verified) VALUES (?, ?, ?, ?, ?, ?)',
      [productId, userId, rating, title || null, body.trim(), isVerified]
    );

    // Update product average rating
    const [avg] = await pool.query(
      'SELECT AVG(rating) as avg_r, COUNT(*) as cnt FROM reviews WHERE product_id = ?',
      [productId]
    );
    await pool.query(
      'UPDATE products SET rating = ?, reviewCount = ? WHERE id = ?',
      [parseFloat(avg[0].avg_r) || 0, avg[0].cnt || 0, productId]
    );

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ error: 'Error al crear reseña' });
  }
});

// =============================================
// PUT /api/reviews/:reviewId - Update own review
// =============================================
router.put('/:reviewId', requireAuth, async (req, res) => {
  try {
    const reviewId = parseInt(req.params.reviewId);
    const userId = req.user.id;
    const { rating, title, body } = req.body;

    // Verify ownership
    const [existing] = await pool.query(
      'SELECT id, product_id FROM reviews WHERE id = ? AND user_id = ?',
      [reviewId, userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Reseña no encontrada' });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating debe ser entre 1 y 5' });
    }
    if (!body || body.trim().length < 5) {
      return res.status(400).json({ error: 'La reseña debe tener al menos 5 caracteres' });
    }

    await pool.query(
      'UPDATE reviews SET rating = ?, title = ?, body = ? WHERE id = ?',
      [rating, title || null, body.trim(), reviewId]
    );

    // Update product average rating
    const productId = existing[0].product_id;
    const [avg] = await pool.query(
      'SELECT AVG(rating) as avg_r, COUNT(*) as cnt FROM reviews WHERE product_id = ?',
      [productId]
    );
    await pool.query(
      'UPDATE products SET rating = ?, reviewCount = ? WHERE id = ?',
      [parseFloat(avg[0].avg_r) || 0, avg[0].cnt || 0, productId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Update review error:', err);
    res.status(500).json({ error: 'Error al actualizar reseña' });
  }
});

module.exports = router;
