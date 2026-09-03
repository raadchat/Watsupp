// utils/customerPresentation.js
// المرحلة 7 — إخفاء رقم العميل عن الوكيل: طبقة عرض فقط (Presentation
// Layer). لا يمسّ هذا الملف قاعدة البيانات إطلاقاً ولا إرسال/استقبال
// رسائل واتساب الفعلي (تلك دائماً تستخدم customer.phone_number الحقيقي من
// المصدر مباشرة) — يُطبَّق فقط على الكائن الخارج في استجابة API، وتحديداً
// حين يكون الطالب Agent (admin يرى الرقم دائماً كاملاً، مهما كان الإعداد).

const botSettingsRepository = require('../database/repositories/botSettingsRepository');

/** يُخفي كل الرقم إلا آخر 4 خانات — نفس أسلوب تمويه أسرار واتساب في settingsController.js. */
function maskPhoneNumber(phone) {
  if (!phone) return phone;
  const str = String(phone);
  return `••••••${str.slice(-4)}`;
}

/**
 * يُطبَّق على أي كائن عميل قبل إرساله في استجابة API لمسار يصل إليه Agent.
 * يعيد نفس الكائن دون تغيير لو كان الطالب admin، أو لو الإعداد يسمح بإظهار
 * الرقم (show_customer_phone_to_agents !== 0، الافتراضي)، أو لو لا يوجد
 * phone_number أصلاً على الكائن (مثال: كائنات ليست عملاء).
 */
function presentCustomer(customer, req) {
  if (!customer || !('phone_number' in customer)) return customer;
  if (req.admin?.role !== 'agent') return customer;

  const settings = botSettingsRepository.get();
  if (settings?.show_customer_phone_to_agents !== 0) return customer;

  return { ...customer, phone_number: maskPhoneNumber(customer.phone_number) };
}

function presentCustomers(customers, req) {
  return (customers || []).map((c) => presentCustomer(c, req));
}

module.exports = { maskPhoneNumber, presentCustomer, presentCustomers };
