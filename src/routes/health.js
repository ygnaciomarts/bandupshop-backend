const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date(),
    memory: process.memoryUsage()
  });
});

module.exports = router;
