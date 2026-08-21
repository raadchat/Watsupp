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

module.exports = db;
