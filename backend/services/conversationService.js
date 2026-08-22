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
const whatsappService = require('./whatsappService');
const axios = require('axios');

const SERVICES_TRIGGER_WORDS = ['الخدمات', 'خدمات', 'services', 'menu', 'قائمة'];

// حدود رسالة القائمة التفاعلية في WhatsApp Cloud API (تنطبق على كل مستوى على حدة)
const MAX_LIST_ROWS = 10;
const MAX_TITLE_LEN = 24;
const MAX_DESC_LEN = 72;

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? `${str.slice(0, len - 1)}…` : str;
}

/** يبني sections لرسالة قائمة الأقسام (المستوى الأول) مباشرة من قاعدة البيانات. */
function buildCategoryListSections(categories) {
  // نفس قيد الـ 10 صفوف أدناه، يُطبَّق هنا أيضاً لأنها رسالة قائمة مستقلة
  const limited = categories.slice(0, MAX_LIST_ROWS);
  const rows = limited.map((c) => ({
    id: c.category_id,
    title: truncate(c.name, MAX_TITLE_LEN),
    description: truncate(c.description || '', MAX_DESC_LEN),
  }));
  return [{ title: 'الأقسام المتاحة', rows }];
}

/** يبني sections لرسالة قائمة الخدمات (المستوى الثاني) مباشرة من قاعدة البيانات. */
function buildServiceListSections(services) {
  // ملاحظة: WhatsApp Cloud API يسمح بحد أقصى 10 صفوف في رسالة قائمة واحدة.
  // إذا تجاوز عدد الخدمات النشطة (ضمن القسم) هذا الحد، تُعرض أول 10 فقط
  // (قيد حقيقي من واجهة واتساب، وليس افتراضاً اعتباطياً).
  const limited = services.slice(0, MAX_LIST_ROWS);
  const rows = limited.map((s) => ({
    id: s.service_id,
    title: truncate(s.name, MAX_TITLE_LEN),
    description: truncate(s.description || '', MAX_DESC_LEN),
  }));
  return [{ title: 'الخدمات المتاحة', rows }];
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
 * المستوى الحالي من شجرة الأقسام: يعرض أبناء parentDbId النشطين (أو
 * الأقسام الرئيسية إن مُرِّر null/تُرك فارغاً). لا حد مبرمَج على عمق
 * التداخل — الاختيار المتكرر لقسم له أبناء يستدعي هذه الدالة من جديد
 * بمعرّف ذلك القسم، وهكذا حتى الوصول لقسم "ورقة" فتُعرض خدماته.
 * إن لم يُنشئ المدير أي قسم رئيسي بعد، يتراجع تلقائياً لعرض كل الخدمات
 * النشطة كقائمة مسطّحة (السلوك الأصلي) بدل توقف البوت.
 */
async function sendCategoriesList(customer, parentDbId = null) {
  const activeCategories = categoriesRepository.findActiveChildrenOf(parentDbId); // <-- القراءة المباشرة من قاعدة البيانات

  if (activeCategories.length === 0) {
    if (parentDbId === null) {
      await sendServicesList(customer, null); // لا توجد أقسام في النظام كله بعد
    } else {
      await sendServicesList(customer, parentDbId); // قسم "ورقة" — أبناؤه خدمات لا أقسام
    }
    return;
  }

  const sections = buildCategoryListSections(activeCategories);
  const result = await whatsappService.sendInteractiveListMessage(customer.phone_number, {
    bodyText: 'اختر القسم المناسب:',
    buttonText: 'عرض الأقسام',
    sections,
  });
  await sendOutbound(customer, '[قائمة الأقسام التفاعلية]', result);
  customersRepository.updateState(customer.id, 'CATEGORY_LIST');
}

/**
 * المستوى الثاني: يعرض خدمات قسم واحد (categoryDbId = categories.id الرقمي)،
 * أو كل الخدمات النشطة إن مُرِّر null (حالة التراجع أعلاه، أو نظام بلا أقسام أصلاً).
 */
async function sendServicesList(customer, categoryDbId) {
  const activeServices = categoryDbId
    ? servicesRepository.findActiveByCategoryId(categoryDbId)
    : servicesRepository.findActive();

  if (activeServices.length === 0) {
    const text = categoryDbId
      ? 'لا توجد خدمات متاحة في هذا القسم حالياً.'
      : 'لا توجد خدمات متاحة حالياً، يرجى المحاولة لاحقاً.';
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    customersRepository.updateState(customer.id, 'MAIN_MENU');
    return;
  }

  const sections = buildServiceListSections(activeServices);
  const result = await whatsappService.sendInteractiveListMessage(customer.phone_number, {
    bodyText: 'اختر إحدى الخدمات التالية:',
    buttonText: 'عرض الخدمات',
    sections,
  });
  await sendOutbound(customer, '[قائمة الخدمات التفاعلية]', result);
  customersRepository.updateState(customer.id, 'SERVICE_LIST');
}

const DEFAULT_WELCOME_TEXT = 'مرحباً بك 👋\nاكتب "الخدمات" لعرض قائمة الخدمات المتاحة حالياً.';

function getPublicBaseUrl() {
  // يُستخدم لبناء رابط عام لصورة الترحيب يستطيع خادم Meta الوصول إليه.
  // اضبط PUBLIC_BASE_URL في .env بمجرد نشر الخادم على نطاق حقيقي (أو رابط
  // ngrok أثناء التجربة) — القيمة الافتراضية أدناه تعمل محلياً فقط ولن
  // تصل إليها Meta، فلن تُرسَل الصورة فعلياً حتى تُضبط.
  return process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * أي رسالة غير مفهومة (أو أول تواصل من عميل جديد) تصل هنا: رسالة ترحيب
 * قابلة للتعديل الكامل من لوحة التحكم (نص + صورة اختيارية)، بدل نص ثابت
 * في الكود — كما هو مطلوب صراحة.
 */
async function sendWelcomeMessage(customer) {
  const botSettings = botSettingsRepository.get();
  const messageText = botSettings?.welcome_message || DEFAULT_WELCOME_TEXT;

  let result;
  if (botSettings?.welcome_image_filename) {
    const imageUrl = `${getPublicBaseUrl()}/uploads/${botSettings.welcome_image_filename}`;
    result = await whatsappService.sendImageMessage(customer.phone_number, imageUrl, messageText);
  } else {
    result = await whatsappService.sendTextMessage(customer.phone_number, messageText);
  }

  await sendOutbound(customer, messageText, result);
  customersRepository.updateState(customer.id, 'MAIN_MENU');
}

async function handleCategorySelection(customer, selectedCategoryId) {
  // لا يُعتمد على اسم القسم القادم من العميل إطلاقاً — البحث دائماً بالـ category_id
  const category = categoriesRepository.findByCategoryId(selectedCategoryId);

  if (!category || category.status !== 'active') {
    const text = 'عذراً، هذا القسم لم يعد متاحاً. اكتب "الخدمات" لعرض القائمة المحدّثة.';
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    customersRepository.updateState(customer.id, 'MAIN_MENU');
    return;
  }

  // له أبناء نشطون؟ انزل مستوى إضافياً بدل عرض الخدمات مباشرة — هذا ما يجعل
  // التداخل بلا حد للعمق: نفس الدالتين تتكرران بمعرّف القسم المُختار كأب جديد
  if (categoriesRepository.hasActiveChildren(category.id)) {
    await sendCategoriesList(customer, category.id);
  } else {
    await sendServicesList(customer, category.id);
  }
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

const DEFAULT_VALIDATION_ERROR = 'عذراً، الصيغة التي أرسلتها غير صحيحة. يرجى المحاولة مرة أخرى.';
const DEFAULT_EXTERNAL_ERROR = 'تعذّر معالجة طلبك حالياً، حاول مرة أخرى لاحقاً.';

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
  const bodyText = 'هل ترغب في تلقي إشعارات وعروض منا مستقبلاً على واتساب؟';
  const result = await whatsappService.sendButtonMessage(customer.phone_number, bodyText, [
    { id: 'notif_yes', title: 'نعم، أوافق' },
    { id: 'notif_no', title: 'لا، شكراً' },
  ]);
  await sendOutbound(customer, bodyText, result);
  customersRepository.updateState(customer.id, 'AWAITING_NOTIFICATION_OPT_IN');
}

async function handleNotificationOptInReply(customer, buttonId) {
  if (buttonId === 'notif_yes') {
    customersRepository.updateNotificationOptIn(customer.id, 'opted_in');
    const text = 'شكراً لك! سنبقيك على اطّلاع بآخر العروض والتحديثات. 🎉';
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
  } else {
    customersRepository.updateNotificationOptIn(customer.id, 'opted_out');
  }
  customersRepository.updateState(customer.id, 'COMPLETED');
}

/** يبني رسالة الطلب من العميل، مع ذكر البادئة/الصيغة المطلوبة إن وُجدت حتى لا يخمّن العميل. */
function buildInputPrompt(service) {
  let text = 'يرجى إرسال التفاصيل اللازمة لإتمام طلب هذه الخدمة في رسالة واحدة.';
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
    const text = 'عذراً، هذه الخدمة لم تعد متاحة. اكتب "الخدمات" لعرض القائمة المحدّثة.';
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    customersRepository.updateState(customer.id, 'MAIN_MENU');
    return;
  }

  customersRepository.updateState(customer.id, 'SERVICE_SELECTED', service.id);

  if (service.reply_type === 'INFO') {
    // استعلام عن معلومة معروفة: description هو نص الرد نفسه، لا حاجة لأي إدخال إضافي
    const text = `*${service.name}*\n\n${service.description || ''}`.trim();
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    await completeConversation(customer);
    return;
  }

  // COLLECT_INPUT: نعرض تفاصيل الخدمة ثم نطلب من العميل بياناته بالصيغة المطلوبة
  const detailsText = `*${service.name}*\n\n${service.description || ''}`.trim();
  const detailsResult = await whatsappService.sendTextMessage(customer.phone_number, detailsText);
  await sendOutbound(customer, detailsText, detailsResult);

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
    const text = 'شكراً لك، تم استلام رسالتك.';
    const result = await whatsappService.sendTextMessage(customer.phone_number, text);
    await sendOutbound(customer, text, result);
    await completeConversation(customer);
    return;
  }

  const validation = validateCustomerInput(freeText, service);

  if (!validation.valid) {
    const errorText = service.validation_error_message || DEFAULT_VALIDATION_ERROR;
    const result = await whatsappService.sendTextMessage(customer.phone_number, errorText);
    await sendOutbound(customer, errorText, result);
    // نبقى عمداً في WAITING_FOR_DATA — نمنح العميل فرصة تصحيح إدخاله بدل إجباره على البدء من جديد
    return;
  }

  let replyText;
  if (service.external_api_url) {
    const apiResult = await callExternalService(service, customer, validation.value);
    replyText = apiResult.success ? apiResult.message : service.validation_error_message || DEFAULT_EXTERNAL_ERROR;
  } else {
    replyText = 'شكراً لك، تم استلام طلبك بنجاح وسنتواصل معك قريباً بخصوصه.';
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
  if (selectedId) {
    if (customer.conversation_state === 'CATEGORY_LIST') {
      await handleCategorySelection(customer, selectedId);
      return;
    }
    if (customer.conversation_state === 'SERVICE_LIST') {
      await handleServiceSelection(customer, selectedId);
      return;
    }
    // رد قائمة وصل في حالة غير متوقعة (مثال: قائمة قديمة من محادثة سابقة) —
    // إعادة تشغيل التدفق من البداية بأمان بدل تجاهل رسالة العميل
    await sendCategoriesList(customer);
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
    await sendCategoriesList(customer);
    return;
  }

  // أي رسالة أخرى (بما فيها أول تواصل من عميل جديد) تُعيده لقائمة البداية
  await sendWelcomeMessage(customer);
}

module.exports = { handleMessage, buildCategoryListSections, buildServiceListSections };
