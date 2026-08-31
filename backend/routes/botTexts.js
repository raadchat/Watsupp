// routes/botTexts.js

const express = require('express');
const router = express.Router();

const botTextsController = require('../controllers/botTextsController');
const { authenticateToken, requireAdminRole } = require('../middleware/auth');

router.use(authenticateToken);
router.use(requireAdminRole); // المرحلة 4: التعديل (وحتى العرض) مقصور على admin — Agent ممنوع تماماً

// GET /api/bot-texts
router.get('/', botTextsController.getBotTexts);

// PUT /api/bot-texts  (body: { texts: { key: value, ... } })
router.put('/', botTextsController.saveBotTexts);

module.exports = router;
