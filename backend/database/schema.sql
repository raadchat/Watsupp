-- =============================================================
-- مخطط قاعدة البيانات - نظام إدارة بوت واتساب
-- SQLite — يُنفَّذ تلقائياً عند إقلاع الخادم (db.js) وهو آمن للتكرار
-- (كل جملة تستخدم IF NOT EXISTS)
-- =============================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------
-- Admins: حسابات مديري لوحة التحكم
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- bcrypt hash فقط، لا يُخزَّن أي نص صريح أبداً
  role          TEXT NOT NULL DEFAULT 'admin',  -- 'admin' أو 'agent' (وكيل خدمة عملاء)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
-- ملاحظة: admins.name (الاسم المعروض، مختلف عن username المُستخدَم للدخول)
-- و admins.rating_total و admins.rating_count (تقييم 5 نجوم التراكمي لوكلاء
-- خدمة العملاء) تُضاف عبر ترقية تلقائية في db.js.

-- ---------------------------------------------------------
-- Categories: تصنيف "المستوى الأول" في قائمة واتساب (مثال: الخدمات البنكية،
-- خدمات البطاقات...). القائمة الأولى التي يراها العميل تُبنى من هذا الجدول؛
-- اختياره لقسم يفتح قائمة ثانية بخدمات ذلك القسم فقط (services.category_id).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   TEXT NOT NULL UNIQUE,    -- معرف عام مستقر يُستخدم في list_reply.id من واتساب
  name          TEXT NOT NULL,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,  -- ترتيب الظهور للعميل (الأصغر أولاً)
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_categories_status ON categories(status);
-- ملاحظة: عمود categories.parent_category_id (تداخل أقسام داخل أقسام بلا حد
-- عمق) يُضاف عبر ترقية تلقائية في db.js (ensureParentCategoryMigration)
-- بنفس أسلوب category_id في services أدناه — NULL يعني "قسم رئيسي".

-- ---------------------------------------------------------
-- Services: كتالوج الخدمات الذي يقرأ منه البوت مباشرة
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id    TEXT NOT NULL UNIQUE,    -- معرف عام مستقر يُستخدم في رسائل واتساب التفاعلية
  name          TEXT NOT NULL,
  description   TEXT,
  category      TEXT,                    -- (قديم/مهمَل) استُبدل بـ category_id أدناه، أُبقي عليه للترحيل فقط
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
-- ملاحظة: الأعمدة التالية تُضاف عبر ترقيات تلقائية في db.js وليس هنا (نفس
-- سبب category_id أعلاه — CREATE TABLE IF NOT EXISTS لا يُعدّل جدولاً قائماً):
--   category_id (مرجع رقمي لـ categories.id)                — ensureCategoriesMigration
--   reply_type / input_format / input_prefix /
--   validation_error_message / external_api_url /
--   external_service_code (نوع الرد ونموذج جمع بيانات العميل) — ensureServiceReplyTypeMigration

-- ---------------------------------------------------------
-- Customers: عملاء واتساب وحالة محادثتهم الحالية
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number        TEXT NOT NULL UNIQUE,
  last_contact        TEXT,
  conversation_state  TEXT NOT NULL DEFAULT 'MAIN_MENU'
                        CHECK (conversation_state IN
                          ('MAIN_MENU','CATEGORY_LIST','SERVICE_LIST','SERVICE_SELECTED',
                           'WAITING_FOR_DATA','AWAITING_NOTIFICATION_OPT_IN',
                           'CUSTOMER_SERVICE_WAITING','CUSTOMER_SERVICE_ACTIVE','CUSTOMER_SERVICE_RATING',
                           'COMPLETED')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  last_selected_service_id INTEGER REFERENCES services(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number);
-- ملاحظة: notifications_opt_in (موافقة تلقي الإشعارات) و assigned_agent_id
-- (وكيل خدمة العملاء المُعيَّن) يُضافان عبر ترقيات تلقائية في db.js، بنفس
-- سبب كل ترقيات هذا الملف: CREATE TABLE IF NOT EXISTS لا تُعدّل جدولاً قائماً.

-- ---------------------------------------------------------
-- Messages: سجل كل رسالة واردة/صادرة مرتبطة بعميل
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id           INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  direction             TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message               TEXT,
  status                TEXT NOT NULL DEFAULT 'received',
  whatsapp_message_id   TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_customer ON messages(customer_id);
-- ملاحظة: messages.sent_by (من أرسل رسالة صادرة: NULL = البوت تلقائياً، أو
-- اسم مستخدم المدير/الوكيل الذي ردّ يدوياً) يُضاف عبر ترقية تلقائية في db.js.

-- ---------------------------------------------------------
-- Bulk jobs + items: جدول إضافي لإدارة طابور الرسائل الجماعية
-- (مسموح به صراحة في المواصفات عند الحاجة إلى جدول لإدارة الـ Queue)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS bulk_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  message_text TEXT NOT NULL,
  total_count  INTEGER NOT NULL DEFAULT 0,
  sent_count   INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_by   INTEGER REFERENCES admins(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulk_job_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id              INTEGER NOT NULL REFERENCES bulk_jobs(id) ON DELETE CASCADE,
  phone_number        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error               TEXT,
  whatsapp_message_id TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bulk_job_items_job ON bulk_job_items(job_id, status);

-- ---------------------------------------------------------
-- WhatsApp Settings: صف واحد فقط (id مقفل على 1) يخزّن بيانات اتصال
-- WhatsApp Cloud API القابلة للتعديل من لوحة التحكم مباشرة (بدل .env),
-- مع نتيجة آخر اختبار اتصال لعرضها كحالة "متصل/غير متصل" في اللوحة.
-- access_token لا يُعاد أبداً كاملاً في أي استجابة API (راجع settingsController).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  phone_number_id     TEXT,
  access_token        TEXT,
  verify_token        TEXT,
  business_account_id TEXT,
  status              TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected')),
  last_tested_at      TEXT,
  last_test_result    TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------
-- Bot Settings: صف واحد فقط (id مقفل على 1) — محتوى سلوك البوت القابل
-- للتعديل من لوحة التحكم (رسالة الترحيب حالياً، ومكان طبيعي لأي محتوى
-- بوت مشابه لاحقاً). welcome_image_filename يشير لملف داخل frontend/uploads/
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS bot_settings (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  welcome_message         TEXT,
  welcome_image_filename  TEXT,
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------
-- Customer Service Settings: صف واحد فقط — يتحكم في القسم الثابت "خدمة
-- العملاء" الذي يظهر دائماً كآخر خيار في قائمة الأقسام الرئيسية (وليس
-- صفاً حقيقياً في جدول categories، حتى يبقى ترتيبه مضموناً كآخر عنصر
-- بصرف النظر عن عدد الأقسام الحقيقية التي يضيفها المدير أو يحذفها).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_service_settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  enabled    INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  label      TEXT NOT NULL DEFAULT 'خدمة العملاء',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
