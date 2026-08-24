// routes/categories.js

const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const categoriesController = require('../controllers/categoriesController');
const { authenticateToken, requireAdminRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

router.use(authenticateToken);
router.use(requireAdminRole); // كل مسارات هذا الملف إدارية بحتة — لا وصول لوكلاء خدمة العملاء

// GET /api/categories
router.get('/', categoriesController.getAllCategories);

// POST /api/categories
router.post(
  '/',
  body('category_id').trim().notEmpty().withMessage('معرف القسم (category_id) مطلوب'),
  body('name').trim().notEmpty().withMessage('اسم القسم مطلوب'),
  body('display_order').optional().isInt().withMessage('ترتيب الظهور يجب أن يكون رقماً صحيحاً'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('الحالة يجب أن تكون active أو inactive'),
  body('parent_category_id').optional({ nullable: true }).isInt().withMessage('القسم الأب غير صالح'),
  handleValidation,
  categoriesController.createCategory
);

// PUT /api/categories/:id
router.put(
  '/:id',
  param('id').isInt().withMessage('معرف غير صالح'),
  body('name').trim().notEmpty().withMessage('اسم القسم مطلوب'),
  body('display_order').optional().isInt().withMessage('ترتيب الظهور يجب أن يكون رقماً صحيحاً'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('الحالة يجب أن تكون active أو inactive'),
  body('parent_category_id').optional({ nullable: true }).isInt().withMessage('القسم الأب غير صالح'),
  handleValidation,
  categoriesController.updateCategory
);

// DELETE /api/categories/:id
router.delete(
  '/:id',
  param('id').isInt().withMessage('معرف غير صالح'),
  handleValidation,
  categoriesController.deleteCategory
);

module.exports = router;
