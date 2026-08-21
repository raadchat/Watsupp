// routes/customers.js

const express = require('express');
const { param } = require('express-validator');
const router = express.Router();

const customersController = require('../controllers/customersController');
const { authenticateToken } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

router.use(authenticateToken);

// GET /api/customers?search=...&page=...&pageSize=...
router.get('/', customersController.getAllCustomers);

// GET /api/customers/:id
router.get(
  '/:id',
  param('id').isInt().withMessage('معرف غير صالح'),
  handleValidation,
  customersController.getCustomerById
);

module.exports = router;
