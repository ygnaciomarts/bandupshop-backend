const express = require('express');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// =============================================
// POST /api/coupons/validate - Validate a coupon code
// =============================================
router.post('/validate', requireAuth, async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) return res.status(400).json({ error: 'Se requiere un código' });

    const [rows] = await pool.query(
      'SELECT * FROM coupons WHERE code = ? AND is_active = 1',
      [code.toUpperCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Código de descuento no válido' });
    }

    const coupon = rows[0];
    const now = new Date();

    // Check dates
    if (coupon.starts_at && new Date(coupon.starts_at) > now) {
      return res.status(400).json({ error: 'Este cupón aún no está activo' });
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
      return res.status(400).json({ error: 'Este cupón ha expirado' });
    }

    // Check max uses
    if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
      return res.status(400).json({ error: 'Este cupón ha alcanzado su límite de usos' });
    }

    // Check min purchase
    if (coupon.min_purchase && subtotal < coupon.min_purchase) {
      return res.status(400).json({
        error: `Compra mínima de $${coupon.min_purchase} requerida para este cupón`
      });
    }

    // Calculate discount
    let discount = 0;
    if (coupon.type === 'percent') {
      discount = Math.round((subtotal * coupon.value) / 100);
    } else if (coupon.type === 'fixed') {
      discount = Math.min(parseFloat(coupon.value), subtotal);
    }

    res.json({
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        value: parseFloat(coupon.value),
        discount,
        freeShipping: coupon.type === 'free_shipping',
      },
    });
  } catch (err) {
    console.error('Validate coupon error:', err);
    res.status(500).json({ error: 'Error al validar cupón' });
  }
});

// =============================================
// POST /api/coupons/apply - Apply coupon to increment used_count
// =============================================
router.post('/apply', requireAuth, async (req, res) => {
  try {
    const { couponId } = req.body;
    if (!couponId) return res.status(400).json({ error: 'Se requiere couponId' });

    await pool.query(
      'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?',
      [couponId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Apply coupon error:', err);
    res.status(500).json({ error: 'Error al aplicar cupón' });
  }
});

module.exports = router;
