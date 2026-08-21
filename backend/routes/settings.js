// routes/settings.js

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const settingsController = require('../controllers/settingsController');
const { authenticateToken } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

router.use(authenticateToken);

// GET /api/settings/whatsapp
router.get('/whatsapp', settingsController.getWhatsAppSettings);

// PUT /api/settings/whatsapp — يحفظ ويختبر الاتصال فوراً في نفس الطلب
router.put(
  '/whatsapp',
  body('phone_number_id').trim().notEmpty().withMessage('معرّف رقم الهاتف مطلوب'),
  body('verify_token').trim().notEmpty().withMessage('Verify Token مطلوب'),
  body('access_token').optional({ nullable: true }).isString(),
  body('business_account_id').optional({ nullable: true }).isString(),
  handleValidation,
  settingsController.saveWhatsAppSettings
);

// POST /api/settings/whatsapp/test — إعادة اختبار ما هو محفوظ بالفعل، بلا نموذج
router.post('/whatsapp/test', settingsController.retestWhatsAppConnection);

module.exports = router;
