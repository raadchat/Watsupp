// controllers/botSettingsController.js
// إدارة محتوى سلوك البوت — رسالة الترحيب (نص + صورة اختيارية) — التي
// يستخدمها conversationService.sendWelcomeMessage() لأي رسالة غير مفهومة.

const botSettingsRepository = require('../database/repositories/botSettingsRepository');
const mediaService = require('../services/mediaService');
const whatsappService = require('../services/whatsappService');
const { AppError, ErrorCodes } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

// نستخدم multer المشترك من mediaService (لا نظام رفع منفصل لهذه الصفحة بعد
// المرحلة 2)، لكن نتحقق هنا تحديداً أن الملف صورة فقط — رسالة الترحيب لم
// تُذكر ضمن الأماكن المطلوب دعم فيديو/PDF فيها في هذه المرحلة.
const upload = mediaService.upload;

const getBotSettings = asyncHandler(async (req, res) => {
  const settings = botSettingsRepository.get();
  res.json({
    success: true,
    data: {
      welcome_message: settings?.welcome_message || null,
      welcome_image_filename: settings?.welcome_image_filename || null,
      welcome_image_url: settings?.welcome_image_filename
        ? `/uploads/${mediaService.publicPathFor(settings.welcome_image_filename)}`
        : null,
      public_base_url: settings?.public_base_url || null,
      show_customer_phone_to_agents: settings?.show_customer_phone_to_agents !== 0,
    },
  });
});

const saveBotSettings = asyncHandler(async (req, res) => {
  const { welcome_message, public_base_url, show_customer_phone_to_agents } = req.body;

  if (!welcome_message || !welcome_message.trim()) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'نص رسالة الترحيب مطلوب', 400);
  }

  const existing = botSettingsRepository.get();
  let welcome_image_filename;
  let welcome_image_media_id;

  if (req.file) {
    if (mediaService.detectCategory(req.file.mimetype) !== 'image') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'صورة الترحيب يجب أن تكون JPEG أو PNG', 400);
    }
    mediaService.validateAttachment(req.file); // يتحقق أيضاً الحجم (5MB) وتطابق الامتداد

    welcome_image_filename = mediaService.saveAttachment(req.file, 'image');
    welcome_image_media_id = null; // يُرفع لواتساب أدناه بعد الحفظ في قاعدة البيانات

    if (existing?.welcome_image_filename) {
      mediaService.deleteAttachment(existing.welcome_image_filename); // لا نُبقي ملفات يتيمة على القرص
    }
  } else if (req.body.remove_image === 'true') {
    welcome_image_filename = null;
    welcome_image_media_id = null;
    if (existing?.welcome_image_filename) {
      mediaService.deleteAttachment(existing.welcome_image_filename);
    }
  }
  // وإلا (لا ملف جديد ولا طلب حذف): كلاهما يبقى undefined، فيُبقي
  // botSettingsRepository.save() على الصورة الحالية (والـ media_id الحالي) كما هما

  let saved = botSettingsRepository.save({
    welcome_message: welcome_message.trim(),
    welcome_image_filename,
    welcome_image_media_id,
    public_base_url: public_base_url !== undefined ? public_base_url.trim() || null : undefined,
    show_customer_phone_to_agents:
      show_customer_phone_to_agents !== undefined ? show_customer_phone_to_agents === 'true' : undefined,
  });

  // رفع الصورة الجديدة لواتساب الآن (مرة واحدة، المرحلة 2) إن كان الاتصال
  // مُعداً بالفعل. إن لم يكن (أو فشل الرفع الآن لأي سبب)، يبقى media_id
  // فارغاً وتُرفع الصورة تلقائياً لاحقاً عند أول رسالة ترحيب فعلية (راجع
  // conversationService.getWelcomeImageMediaId) — فشل الرفع هنا ليس خطأً
  // يمنع حفظ باقي الإعدادات.
  if (req.file && saved.welcome_image_filename) {
    const filePath = mediaService.resolveAttachmentPath(saved.welcome_image_filename);
    if (filePath) {
      const uploadResult = await whatsappService.uploadMedia(filePath, req.file.mimetype);
      if (uploadResult.success) {
        saved = botSettingsRepository.save({
          welcome_message: saved.welcome_message,
          welcome_image_filename: saved.welcome_image_filename,
          welcome_image_media_id: uploadResult.mediaId,
          public_base_url: saved.public_base_url,
        });
      }
    }
  }

  res.json({
    success: true,
    data: {
      welcome_message: saved.welcome_message,
      welcome_image_filename: saved.welcome_image_filename,
      welcome_image_url: saved.welcome_image_filename
        ? `/uploads/${mediaService.publicPathFor(saved.welcome_image_filename)}`
        : null,
      public_base_url: saved.public_base_url || null,
      show_customer_phone_to_agents: saved.show_customer_phone_to_agents !== 0,
    },
  });
});

module.exports = { getBotSettings, saveBotSettings, upload };
