// routes/auth.js

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const authController = require('../controllers/authController');
const { handleValidation } = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rateLimiter');

// POST /api/login
router.post(
  '/',
  loginLimiter,
  body('username').trim().notEmpty().withMessage('اسم المستخدم مطلوب'),
  body('password').notEmpty().withMessage('كلمة المرور مطلوبة'),
  handleValidation,
  authController.login
);

module.exports = router;
