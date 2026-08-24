// database/db.js
// يفتح اتصال SQLite واحد لعمر التطبيق كامل، وينفّذ schema.sql تلقائياً
// عند كل إقلاع (كل الجمل هناك IF NOT EXISTS، لذلك التنفيذ المتكرر آمن).
//
// ملاحظة معمارية: هذا هو المكان الوحيد الذي يعرف فيه المشروع أنه يستخدم
// SQLite تحديداً. كل الوصول للبيانات يمر عبر database/repositories/*
// لذلك الانتقال لاحقاً إلى PostgreSQL/MySQL يعني تغيير هذا الملف
// وملفات الـ repositories فقط، دون لمس الـ controllers أو الـ routes.
//
// اختيار السائق: node:sqlite (مدمج في Node.js نفسه منذ v22.5، بلا حاجة
// لأي flag منذ v22.13/v23.4) بدل better-sqlite3، لأن الأخير حزمة أصلية
// تحتاج تصريف C++ عبر node-gyp، وهذا يفشل على بيئات مثل Termux/Android
// (لا توجد binaries جاهزة له، وnode-gyp لا يعرف مسار Android NDK).
// node:sqlite يزيل هذه المشكلة كلياً لأنه يأتي مع Node نفسه. واجهته شبه
// مطابقة لـ better-sqlite3 (.prepare().get/all/run())، والفرق الوحيد هنا
// هو استخدام PRAGMA عبر .exec() بدل دالة .pragma() الخاصة بتلك الحزمة.
// يتطلب Node.js >= 22.13.0 (راجع engines في package.json).

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const configuredPath = process.env.DATABASE_URL || './backend/database/bot.db';
const dbPath = path.resolve(process.cwd(), configuredPath);

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);

// WAL يحسّن التزامن بين القراءة والكتابة (لوحة التحكم + الـ webhook في آن واحد)
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

ensureCategoriesMigration(db);
ensureParentCategoryMigration(db);
ensureServiceReplyTypeMigration(db);
ensureCustomerColumnsMigration(db);
ensureCustomerStateExpansionMigration(db);
ensureMessagesSentByMigration(db);
ensureAgentRatingColumnsMigration(db);

console.log(`[database] متصل بقاعدة البيانات: ${dbPath}`);

/**
 * ترقية تلقائية وآمنة للتكرار: تضيف عمود services.category_id (مرجع رقمي
 * إلى categories.id) إن لم يكن موجوداً، وتنقل أي قيم نصية قديمة من
 * services.category إلى صفوف categories حقيقية مع ربط الخدمات بها.
 * تعمل بنفس المنطق سواء كانت قاعدة بيانات جديدة تماماً (لا شيء لترحيله)
 * أو قاعدة موجودة من قبل هذه الميزة (تُرحَّل بياناتها فعلياً).
 * تُستدعى في كل إقلاع لكنها تتحقق أولاً فتُنفَّذ مرة واحدة فقط.
 */
function ensureCategoriesMigration(database) {
  const columns = database.prepare('PRAGMA table_info(services)').all();
  const hasCategoryId = columns.some((c) => c.name === 'category_id');
  if (hasCategoryId) return; // رُحِّلت مسبقاً

  console.log('[database] ترقية: إضافة services.category_id ونقل الأقسام النصية القديمة...');

  database.exec('BEGIN');
  try {
    database.exec('ALTER TABLE services ADD COLUMN category_id INTEGER REFERENCES categories(id)');

    const oldCategories = database
      .prepare("SELECT DISTINCT category FROM services WHERE category IS NOT NULL AND TRIM(category) <> ''")
      .all();

    const insertCategory = database.prepare(
      'INSERT INTO categories (category_id, name, display_order) VALUES (?, ?, ?)'
    );
    const linkServices = database.prepare('UPDATE services SET category_id = ? WHERE category = ?');

    oldCategories.forEach((row, index) => {
      const info = insertCategory.run(`cat_${index + 1}`, row.category, index);
      linkServices.run(info.lastInsertRowid, row.category);
    });

    database.exec('COMMIT');
    console.log(`[database] تمت الترقية: أُنشئ ${oldCategories.length} قسماً من البيانات القديمة.`);
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

/**
 * ترقية تلقائية: تضيف عمود categories.parent_category_id (تداخل أقسام
 * داخل أقسام بلا حد للعمق) إن لم يكن موجوداً. NULL = قسم رئيسي، فكل
 * الأقسام الموجودة مسبقاً تبقى كأقسام رئيسية تلقائياً وبأمان بعد الترقية.
 */
function ensureParentCategoryMigration(database) {
  const columns = database.prepare('PRAGMA table_info(categories)').all();
  const hasParentId = columns.some((c) => c.name === 'parent_category_id');
  if (hasParentId) return;

  console.log('[database] ترقية: إضافة categories.parent_category_id (دعم أقسام متداخلة)...');
  database.exec('ALTER TABLE categories ADD COLUMN parent_category_id INTEGER REFERENCES categories(id)');
  console.log('[database] تمت الترقية — كل الأقسام الحالية بقيت أقساماً رئيسية.');
}

/**
 * ترقية تلقائية: تضيف أعمدة "نوع رد الخدمة" (رد معلومة ثابتة أو طلب بيانات
 * من العميل بتحقق شكل/بادئة محدَّدين، مع إمكانية ربط برد آلي من API خارجي).
 * القيمة الافتراضية للخدمات الموجودة مسبقاً هي COLLECT_INPUT عمداً — تحافظ
 * على سلوكها الحالي (طلب بيانات من العميل) دون أي تغيير مفاجئ بعد الترقية.
 * الخدمات الجديدة تحدِّد النوع صراحة من نموذج اللوحة (افتراضها INFO هناك).
 */
function ensureServiceReplyTypeMigration(database) {
  const columns = database.prepare('PRAGMA table_info(services)').all();
  const hasReplyType = columns.some((c) => c.name === 'reply_type');
  if (hasReplyType) return;

  console.log('[database] ترقية: إضافة أعمدة نوع رد الخدمة (reply_type وما يتعلق به)...');
  database.exec(
    "ALTER TABLE services ADD COLUMN reply_type TEXT NOT NULL DEFAULT 'COLLECT_INPUT' CHECK (reply_type IN ('INFO','COLLECT_INPUT'))"
  );
  database.exec(
    "ALTER TABLE services ADD COLUMN input_format TEXT CHECK (input_format IN ('NUMBERS','ALPHANUMERIC','LETTERS') OR input_format IS NULL)"
  );
  database.exec('ALTER TABLE services ADD COLUMN input_prefix TEXT');
  database.exec('ALTER TABLE services ADD COLUMN validation_error_message TEXT');
  database.exec('ALTER TABLE services ADD COLUMN external_api_url TEXT');
  database.exec('ALTER TABLE services ADD COLUMN external_service_code TEXT');
  console.log('[database] تمت الترقية — الخدمات الحالية بقيت بسلوكها الأصلي (طلب بيانات من العميل).');
}

module.exports = db;

/**
 * ترقية تلقائية: تضيف customers.notifications_opt_in (موافقة تلقي الإشعارات
 * بعد نهاية المحادثة) و customers.assigned_agent_id (وكيل خدمة العملاء
 * المُعيَّن لهذا العميل حالياً) — كلاهما عبر ALTER TABLE بسيط، بلا حاجة لإعادة
 * بناء الجدول (على عكس ensureCustomerStateExpansionMigration أدناه).
 */
function ensureCustomerColumnsMigration(database) {
  const columns = database.prepare('PRAGMA table_info(customers)').all();
  const names = columns.map((c) => c.name);

  if (!names.includes('notifications_opt_in')) {
    console.log('[database] ترقية: إضافة customers.notifications_opt_in...');
    database.exec(
      "ALTER TABLE customers ADD COLUMN notifications_opt_in TEXT NOT NULL DEFAULT 'pending' CHECK (notifications_opt_in IN ('pending','opted_in','opted_out'))"
    );
  }

  if (!names.includes('assigned_agent_id')) {
    console.log('[database] ترقية: إضافة customers.assigned_agent_id...');
    database.exec('ALTER TABLE customers ADD COLUMN assigned_agent_id INTEGER REFERENCES admins(id)');
  }
}

/**
 * ترقية تلقائية أكثر تعقيداً: قيد CHECK على conversation_state لا يمكن
 * تعديله بـ ALTER TABLE ADD COLUMN عادية (SQLite لا يدعم تعديل قيود CHECK
 * قائمة مباشرة)، فنعيد بناء الجدول بالكامل بالنمط القياسي في SQLite:
 * إنشاء جدول جديد بالقيد المحدَّث → نسخ كل البيانات → حذف القديم → إعادة
 * تسمية الجديد. تعمل داخل معاملة واحدة (BEGIN/COMMIT) فإما تنجح بالكامل
 * أو لا يتغيّر شيء إطلاقاً. يجب أن تُستدعى بعد ensureCustomerColumnsMigration
 * لأن النسخ يتضمّن الأعمدة التي تلك الدالة تضيفها.
 */
function ensureCustomerStateExpansionMigration(database) {
  const row = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'").get();
  if (row && row.sql.includes('AWAITING_NOTIFICATION_OPT_IN')) return; // مُرحَّلة مسبقاً

  console.log('[database] ترقية: توسيع حالات محادثة العملاء (إعادة بناء جدول customers)...');

  database.exec('BEGIN');
  try {
    database.exec(`
      CREATE TABLE customers_new (
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
        notifications_opt_in TEXT NOT NULL DEFAULT 'pending' CHECK (notifications_opt_in IN ('pending','opted_in','opted_out')),
        assigned_agent_id   INTEGER REFERENCES admins(id),
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    database.exec(`
      INSERT INTO customers_new
        (id, phone_number, last_contact, conversation_state, status,
         last_selected_service_id, notifications_opt_in, assigned_agent_id, created_at, updated_at)
      SELECT
        id, phone_number, last_contact, conversation_state, status,
        last_selected_service_id, notifications_opt_in, assigned_agent_id, created_at, updated_at
      FROM customers
    `);

    database.exec('DROP TABLE customers');
    database.exec('ALTER TABLE customers_new RENAME TO customers');
    database.exec('CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number)');

    database.exec('COMMIT');
    console.log('[database] تمت الترقية — كل بيانات العملاء محفوظة كاملة.');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

/** ترقية بسيطة: من أرسل كل رسالة صادرة (NULL=البوت تلقائياً، أو اسم مستخدم من ردّ يدوياً). */
function ensureMessagesSentByMigration(database) {
  const columns = database.prepare('PRAGMA table_info(messages)').all();
  if (columns.some((c) => c.name === 'sent_by')) return;

  console.log('[database] ترقية: إضافة messages.sent_by...');
  database.exec('ALTER TABLE messages ADD COLUMN sent_by TEXT');
}

/** ترقية بسيطة: مجموع/عدد تقييمات النجوم التراكمية لكل مدير (وكلاء خدمة العملاء تحديداً). */
function ensureAgentRatingColumnsMigration(database) {
  const columns = database.prepare('PRAGMA table_info(admins)').all();
  const names = columns.map((c) => c.name);

  if (!names.includes('rating_total')) {
    console.log('[database] ترقية: إضافة admins.rating_total...');
    database.exec('ALTER TABLE admins ADD COLUMN rating_total INTEGER NOT NULL DEFAULT 0');
  }
  if (!names.includes('rating_count')) {
    console.log('[database] ترقية: إضافة admins.rating_count...');
    database.exec('ALTER TABLE admins ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!names.includes('name')) {
    console.log('[database] ترقية: إضافة admins.name...');
    // القيمة الافتراضية للحسابات الموجودة مسبقاً: نفس username، حتى لا يبقى الاسم فارغاً بلا داعٍ
    database.exec('ALTER TABLE admins ADD COLUMN name TEXT');
    database.exec('UPDATE admins SET name = username WHERE name IS NULL');
  }
}
