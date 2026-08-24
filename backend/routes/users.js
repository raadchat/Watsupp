// routes/users.js
// إدارة وكلاء خدمة العملاء — للمدير فقط بالكامل.

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const usersController = require('../controllers/usersController');
const { authenticateToken, requireAdminRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

router.use(authenticateToken);
router.use(requireAdminRole);

// GET /api/users
router.get('/', usersController.getAgents);

// POST /api/users
router.post(
  '/',
  body('username').trim().notEmpty().withMessage('اسم المستخدم مطلوب'),
  body('name').trim().notEmpty().withMessage('الاسم مطلوب'),
  body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
  handleValidation,
  usersController.createAgent
);

module.exports = router;
