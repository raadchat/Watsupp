// routes/services.js
// كل مسار هنا محمي بـ authenticateToken — لا وصول بدون JWT صالح.

const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const servicesController = require('../controllers/servicesController');
const { authenticateToken } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

router.use(authenticateToken);

// GET /api/services
router.get('/', servicesController.getAllServices);

// POST /api/services
router.post(
  '/',
  body('service_id').trim().notEmpty().withMessage('معرف الخدمة (service_id) مطلوب'),
  body('name').trim().notEmpty().withMessage('اسم الخدمة مطلوب'),
  body('category_id').optional({ nullable: true }).isInt().withMessage('القسم المحدَّد غير صالح'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('الحالة يجب أن تكون active أو inactive'),
  body('reply_type').optional().isIn(['INFO', 'COLLECT_INPUT']).withMessage('نوع الرد يجب أن يكون INFO أو COLLECT_INPUT'),
  body('input_format')
    .optional({ nullable: true })
    .isIn(['NUMBERS', 'ALPHANUMERIC', 'LETTERS'])
    .withMessage('نوع المدخل يجب أن يكون أرقام أو أرقام وحروف أو حروف فقط'),
  body('external_api_url').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('رابط الـ API الخارجي غير صالح'),
  handleValidation,
  servicesController.createService
);

// PUT /api/services/:id
router.put(
  '/:id',
  param('id').isInt().withMessage('معرف غير صالح'),
  body('name').trim().notEmpty().withMessage('اسم الخدمة مطلوب'),
  body('category_id').optional({ nullable: true }).isInt().withMessage('القسم المحدَّد غير صالح'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('الحالة يجب أن تكون active أو inactive'),
  body('reply_type').optional().isIn(['INFO', 'COLLECT_INPUT']).withMessage('نوع الرد يجب أن يكون INFO أو COLLECT_INPUT'),
  body('input_format')
    .optional({ nullable: true })
    .isIn(['NUMBERS', 'ALPHANUMERIC', 'LETTERS'])
    .withMessage('نوع المدخل يجب أن يكون أرقام أو أرقام وحروف أو حروف فقط'),
  body('external_api_url').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('رابط الـ API الخارجي غير صالح'),
  handleValidation,
  servicesController.updateService
);

// DELETE /api/services/:id
router.delete(
  '/:id',
  param('id').isInt().withMessage('معرف غير صالح'),
  handleValidation,
  servicesController.deleteService
);

module.exports = router;
