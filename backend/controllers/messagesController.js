// controllers/messagesController.js
// POST /api/messages/bulk يقبل نص الرسالة + مصدر الأرقام (recipient_type):
// 'manual' = ملف و/أو أرقام مُدخلة يدوياً (كالسابق)، أو 'opted_in' = شريحة
// العملاء الموافقين على الإشعارات (القسم 5) مباشرة من قاعدة البيانات —
// بلا حاجة لإدخال أي رقم يدوياً. يُنشئ bulk_job واحد فوراً ويعيد معرّفه،
// ثم يُسلّم المعالجة الفعلية لـ messageQueue في الخلفية دون حجب الاستجابة.

const multer = require('multer');
const bulkJobsRepository = require('../database/repositories/bulkJobsRepository');
const customersRepository = require('../database/repositories/customersRepository');
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
  const { message, phone_numbers, recipient_type } = req.body;

  if (!message || !message.trim()) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'نص الرسالة مطلوب', 400);
  }

  let numbers = [];

  if (recipient_type === 'opted_in') {
    // شريحة جاهزة من قاعدة البيانات — لا تُلمَس بقية الطريقة القديمة (ملف/يدوي) إطلاقاً
    numbers = customersRepository.findOptedInPhoneNumbers();
  } else {
    if (req.file) {
      numbers = numbers.concat(parsePhoneNumbers(req.file.buffer.toString('utf8')));
    }
    if (phone_numbers) {
      const manualText = Array.isArray(phone_numbers) ? phone_numbers.join('\n') : String(phone_numbers);
      numbers = numbers.concat(parsePhoneNumbers(manualText));
    }
    numbers = [...new Set(numbers)]; // إزالة التكرار
  }

  if (numbers.length === 0) {
    const message2 =
      recipient_type === 'opted_in'
        ? 'لا يوجد عملاء موافقون على الإشعارات حالياً'
        : 'لم يتم العثور على أرقام هواتف صالحة (من الملف أو الإدخال اليدوي)';
    throw new AppError(ErrorCodes.VALIDATION_ERROR, message2, 400);
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

const getOptedInCount = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { count: customersRepository.countOptedIn() } });
});

module.exports = { sendBulkMessages, getMessagesStatus, getOptedInCount, upload };
