// controllers/customersController.js

const customersRepository = require('../database/repositories/customersRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const getAllCustomers = asyncHandler(async (req, res) => {
  const { search, page, pageSize } = req.query;

  const result = customersRepository.findAll({
    search: search ? String(search).trim() : undefined,
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : 20,
  });

  res.json({
    success: true,
    data: result.rows,
    meta: { total: result.total, page: result.page, pageSize: result.pageSize },
  });
});

const getCustomerById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = customersRepository.findById(id);
  if (!customer) {
    throw new AppError(ErrorCodes.CUSTOMER_NOT_FOUND, 'العميل غير موجود', 404);
  }

  res.json({ success: true, data: customer });
});

module.exports = { getAllCustomers, getCustomerById };
