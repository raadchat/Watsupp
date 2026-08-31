// services/conversationService.js
// "القائمة الديناميكية": هذا الملف هو التطبيق الفعلي لأهم نقطة في المواصفات (القسم 10)،
// وأصبح الآن يدعم أقساماً متداخلة بلا حد للعمق (قسم داخل قسم داخل قسم...)،
// بنفس مبدأ بوت الكريمي المرجعي لكن بمستويات غير محدودة بدل مستويين فقط.
// لا توجد هنا أي قائمة أقسام أو خدمات مكتوبة داخل الكود — كل قائمة تُبنى من
// categoriesRepository.findActiveChildrenOf() / servicesRepository.findActive*()
// في لحظة الطلب. إضافة/تعديل/حذف من لوحة التحكم ينعكس في الرسالة التالية
// للعميل دون أي إعادة تشغيل أو تعديل كود.
//
// ملاحظة تقنية: واتساب لا يدعم "قائمة داخل قائمة" كعنصر واجهة واحد (حد 10
// صفوف، مستوى واحد فقط لكل رسالة). التأثير المطلوب يتحقق بتسلسل رسائل
// متعددة: كل اختيار قسم له أبناء نشطون يرسل رسالة قائمة جديدة بأبنائه هو
// (نفس sendCategoriesList تُستدعى من جديد بمعرّفه كأب) — وهكذا حتى الوصول
// لقسم "ورقة" (بلا أبناء)، فتُعرض خدماته بدل المزيد من الأقسام.
//
// افتراض مذكور بوضوح: كلمات التحفيز ("الخدمات") ونص رسائل البوت (الترحيب،
// طلب البيانات، رسالة الشكر) غير محددة في المواصفات، فاخترتُ نصوصاً عربية
// قياسية بسيطة يسهل تعديلها لاحقاً حسب هوية النشاط التجاري.

const categoriesRepository = require('../database/repositories/categoriesRepository');
const servicesRepository = require('../database/repositories/servicesRepository');
const customersRepository = require('../database/repositories/customersRepository');
const messagesRepository = require('../database/repositories/messagesRepository');
const botSettingsRepository = require('../database/repositories/botSettingsRepository');
const customerServiceSettingsRepository = require('../database/repositories/customerServiceSettingsRepository');
const adminsRepository = require('../database/repositories/adminsRepository');
const whatsappService = require('./whatsappService');
const mediaService = require('./mediaService');
const botTexts = require('./botTexts');
const axios = require('axios');

const SERVICES_TRIGGER_WORDS = ['الخدمات', 'خدمات', 'services', 'menu', 'قائمة', 'show_menu'];

// معرّف محجوز لخيار "خدمة العملاء" الثابت — ليس صفاً حقيقياً في categories،
// فلا يمكن أن يتصادم مع category_id يُنشئه المدير (categoriesController يمنع
// استخدام هذه القيمة تحديداً عند إنشاء قسم عادي).
const CUSTOMER_SERVICE_RESERVED_ID = '__customer_service__';

// معرّف Payload محجوز لزر "رجوع" في قوائم واتساب فقط (المرحلة 1) — ثابت
// دائماً حتى لو تغيّر النص الظاهر لاحقاً من لوحة التحكم (المرحلة 4: نظام
// النصوص المركزي، مفتاح backButton). محجوز أيضاً كـ category_id وservice_id
// (categoriesController وservicesController يمنعان استخدام هذه القيمة
// تحديداً عند الإنشاء).
const BACK_RESERVED_ID = 'BACK';

// حدود رسالة القائمة التفاعلية في WhatsApp Cloud API (تنطبق على كل مستوى على حدة)
const MAX_LIST_ROWS = 10;
const MAX_TITLE_LEN = 24;
const MAX_DESC_LEN = 72;

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? `${str.slice(0, len - 1)}…` : str;
}

/** يبني sections لرسالة قائمة الأقسام (المستوى الأول) مباشرة من قاعدة البيانات.
 * customerServiceLabel (إن مُرِّر) يُضاف كصف أخير دائماً، وincludeBack (المرحلة 1)
 * يُضاف كصف أول دائماً — كلاهما يحجز مكانه مسبقاً حتى لا يُقطَع بحد الـ 10
 * صفوف. عملياً الاثنان لا يجتمعان أبداً في نفس الرسالة (خدمة العملاء تظهر في
 * الجذر فقط حيث لا يوجد رجوع أصلاً)، لكن الدالة تدعم الحالتين معاً بأمان. */
function buildCategoryListSections(categories, customerServiceLabel = null, includeBack = false) {
  const reserveSlots = (customerServiceLabel ? 1 : 0) + (includeBack ? 1 : 0);
  const limited = categories.slice(0, MAX_LIST_ROWS - reserveSlots);
  const rows = [];
  if (includeBack) {
    rows.push({ id: BACK_RESERVED_ID, title: botTexts.getText('backButton'), description: '' });
  }
  rows.push(
    ...limited.map((c) => ({
      id: c.category_id,
      title: truncate(c.name, MAX_TITLE_LEN),
      description: truncate(c.description || '', MAX_DESC_LEN),
    }))
  );
  if (customerServiceLabel) {
    rows.push({ id: CUSTOMER_SERVICE_RESERVED_ID, title: truncate(customerServiceLabel, MAX_TITLE_LEN), description: '' });
  }
  return [{ title: botTexts.getText('categoryListTitle'), rows }];
}

/** يبني sections لرسالة قائمة الخدمات (المستوى الثاني) مباشرة من قاعدة البيانات. */
function buildServiceListSections(services, includeBack = false) {
  // ملاحظة: WhatsApp Cloud API يسمح بحد أقصى 10 صفوف في رسالة قائمة واحدة.
  // إذا تجاوز عدد الخدمات النشطة (ضمن القسم) هذا الحد (بعد حجز صف الرجوع إن
  // وُجد)، تُعرض أول 10 فقط (قيد حقيقي من واجهة واتساب، وليس افتراضاً اعتباطياً).
  //
  // description تُترَك فارغة عمداً: لا نعرض معاينة نص الرد تحت اسم الخدمة في
  // القائمة — الرد لا يظهر للعميل إلا بعد اختيار اسم الخدمة، وليس قبله.
  const reserveSlots = includeBack ? 1 : 0;
  const limited = services.slice(0, MAX_LIST_ROWS - reserveSlots);
  const rows = [];
  if (includeBack) {
    rows.push({ id: BACK_RESERVED_ID, title: botTexts.getText('backButton'), description: '' });
  }
  rows.push(...limited.map((s) => ({ id: s.service_id, title: truncate(s.name, MAX_TITLE_LEN), description: '' })));
  return [{ title: botTexts.getText('serviceListTitle'), rows }];
}

async function sendOutbound(customer, text, whatsappResult) {
  messagesRepository.create({
    customer_id: customer.id,
    direction: 'outbound',
    message: text,
    status: whatsappResult?.success ? 'sent' : 'failed',
    whatsapp_message_id: whatsappResult?.messageId || null,
  });
}

/**
 * المستوى الحالي من شجرة الأقسام. `stack` هو مسار معرّفات الأقسام الرقمية
 * من الجذر حتى (وشاملاً) الموضع الحالي — []  يعني الجذر (المستوى الأول)،
 * و[12, 25] يعني "أبناء القسم 25، الذي هو ابن القسم 12". لا حد مبرمَج على
 * عمق التداخل — الاختيار المتكرر لقسم له أبناء يستدعي هذه الدالة من جديد
 * بـ stack أطول بعنصر واحد، وهكذا حتى الوصول لقسم "ورقة" فتُعرض خدماته.
 * إن لم يُنشئ المدير أي قسم رئيسي بعد، يتراجع تلقائياً لعرض كل الخدمات
 * النشطة كقائمة مسطّحة (السلوك الأصلي) بدل توقف البوت.
 *
 * المرحلة 1: يُحفَظ stack في customers.navigation_stack بعد كل إرسال ناجح،
 * ويظهر صف "↩️ رجوع" أولاً كلما كان stack غير فارغ (أي: لسنا في الجذر).
 */
async function sendCategoriesList(customer, stack = []) {
  const parentDbId = stack.length ? stack[stack.length - 1] : null;
  const activeCategories = categoriesRepository.findActiveChildrenOf(parentDbId); // <-- القراءة المباشرة من قاعدة البيانات

  // "خدمة العملاء" تظهر فقط في القائمة الرئيسية (المستوى الأول)، كآخر خيار دائماً
  const csSettings = parentDbId === null ? customerServiceSettingsRepository.get() : null;
  const csEnabled = Boolean(csSettings && csSettings.enabled === 1);

  if (activeCategories.length === 0 && !csEnabled) {
    await sendServicesList(customer, stack); // لا أقسام هنا (ولا خدمة عملاء مفعّلة) — تراجع لعرض الخدمات في نفس الموضع
    return;
  }

  const includeBack = stack.length > 0; // لا رجوع في الجذر أبداً
  const sections = buildCategoryListSections(activeCategories, csEnabled ? csSettings.label : null, includeBack);
  const result = await whatsappService.sendInteractiveListMessage(customer.phone_number, {
    bodyText: botTexts.getText('categoryPrompt'),
    buttonText: botTexts.getText('categoryListButton'),
    sections,
  });
  await sendOutbound(customer, '[قائمة الأقسام التفاعلية]', result);
  customersRepository.updateState(customer.id, 'CATEGORY_LIST');
  customersRepository.updateNavigationStack(customer.id, stack);
}

/**
 * المستوى الأخير: يعرض خدمات قسم واحد (آخر عنصر في stack)، أو كل الخدمات
 * النشطة إن كان stack فارغاً (حالة التراجع في sendCategoriesList، أو نظام
 * بلا أقسام أصلاً — وفي هذه الحالة تحديداً لا يوجد "رجوع" لأنها تعادل الجذر).
 */
async function sendServicesList(customer, stack = []) {
  const categoryDbId = stack.length ? stack[stack.length - 1] : null;
  const activeServices = categoryDbId
    ? servicesRepository.findActiveByCategoryId(categoryDbId)
    : servicesRepository.findActive();

  if (activeServices.length === 0) {
    const text = categoryDbId ? botTexts.getText('noServicesInCategory') : botTexts.getText('noServicesAtAll');
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    customersRepository.updateState(customer.id, 'MAIN_MENU');
    customersRepository.updateNavigationStack(customer.id, []); // هذه رسالة نصية بلا تفاعل، فلا حاجة لحفظ موضع للرجوع إليه
    return;
  }

  const includeBack = stack.length > 0;
  const sections = buildServiceListSections(activeServices, includeBack);
  const result = await whatsappService.sendInteractiveListMessage(customer.phone_number, {
    bodyText: botTexts.getText('servicePrompt'),
    buttonText: botTexts.getText('serviceListButton'),
    sections,
  });
  await sendOutbound(customer, '[قائمة الخدمات التفاعلية]', result);
  customersRepository.updateState(customer.id, 'SERVICE_LIST');
  customersRepository.updateNavigationStack(customer.id, stack);
}

const DEFAULT_WELCOME_TEXT = 'مرحباً بك 👋';

function getPublicBaseUrl() {
  // يُستخدم لبناء رابط عام لصورة الترحيب يستطيع خادم Meta الوصول إليه.
  // يُقرأ أولاً من bot_settings (قابل للضبط من لوحة التحكم مباشرة)، ثم
  // PUBLIC_BASE_URL في .env كتراجع، ثم رابط محلي لن تصل إليه Meta فعلياً
  // (يعني عدم ضبط أي منهما = لن تُرسَل صورة الترحيب فعلياً حتى يُضبط أحدهما).
  const botSettings = botSettingsRepository.get();
  const raw = botSettings?.public_base_url || process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  // إزالة أي شرطة مائلة زائدة في النهاية — إن أدخل المدير الرابط منتهياً
  // بـ "/" (شائع عند نسخه من شريط عنوان المتصفح)، فسينتج بدون هذا "//uploads/..."
  // بمسار مزدوج قد يفشل بعض المضيفين/الوسطاء (مثل طبقة Railway) في جلبه بشكل صحيح
  return raw.replace(/\/+$/, '');
}

/**
 * أي رسالة غير مفهومة (أو أول تواصل من عميل جديد) تصل هنا: رسالة ترحيب
 * قابلة للتعديل الكامل من لوحة التحكم (نص + صورة اختيارية)، متبوعة فوراً
 * بقائمة الأقسام/الخدمات نفسها — بلا أي زر وسيط ينتظر ضغطة العميل. واتساب
 * لا يسمح بصورة داخل رسالة قائمة تفاعلية (header القوائم نصي فقط، خلافاً
 * لرسائل الأزرار)، لذلك تُرسَل الصورة (إن وُجدت) كرسالة صورة عادية أولاً
 * ثم تلحقها رسالة القائمة مباشرة في نفس اللحظة — لا ضغطة زر مطلوبة إطلاقاً.
 */
/**
 * يعيد Media ID جاهزاً لصورة الترحيب (المرحلة 2) — من الكاش المحفوظ إن
 * وُجد، وإلا يرفع الملف المحفوظ محلياً الآن (مرة واحدة فقط) ويخزّن الناتج
 * في bot_settings ليُعاد استخدامه في كل رسالة ترحيب تالية بلا رفع مكرَّر.
 * يعيد null إن لم تُضبط صورة، أو كانت من اسم قديم قبل هذه المرحلة (سيتراجع
 * sendWelcomeMessage تلقائياً للطريقة الأصلية بالرابط العام لتلك الحالة)،
 * أو تعذّر الرفع الآن (واتساب غير مُعد مثلاً).
 */
async function getWelcomeImageMediaId(botSettings) {
  if (!botSettings?.welcome_image_filename) return null;
  if (botSettings.welcome_image_media_id) return botSettings.welcome_image_media_id;

  const filePath = mediaService.resolveAttachmentPath(botSettings.welcome_image_filename);
  if (!filePath) return null;

  const mimeType = botSettings.welcome_image_filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const uploadResult = await whatsappService.uploadMedia(filePath, mimeType);
  if (!uploadResult.success) return null;

  botSettingsRepository.save({
    welcome_message: botSettings.welcome_message,
    welcome_image_filename: botSettings.welcome_image_filename,
    welcome_image_media_id: uploadResult.mediaId,
    public_base_url: botSettings.public_base_url,
  });
  return uploadResult.mediaId;
}

async function sendWelcomeMessage(customer) {
  const botSettings = botSettingsRepository.get();
  const messageText = botSettings?.welcome_message || DEFAULT_WELCOME_TEXT;

  let result;
  const mediaId = await getWelcomeImageMediaId(botSettings);

  if (mediaId) {
    // الطريقة المفضّلة (المرحلة 2): بـ Media ID مباشرة — تعمل محلياً بلا حاجة
    // لنطاق علني أو نفق مثل ngrok، على عكس الطريقة القديمة بالرابط العام
    result = await whatsappService.sendMediaMessage(customer.phone_number, {
      type: 'image',
      mediaId,
      caption: messageText,
    });
  } else if (botSettings?.welcome_image_filename) {
    // تراجع: اسم صورة قديم قبل المرحلة 2 (لا يمكن رفعه هنا لأنه ليس داخل
    // مجلد attachments/ الآمن)، أو تعذّر رفعه الآن لأي سبب آخر
    const imageUrl = `${getPublicBaseUrl()}/uploads/${mediaService.publicPathFor(botSettings.welcome_image_filename)}`;
    result = await whatsappService.sendImageMessage(customer.phone_number, imageUrl, messageText);
  }

  if (!result || !result.success) {
    // فشل إرسال الصورة (بأي من الطريقتين)، أو لا صورة أصلاً. لا نترك العميل
    // بلا أي رد: نُعيد المحاولة كنص عادي فوراً بدل ترك الترحيب يختفي بصمت
    if (result) {
      console.error('[conversationService] فشل إرسال صورة الترحيب، إعادة المحاولة كنص:', result.error);
    }
    result = await whatsappService.sendTextMessage(customer.phone_number, messageText);
  }

  await sendOutbound(customer, messageText, result);

  // مباشرة، بلا انتظار أي ضغطة: أرسل قائمة الأقسام (أو الخدمات إن لم توجد أقسام بعد)
  // من الجذر دائماً (stack فارغ) — هذه بداية محادثة جديدة
  await sendCategoriesList(customer, []);
}

/** currentStack: مسار الموضع الحالي (قبل هذا الاختيار) — انظر توثيق sendCategoriesList. */
async function handleCategorySelection(customer, selectedCategoryId, currentStack) {
  // لا يُعتمد على اسم القسم القادم من العميل إطلاقاً — البحث دائماً بالـ category_id
  const category = categoriesRepository.findByCategoryId(selectedCategoryId);

  if (!category || category.status !== 'active') {
    const text = botTexts.getText('categoryUnavailable');
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    customersRepository.updateState(customer.id, 'MAIN_MENU');
    customersRepository.updateNavigationStack(customer.id, []);
    return;
  }

  const newStack = [...currentStack, category.id];

  // له أبناء نشطون؟ انزل مستوى إضافياً بدل عرض الخدمات مباشرة — هذا ما يجعل
  // التداخل بلا حد للعمق: نفس الدالتين تتكرران بـ stack أطول بعنصر واحد
  if (categoriesRepository.hasActiveChildren(category.id)) {
    await sendCategoriesList(customer, newStack);
  } else {
    await sendServicesList(customer, newStack);
  }
}

/** يقرأ customers.navigation_stack (JSON نصي) بأمان — [] افتراضياً لأي قيمة مفقودة أو تالفة. */
function parseNavigationStack(customer) {
  if (!customer.navigation_stack) return [];
  try {
    const parsed = JSON.parse(customer.navigation_stack);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

/**
 * المرحلة 1 — العميل ضغط "↩️ رجوع": يُزال آخر عنصر من stack (pop)، ثم تُعاد
 * قائمة الموضع الجديد (أقسام أو خدمات، حسب ما إذا كان لآخر عنصر متبقٍّ أبناء
 * نشطون أم لا — نفس فحص handleCategorySelection تماماً). لا يُنشئ أي رسالة
 * "ترحيب" جديدة ولا يُعيد تشغيل المحادثة — فقط يعرض المستوى السابق مباشرة،
 * ويحافظ على كل سياق العميل الآخر (حالته الأخرى، بياناته، إلخ) كما هو.
 */
async function handleBackNavigation(customer) {
  const stack = parseNavigationStack(customer);

  // احتياط أمان: زر الرجوع لا يظهر أصلاً إن كان stack فارغاً (الجذر)، لكن لو
  // وصل الطلب هنا لأي سبب غير متوقع (مثال: ضغطة على رسالة قديمة)، لا نكسر
  // المحادثة — نعرض الجذر بدل توليد خطأ.
  if (stack.length === 0) {
    await sendCategoriesList(customer, []);
    return;
  }

  const newStack = stack.slice(0, -1);

  if (newStack.length === 0) {
    await sendCategoriesList(customer, []);
    return;
  }

  const parentId = newStack[newStack.length - 1];
  if (categoriesRepository.hasActiveChildren(parentId)) {
    await sendCategoriesList(customer, newStack);
  } else {
    await sendServicesList(customer, newStack);
  }
}

/**
 * العميل اختار "خدمة العملاء" من القائمة الرئيسية: يدخل طابور الانتظار
 * (customers.conversation_state = CUSTOMER_SERVICE_WAITING) حتى يفتح أحد
 * الوكلاء محادثته من صفحتهم فيُسنَد له تلقائياً — البوت لا يتدخل بعدها.
 */
async function handleCustomerServiceRequest(customer) {
  const text = botTexts.getText('customerServiceRequested');
  const result = await whatsappService.sendTextMessage(customer.phone_number, text);
  await sendOutbound(customer, text, result);
  customersRepository.updateState(customer.id, 'CUSTOMER_SERVICE_WAITING');
}

/**
 * يُستدعى من controller عند ضغط الوكيل "إنهاء المحادثة" — وليس من داخل
 * آلة حالة البوت التلقائية، لأن خدمة العملاء تتم يدوياً بالكامل. يرسل طلب
 * تقييم 5 نجوم كقائمة تفاعلية (لا أزرار: واتساب يسمح بـ 3 أزرار كحد أقصى،
 * فالقائمة أنسب لـ 5 خيارات).
 */
async function endCustomerServiceConversation(customer) {
  const bodyText = botTexts.getText('ratingPrompt');
  const sections = [
    {
      title: botTexts.getText('ratingSectionTitle'),
      rows: [5, 4, 3, 2, 1].map((n) => ({
        id: `rating_${n}`,
        title: '⭐'.repeat(n),
        description: `${n} من 5`,
      })),
    },
  ];
  const result = await whatsappService.sendInteractiveListMessage(customer.phone_number, {
    bodyText,
    buttonText: botTexts.getText('ratingButton'),
    sections,
  });
  await sendOutbound(customer, bodyText, result);
  customersRepository.updateState(customer.id, 'CUSTOMER_SERVICE_RATING');
}

/** العميل اختار عدد نجوم — تُسجَّل للوكيل المُسنَد له، ثم تنتهي المحادثة بالمسار المعتاد (قد يُسأل عن الإشعارات). */
async function handleRatingReply(customer, selectedRatingId) {
  const match = /^rating_([1-5])$/.exec(selectedRatingId || '');
  const stars = match ? Number(match[1]) : null;

  if (stars && customer.assigned_agent_id) {
    adminsRepository.addRating(customer.assigned_agent_id, stars);
  }

  const text = botTexts.getText('ratingThanks');
  const result = await whatsappService.sendTextMessage(customer.phone_number, text);
  await sendOutbound(customer, text, result);

  await completeConversation(customer);
}

// أنماط تحقق شكل مدخل العميل (القسم 4 من المواصفات) — \p{L}/\p{N} يونيكود
// فتدعم الحروف العربية مباشرة، وليست مقتصرة على الحروف اللاتينية فقط
const INPUT_FORMAT_PATTERNS = {
  NUMBERS: /^\d+$/,
  ALPHANUMERIC: /^[\p{L}\p{N}]+$/u,
  LETTERS: /^[\p{L}]+$/u,
};

const INPUT_FORMAT_LABELS = {
  NUMBERS: 'أرقام فقط',
  ALPHANUMERIC: 'أرقام وحروف فقط',
  LETTERS: 'حروف فقط',
};

/**
 * نهاية أي محادثة تمر من هنا بدل تعيين COMPLETED مباشرة: إن لم يُسأل العميل
 * من قبل عن الموافقة على الإشعارات (notifications_opt_in='pending')، يُسأل
 * الآن عبر أزرار نعم/لا (القسم 5 من المواصفات: "نهاية كل محادثة")، وتنتظر
 * حالته AWAITING_NOTIFICATION_OPT_IN رده. من أجاب سابقاً (بأي الاتجاهين)
 * لا يُسأل مجدداً في كل محادثة لاحقة — تفادياً للإزعاج المتكرر.
 */
async function completeConversation(customer) {
  if (customer.notifications_opt_in === 'pending') {
    await askNotificationOptIn(customer);
  } else {
    customersRepository.updateState(customer.id, 'COMPLETED');
  }
}

async function askNotificationOptIn(customer) {
  const bodyText = botTexts.getText('notificationOptInAsk');
  const result = await whatsappService.sendButtonMessage(customer.phone_number, bodyText, [
    { id: 'notif_yes', title: botTexts.getText('notificationOptInYes') },
    { id: 'notif_no', title: botTexts.getText('notificationOptInNo') },
  ]);
  await sendOutbound(customer, bodyText, result);
  customersRepository.updateState(customer.id, 'AWAITING_NOTIFICATION_OPT_IN');
}

async function handleNotificationOptInReply(customer, buttonId) {
  if (buttonId === 'notif_yes') {
    customersRepository.updateNotificationOptIn(customer.id, 'opted_in');
    const text = botTexts.getText('notificationOptInThanks');
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
  } else {
    customersRepository.updateNotificationOptIn(customer.id, 'opted_out');
  }
  customersRepository.updateState(customer.id, 'COMPLETED');
}

/** يبني رسالة الطلب من العميل، مع ذكر البادئة/الصيغة المطلوبة إن وُجدت حتى لا يخمّن العميل. */
function buildInputPrompt(service) {
  let text = botTexts.getText('inputPrompt');
  const hints = [];
  if (service.input_prefix) hints.push(`يجب أن يبدأ بـ "${service.input_prefix}"`);
  if (service.input_format && INPUT_FORMAT_LABELS[service.input_format]) {
    hints.push(INPUT_FORMAT_LABELS[service.input_format]);
  }
  if (hints.length > 0) text += `\n(${hints.join(' — ')})`;
  return text;
}

/** يتحقق من مدخل العميل مقابل بادئة/صيغة الخدمة المُعرَّفتين من لوحة التحكم. */
function validateCustomerInput(rawText, service) {
  const value = (rawText || '').trim();
  if (!value) return { valid: false };

  if (service.input_prefix && !value.startsWith(service.input_prefix)) {
    return { valid: false };
  }

  if (service.input_format) {
    const pattern = INPUT_FORMAT_PATTERNS[service.input_format];
    if (pattern && !pattern.test(value)) {
      return { valid: false };
    }
  }

  return { valid: true, value };
}

/**
 * يربط الخدمة برد آلي حقيقي من نظام خارجي (بنكي، محاسبي، ...). عقد بسيط
 * وقياسي وُثِّق في README §"ربط خدمة بـ API خارجي": POST بجسم JSON يحوي
 * رقم العميل والمدخل المُتحقَّق منه ومعرّفي الخدمة، ويُتوقَّع رد
 * { success: true, message: "..." } ليُرسَل للعميل كما هو. أي عطل (شبكة،
 * timeout، رد غير متوقع) يُعامَل كفشل بصمت — لا يُسرَّب أي تفصيل تقني للعميل.
 */
async function callExternalService(service, customer, inputValue) {
  try {
    const response = await axios.post(
      service.external_api_url,
      {
        service_id: service.service_id,
        service_code: service.external_service_code || null,
        phone_number: customer.phone_number,
        input: inputValue,
      },
      { timeout: 15000 }
    );

    if (response.data && response.data.success && response.data.message) {
      return { success: true, message: String(response.data.message) };
    }
    return { success: false };
  } catch (err) {
    console.error(`[conversationService] فشل استدعاء API خارجي للخدمة ${service.service_id}:`, err.message);
    return { success: false };
  }
}

async function handleServiceSelection(customer, selectedServiceId) {
  // لا يُعتمد على اسم الخدمة القادم من العميل إطلاقاً — البحث دائماً بالـ service_id
  const service = servicesRepository.findByServiceId(selectedServiceId);

  if (!service || service.status !== 'active') {
    const text = botTexts.getText('serviceUnavailable');
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    customersRepository.updateState(customer.id, 'MAIN_MENU');
    return;
  }

  customersRepository.updateState(customer.id, 'SERVICE_SELECTED', service.id);

  if (service.reply_type === 'INFO') {
    // استعلام عن معلومة معروفة: description هو نص الرد نفسه فقط — بلا اسم
    // الخدمة مكرَّراً معه (العميل رآه للتو في القائمة عند الاختيار)
    const text = (service.description || '').trim() || botTexts.getText('infoNoDetails');
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    await completeConversation(customer);
    return;
  }

  // COLLECT_INPUT: نعرض تفاصيل الخدمة (النص فقط، بلا اسمها) إن وُجدت، ثم نطلب من العميل بياناته بالصيغة المطلوبة
  const detailsText = (service.description || '').trim();
  if (detailsText) {
    const detailsResult = await whatsappService.sendTextMessage(customer.phone_number, detailsText);
    await sendOutbound(customer, detailsText, detailsResult);
  }

  const askText = buildInputPrompt(service);
  const askResult = await whatsappService.sendTextMessage(customer.phone_number, askText);
  await sendOutbound(customer, askText, askResult);

  customersRepository.updateState(customer.id, 'WAITING_FOR_DATA', service.id);
}

async function handleAwaitedData(customer, freeText) {
  // تخزين رد العميل كرسالة واردة يتم بالفعل في webhookController قبل استدعاء هذا.
  const service = customer.last_selected_service_id
    ? servicesRepository.findById(customer.last_selected_service_id)
    : null;

  if (!service) {
    // احتياط أمان: لو فُقد سياق الخدمة لأي سبب غير متوقع، لا نكسر المحادثة
    const text = botTexts.getText('fallbackReceived');
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    await completeConversation(customer);
    return;
  }

  const validation = validateCustomerInput(freeText, service);

  if (!validation.valid) {
    const errorText = service.validation_error_message || botTexts.getText('defaultValidationError');
    const result = await whatsappService.sendTextMessage(customer.phone_number, errorText);
    await sendOutbound(customer, errorText, result);
    // نبقى عمداً في WAITING_FOR_DATA — نمنح العميل فرصة تصحيح إدخاله بدل إجباره على البدء من جديد
    return;
  }

  let replyText;
  if (service.external_api_url) {
    const apiResult = await callExternalService(service, customer, validation.value);
    replyText = apiResult.success
      ? apiResult.message
      : service.validation_error_message || botTexts.getText('defaultExternalServiceError');
  } else {
    replyText = botTexts.getText('genericCollectInputThanks');
  }

  const result = await whatsappService.sendTextMessage(customer.phone_number, replyText);
  await sendOutbound(customer, replyText, result);
  await completeConversation(customer);
}

/**
 * نقطة الدخول الوحيدة من webhookController: تُحرّك آلة الحالة بناءً على
 * الحالة الحالية للعميل (قبل هذه الرسالة) ومحتوى رسالته.
 * selectedId قد يكون معرّف قسم أو معرّف خدمة حسب الحالة الحالية للعميل —
 * لهذا السبب تحديداً نحتاج فحص conversation_state هنا قبل تفسير المعرّف.
 * @param {object} customer - صف العميل من قاعدة البيانات (بحالته قبل هذه الرسالة)
 * @param {{text: string|null, selectedId: string|null}} incoming
 */
async function handleMessage(customer, { text, selectedId }) {
  // خدمة العملاء: طالما العميل ينتظر وكيلاً أو يتحدث مع أحدهم فعلياً، البوت
  // لا يتدخل إطلاقاً — الردود كلها يدوية من الوكيل عبر صفحته. الرسالة
  // الواردة تُسجَّل بالفعل في webhookController قبل الوصول إلى هنا.
  if (
    customer.conversation_state === 'CUSTOMER_SERVICE_WAITING' ||
    customer.conversation_state === 'CUSTOMER_SERVICE_ACTIVE'
  ) {
    return;
  }

  if (customer.conversation_state === 'CUSTOMER_SERVICE_RATING' && selectedId) {
    await handleRatingReply(customer, selectedId);
    return;
  }

  if (selectedId) {
    // المرحلة 1: "رجوع" يعمل من كلا مستويي القائمة (أقسام أو خدمات) بنفس المعالج —
    // هذا الفحص يجب أن يسبق فحص خدمة العملاء/الأقسام/الخدمات أدناه تحديداً
    if (
      selectedId === BACK_RESERVED_ID &&
      (customer.conversation_state === 'CATEGORY_LIST' || customer.conversation_state === 'SERVICE_LIST')
    ) {
      await handleBackNavigation(customer);
      return;
    }
    if (selectedId === CUSTOMER_SERVICE_RESERVED_ID && customer.conversation_state === 'CATEGORY_LIST') {
      await handleCustomerServiceRequest(customer);
      return;
    }
    if (customer.conversation_state === 'CATEGORY_LIST') {
      await handleCategorySelection(customer, selectedId, parseNavigationStack(customer));
      return;
    }
    if (customer.conversation_state === 'SERVICE_LIST') {
      await handleServiceSelection(customer, selectedId);
      return;
    }
    // رد قائمة وصل في حالة غير متوقعة (مثال: قائمة قديمة من محادثة سابقة) —
    // إعادة تشغيل التدفق من البداية بأمان بدل تجاهل رسالة العميل (من الجذر دائماً)
    await sendCategoriesList(customer, []);
    return;
  }

  if (customer.conversation_state === 'WAITING_FOR_DATA' && text) {
    await handleAwaitedData(customer, text);
    return;
  }

  // ردود أزرار واتساب (button_reply) تصل عبر text أيضاً (وليس selectedId، المخصَّص
  // لردود القوائم list_reply فقط) — راجع webhookController لتفصيل هذا الاستخراج
  if (customer.conversation_state === 'AWAITING_NOTIFICATION_OPT_IN' && text) {
    const buttonId = text === 'notif_yes' ? 'notif_yes' : 'notif_no'; // أي رد غير متوقع يُعامَل كرفض ضمني
    await handleNotificationOptInReply(customer, buttonId);
    return;
  }

  const normalized = (text || '').trim();
  const isServicesTrigger = SERVICES_TRIGGER_WORDS.some(
    (w) => normalized === w || normalized.includes(w)
  );

  if (isServicesTrigger) {
    await sendCategoriesList(customer, []);
    return;
  }

  // أي رسالة أخرى (بما فيها أول تواصل من عميل جديد) تُعيده لقائمة البداية
  await sendWelcomeMessage(customer);
}

module.exports = {
  handleMessage,
  buildCategoryListSections,
  buildServiceListSections,
  endCustomerServiceConversation,
  CUSTOMER_SERVICE_RESERVED_ID,
  BACK_RESERVED_ID,
};
