// routes/messages.js

const express = require('express');
const router = express.Router();

const messagesController = require('../controllers/messagesController');
const { authenticateToken, requireAdminRole } = require('../middleware/auth');

router.use(authenticateToken);
router.use(requireAdminRole); // كل مسارات هذا الملف إدارية بحتة — لا وصول لوكلاء خدمة العملاء

// POST /api/messages/bulk  (multipart/form-data: file اختياري + message + phone_numbers اختياري)
router.post('/bulk', messagesController.upload.single('file'), messagesController.sendBulkMessages);

// GET /api/messages/status
router.get('/status', messagesController.getMessagesStatus);

// GET /api/messages/opted-in-count
router.get('/opted-in-count', messagesController.getOptedInCount);

module.exports = router;
