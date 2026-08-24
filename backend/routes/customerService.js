// routes/customerService.js
// مفتوح لكل من admin و agent (النطاق يُحدَّد داخل الـ controller)، باستثناء
// حفظ الإعدادات (تفعيل/تسمية القسم الثابت) المقصور على admin تحديداً.

const express = require('express');
const { param, body } = require('express-validator');
const router = express.Router();

const customerServiceController = require('../controllers/customerServiceController');
const { authenticateToken, requireAdminRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

router.use(authenticateToken);

// GET /api/customer-service/settings
router.get('/settings', customerServiceController.getSettings);

// PUT /api/customer-service/settings — للمدير فقط
router.put(
  '/settings',
  requireAdminRole,
  body('enabled').isBoolean().withMessage('enabled يجب أن يكون true أو false'),
  body('label').optional().trim().notEmpty().withMessage('التسمية لا يمكن أن تكون فارغة'),
  handleValidation,
  customerServiceController.saveSettings
);

// GET /api/customer-service/queue — طابور الانتظار العام
router.get('/queue', customerServiceController.getQueue);

// GET /api/customer-service/my-conversations — محادثاتي النشطة أنا
router.get('/my-conversations', customerServiceController.getMyActiveConversations);

// POST /api/customer-service/:customerId/claim
router.post(
  '/:customerId/claim',
  param('customerId').isInt().withMessage('معرف غير صالح'),
  handleValidation,
  customerServiceController.claimConversation
);

// POST /api/customer-service/:customerId/end
router.post(
  '/:customerId/end',
  param('customerId').isInt().withMessage('معرف غير صالح'),
  handleValidation,
  customerServiceController.endConversation
);

module.exports = router;
