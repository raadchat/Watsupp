// routes/whatsapp.js
// هذا المسار لا يُحمى بـ JWT عمداً: الطرف الذي يستدعيه هو خوادم Meta نفسها،
// وليس متصفح المدير. الحماية هنا تتم عبر hub.verify_token في GET، وعبر
// كون WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID سرّين لا تُكشف إلا من خادمنا.

const express = require('express');
const router = express.Router();

const webhookController = require('../controllers/webhookController');

// GET /webhook — تحقق Meta الأولي عند ربط الـ webhook
router.get('/', webhookController.verifyWebhook);

// POST /webhook — استقبال الرسائل الواردة والتحديثات
router.post('/', webhookController.handleIncomingMessage);

module.exports = router;
