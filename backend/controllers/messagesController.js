// controllers/messagesController.js
// POST /api/messages/bulk يقبل نص الرسالة + (ملف أرقام و/أو أرقام مُدخلة يدوياً)،
// يُنشئ bulk_job واحد فوراً ويعيد معرّفه، ثم يُسلّم المعالجة الفعلية لـ messageQueue
// في الخلفية دون حجب الاستجابة — هذا هو "لا ترسل جميع الرسائل دفعة واحدة".

const multer = require('multer');
const bulkJobsRepository = require('../database/repositories/bulkJobsRepository');
const messageQueue = require('../services/messageQueue');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB كافية لملف أرقام نصي
});

// يقبل فواصل أسطر أو فواصل عادية أو فاصلة منقوطة، ويتحقق من شكل رقم هاتف عام
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

function parsePhoneNumbers(rawText) {
  return rawText
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => PHONE_PATTERN.test(s));
}

const sendBulkMessages = asyncHandler(async (req, res) => {
  const { message, phone_numbers } = req.body;

  if (!message || !message.trim()) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'نص الرسالة مطلوب', 400);
  }

  let numbers = [];

  if (req.file) {
    numbers = numbers.concat(parsePhoneNumbers(req.file.buffer.toString('utf8')));
  }

  if (phone_numbers) {
    const manualText = Array.isArray(phone_numbers) ? phone_numbers.join('\n') : String(phone_numbers);
    numbers = numbers.concat(parsePhoneNumbers(manualText));
  }

  numbers = [...new Set(numbers)]; // إزالة التكرار

  if (numbers.length === 0) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'لم يتم العثور على أرقام هواتف صالحة (من الملف أو الإدخال اليدوي)',
      400
    );
  }

  const job = bulkJobsRepository.createJob({
    message_text: message.trim(),
    numbers,
    created_by: req.admin.id,
  });

  messageQueue.enqueueBulkJob(job.id); // معالجة في الخلفية، لا ننتظرها هنا

  res.status(201).json({
    success: true,
    data: { job_id: job.id, total_count: numbers.length, status: job.status },
  });
});

const getMessagesStatus = asyncHandler(async (req, res) => {
  const jobs = bulkJobsRepository.findRecentJobs(20);
  res.json({ success: true, data: jobs });
});

module.exports = { sendBulkMessages, getMessagesStatus, upload };
