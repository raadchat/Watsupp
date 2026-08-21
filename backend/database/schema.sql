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
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

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
-- ملاحظة: عمود services.category_id (مرجع رقمي داخلي إلى categories.id) يُضاف
-- عبر ترقية تلقائية في db.js (ensureCategoriesMigration) وليس هنا، لأن
-- CREATE TABLE IF NOT EXISTS لا يُعدّل جدولاً موجوداً مسبقاً لدى من ثبّت
-- المشروع قبل هذه الميزة. أي تثبيت جديد يمر بنفس المسار أيضاً فيحصل على
-- العمود فوراً بعد أول تشغيل — راجع db.js للتفاصيل.

-- ---------------------------------------------------------
-- Customers: عملاء واتساب وحالة محادثتهم الحالية
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number        TEXT NOT NULL UNIQUE,
  last_contact        TEXT,
  conversation_state  TEXT NOT NULL DEFAULT 'MAIN_MENU'
                        CHECK (conversation_state IN
                          ('MAIN_MENU','CATEGORY_LIST','SERVICE_LIST','SERVICE_SELECTED','WAITING_FOR_DATA','COMPLETED')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  last_selected_service_id INTEGER REFERENCES services(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number);

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
