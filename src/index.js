require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const reviewRoutes = require('./routes/reviews');
const wishlistRoutes = require('./routes/wishlist');
const couponRoutes = require('./routes/coupons');
const collectionRoutes = require('./routes/collections');

const app = express();
const PORT = process.env.PORT || 3001;

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow image loading from frontend
  contentSecurityPolicy: false, // Let frontend handle CSP
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 1000, // 1000 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta de nuevo más tarde.' },
});
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // Stricter for auth endpoints
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
}));
app.use(apiLimiter);

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static uploads
app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'))
);

// Routes
app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/cart', cartRoutes);
app.use('/orders', orderRoutes);
app.use('/user', userRoutes);
app.use('/admin', adminRoutes);
app.use('/reviews', reviewRoutes);
app.use('/wishlist', wishlistRoutes);
app.use('/coupons', couponRoutes);
app.use('/collections', collectionRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'BandUp Shop API',
    version: '2.0',
    status: 'online'
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal server error',
  });
});

app.listen(PORT, async () => {
  console.log(`BandUp API running on port ${PORT}`);
  // Auto-migration: drop unique_product_type to allow multiple variants of the same type
  try {
    const pool = require('./config/database');
    const [rows] = await pool.query(`
      SELECT 1 FROM information_schema.TABLE_CONSTRAINTS 
      WHERE CONSTRAINT_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'product_variants' 
        AND CONSTRAINT_NAME = 'unique_product_type'
    `);
    if (rows.length > 0) {
      // Add a plain index on product_id so the FK doesn't depend on the unique composite index
      await pool.query("CREATE INDEX idx_pv_product_id ON product_variants (product_id)").catch(() => {});
      await pool.query("ALTER TABLE product_variants DROP INDEX unique_product_type");
      console.log('[migration] Dropped unique_product_type index — multiple variants per type now allowed');
    }
  } catch (e) {
    console.error('[migration] Error dropping unique_product_type:', e.message);
  }

  // Auto-migration: add position column to product_variants
  try {
    const pool = require('./config/database');
    const [cols] = await pool.query(`
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'position'
    `);
    if (cols.length === 0) {
      await pool.query("ALTER TABLE product_variants ADD COLUMN position INT NOT NULL DEFAULT 0");
      // Set initial positions based on current ID order
      await pool.query(`
        UPDATE product_variants pv
        JOIN (SELECT id, product_id, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY id) as rn FROM product_variants) r
        ON pv.id = r.id SET pv.position = r.rn
      `);
      console.log('[migration] Added position column to product_variants');
    }
  } catch (e) {
    console.error('[migration] Error adding position column:', e.message);
  }

  // Auto-migration: add tracklist column to product_variants
  try {
    const pool2 = require('./config/database');
    const [cols2] = await pool2.query(`
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'tracklist'
    `);
    if (cols2.length === 0) {
      await pool2.query("ALTER TABLE product_variants ADD COLUMN tracklist TEXT NULL");
      // Migrate product-level tracklist to first variant
      try {
        const [hasCol] = await pool2.query(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'tracklist'`);
        if (hasCol.length > 0) {
          await pool2.query(`
            UPDATE product_variants pv
            JOIN (SELECT product_id, MIN(id) as first_id FROM product_variants GROUP BY product_id) f ON pv.id = f.first_id
            JOIN products p ON p.id = pv.product_id
            SET pv.tracklist = p.tracklist
            WHERE p.tracklist IS NOT NULL AND p.tracklist != ''
          `);
        }
      } catch (_) {}
      console.log('[migration] Added tracklist column to product_variants');
    }
  } catch (e) {
    console.error('[migration] Error adding tracklist column:', e.message);
  }

  // Auto-migration: add variant_id column to product_images
  try {
    const pool3 = require('./config/database');
    const [cols3] = await pool3.query(`
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_images' AND COLUMN_NAME = 'variant_id'
    `);
    if (cols3.length === 0) {
      await pool3.query("ALTER TABLE product_images ADD COLUMN variant_id INT NULL AFTER product_id");
      console.log('[migration] Added variant_id column to product_images');
    }
  } catch (e) {
    console.error('[migration] Error adding variant_id column:', e.message);
  }

  // Auto-migration: create announcements table
  try {
    const pool4 = require('./config/database');
    await pool4.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INT PRIMARY KEY AUTO_INCREMENT,
        message VARCHAR(500) NOT NULL,
        link_url VARCHAR(500) DEFAULT NULL,
        is_active TINYINT DEFAULT 1,
        position INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // Add link_url if missing
    try {
      await pool4.query('ALTER TABLE announcements ADD COLUMN link_url VARCHAR(500) DEFAULT NULL AFTER message');
    } catch (_) {}
  } catch (e) {
    console.error('[migration] Error creating announcements table:', e.message);
  }
});
