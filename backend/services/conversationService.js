// services/conversationService.js
// "القائمة الديناميكية": هذا الملف هو التطبيق الفعلي لأهم نقطة في المواصفات (القسم 10)،
// وأصبح الآن على مستويين (أقسام ← خدمات) بنفس مبدأ بوت الكريمي المرجعي.
// لا توجد هنا أي قائمة أقسام أو خدمات مكتوبة داخل الكود — كل قائمة تُبنى من
// categoriesRepository.findActive() / servicesRepository.findActive*() في لحظة
// الطلب. إضافة/تعديل/حذف من لوحة التحكم ينعكس في الرسالة التالية للعميل دون
// أي إعادة تشغيل أو تعديل كود.
//
// ملاحظة تقنية: واتساب لا يدعم "قائمة داخل قائمة" كعنصر واجهة واحد (حد 10
// صفوف، مستوى واحد فقط لكل رسالة). التأثير المطلوب يتحقق بتسلسل رسالتين:
// الأولى تعرض الأقسام (state=CATEGORY_LIST)، واختيار قسم يرسل رسالة ثانية
// بخدمات ذلك القسم فقط (state=SERVICE_LIST) — بالضبط كما تفعل تطبيقات
// حقيقية مثل بوت الكريمي.
//
// افتراض مذكور بوضوح: كلمات التحفيز ("الخدمات") ونص رسائل البوت (الترحيب،
// طلب البيانات، رسالة الشكر) غير محددة في المواصفات، فاخترتُ نصوصاً عربية
// قياسية بسيطة يسهل تعديلها لاحقاً حسب هوية النشاط التجاري.

const categoriesRepository = require('../database/repositories/categoriesRepository');
const servicesRepository = require('../database/repositories/servicesRepository');
const customersRepository = require('../database/repositories/customersRepository');
const messagesRepository = require('../database/repositories/messagesRepository');
const whatsappService = require('./whatsappService');

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
 * المستوى الأول: يعرض الأقسام. إن لم يُنشئ المدير أي قسم بعد، يتراجع تلقائياً
 * لعرض كل الخدمات النشطة كقائمة مسطّحة (السلوك الأصلي) بدل توقف البوت.
 */
async function sendCategoriesList(customer) {
  const activeCategories = categoriesRepository.findActive(); // <-- القراءة المباشرة من قاعدة البيانات

  if (activeCategories.length === 0) {
    await sendServicesList(customer, null);
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

async function sendMainMenu(customer) {
  const text = `مرحباً بك 👋\nاكتب "الخدمات" لعرض قائمة الخدمات المتاحة حالياً.`;
  const result = await whatsappService.sendTextMessage(customer.phone_number, text);
  await sendOutbound(customer, text, result);
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

  await sendServicesList(customer, category.id);
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

  const detailsText = `*${service.name}*\n\n${service.description || ''}`.trim();
  const detailsResult = await whatsappService.sendTextMessage(customer.phone_number, detailsText);
  await sendOutbound(customer, detailsText, detailsResult);

  const askText = 'يرجى إرسال التفاصيل اللازمة لإتمام طلب هذه الخدمة في رسالة واحدة.';
  const askResult = await whatsappService.sendTextMessage(customer.phone_number, askText);
  await sendOutbound(customer, askText, askResult);

  customersRepository.updateState(customer.id, 'WAITING_FOR_DATA', service.id);
}

async function handleAwaitedData(customer, freeText) {
  // تخزين رد العميل كرسالة واردة يتم بالفعل في webhookController قبل استدعاء هذا؛
  // هنا فقط نُنهي دورة الحالة ونؤكد الاستلام.
  const text = 'شكراً لك، تم استلام طلبك بنجاح وسنتواصل معك قريباً بخصوصه.';
  const result = await whatsappService.sendTextMessage(customer.phone_number, text);
  await sendOutbound(customer, text, result);
  customersRepository.updateState(customer.id, 'COMPLETED');
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

  const normalized = (text || '').trim();
  const isServicesTrigger = SERVICES_TRIGGER_WORDS.some(
    (w) => normalized === w || normalized.includes(w)
  );

  if (isServicesTrigger) {
    await sendCategoriesList(customer);
    return;
  }

  // أي رسالة أخرى (بما فيها أول تواصل من عميل جديد) تُعيده لقائمة البداية
  await sendMainMenu(customer);
}

module.exports = { handleMessage, buildCategoryListSections, buildServiceListSections };
