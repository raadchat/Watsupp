// routes/logout.js
// مسار مستقل خاص به (نفس أسلوب routes/auth.js لـ /api/login) بدل تحميله
// تحت مسار آخر — المرحلة 8: يحتاج توكناً صالحاً ليعرف صاحب الجلسة المُغلَقة.

const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

// POST /api/logout
router.post('/', authenticateToken, authController.logout);

module.exports = router;
