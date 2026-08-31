// services/mediaService.js
// خدمة مرفقات مركزية (المرحلة 2) — نقطة واحدة للتحقق (MIME/امتداد/حجم)،
// التخزين الآمن، الحذف، وحل المسار الفعلي، لأي مرفق (صورة/فيديو/PDF) قبل
// إرساله عبر واتساب. لا يوجد أي نظام رفع منفصل مكرَّر لكل صفحة — أي مكان
// جديد يحتاج مرفقات (الرسائل الجماعية والخدمات والإشعارات في مراحلها
// المخصَّصة لاحقاً) يستدعي نفس الدوال هنا، تماماً كما يفعل customersController
// (رد يدوي) وbotSettingsController (صورة الترحيب) بعد هذه المرحلة.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { getUploadsDir } = require('../utils/paths');
const { AppError, ErrorCodes } = require('../utils/errors');

const ATTACHMENTS_DIR = path.join(getUploadsDir(), 'attachments');
if (!fs.existsSync(ATTACHMENTS_DIR)) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

// الحدود والصيغ المسموحة تطابق حدود WhatsApp Cloud API الفعلية لإرسال
// الوسائط (Meta for Developers، قسم Media): تجاوزها يعني فشل الإرسال من
// عند Meta لاحقاً حتى لو قبلناه نحن هنا، فلا فائدة من حد أوسع من هذا.
const ATTACHMENT_TYPES = {
  image: {
    mimeTypes: ['image/jpeg', 'image/png'],
    extensions: ['.jpg', '.jpeg', '.png'],
    maxBytes: 5 * 1024 * 1024,
    label: 'صورة (JPEG/PNG)، حتى 5MB',
  },
  video: {
    mimeTypes: ['video/mp4'],
    extensions: ['.mp4'],
    maxBytes: 16 * 1024 * 1024,
    label: 'فيديو (MP4)، حتى 16MB',
  },
  document: {
    mimeTypes: ['application/pdf'],
    extensions: ['.pdf'],
    maxBytes: 100 * 1024 * 1024,
    label: 'مستند PDF، حتى 100MB',
  },
};

const ALL_MIME_TYPES = Object.values(ATTACHMENT_TYPES).flatMap((t) => t.mimeTypes);
const MAX_UPLOAD_BYTES = Math.max(...Object.values(ATTACHMENT_TYPES).map((t) => t.maxBytes));

/** يحدّد الفئة (image/video/document) من mimetype، أو null إن لم تكن مدعومة. */
function detectCategory(mimetype) {
  return Object.keys(ATTACHMENT_TYPES).find((cat) => ATTACHMENT_TYPES[cat].mimeTypes.includes(mimetype)) || null;
}

/**
 * يتحقق من ملف multer: MIME مدعوم، الحجم ضمن حد نوعه تحديداً (لا الحد
 * العام فقط)، وأن امتداد الاسم الأصلي يطابق فعلياً نوع الملف (دفاع إضافي
 * ضد انتحال MIME بمجرد تسمية الملف). يرمي AppError عربياً واضحاً عند
 * الرفض، أو يعيد الفئة المكتشَفة عند القبول.
 */
function validateAttachment(file) {
  if (!file) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'لم يصل أي ملف', 400);
  }

  const category = detectCategory(file.mimetype);
  if (!category) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'نوع الملف غير مدعوم. المسموح فقط: صورة (JPEG/PNG)، فيديو (MP4)، أو مستند PDF',
      400
    );
  }

  const spec = ATTACHMENT_TYPES[category];
  if (file.size > spec.maxBytes) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `الملف كبير جداً — الحد الأقصى لـ ${spec.label}`, 400);
  }

  const originalExt = path.extname(file.originalname || '').toLowerCase();
  if (originalExt && !spec.extensions.includes(originalExt)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'امتداد الملف لا يطابق نوعه الفعلي', 400);
  }

  return category;
}

/**
 * يحفظ الملف في مجلد المرفقات باسم عشوائي بالكامل — لا علاقة له إطلاقاً
 * باسم الملف الأصلي أو بأي مدخل من العميل/المستخدم. هذا تحديداً ما يمنع
 * أي احتمال Path Traversal بالبناء (construction)، لا بفحص لاحق للاسم.
 * يعمل مع ملفات multer سواء diskStorage (file.path) أو memoryStorage (file.buffer).
 * @returns {string} اسم الملف الآمن المحفوظ به (وليس مساره الكامل)
 */
function saveAttachment(file, category) {
  const originalExt = path.extname(file.originalname || '').toLowerCase();
  const spec = ATTACHMENT_TYPES[category];
  const ext = spec.extensions.includes(originalExt) ? originalExt : spec.extensions[0];
  const filename = `att-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const destination = path.join(ATTACHMENTS_DIR, filename);

  if (file.path) {
    fs.renameSync(file.path, destination); // نفس مجلد الوجهة أصلاً (multer.diskStorage أدناه) — إعادة تسمية فقط
  } else if (file.buffer) {
    fs.writeFileSync(destination, file.buffer);
  } else {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'تعذّر حفظ الملف المرفوع', 500);
  }

  return filename;
}

/** true فقط لاسم مطابق تماماً للصيغة التي نولّدها نحن — دفاع إضافي (Defense
 * in depth) قبل أي حذف/قراءة، حتى لو وصل الاسم من طريق لم نتحكم فيه بالكامل. */
function isSafeFilename(filename) {
  return typeof filename === 'string' && /^att-\d+-[a-f0-9]{16}\.(jpg|jpeg|png|mp4|pdf)$/.test(filename);
}

/** يحل filename إلى مسار كامل داخل مجلد المرفقات فقط، أو null إن كان غير آمن/غير موجود. */
function resolveAttachmentPath(filename) {
  if (!isSafeFilename(filename)) return null;
  const resolved = path.join(ATTACHMENTS_DIR, filename);
  if (!resolved.startsWith(ATTACHMENTS_DIR + path.sep)) return null; // تأكيد إضافي أنه لم يخرج من المجلد
  return fs.existsSync(resolved) ? resolved : null;
}

function deleteAttachment(filename) {
  const resolved = resolveAttachmentPath(filename);
  if (resolved) {
    fs.unlink(resolved, () => {}); // فشل الحذف هنا غير حرج، يُتجاهل بأمان (نفس نمط صورة الترحيب في botSettingsController)
  }
}

/**
 * يبني المسار العام (تحت /uploads/) لاسم ملف مخزَّن، سواء كان من هذه
 * المرحلة (داخل مجلد attachments/ الفرعي) أو اسماً قديماً محفوظاً مباشرة في
 * جذر uploads/ من قبل هذه المرحلة (يبقى يعمل كما هو دون أي نقل/ترحيل ملفات).
 */
function publicPathFor(filename) {
  if (!filename) return null;
  return isSafeFilename(filename) ? `attachments/${filename}` : filename;
}

// multer مشترك لكل مكان يستقبل مرفقاً (رد يدوي الآن؛ رسائل جماعية/خدمات/
// إشعارات لاحقاً في مراحلها) — الوجهة النهائية مجلد المرفقات نفسه مباشرة
// (اسم مؤقت الآن، تُعيد saveAttachment تسميته لاحقاً بعد التحقق) لتفادي أي
// مشكلة نقل بين قرصين (EXDEV) عند fs.renameSync أعلاه.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ATTACHMENTS_DIR),
  filename: (req, file, cb) => cb(null, `tmp-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES }, // سقف عام (أكبر الحدود)؛ التحقق الدقيق لكل نوع في validateAttachment أعلاه
  fileFilter: (req, file, cb) => {
    if (!ALL_MIME_TYPES.includes(file.mimetype)) {
      return cb(
        new AppError(ErrorCodes.VALIDATION_ERROR, 'نوع الملف غير مدعوم. المسموح فقط: صورة (JPEG/PNG)، فيديو (MP4)، أو مستند PDF', 400)
      );
    }
    cb(null, true);
  },
});

module.exports = {
  ATTACHMENT_TYPES,
  detectCategory,
  validateAttachment,
  saveAttachment,
  deleteAttachment,
  resolveAttachmentPath,
  publicPathFor,
  upload,
};
