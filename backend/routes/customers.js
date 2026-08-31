// routes/customers.js

const express = require('express');
const { param, body } = require('express-validator');
const router = express.Router();

const customersController = require('../controllers/customersController');
const { authenticateToken, requireAdminRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

router.use(authenticateToken);

// GET /api/customers?search=...&page=...&pageSize=...  — قائمة كل العملاء: للمدير فقط
router.get('/', requireAdminRole, customersController.getAllCustomers);

// GET /api/customers/:id — للمدير فقط (الوكيل يصل لعملائه عبر /api/customer-service بدل هذا)
router.get(
  '/:id',
  requireAdminRole,
  param('id').isInt().withMessage('معرف غير صالح'),
  handleValidation,
  customersController.getCustomerById
);

// GET /api/customers/:id/messages — سجل المحادثة كاملاً. مفتوح للمدير ولوكيل خدمة
// العملاء المُسنَد له هذا العميل تحديداً (assertCanAccessCustomer داخل الـ controller)
router.get(
  '/:id/messages',
  param('id').isInt().withMessage('معرف غير صالح'),
  handleValidation,
  customersController.getCustomerMessages
);

// POST /api/customers/:id/messages — رد يدوي مباشر (خارج آلة حالة البوت). نفس نطاق الصلاحية أعلاه
// المرحلة 2: multipart/form-data اختياري (attachment: صورة/فيديو/PDF) + message
// (نص الرسالة صار اختيارياً هنا تحديداً — التحقق "نص أو مرفق" داخل الـ controller)
router.post(
  '/:id/messages',
  param('id').isInt().withMessage('معرف غير صالح'),
  customersController.upload.single('attachment'),
  body('message').optional().trim(),
  handleValidation,
  customersController.sendCustomerMessage
);

module.exports = router;
