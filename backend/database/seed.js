// database/seed.js
// سكربت تفاعلي لإنشاء أول حساب مدير. يُشغَّل يدوياً مرة واحدة بعد التثبيت:
//   npm run seed:admin
// (راجع README.md لتفاصيل الاستخدام)

require('dotenv').config();
const bcrypt = require('bcryptjs'); // نفس واجهة bcrypt، بلا تصريف أصلي
const readline = require('readline');

const db = require('./db'); // يضمن تنفيذ schema.sql قبل أي استعلام
const adminsRepository = require('./repositories/adminsRepository');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log('=== إنشاء حساب مدير جديد للوحة التحكم ===\n');

  const username = (await ask('اسم المستخدم (للدخول): ')).trim();
  const name = (await ask('الاسم الكامل (اختياري، Enter لتركه كاسم المستخدم): ')).trim();
  const password = await ask('كلمة المرور (6 أحرف على الأقل): ');

  if (!username) {
    console.error('\n✗ اسم المستخدم مطلوب.');
    process.exitCode = 1;
    rl.close();
    return;
  }

  if (!password || password.length < 6) {
    console.error('\n✗ كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
    process.exitCode = 1;
    rl.close();
    return;
  }

  const existing = adminsRepository.findByUsername(username);
  if (existing) {
    console.error('\n✗ اسم المستخدم موجود بالفعل، اختر اسماً آخر.');
    process.exitCode = 1;
    rl.close();
    return;
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const password_hash = await bcrypt.hash(password, saltRounds);

  const admin = adminsRepository.create({ username, password_hash, role: 'admin', name: name || username });

  console.log(`\n✓ تم إنشاء المدير بنجاح: "${admin.username}" (ID: ${admin.id})`);
  console.log('يمكنك الآن تسجيل الدخول من صفحة login.html بهذه البيانات.');

  rl.close();
}

main()
  .catch((err) => {
    console.error('\n✗ حدث خطأ غير متوقع:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close?.();
  });
