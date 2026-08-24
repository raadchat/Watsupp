// routes/botSettings.js

const express = require('express');
const router = express.Router();

const botSettingsController = require('../controllers/botSettingsController');
const { authenticateToken, requireAdminRole } = require('../middleware/auth');

router.use(authenticateToken);
router.use(requireAdminRole); // كل مسارات هذا الملف إدارية بحتة — لا وصول لوكلاء خدمة العملاء

// GET /api/bot-settings/welcome
router.get('/welcome', botSettingsController.getBotSettings);

// PUT /api/bot-settings/welcome  (multipart/form-data: welcome_message + image اختياري + remove_image اختياري)
router.put('/welcome', botSettingsController.upload.single('image'), botSettingsController.saveBotSettings);

module.exports = router;
