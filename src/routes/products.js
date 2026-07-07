const express = require('express');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function formatProduct(row, variants = [], galleryMap = {}) {
  const pg = galleryMap[row.id] || {};
  // Pick the cheapest variant as default display price
  const defaultVariant = variants.length > 0
    ? variants.reduce((min, v) => v.price_final < min.price_final ? v : min, variants[0])
    : null;

  return {
    id: row.id,
    slug: row.slug || null,
    title: row.title,
    artist: row.artist,
    description: row.description || '',
    tracklist: row.tracklist || null,
    genre: row.genre || null,
    coverImage: row.coverImage || null,
    gallery_first: pg['_general'] || null,
    rating: parseFloat(row.rating) || 0,
    reviewCount: row.reviewCount || 0,
    isActive: Boolean(row.isActive),
    isFeatured: Boolean(row.isFeatured),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Variant-aware fields
    variants: variants.map(v => ({
      id: v.id,
      type: v.type,
      label: v.label || null,
      cover_image: v.cover_image || null,
      gallery_first: pg[v.id] || pg['_general'] || null,
      price_original: parseInt(v.price_original) || null,
      price_final: parseInt(v.price_final),
      stock: v.stock || 0,
      sku: v.sku || null,
      tracklist: v.tracklist || null,
      is_active: Boolean(v.is_active),
    })),
    // Convenience: default variant info for listings
    type: defaultVariant?.type || null,
    price_original: defaultVariant ? (parseInt(defaultVariant.price_original) || 0) : 0,
    price_final: defaultVariant ? parseInt(defaultVariant.price_final) : 0,
    stock: defaultVariant?.stock || 0,
  };
}

async function getVariantsForProducts(productIds) {
  if (productIds.length === 0) return {};
  const [variants] = await pool.query(
    `SELECT * FROM product_variants WHERE product_id IN (?) AND is_active = 1 ORDER BY position ASC, id ASC`,
    [productIds]
  );
  const map = {};
  for (const v of variants) {
    if (!map[v.product_id]) map[v.product_id] = [];
    map[v.product_id].push(v);
  }
  return map;
}

// Returns { productId: { variantId: imageUrl, '_general': imageUrl } }
async function getFirstGalleryImages(productIds) {
  if (productIds.length === 0) return {};
  const [rows] = await pool.query(
    `SELECT product_id, variant_id, image_url FROM product_images WHERE product_id IN (?) ORDER BY position ASC, id ASC`,
    [productIds]
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.product_id]) map[r.product_id] = {};
    const key = r.variant_id || '_general';
    if (!map[r.product_id][key]) {
      map[r.product_id][key] = r.image_url;
    }
  }
  return map;
}

// GET /products/autocomplete
router.get('/autocomplete', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const searchTerm = `%${q}%`;
    const [rows] = await pool.query(
      `SELECT p.id, p.slug, p.title, p.artist, p.coverImage,
              (SELECT pv.type FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = 1 ORDER BY pv.price_final ASC LIMIT 1) as type,
              (SELECT pv.price_final FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = 1 ORDER BY pv.price_final ASC LIMIT 1) as price_final
       FROM products p WHERE p.isActive = 1 AND (p.title LIKE ? OR p.artist LIKE ?) 
       ORDER BY p.title ASC LIMIT 8`,
      [searchTerm, searchTerm]
    );
    res.json({ results: rows });
  } catch (err) {
    console.error('Autocomplete error:', err);
    res.status(500).json({ error: 'Error en autocompletado' });
  }
});

// GET /products/sliders (public)
router.get('/sliders', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, subtitle, image_url, link_url FROM home_sliders WHERE is_active = 1 ORDER BY position ASC'
    );
    res.json({ sliders: rows });
  } catch (err) {
    console.error('Sliders error:', err);
    res.status(500).json({ error: 'Error al obtener sliders' });
  }
});

// GET /api/products/announcements (public)
router.get('/announcements', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, message, link_url FROM announcements WHERE is_active = 1 ORDER BY position ASC, id ASC'
    );
    res.json({ announcements: rows });
  } catch (err) {
    console.error('Get public announcements error:', err);
    res.json({ announcements: [] });
  }
});

// GET /api/products/site-config (public)
router.get('/site-config', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM site_settings');
    const settings = {};
    for (const row of rows) {
      settings[row.setting_key] = row.setting_value;
    }
    res.json({ settings });
  } catch (err) {
    console.error('Get public site config error:', err);
    res.json({ settings: {} });
  }
});

// GET /products
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const type = req.query.type || null;
    const filterIds = req.query.ids ? req.query.ids.split(',').map(Number).filter(n => n > 0) : null;

    let where = 'WHERE p.isActive = 1';
    const params = [];

    if (filterIds && filterIds.length > 0) {
      where += ' AND p.id IN (?)';
      params.push(filterIds);
    }

    if (type) {
      where += ' AND p.id IN (SELECT product_id FROM product_variants WHERE type = ? AND is_active = 1)';
      params.push(type);
    }

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM products p ${where}`, params
    );
    const total = countResult[0].total;

    const [products] = await pool.query(
      `SELECT p.* FROM products p ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const ids = products.map(p => p.id);
    const [variantsMap, galleryMap] = await Promise.all([getVariantsForProducts(ids), getFirstGalleryImages(ids)]);

    res.json({
      products: products.map(p => formatProduct(p, variantsMap[p.id] || [], galleryMap)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Products index error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products/featured
router.get('/featured', async (req, res) => {
  try {
    let [products] = await pool.query(
      'SELECT * FROM products WHERE isFeatured = 1 AND isActive = 1 ORDER BY updatedAt DESC LIMIT 20'
    );

    if (products.length === 0) {
      [products] = await pool.query(
        'SELECT * FROM products WHERE isActive = 1 ORDER BY id DESC LIMIT 20'
      );
    }

    const ids = products.map(p => p.id);
    const [variantsMap, galleryMap] = await Promise.all([getVariantsForProducts(ids), getFirstGalleryImages(ids)]);
    res.json({ products: products.map(p => formatProduct(p, variantsMap[p.id] || [], galleryMap)) });
  } catch (err) {
    console.error('Featured error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products/sections (public - for Home page)
router.get('/sections', async (req, res) => {
  try {
    const [sections] = await pool.query(
      'SELECT * FROM home_sections WHERE is_active = 1 ORDER BY position ASC'
    );

    const result = [];
    for (const section of sections) {
      let products;
      // Auto-fill "Novedades" with latest products
      if (section.title && section.title.toLowerCase().includes('novedades')) {
        [products] = await pool.query(
          'SELECT * FROM products WHERE isActive = 1 ORDER BY createdAt DESC LIMIT 12'
        );
      } else {
        [products] = await pool.query(
          `SELECT p.*
           FROM section_products sp
           JOIN products p ON p.id = sp.product_id
           WHERE sp.section_id = ?
           ORDER BY sp.position ASC`,
          [section.id]
        );
      }
      const ids = products.map(p => p.id);
      const [variantsMap, galleryMap] = await Promise.all([getVariantsForProducts(ids), getFirstGalleryImages(ids)]);
      result.push({
        id: section.id,
        title: section.title,
        subtitle: section.subtitle,
        link_url: section.link_url,
        link_text: section.link_text,
        products: products.map(p => formatProduct(p, variantsMap[p.id] || [], galleryMap))
      });
    }

    res.json({ sections: result });
  } catch (err) {
    console.error('Public sections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products/search
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ products: [] });

    const searchTerm = `%${q}%`;
    const [products] = await pool.query(
      'SELECT * FROM products WHERE isActive = 1 AND (title LIKE ? OR artist LIKE ? OR description LIKE ?) LIMIT 50',
      [searchTerm, searchTerm, searchTerm]
    );

    const ids = products.map(p => p.id);
    const [variantsMap, galleryMap] = await Promise.all([getVariantsForProducts(ids), getFirstGalleryImages(ids)]);
    res.json({ products: products.map(p => formatProduct(p, variantsMap[p.id] || [], galleryMap)) });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products/:slug (accepts slug or numeric id)
// GET /products/:slug/related
// Hybrid recommendation: co-purchase > browsing affinity > genre > popularity
router.get('/:slug/related', async (req, res) => {
  try {
    const param = req.params.slug;
    const isNumeric = /^\d+$/.test(param);
    const [rows] = await pool.query(
      isNumeric ? 'SELECT id, artist, genre FROM products WHERE id = ?' : 'SELECT id, artist, genre FROM products WHERE slug = ?',
      [isNumeric ? parseInt(param) : param]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });

    const { id, artist, genre } = rows[0];
    const limit = parseInt(req.query.limit) || 10;
    // viewedIds: comma-separated product IDs the user has recently viewed (from frontend localStorage)
    const viewedIds = (req.query.viewed || '').split(',').filter(Boolean).map(Number).filter(n => n > 0 && n !== id);

    // Score map: productId -> score
    const scores = {};
    const addScore = (pid, points) => { scores[pid] = (scores[pid] || 0) + points; };

    // 1. Co-purchase: products bought together with this one (strongest signal)
    try {
      const [coPurchased] = await pool.query(
        `SELECT oi2.producto_id, COUNT(*) as freq
         FROM orden_items oi1
         JOIN orden_items oi2 ON oi1.orden_id = oi2.orden_id AND oi2.producto_id != oi1.producto_id
         JOIN products p ON p.id = oi2.producto_id AND p.isActive = 1
         WHERE oi1.producto_id = ?
         GROUP BY oi2.producto_id
         ORDER BY freq DESC
         LIMIT 20`,
        [id]
      );
      for (const row of coPurchased) {
        addScore(row.producto_id, 50 + row.freq * 10);
      }
    } catch (e) {
      // Table may not exist yet — skip co-purchase signal
    }

    // 2. Browsing affinity: if user sent viewed products, find what genres/artists they like
    if (viewedIds.length > 0) {
      const [viewedProducts] = await pool.query(
        `SELECT id, artist, genre FROM products WHERE id IN (?)`,
        [viewedIds]
      );
      // Count genre/artist affinity from browsing
      const genreCounts = {};
      const artistCounts = {};
      for (const vp of viewedProducts) {
        if (vp.genre) genreCounts[vp.genre] = (genreCounts[vp.genre] || 0) + 1;
        if (vp.artist) artistCounts[vp.artist] = (artistCounts[vp.artist] || 0) + 1;
      }

      // Boost products matching viewed genres/artists
      const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
      const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);

      if (topGenres.length > 0 || topArtists.length > 0) {
        const conditions = [];
        const params = [];
        if (topGenres.length > 0) { conditions.push('p.genre IN (?)'); params.push(topGenres); }
        if (topArtists.length > 0) { conditions.push('p.artist IN (?)'); params.push(topArtists); }

        const [affinityProducts] = await pool.query(
          `SELECT p.id, p.artist, p.genre FROM products p
           WHERE p.id != ? AND p.isActive = 1 AND (${conditions.join(' OR ')})
           LIMIT 30`,
          [id, ...params]
        );
        for (const ap of affinityProducts) {
          if (topArtists.includes(ap.artist)) addScore(ap.id, 25);
          if (topGenres.includes(ap.genre)) addScore(ap.id, 15);
        }
      }
    }

    // 3. Content-based: same artist or genre as current product
    const [contentBased] = await pool.query(
      `SELECT p.id,
        CASE WHEN p.artist = ? THEN 20 ELSE 0 END +
        CASE WHEN p.genre = ? THEN 10 ELSE 0 END as content_score
       FROM products p
       WHERE p.id != ? AND p.isActive = 1 AND (p.artist = ? OR p.genre = ?)
       LIMIT 30`,
      [artist, genre, id, artist, genre]
    );
    for (const row of contentBased) {
      addScore(row.id, row.content_score);
    }

    // 4. Popularity fallback: high-rated products fill remaining slots
    const [popular] = await pool.query(
      `SELECT p.id FROM products p
       WHERE p.id != ? AND p.isActive = 1
       ORDER BY p.rating DESC, p.reviewCount DESC
       LIMIT 15`,
      [id]
    );
    for (const row of popular) {
      addScore(row.id, 5); // Low base score - only wins if nothing else matches
    }

    // Sort by score, take top N
    const rankedIds = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(e => parseInt(e[0]));

    if (rankedIds.length === 0) return res.json({ products: [] });

    // Fetch full product data
    const [related] = await pool.query(
      `SELECT p.* FROM products p WHERE p.id IN (?) AND p.isActive = 1`,
      [rankedIds]
    );

    // Maintain score order
    const relatedMap = {};
    for (const r of related) relatedMap[r.id] = r;
    const ordered = rankedIds.filter(rid => relatedMap[rid]).map(rid => relatedMap[rid]);

    const productIds = ordered.map(r => r.id);
    const variantsMap = await getVariantsForProducts(productIds);
    const galleryMap = await getFirstGalleryImages(productIds);

    const products = ordered.map(r => formatProduct(r, variantsMap[r.id] || [], galleryMap));

    res.json({ products });
  } catch (err) {
    console.error('Related products error:', err);
    res.status(500).json({ error: 'Error al obtener productos relacionados' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const param = req.params.slug;
    const isNumeric = /^\d+$/.test(param);
    const [rows] = await pool.query(
      isNumeric ? 'SELECT * FROM products WHERE id = ?' : 'SELECT * FROM products WHERE slug = ?',
      [isNumeric ? parseInt(param) : param]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });

    // Get variants
    const [variants] = await pool.query(
      `SELECT * FROM product_variants WHERE product_id = ? ORDER BY position ASC, id ASC`,
      [rows[0].id]
    );

    // Get additional images
    const [images] = await pool.query(
      'SELECT id, variant_id, image_url, alt_text, position FROM product_images WHERE product_id = ? ORDER BY position ASC',
      [rows[0].id]
    );

    const product = formatProduct(rows[0], variants);
    product.images = images.map(img => ({ id: img.id, variant_id: img.variant_id, url: img.image_url, alt: img.alt_text }));

    res.json(product);
  } catch (err) {
    console.error('Product show error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /products/:id/rate
router.post('/:id/rate', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const [product] = await pool.query('SELECT rating, reviewCount FROM products WHERE id = ?', [id]);
    if (!product[0]) return res.status(404).json({ error: 'Product not found' });

    const oldRating = parseFloat(product[0].rating) || 0;
    const oldCount = product[0].reviewCount || 0;
    const newCount = oldCount + 1;
    const newRating = ((oldRating * oldCount) + rating) / newCount;

    await pool.query(
      'UPDATE products SET rating = ?, reviewCount = ? WHERE id = ?',
      [newRating.toFixed(1), newCount, id]
    );

    res.json({ message: 'Rating saved', rating: newRating });
  } catch (err) {
    console.error('Rate error:', err);
    res.status(500).json({ error: 'Error saving rating' });
  }
});

module.exports = router;
