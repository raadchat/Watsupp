// routes/categories.js

const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const categoriesController = require('../controllers/categoriesController');
const { authenticateToken } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

router.use(authenticateToken);

// GET /api/categories
router.get('/', categoriesController.getAllCategories);

// POST /api/categories
router.post(
  '/',
  body('category_id').trim().notEmpty().withMessage('معرف القسم (category_id) مطلوب'),
  body('name').trim().notEmpty().withMessage('اسم القسم مطلوب'),
  body('display_order').optional().isInt().withMessage('ترتيب الظهور يجب أن يكون رقماً صحيحاً'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('الحالة يجب أن تكون active أو inactive'),
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
