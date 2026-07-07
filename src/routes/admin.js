const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// --- Slug helper ---
const charMap = { '$': 's', '@': 'a', '&': 'and', '+': 'plus', '=': 'eq', '%': 'pct', '#': 'num', '!': '', '?': '', '*': '', '~': '', '^': '' };
function slugify(text) {
  let s = text.toLowerCase();
  s = s.replace(/['']/g, '');
  for (const [ch, rep] of Object.entries(charMap)) s = s.split(ch).join(rep);
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// --- Image upload config ---
const productsDir = path.join(__dirname, '../../uploads/products');
if (!fs.existsSync(productsDir)) {
  fs.mkdirSync(productsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, productsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `product-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// =============================================
// PRODUCTS CRUD
// =============================================

// GET /api/admin/products
router.get('/products', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    let where = '';
    const params = [];

    if (search) {
      where = 'WHERE p.title LIKE ? OR p.artist LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM products p ${where}`, params
    );
    const total = countResult[0].total;

    const [products] = await pool.query(
      `SELECT p.* FROM products p ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get variants for all products
    const ids = products.map(p => p.id);
    let variantsMap = {};
    if (ids.length > 0) {
      const [variants] = await pool.query(
        `SELECT * FROM product_variants WHERE product_id IN (?) ORDER BY position ASC, id ASC`,
        [ids]
      );
      for (const v of variants) {
        if (!variantsMap[v.product_id]) variantsMap[v.product_id] = [];
        variantsMap[v.product_id].push(v);
      }
    }

    res.json({
      products: products.map(p => formatAdminProduct(p, variantsMap[p.id] || [])),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Admin products error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/admin/products/:id
router.get('/products/:id', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    const [variants] = await pool.query(
      `SELECT * FROM product_variants WHERE product_id = ? ORDER BY position ASC, id ASC`,
      [req.params.id]
    );
    res.json({ product: formatAdminProduct(rows[0], variants) });
  } catch (err) {
    console.error('Admin product detail error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/admin/products
router.post('/products', requireAdmin, upload.single('imagen'), async (req, res) => {
  try {
    const { nombre, artista, descripcion, tracklist, featured, variants: variantsJson } = req.body;

    if (!nombre || !artista) {
      return res.status(400).json({ error: 'Campos requeridos: nombre, artista' });
    }

    const coverImage = req.file ? `/uploads/products/${req.file.filename}` : null;

    // Generate slug
    const slug = slugify(nombre.trim() + '-' + artista.trim());

    // Create product
    const [result] = await pool.query(
      `INSERT INTO products (title, artist, slug, description, tracklist, coverImage, isFeatured, isActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        nombre.trim(),
        artista.trim(),
        slug,
        descripcion || null,
        tracklist || null,
        coverImage,
        featured === 'true' || featured === '1' ? 1 : 0
      ]
    );

    const productId = result.insertId;

    // Create variants
    let variants = [];
    try { variants = JSON.parse(variantsJson || '[]') } catch {}
    
    // If no variants sent, create a default LP variant with legacy fields
    if (variants.length === 0 && req.body.tipo) {
      variants = [{ type: req.body.tipo, price_final: parseInt(req.body.precio) || 0, price_original: parseInt(req.body.precio) || 0, stock: parseInt(req.body.existencias) || 0 }];
    }

    for (let idx = 0; idx < variants.length; idx++) {
      const v = variants[idx];
      if (!v.type || !v.price_final) continue;
      await pool.query(
        `INSERT INTO product_variants (product_id, type, label, price_original, price_final, stock, position, tracklist)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [productId, v.type, v.label || null, v.price_original || v.price_final, v.price_final, v.stock || 0, idx + 1, v.tracklist || null]
      );
    }

    const [newProduct] = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);
    const [newVariants] = await pool.query('SELECT * FROM product_variants WHERE product_id = ? ORDER BY position ASC, id ASC', [productId]);

    res.json({ success: true, product: formatAdminProduct(newProduct[0], newVariants) });
  } catch (err) {
    console.error('Admin create product error:', err);
    res.status(500).json({ error: 'Error al crear el producto' });
  }
});

// PUT /api/admin/products/:id
router.put('/products/:id', requireAdmin, upload.single('imagen'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nombre, artista, descripcion, tracklist, featured, variants: variantsJson } = req.body;

    const [current] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (!current[0]) return res.status(404).json({ error: 'Producto no encontrado' });

    let coverImage = current[0].coverImage;
    if (req.file) {
      if (coverImage && coverImage.startsWith('/uploads/')) {
        const oldPath = path.join(__dirname, '../../', coverImage);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      coverImage = `/uploads/products/${req.file.filename}`;
    }

    const newTitle = nombre?.trim() || current[0].title;
    const newArtist = artista?.trim() || current[0].artist;
    const slug = slugify(newTitle + '-' + newArtist);

    await pool.query(
      `UPDATE products SET title = ?, artist = ?, slug = ?, description = ?, tracklist = ?, coverImage = ?, isFeatured = ? WHERE id = ?`,
      [
        newTitle,
        newArtist,
        slug,
        descripcion !== undefined ? descripcion : current[0].description,
        tracklist !== undefined ? tracklist : current[0].tracklist,
        coverImage,
        featured === 'true' || featured === '1' ? 1 : 0,
        id
      ]
    );

    // Update variants if provided (smart: update existing, insert new, delete removed)
    let variants = null;
    try { variants = JSON.parse(variantsJson || 'null') } catch {}

    if (variants && Array.isArray(variants)) {
      const incomingIds = variants.filter(v => v.id).map(v => v.id);

      // Delete variants that are no longer in the list
      if (incomingIds.length > 0) {
        await pool.query(
          'DELETE FROM product_variants WHERE product_id = ? AND id NOT IN (?)',
          [id, incomingIds]
        );
      } else {
        await pool.query('DELETE FROM product_variants WHERE product_id = ?', [id]);
      }

      for (let idx = 0; idx < variants.length; idx++) {
        const v = variants[idx];
        if (!v.type || !v.price_final) continue;
        if (v.id) {
          // Update existing variant (preserve cover_image)
          await pool.query(
            `UPDATE product_variants SET type = ?, label = ?, price_original = ?, price_final = ?, stock = ?, position = ?, tracklist = ?
             WHERE id = ? AND product_id = ?`,
            [v.type, v.label || null, v.price_original || v.price_final, v.price_final, v.stock || 0, idx + 1, v.tracklist || null, v.id, id]
          );
        } else {
          // Insert new variant
          await pool.query(
            `INSERT INTO product_variants (product_id, type, label, price_original, price_final, stock, position, tracklist)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, v.type, v.label || null, v.price_original || v.price_final, v.price_final, v.stock || 0, idx + 1, v.tracklist || null]
          );
        }
      }
    }

    const [updated] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    const [updatedVariants] = await pool.query('SELECT * FROM product_variants WHERE product_id = ? ORDER BY position ASC, id ASC', [id]);
    res.json({ success: true, product: formatAdminProduct(updated[0], updatedVariants) });
  } catch (err) {
    console.error('Admin update product error:', err);
    res.status(500).json({ error: 'Error al actualizar el producto' });
  }
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const [product] = await pool.query('SELECT coverImage FROM products WHERE id = ?', [id]);
    if (!product[0]) return res.status(404).json({ error: 'Producto no encontrado' });

    if (product[0].coverImage && product[0].coverImage.startsWith('/uploads/')) {
      const imgPath = path.join(__dirname, '../../', product[0].coverImage);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    await pool.query('DELETE FROM section_products WHERE product_id = ?', [id]);
    await pool.query('DELETE FROM products WHERE id = ?', [id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete product error:', err);
    res.status(500).json({ error: 'Error al eliminar el producto' });
  }
});

// PATCH /api/admin/products/:id/featured
router.patch('/products/:id/featured', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { featured } = req.body;

    await pool.query('UPDATE products SET isFeatured = ? WHERE id = ?', [featured ? 1 : 0, id]);
    res.json({ success: true, featured: Boolean(featured) });
  } catch (err) {
    console.error('Toggle featured error:', err);
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// =============================================
// HOME SECTIONS
// =============================================

// GET /api/admin/sections
router.get('/sections', requireAdmin, async (req, res) => {
  try {
    const [sections] = await pool.query(
      'SELECT * FROM home_sections ORDER BY position ASC'
    );

    const result = [];
    for (const section of sections) {
      const [products] = await pool.query(
        `SELECT p.*, sp.position as section_position
         FROM section_products sp
         JOIN products p ON p.id = sp.product_id
         WHERE sp.section_id = ?
         ORDER BY sp.position ASC`,
        [section.id]
      );
      // Get variants for section products
      const pIds = products.map(p => p.id);
      let vMap = {};
      if (pIds.length > 0) {
        const [pvs] = await pool.query(`SELECT * FROM product_variants WHERE product_id IN (?) ORDER BY position ASC, id ASC`, [pIds]);
        for (const v of pvs) { if (!vMap[v.product_id]) vMap[v.product_id] = []; vMap[v.product_id].push(v); }
      }
      result.push({
        ...section,
        is_active: Boolean(section.is_active),
        products: products.map(p => formatAdminProduct(p, vMap[p.id] || []))
      });
    }

    res.json({ sections: result });
  } catch (err) {
    console.error('Admin sections error:', err);
    res.status(500).json({ error: 'Error al obtener secciones' });
  }
});

// POST /api/admin/sections
router.post('/sections', requireAdmin, async (req, res) => {
  try {
    const { title, subtitle, link_url, link_text } = req.body;
    if (!title) return res.status(400).json({ error: 'El titulo es requerido' });

    const [maxPos] = await pool.query('SELECT COALESCE(MAX(position), 0) + 1 as next FROM home_sections');

    const [result] = await pool.query(
      `INSERT INTO home_sections (title, subtitle, link_url, link_text, position, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [title.trim(), subtitle || null, link_url || null, link_text || null, maxPos[0].next]
    );

    res.json({
      success: true,
      section: { id: result.insertId, title: title.trim(), subtitle, link_url, link_text, position: maxPos[0].next, is_active: true, products: [] }
    });
  } catch (err) {
    console.error('Create section error:', err);
    res.status(500).json({ error: 'Error al crear seccion' });
  }
});

// PUT /api/admin/sections/reorder (MUST be before :id)
router.put('/sections/reorder', requireAdmin, async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Se requiere array "order"' });

    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE home_sections SET position = ? WHERE id = ?', [i + 1, order[i]]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Reorder sections error:', err);
    res.status(500).json({ error: 'Error al reordenar' });
  }
});

// PUT /api/admin/sections/:id
router.put('/sections/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, subtitle, link_url, link_text, is_active } = req.body;

    await pool.query(
      `UPDATE home_sections SET title = ?, subtitle = ?, link_url = ?, link_text = ?, is_active = ? WHERE id = ?`,
      [title?.trim(), subtitle || null, link_url || null, link_text || null, is_active ? 1 : 0, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Update section error:', err);
    res.status(500).json({ error: 'Error al actualizar seccion' });
  }
});

// DELETE /api/admin/sections/:id
router.delete('/sections/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM section_products WHERE section_id = ?', [id]);
    await pool.query('DELETE FROM home_sections WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete section error:', err);
    res.status(500).json({ error: 'Error al eliminar seccion' });
  }
});

// PUT /api/admin/sections/:id/products
router.put('/sections/:id/products', requireAdmin, async (req, res) => {
  try {
    const sectionId = parseInt(req.params.id);
    const { productIds } = req.body;

    if (!Array.isArray(productIds)) return res.status(400).json({ error: 'Se requiere array "productIds"' });

    await pool.query('DELETE FROM section_products WHERE section_id = ?', [sectionId]);

    if (productIds.length > 0) {
      const values = productIds.map((pid, i) => [sectionId, pid, i + 1]);
      await pool.query(
        'INSERT INTO section_products (section_id, product_id, position) VALUES ?',
        [values]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Update section products error:', err);
    res.status(500).json({ error: 'Error al actualizar productos de seccion' });
  }
});

// =============================================
// ORDERS
// =============================================

// GET /api/admin/orders
router.get('/orders', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.id, o.total, o.estado, o.created_at, u.usuario, u.email
      FROM ordenes o
      JOIN usuarios u ON o.usuario_id = u.id
      ORDER BY o.created_at DESC
    `);
    res.json({ orders: rows });
  } catch (err) {
    console.error('Admin orders error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================================
// SLIDERS
// =============================================

// GET /api/admin/sliders
router.get('/sliders', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM home_sliders ORDER BY position ASC');
    res.json({ sliders: rows });
  } catch (err) {
    console.error('Admin sliders error:', err);
    res.status(500).json({ error: 'Error al obtener sliders' });
  }
});

// POST /api/admin/sliders
router.post('/sliders', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { title, subtitle, link_url } = req.body;
    const image_url = req.file ? `/uploads/${req.file.filename}` : req.body.image_url;
    if (!image_url) return res.status(400).json({ error: 'Se requiere imagen' });

    const [maxPos] = await pool.query('SELECT COALESCE(MAX(position), 0) as maxP FROM home_sliders');
    const position = maxPos[0].maxP + 1;

    const [result] = await pool.query(
      'INSERT INTO home_sliders (title, subtitle, image_url, link_url, position) VALUES (?, ?, ?, ?, ?)',
      [title || null, subtitle || null, image_url, link_url || null, position]
    );

    res.status(201).json({ success: true, slider: { id: result.insertId, title, subtitle, image_url, link_url, position, is_active: 1 } });
  } catch (err) {
    console.error('Create slider error:', err);
    res.status(500).json({ error: 'Error al crear slider' });
  }
});

// PUT /api/admin/sliders/reorder
router.put('/sliders/reorder', requireAdmin, async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Se requiere array "order"' });

    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE home_sliders SET position = ? WHERE id = ?', [i + 1, order[i]]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Reorder sliders error:', err);
    res.status(500).json({ error: 'Error al reordenar sliders' });
  }
});

// PUT /api/admin/sliders/:id
router.put('/sliders/:id', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, subtitle, link_url, is_active } = req.body;
    const image_url = req.file ? `/uploads/${req.file.filename}` : req.body.image_url;

    const fields = [];
    const values = [];

    if (title !== undefined) { fields.push('title = ?'); values.push(title); }
    if (subtitle !== undefined) { fields.push('subtitle = ?'); values.push(subtitle); }
    if (image_url) { fields.push('image_url = ?'); values.push(image_url); }
    if (link_url !== undefined) { fields.push('link_url = ?'); values.push(link_url); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(parseInt(is_active)); }

    if (fields.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

    values.push(id);
    await pool.query(`UPDATE home_sliders SET ${fields.join(', ')} WHERE id = ?`, values);

    res.json({ success: true });
  } catch (err) {
    console.error('Update slider error:', err);
    res.status(500).json({ error: 'Error al actualizar slider' });
  }
});

// DELETE /api/admin/sliders/:id
router.delete('/sliders/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM home_sliders WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete slider error:', err);
    res.status(500).json({ error: 'Error al eliminar slider' });
  }
});

// =============================================
// COUPONS
// =============================================

router.get('/coupons', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json({ coupons: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener cupones' });
  }
});

router.post('/coupons', requireAdmin, async (req, res) => {
  try {
    const { code, type, value, min_purchase, max_uses, starts_at, expires_at } = req.body;
    if (!code || !type) return res.status(400).json({ error: 'Código y tipo requeridos' });

    const [result] = await pool.query(
      `INSERT INTO coupons (code, type, value, min_purchase, max_uses, starts_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [code.toUpperCase().trim(), type, value || 0, min_purchase || 0, max_uses || null, starts_at || null, expires_at || null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este código ya existe' });
    res.status(500).json({ error: 'Error al crear cupón' });
  }
});

router.put('/coupons/:id', requireAdmin, async (req, res) => {
  try {
    const { code, type, value, min_purchase, max_uses, starts_at, expires_at, is_active } = req.body;
    const fields = [];
    const values = [];

    if (code !== undefined) { fields.push('code = ?'); values.push(code.toUpperCase().trim()); }
    if (type !== undefined) { fields.push('type = ?'); values.push(type); }
    if (value !== undefined) { fields.push('value = ?'); values.push(value); }
    if (min_purchase !== undefined) { fields.push('min_purchase = ?'); values.push(min_purchase); }
    if (max_uses !== undefined) { fields.push('max_uses = ?'); values.push(max_uses); }
    if (starts_at !== undefined) { fields.push('starts_at = ?'); values.push(starts_at || null); }
    if (expires_at !== undefined) { fields.push('expires_at = ?'); values.push(expires_at || null); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }

    if (fields.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

    values.push(parseInt(req.params.id));
    await pool.query(`UPDATE coupons SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar cupón' });
  }
});

router.delete('/coupons/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM coupons WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar cupón' });
  }
});

// =============================================
// COLLECTIONS
// =============================================

router.get('/collections', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM collections ORDER BY position ASC');
    res.json({ collections: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener colecciones' });
  }
});

router.post('/collections', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Título requerido' });

    const slug = slugify(title);
    const cover_image = req.file ? `/uploads/${req.file.filename}` : req.body.cover_image || null;

    const [maxPos] = await pool.query('SELECT COALESCE(MAX(position), 0) as m FROM collections');
    const [result] = await pool.query(
      'INSERT INTO collections (title, slug, description, cover_image, position) VALUES (?, ?, ?, ?, ?)',
      [title, slug, description || null, cover_image, maxPos[0].m + 1]
    );
    res.status(201).json({ success: true, id: result.insertId, slug });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una colección con este nombre' });
    res.status(500).json({ error: 'Error al crear colección' });
  }
});

router.put('/collections/:id', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { title, description, is_active } = req.body;
    const cover_image = req.file ? `/uploads/${req.file.filename}` : req.body.cover_image;
    const fields = [];
    const values = [];

    if (title !== undefined) {
      fields.push('title = ?', 'slug = ?');
      values.push(title, title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
    }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (cover_image) { fields.push('cover_image = ?'); values.push(cover_image); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(parseInt(is_active)); }

    if (fields.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

    values.push(parseInt(req.params.id));
    await pool.query(`UPDATE collections SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar colección' });
  }
});

router.delete('/collections/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM collection_products WHERE collection_id = ?', [id]);
    await pool.query('DELETE FROM collections WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar colección' });
  }
});

router.put('/collections/:id/products', requireAdmin, async (req, res) => {
  try {
    const collectionId = parseInt(req.params.id);
    const { productIds } = req.body;
    if (!Array.isArray(productIds)) return res.status(400).json({ error: 'Se requiere array productIds' });

    await pool.query('DELETE FROM collection_products WHERE collection_id = ?', [collectionId]);
    if (productIds.length > 0) {
      const values = productIds.map((pid, i) => [collectionId, pid, i + 1]);
      await pool.query('INSERT INTO collection_products (collection_id, product_id, position) VALUES ?', [values]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar productos' });
  }
});

// =============================================
// VARIANT COVER IMAGE
// =============================================

router.put('/products/:id/variants/:variantId/cover', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const variantId = parseInt(req.params.variantId);
    const image_url = req.file ? `/uploads/products/${req.file.filename}` : null;
    if (!image_url) return res.status(400).json({ error: 'Imagen requerida' });

    await pool.query(
      'UPDATE product_variants SET cover_image = ? WHERE id = ? AND product_id = ?',
      [image_url, variantId, productId]
    );
    res.json({ success: true, cover_image: image_url });
  } catch (err) {
    console.error('Variant cover upload error:', err);
    res.status(500).json({ error: 'Error al subir portada de variante' });
  }
});

router.delete('/products/:id/variants/:variantId/cover', requireAdmin, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const variantId = parseInt(req.params.variantId);
    await pool.query(
      'UPDATE product_variants SET cover_image = NULL WHERE id = ? AND product_id = ?',
      [variantId, productId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar portada de variante' });
  }
});

// =============================================
// PRODUCT IMAGES
// =============================================

router.get('/products/:id/images', requireAdmin, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const variantId = req.query.variant_id ? parseInt(req.query.variant_id) : null;
    let query = 'SELECT * FROM product_images WHERE product_id = ?';
    const params = [productId];
    if (variantId) {
      query += ' AND variant_id = ?';
      params.push(variantId);
    } else {
      query += ' AND variant_id IS NULL';
    }
    query += ' ORDER BY position ASC';
    const [rows] = await pool.query(query, params);
    res.json({ images: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener imágenes' });
  }
});

router.post('/products/:id/images', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const variantId = req.body.variant_id ? parseInt(req.body.variant_id) : null;
    const image_url = req.file ? `/uploads/products/${req.file.filename}` : req.body.image_url;
    if (!image_url) return res.status(400).json({ error: 'Imagen requerida' });

    const [maxPos] = await pool.query(
      'SELECT COALESCE(MAX(position),0) as m FROM product_images WHERE product_id = ? AND (variant_id = ? OR (? IS NULL AND variant_id IS NULL))',
      [productId, variantId, variantId]
    );
    const [result] = await pool.query(
      'INSERT INTO product_images (product_id, variant_id, image_url, alt_text, position) VALUES (?, ?, ?, ?, ?)',
      [productId, variantId, image_url, req.body.alt_text || null, maxPos[0].m + 1]
    );
    res.status(201).json({ success: true, id: result.insertId, image_url, variant_id: variantId });
  } catch (err) {
    console.error('Upload image error:', err);
    res.status(500).json({ error: 'Error al subir imagen' });
  }
});

router.delete('/products/:id/images/:imageId', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM product_images WHERE id = ? AND product_id = ?', [parseInt(req.params.imageId), parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar imagen' });
  }
});

// =============================================
// ORDER STATUS
// =============================================

router.put('/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!status) return res.status(400).json({ error: 'Status requerido' });

    const orderId = parseInt(req.params.id);
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
    await pool.query(
      'INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)',
      [orderId, status, note || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

router.get('/orders/:id/history', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC',
      [parseInt(req.params.id)]
    );
    res.json({ history: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// =============================================
// ANALYTICS
// =============================================

router.get('/analytics', requireAdmin, async (req, res) => {
  try {
    const [totalProducts] = await pool.query('SELECT COUNT(*) as c FROM products WHERE isActive = 1');
    const [totalOrders] = await pool.query('SELECT COUNT(*) as c FROM orders');
    const [totalRevenue] = await pool.query('SELECT COALESCE(SUM(total), 0) as t FROM orders WHERE status != "cancelled"');
    const [totalUsers] = await pool.query('SELECT COUNT(*) as c FROM usuarios');
    const [recentOrders] = await pool.query(
      `SELECT o.id, o.total, o.status, o.created_at, u.nombre, u.email
       FROM orders o LEFT JOIN usuarios u ON o.user_id = u.id
       ORDER BY o.created_at DESC LIMIT 5`
    );
    const [topProducts] = await pool.query(
      `SELECT p.id, p.title, p.artist, p.coverImage, p.price_final, p.rating, p.reviewCount
       FROM products p WHERE p.isActive = 1
       ORDER BY p.reviewCount DESC, p.rating DESC LIMIT 5`
    );
    const [monthlySales] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as orders, SUM(total) as revenue
       FROM orders WHERE status != 'cancelled'
       GROUP BY month ORDER BY month DESC LIMIT 6`
    );

    res.json({
      summary: {
        products: totalProducts[0].c,
        orders: totalOrders[0].c,
        revenue: parseFloat(totalRevenue[0].t),
        users: totalUsers[0].c,
      },
      recentOrders,
      topProducts,
      monthlySales: monthlySales.reverse(),
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Error al obtener analytics' });
  }
});

// =============================================
// USERS
// =============================================

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT id, usuario, email, nombre, apellido, su
       FROM usuarios ORDER BY id DESC`
    );
    res.json({ users });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

router.put('/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { su } = req.body;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    }
    await pool.query('UPDATE usuarios SET su = ? WHERE id = ?', [su ? 1 : 0, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
});

// =============================================
// HELPERS
// =============================================

function formatAdminProduct(p, variants = []) {
  const defaultVariant = variants.length > 0
    ? variants.reduce((min, v) => v.price_final < min.price_final ? v : min, variants[0])
    : null;

  return {
    id: p.id,
    slug: p.slug || null,
    nombre: p.title,
    artista: p.artist,
    descripcion: p.description || null,
    tracklist: p.tracklist || null,
    imagen: p.coverImage || null,
    featured: Boolean(p.isFeatured),
    isActive: Boolean(p.isActive),
    rating: parseFloat(p.rating) || 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    // Variants
    variants: variants.map(v => ({
      id: v.id,
      type: v.type,
      label: v.label || null,
      cover_image: v.cover_image || null,
      price_original: parseInt(v.price_original) || 0,
      price_final: parseInt(v.price_final),
      stock: v.stock || 0,
      tracklist: v.tracklist || null,
      is_active: Boolean(v.is_active),
    })),
    // Convenience (backward compat)
    tipo: defaultVariant?.type || null,
    precio: defaultVariant ? (parseInt(defaultVariant.price_original) || 0) : 0,
    precioDescuento: defaultVariant && defaultVariant.price_final !== defaultVariant.price_original ? parseInt(defaultVariant.price_final) : null,
    existencias: variants.reduce((sum, v) => sum + (v.stock || 0), 0),
  };
}

// =============================================
// ANNOUNCEMENTS (Ticker bar)
// =============================================

// GET /api/admin/announcements
router.get('/announcements', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM announcements ORDER BY position ASC, id ASC');
    res.json({ announcements: rows });
  } catch (err) {
    console.error('Get announcements error:', err);
    res.status(500).json({ error: 'Error al obtener anuncios' });
  }
});

// POST /api/admin/announcements
router.post('/announcements', requireAdmin, async (req, res) => {
  try {
    const { message, link_url } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'El mensaje es requerido' });
    const [maxPos] = await pool.query('SELECT COALESCE(MAX(position), 0) + 1 as next FROM announcements');
    const [result] = await pool.query(
      'INSERT INTO announcements (message, link_url, position) VALUES (?, ?, ?)',
      [message.trim(), link_url?.trim() || null, maxPos[0].next]
    );
    const [created] = await pool.query('SELECT * FROM announcements WHERE id = ?', [result.insertId]);
    res.json({ announcement: created[0] });
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Error al crear anuncio' });
  }
});

// PUT /api/admin/announcements/:id
router.put('/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { message, link_url, is_active } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'El mensaje es requerido' });
    await pool.query(
      'UPDATE announcements SET message = ?, link_url = ?, is_active = ? WHERE id = ?',
      [message.trim(), link_url?.trim() || null, is_active !== undefined ? (is_active ? 1 : 0) : 1, id]
    );
    const [updated] = await pool.query('SELECT * FROM announcements WHERE id = ?', [id]);
    res.json({ announcement: updated[0] });
  } catch (err) {
    console.error('Update announcement error:', err);
    res.status(500).json({ error: 'Error al actualizar anuncio' });
  }
});

// DELETE /api/admin/announcements/:id
router.delete('/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM announcements WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete announcement error:', err);
    res.status(500).json({ error: 'Error al eliminar anuncio' });
  }
});

// PUT /api/admin/announcements/reorder
router.put('/announcements-reorder', requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids requeridos' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < ids.length; i++) {
        await conn.query('UPDATE announcements SET position = ? WHERE id = ?', [i, ids[i]]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Reorder announcements error:', err);
    res.status(500).json({ error: 'Error al reordenar' });
  }
});

// =============================================
// SITE SETTINGS
// =============================================

// GET /api/admin/settings
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM site_settings');
    const settings = {};
    for (const row of rows) {
      settings[row.setting_key] = row.setting_value;
    }
    res.json({ settings });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// PUT /api/admin/settings
router.put('/settings', requireAdmin, async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object requerido' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const [key, value] of Object.entries(settings)) {
        const val = typeof value === 'object' ? JSON.stringify(value) : String(value);
        await conn.query(
          'INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [key, val, val]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

module.exports = router;
