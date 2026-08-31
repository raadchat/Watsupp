// services/botTexts.js
// المرحلة 4 — السجل المركزي لكل النصوص/الأزرار الثابتة الموجَّهة للعميل على
// واتساب. كل مفتاح هنا له نص افتراضي؛ getText() يستخدم التخصيص المحفوظ في
// bot_texts إن وُجد، وإلا الافتراضي — فلا يحتاج المدير لمس أي شيء ليعمل
// النظام كما هو الآن تماماً. لا كاش هنا عمداً (نفس نمط bot_settings/
// whatsapp_settings): كل رسالة تُبنى بأحدث نص محفوظ فوراً، بلا إعادة تشغيل.
//
// مهم: المفاتيح هنا (categoryPrompt, backButton, ...) هي مفاتيح داخلية فقط
// لربط النص بمكانه في الكود — وليست الـ payload/id الفعلي لأي زر أو صف
// (تلك تبقى ثوابت منفصلة تماماً في conversationService.js مثل BACK_RESERVED_ID
// وCUSTOMER_SERVICE_RESERVED_ID ولا تتأثر بهذا الملف إطلاقاً؛ النص الظاهر
// فقط قابل للتغيير من هنا، منطق النظام لا ينكسر مهما غيّر المدير القيم).

const botTextsRepository = require('../database/repositories/botTextsRepository');

const TEXT_REGISTRY = {
  categoryPrompt: { default: 'اختر القسم المناسب:', label: 'نص طلب اختيار قسم' },
  categoryListButton: { default: 'عرض الأقسام', label: 'زر فتح قائمة الأقسام' },
  categoryListTitle: { default: 'الأقسام المتاحة', label: 'عنوان قائمة الأقسام' },
  servicePrompt: { default: 'اختر إحدى الخدمات التالية:', label: 'نص طلب اختيار خدمة' },
  serviceListButton: { default: 'عرض الخدمات', label: 'زر فتح قائمة الخدمات' },
  serviceListTitle: { default: 'الخدمات المتاحة', label: 'عنوان قائمة الخدمات' },
  backButton: { default: '↩️ رجوع', label: 'زر الرجوع (داخل قوائم واتساب فقط)' },
  noServicesInCategory: { default: 'لا توجد خدمات متاحة في هذا القسم حالياً.', label: 'لا خدمات ضمن قسم' },
  noServicesAtAll: { default: 'لا توجد خدمات متاحة حالياً، يرجى المحاولة لاحقاً.', label: 'لا خدمات إطلاقاً' },
  categoryUnavailable: {
    default: 'عذراً، هذا القسم لم يعد متاحاً. اكتب "الخدمات" لعرض القائمة المحدّثة.',
    label: 'القسم لم يعد متاحاً',
  },
  serviceUnavailable: {
    default: 'عذراً، هذه الخدمة لم تعد متاحة. اكتب "الخدمات" لعرض القائمة المحدّثة.',
    label: 'الخدمة لم تعد متاحة',
  },
  infoNoDetails: { default: 'لا تتوفر تفاصيل إضافية لهذه الخدمة حالياً.', label: 'استعلام بلا تفاصيل مسجَّلة' },
  inputPrompt: {
    default: 'يرجى إرسال التفاصيل اللازمة لإتمام طلب هذه الخدمة في رسالة واحدة.',
    label: 'طلب بيانات الخدمة (خدمات تحتاج إدخال العميل)',
  },
  defaultValidationError: {
    default: 'عذراً، الصيغة التي أرسلتها غير صحيحة. يرجى المحاولة مرة أخرى.',
    label: 'خطأ تحقق افتراضي (تستخدمه أي خدمة لم تحدّد رسالة تحقق خاصة بها)',
  },
  defaultExternalServiceError: {
    default: 'تعذّر معالجة طلبك حالياً، حاول مرة أخرى لاحقاً.',
    label: 'خطأ API خارجي افتراضي',
  },
  genericCollectInputThanks: {
    default: 'شكراً لك، تم استلام طلبك بنجاح وسنتواصل معك قريباً بخصوصه.',
    label: 'شكر عام بعد استلام بيانات (خدمة بلا ربط API خارجي)',
  },
  fallbackReceived: {
    default: 'شكراً لك، تم استلام رسالتك.',
    label: 'رد احتياطي عام (فقدان سياق غير متوقَّع)',
  },
  customerServiceRequested: {
    default: 'تم استلام طلبك، سيتواصل معك أحد ممثلي خدمة العملاء في أقرب وقت. 🙏',
    label: 'تأكيد استلام طلب خدمة العملاء',
  },
  customerServiceClaimed: {
    default: 'تمت الموافقة على طلب مرسل خدمة العملاء، {agentName} يتحدث معك الآن.',
    label: 'إشعار انضمام الوكيل للمحادثة',
    placeholders: ['agentName'],
  },
  ratingPrompt: { default: 'كيف تقيّم تجربتك مع خدمة العملاء؟', label: 'طلب التقييم' },
  ratingSectionTitle: { default: 'التقييم', label: 'عنوان قسم قائمة التقييم' },
  ratingButton: { default: 'اختر تقييمك', label: 'زر اختيار التقييم' },
  ratingThanks: { default: 'شكراً لتقييمك! 🙏', label: 'شكر بعد التقييم' },
  notificationOptInAsk: {
    default: 'هل ترغب في تلقي إشعارات وعروض منا مستقبلاً على واتساب؟',
    label: 'سؤال الموافقة على الإشعارات',
  },
  notificationOptInYes: { default: 'نعم، أوافق', label: 'زر الموافقة على الإشعارات' },
  notificationOptInNo: { default: 'لا، شكراً', label: 'زر رفض الإشعارات' },
  notificationOptInThanks: {
    default: 'شكراً لك! سنبقيك على اطّلاع بآخر العروض والتحديثات. 🎉',
    label: 'شكر بعد الموافقة على الإشعارات',
  },
};

/**
 * استبدال نصي بسيط فقط: {name} → قيمته إن مُرِّرت، وإلا يبقى كما هو دون
 * تغيير. لا eval، لا Function()، ولا يُبنى أي استعلام SQL من هذا النص —
 * فلا يوجد أي مسار يُنفَّذ منه كود مهما كان محتوى النص نفسه.
 */
function renderTemplate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    vars && vars[name] !== undefined ? String(vars[name]) : match
  );
}

/** النص الفعلي الحالي لمفتاح معيَّن (تخصيص محفوظ، وإلا الافتراضي)، بعد استبدال أي {placeholders} مُمرَّرة في vars. */
function getText(key, vars) {
  if (!TEXT_REGISTRY[key]) {
    throw new Error(`bot text key غير معروف: ${key}`);
  }
  const overrides = botTextsRepository.getAll();
  const raw = overrides[key] !== undefined ? overrides[key] : TEXT_REGISTRY[key].default;
  return vars ? renderTemplate(raw, vars) : raw;
}

/** للوحة التحكم: كل مفتاح مع تسميته، افتراضيّه، قيمته الحالية، وهل هو مخصَّص فعلاً. */
function listForAdmin() {
  const overrides = botTextsRepository.getAll();
  return Object.keys(TEXT_REGISTRY).map((key) => ({
    key,
    label: TEXT_REGISTRY[key].label,
    placeholders: TEXT_REGISTRY[key].placeholders || [],
    default: TEXT_REGISTRY[key].default,
    value: overrides[key] !== undefined ? overrides[key] : TEXT_REGISTRY[key].default,
    isCustomized: overrides[key] !== undefined,
  }));
}

function isValidKey(key) {
  return Object.prototype.hasOwnProperty.call(TEXT_REGISTRY, key);
}

module.exports = { getText, listForAdmin, isValidKey };
