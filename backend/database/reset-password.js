// database/reset-password.js
// المرحلة 5 — أمر استرجاع طارئ: يغيّر كلمة مرور مستخدم موجود بالفعل (لمن
// نسيها)، بلا أي واجهة ويب (تفيد تحديداً حين لا يمكن تسجيل الدخول أصلاً).
// يُشغَّل يدوياً من الطرفية:
//   npm run reset-password

require('dotenv').config();
const bcrypt = require('bcryptjs');
const readline = require('readline');

const db = require('./db'); // يضمن تنفيذ schema.sql والترقيات قبل أي استعلام
const adminsRepository = require('./repositories/adminsRepository');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log('=== استرجاع كلمة مرور مستخدم ===\n');

  const username = (await ask('اسم المستخدم الذي تريد تغيير كلمة مروره: ')).trim();

  if (!username) {
    console.error('\n✗ اسم المستخدم مطلوب.');
    process.exitCode = 1;
    rl.close();
    return;
  }

  const admin = adminsRepository.findByUsername(username);
  if (!admin) {
    console.error(`\n✗ لا يوجد مستخدم باسم "${username}".`);
    process.exitCode = 1;
    rl.close();
    return;
  }

  const password = await ask('كلمة المرور الجديدة (6 أحرف على الأقل): ');

  if (!password || password.length < 6) {
    console.error('\n✗ كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
    process.exitCode = 1;
    rl.close();
    return;
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const password_hash = await bcrypt.hash(password, saltRounds);
  adminsRepository.updatePassword(admin.id, password_hash);

  // لا تُطبَع كلمة المرور نفسها هنا بأي شكل — فقط تأكيد أن العملية تمّت
  console.log(`\n✓ تم تحديث كلمة مرور "${admin.username}" (${admin.role}) بنجاح.`);
  console.log('يمكنه الآن تسجيل الدخول من صفحة login.html بكلمة المرور الجديدة.');

  rl.close();
}

main()
  .catch((err) => {
    console.error('\n✗ حدث خطأ غير متوقع:', err.message || err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close?.();
  });
