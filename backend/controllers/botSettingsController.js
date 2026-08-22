// controllers/botSettingsController.js
// إدارة محتوى سلوك البوت — رسالة الترحيب (نص + صورة اختيارية) — التي
// يستخدمها conversationService.sendWelcomeMessage() لأي رسالة غير مفهومة.

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const botSettingsRepository = require('../database/repositories/botSettingsRepository');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'frontend', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // اسم فريد بالوقت لتفادي التخزين المؤقت (cache) لصورة قديمة في متصفح
    // العميل على واتساب عند استبدال الصورة لاحقاً بأخرى بنفس الامتداد
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `welcome-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new AppError(ErrorCodes.VALIDATION_ERROR, 'الملف المرفوع يجب أن يكون صورة', 400));
    }
    cb(null, true);
  },
});

const getBotSettings = asyncHandler(async (req, res) => {
  const settings = botSettingsRepository.get();
  res.json({
    success: true,
    data: {
      welcome_message: settings?.welcome_message || null,
      welcome_image_filename: settings?.welcome_image_filename || null,
      welcome_image_url: settings?.welcome_image_filename ? `/uploads/${settings.welcome_image_filename}` : null,
    },
  });
});

const saveBotSettings = asyncHandler(async (req, res) => {
  const { welcome_message } = req.body;

  if (!welcome_message || !welcome_message.trim()) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'نص رسالة الترحيب مطلوب', 400);
  }

  const existing = botSettingsRepository.get();
  let welcome_image_filename;

  if (req.file) {
    welcome_image_filename = req.file.filename;
    // احذف الصورة القديمة بعد نجاح رفع الجديدة، لا نُبقي ملفات يتيمة على القرص
    if (existing?.welcome_image_filename) {
      const oldPath = path.join(UPLOADS_DIR, existing.welcome_image_filename);
      fs.unlink(oldPath, () => {}); // فشل الحذف هنا غير حرج، يُتجاهل بأمان
    }
  } else if (req.body.remove_image === 'true') {
    welcome_image_filename = null;
    if (existing?.welcome_image_filename) {
      fs.unlink(path.join(UPLOADS_DIR, existing.welcome_image_filename), () => {});
    }
  }
  // وإلا (لا ملف جديد ولا طلب حذف): welcome_image_filename تبقى undefined،
  // فيُبقي botSettingsRepository.save() على الصورة الحالية كما هي

  const saved = botSettingsRepository.save({ welcome_message: welcome_message.trim(), welcome_image_filename });

  res.json({
    success: true,
    data: {
      welcome_message: saved.welcome_message,
      welcome_image_filename: saved.welcome_image_filename,
      welcome_image_url: saved.welcome_image_filename ? `/uploads/${saved.welcome_image_filename}` : null,
    },
  });
});

module.exports = { getBotSettings, saveBotSettings, upload };
