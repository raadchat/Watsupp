// routes/users.js
// إدارة المستخدمين (المرحلة 6) — للمدير فقط بالكامل.

const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const usersController = require('../controllers/usersController');
const { authenticateToken, requireAdminRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

router.use(authenticateToken);
router.use(requireAdminRole);

// GET /api/users
router.get('/', usersController.getAllUsers);

// POST /api/users
router.post(
  '/',
  body('username').trim().notEmpty().withMessage('اسم المستخدم مطلوب'),
  body('name').trim().notEmpty().withMessage('الاسم مطلوب'),
  body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
  body('role').optional().isIn(['admin', 'agent']).withMessage('نوع الحساب يجب أن يكون admin أو agent'),
  handleValidation,
  usersController.createUser
);

// PUT /api/users/:id  (الاسم و/أو نوع الحساب فقط — لا اسم المستخدم ولا كلمة المرور)
router.put(
  '/:id',
  param('id').isInt().withMessage('معرف غير صالح'),
  body('name').optional().trim().notEmpty().withMessage('الاسم لا يمكن أن يكون فارغاً'),
  body('role').optional().isIn(['admin', 'agent']).withMessage('نوع الحساب يجب أن يكون admin أو agent'),
  handleValidation,
  usersController.updateUser
);

// DELETE /api/users/:id
router.delete('/:id', param('id').isInt().withMessage('معرف غير صالح'), handleValidation, usersController.deleteUser);

// PUT /api/users/:id/password
router.put(
  '/:id/password',
  param('id').isInt().withMessage('معرف غير صالح'),
  body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
  handleValidation,
  usersController.changeUserPassword
);

// GET /api/users/:id/login-logs  (المرحلة 8)
router.get('/:id/login-logs', param('id').isInt().withMessage('معرف غير صالح'), handleValidation, usersController.getLoginLogs);

// GET /api/users/:id/customer-logs  (المرحلة 8)
router.get(
  '/:id/customer-logs',
  param('id').isInt().withMessage('معرف غير صالح'),
  handleValidation,
  usersController.getCustomerLogs
);

module.exports = router;
