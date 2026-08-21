# لوحة تحكم بوت واتساب — نظام إدارة خدمات متكامل

نظام Full-Stack عملي (وليس نموذجاً تجريبياً): لوحة تحكم HTML/JS ← خادم
Node.js/Express ← قاعدة بيانات ← WhatsApp Cloud API. أي تعديل من لوحة
التحكم على قسم "الخدمات" ينعكس فوراً في القائمة التي يراها العميل على
واتساب — بلا إعادة تشغيل للخادم وبلا لمس أي سطر كود.

---

## 0) افتراضات تقنية مذكورة بوضوح

المواصفات تركت بعض النقاط التقنية مفتوحة عمداً. هذه هي الاختيارات
القياسية القابلة للتغيير التي اعتُمدت، كما طُلب صراحة توضيحه:

| النقطة | الاختيار | لماذا |
|---|---|---|
| قاعدة البيانات | **SQLite** عبر `node:sqlite` (مدمجة في Node.js، بلا npm package) | قاعدة بيانات حقيقية بلا خادم منفصل **وبلا أي تصريف أصلي (native build)** — تعمل من أول تشغيل على أي بيئة، بما فيها بيئات مثل Termux/Android حيث تفشل الحزم الأصلية مثل `better-sqlite3` بخطأ `node-gyp`/`android_ndk_path`. يتطلب Node.js ≥ 22.13.0. كل الوصول للبيانات معزول في `backend/database/repositories/*`، فالانتقال لاحقاً إلى PostgreSQL/MySQL (أو حتى `better-sqlite3` على بيئة عادية) يعني تعديل تلك الطبقة فقط |
| تشفير كلمات المرور | `bcryptjs` بدل `bcrypt` | نفس الواجهة تماماً (`hash`/`compare`)، لكنها JavaScript خالص بلا تصريف أصلي — لنفس سبب اختيار `node:sqlite` أعلاه |
| مزوّد WhatsApp API | **WhatsApp Business Cloud API من Meta** | أسماء متغيرات البيئة المطلوبة في المواصفات (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`) تطابقه تحديداً |
| آلية الطابور (Queue) | طابور داخل عملية Node.js نفسها، مدعوم بجدولي `bulk_jobs`/`bulk_job_items` في قاعدة البيانات (وليس في الذاكرة فقط) | لا حاجة لخدمة خارجية مثل Redis في نشر بسيط بخادم واحد. قابل للترقية لاحقاً إلى Redis + BullMQ عند الحاجة لأكثر من عملية/خادم |
| مدة صلاحية JWT | `24h` (قابلة للتغيير عبر `JWT_EXPIRES_IN`) | قيمة معتدلة لجلسة عمل يومية لمدير لوحة تحكم |
| نص رسائل البوت وكلمات التحفيز | نصوص عربية بسيطة قياسية (مثال: كلمة "الخدمات" كمحفّز) | غير محددة في المواصفات؛ معلّمة بوضوح في `conversationService.js` لتعديلها بسهولة حسب هوية النشاط |
| تقديم لوحة التحكم | يخدمها Express نفسه كملفات ثابتة من نفس الأصل (origin) | يبسّط النشر (خادم واحد) ويتفادى تعقيد CORS بين اللوحة والـ API افتراضياً |
| تخزين بيانات اتصال واتساب | قاعدة البيانات (`whatsapp_settings`, صف واحد)، بدل `.env` فقط | طُلب صراحة لاحقاً: تعديلها من واجهة اللوحة (حفظ + اختبار اتصال حي) دون تعديل ملفات الخادم أو إعادة تشغيله. `.env` بقيت تعمل كتراجع (fallback) للتوافق مع من أعدّها قبل هذه الميزة؛ `access_token` لا يُعاد أبداً كاملاً في أي استجابة API (تلميح آخر 4 خانات فقط) |

---

## 1) Architecture النهائي

```
                    ┌─────────────────────────┐
                    │   لوحة التحكم (Admin)     │
                    │   HTML / CSS / JS واحد   │
                    └────────────┬────────────┘
                                 │ fetch() + Bearer JWT
                                 ▼
                    ┌─────────────────────────┐
                    │      Express API        │
                    │   helmet · cors · rate   │
                    │   limit · validation     │
                    └────────────┬────────────┘
                                 │
          ┌──────────────┬──────┼──────┬──────────────┐
          ▼              ▼             ▼              ▼
     Auth/JWT      Services API   Customers API   Messages API
     (bcrypt)     (CRUD كامل)      (بحث+صفحات)     (جماعي+حالة)
          │              │             │              │
          └──────────────┴─────────────┴──────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   SQLite (node:sqlite)   │
                    │ admins · services         │
                    │ customers · messages       │
                    │ bulk_jobs · bulk_job_items │
                    └────────────┬────────────┘
                                 │ يُقرأ مباشرة، بلا cache
                                 ▼
                    ┌─────────────────────────┐
                    │   conversationService     │  ← آلة الحالة
                    │   (المنطق المحادثي)        │
                    └────────────┬────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │     whatsappService        │
                    │  (WhatsApp Cloud API عميل) │
                    └────────────┬────────────┘
                                 ▼
                          WhatsApp Cloud API
                                 │
                                 ▼
                              العميل
```

---

## 2) شجرة الملفات

```
whatsapp-bot-admin/
│
├── frontend/
│   ├── login.html
│   ├── dashboard.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── api.js            ← API helper موحّد (JWT/أخطاء/401)
│       ├── login.js
│       └── dashboard.js
│
├── backend/
│   ├── server.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── categories.js     ← المستوى الأول في قائمة واتساب
│   │   ├── services.js
│   │   ├── customers.js
│   │   ├── messages.js       ← bulk + status
│   │   ├── settings.js       ← إعدادات اتصال واتساب
│   │   └── whatsapp.js       ← webhook
│   │
│   ├── middleware/
│   │   ├── auth.js           ← authenticateToken
│   │   ├── errorHandler.js
│   │   ├── validate.js
│   │   └── rateLimiter.js
│   │
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── categoriesController.js
│   │   ├── servicesController.js
│   │   ├── customersController.js
│   │   ├── messagesController.js
│   │   ├── settingsController.js  ← إعدادات اتصال واتساب + اختبار حي
│   │   └── webhookController.js
│   │
│   ├── services/
│   │   ├── whatsappService.js    ← إرسال عبر WhatsApp Cloud API
│   │   ├── messageQueue.js       ← طابور الإرسال الجماعي
│   │   └── conversationService.js ← "القائمة الديناميكية" على مستويين + آلة الحالة
│   │
│   ├── database/
│   │   ├── db.js                 ← يشمل ترقية تلقائية لعمود services.category_id
│   │   ├── schema.sql
│   │   ├── seed.js               ← إنشاء أول Admin
│   │   └── repositories/
│   │       ├── adminsRepository.js
│   │       ├── categoriesRepository.js
│   │       ├── servicesRepository.js
│   │       ├── customersRepository.js
│   │       ├── messagesRepository.js
│   │       ├── bulkJobsRepository.js
│   │       └── whatsappSettingsRepository.js  ← صف واحد، مع تراجع تلقائي لـ .env
│   │
│   └── utils/
│       ├── errors.js         ← AppError + ErrorCodes
│       └── asyncHandler.js
│
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## 3) Database Schema

انظر `backend/database/schema.sql` للنص الكامل (تم تنفيذه والتحقق منه فعلياً).
ملخص:

```
admins          (id, username UNIQUE, password_hash, role, created_at, updated_at)
categories      (id, category_id UNIQUE, name, description, display_order, status, created_at, updated_at)
services        (id, service_id UNIQUE, name, description, category_id → categories.id,
                 status, created_at, updated_at)
customers       (id, phone_number UNIQUE, last_contact, conversation_state,
                 status, last_selected_service_id → services.id, created_at, updated_at)
messages        (id, customer_id → customers.id, direction, message, status,
                 whatsapp_message_id, created_at)
bulk_jobs       (id, message_text, total_count, sent_count, failed_count,
                 status, created_by → admins.id, created_at, updated_at)
bulk_job_items  (id, job_id → bulk_jobs.id, phone_number, status, error,
                 whatsapp_message_id, created_at, updated_at)
whatsapp_settings (id=1 فقط, phone_number_id, access_token, verify_token,
                 business_account_id, status, last_tested_at, last_test_result, updated_at)
```

`bulk_jobs`/`bulk_job_items` هما الجدولان الإضافيان لإدارة طابور الرسائل
الجماعية (مسموح بهما صراحة في المواصفات عند الحاجة).

`categories` أُضيف لاحقاً لدعم قائمة على مستويين (أقسام ← خدمات، بنفس مبدأ
بوت الكريمي). `services.category_id` عمود مُرحَّل تلقائياً وبأمان عند أول
تشغيل بعد التحديث — `db.js` يتحقق من وجوده، وإن كانت هناك خدمات قديمة بحقل
`category` نصي، يُنشئ لها صفوف `categories` حقيقية (بلا تكرار للأسماء
المتطابقة) ويربطها به. لا حاجة لأي أمر يدوي.

---

## 4) API Specification

كل استجابة بالصيغة الموحدة:

```json
// نجاح
{ "success": true, "data": { } }

// فشل
{ "success": false, "error": { "code": "SERVICE_NOT_FOUND", "message": "الخدمة غير موجودة" } }
```

| Method | المسار | حماية JWT | الوصف |
|---|---|:---:|---|
| POST | `/api/login` | ✗ | `{ username, password }` → `{ token, admin }` |
| GET | `/api/categories` | ✓ | كل الأقسام |
| POST | `/api/categories` | ✓ | `{ category_id, name, description, display_order, status }` |
| PUT | `/api/categories/:id` | ✓ | `{ name, description, display_order, status }` |
| DELETE | `/api/categories/:id` | ✓ | يُرفض إن كانت خدمات لا تزال مرتبطة بالقسم |
| GET | `/api/services` | ✓ | كل الخدمات (مع اسم القسم عبر JOIN) |
| POST | `/api/services` | ✓ | `{ service_id, name, description, category_id, status }` |
| PUT | `/api/services/:id` | ✓ | `{ name, description, category_id, status }` |
| DELETE | `/api/services/:id` | ✓ | حذف خدمة |
| GET | `/api/customers?search=&page=&pageSize=` | ✓ | بحث برقم الهاتف + صفحات |
| GET | `/api/customers/:id` | ✓ | عميل واحد |
| POST | `/api/messages/bulk` | ✓ | `multipart/form-data`: `message` + (`file` و/أو `phone_numbers`) |
| GET | `/api/messages/status` | ✓ | آخر 20 وظيفة إرسال جماعي وحالتها |
| GET | `/api/settings/whatsapp` | ✓ | بيانات الاتصال الحالية (`access_token` مُقنَّع دائماً) |
| PUT | `/api/settings/whatsapp` | ✓ | `{ phone_number_id, access_token?, verify_token, business_account_id? }` — يحفظ **ويختبر فوراً** |
| POST | `/api/settings/whatsapp/test` | ✓ | إعادة اختبار ما هو محفوظ بالفعل، بلا جسم طلب |
| GET | `/webhook` | ✗ | تحقق Meta (`hub.mode`/`hub.verify_token`/`hub.challenge`) |
| POST | `/webhook` | ✗ | استقبال رسائل واتساب الواردة |

مثال، إضافة قسم ثم خدمة داخله:

```bash
curl -X POST http://localhost:3000/api/categories \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"category_id":"cat_delivery","name":"خدمات التوصيل","display_order":0,"status":"active"}'
# → يعيد { "data": { "id": 1, ... } } — استخدم هذا id الرقمي أدناه

curl -X POST http://localhost:3000/api/services \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"service_id":"svc_delivery","name":"توصيل الطلبات","description":"توصيل خلال 24 ساعة","category_id":1,"status":"active"}'
```

---

## 5) Authentication Flow

1. `POST /api/login` بـ `{ username, password }`.
2. الخادم يبحث عن المستخدم، ثم `bcrypt.compare()` لكلمة المرور.
3. عند النجاح: `jwt.sign({ id, username, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })`.
4. الواجهة تخزّن التوكن في `localStorage` وتنتقل إلى `dashboard.html`.
5. كل طلب لاحق يرفق `Authorization: Bearer <token>`؛ `middleware/auth.js`
   يرفض بـ `401` إن كان مفقوداً/غير صالح/منتهياً، ويسمح بالمرور فقط إذا صالح.
6. عند أي `401` من الخادم، `js/api.js` يحذف التوكن ويُعيد التوجيه تلقائياً
   لـ `login.html`.

---

## 6) WhatsApp Webhook Flow

```
العميل → WhatsApp → POST /webhook → webhookController
  → استخراج الرسالة (نص أو رد قائمة تفاعلية)
  → customersRepository (إيجاد/إنشاء العميل برقم هاتفه)
  → messagesRepository (تسجيل الرسالة الواردة)
  → conversationService.handleMessage()  ← يقرر الاستجابة بناءً على الحالة
  → whatsappService (إرسال الرد عبر WhatsApp Cloud API)
  → العميل
```

الرد على Meta يكون `200` فوراً (قبل إتمام المعالجة الداخلية) لأن Meta
تتطلب استجابة سريعة وإلا اعتبرت الـ webhook متعطلاً.

**GET /webhook** يُستخدم مرة واحدة فقط عند ربط الـ webhook من لوحة تحكم
Meta للمطورين، للتحقق من ملكية الرابط (راجع القسم 12 بالأسفل).

---

## 7) Dynamic Services Flow — أهم نقطة في النظام (على مستويين)

النظام الآن يعرض قائمة على مستويين (أقسام ← خدمات)، بنفس مبدأ بوت
الكريمي المرجعي. **واتساب لا يدعم "قائمة داخل قائمة" كعنصر واجهة واحد**
(حد 10 صفوف، مستوى واحد فقط لكل رسالة — موثّق رسمياً من Meta). التأثير
المطلوب يتحقق بتسلسل رسالتين منفصلتين تُبنيان من قاعدة البيانات في كل
مرة، وليس رسالة واحدة "متداخلة":

```
العميل يكتب "الخدمات"
        │
        ▼
conversationService.sendCategoriesList()
        │
        ▼
categoriesRepository.findActive()  ← SELECT * FROM categories WHERE status='active'
        │
        ▼
رسالة قائمة تفاعلية بالأقسام (state → CATEGORY_LIST)
        │
        ▼
العميل يختار قسماً → list_reply.id = category_id
        │
        ▼
conversationService.handleCategorySelection()
        │
        ▼
servicesRepository.findActiveByCategoryId(category.id)  ← خدمات هذا القسم فقط
        │
        ▼
رسالة قائمة تفاعلية ثانية بخدمات القسم المُختار (state → SERVICE_LIST)
        │
        ▼
العميل يختار خدمة → list_reply.id = service_id
        │
        ▼
(من هنا يستمر التدفق الأصلي دون تغيير: تفاصيل الخدمة → WAITING_FOR_DATA → COMPLETED)
```

**لا توجد أي قائمة أقسام أو خدمات مكتوبة داخل الكود.** إذا أضاف المدير
قسماً جديداً أو خدمة داخل قسم موجود من لوحة التحكم، فهي تُكتب مباشرة في
قاعدة البيانات؛ وفي المرة التالية التي يتفاعل فيها أي عميل مع البوت،
تُنفَّذ نفس الاستعلامات من جديد — بلا إعادة تشغيل وبلا تعديل كود.

عند أي اختيار (قسم أو خدمة)، تُرسل واجهة واتساب `list_reply.id` فقط —
لا يُعتمد إطلاقاً على الاسم القادم من العميل. `conversationService` يعرف
كيف يُفسّر هذا المعرّف (كقسم أم كخدمة) من خلال `conversation_state`
الحالية للعميل *قبل* هذه الرسالة، لأن كلا الجدولين له معرّف نصي مستقل
(`category_id`/`service_id`).

**ترحيل تلقائي وتراجع آمن:** إن لم يُنشئ المدير أي قسم بعد، يتراجع
`sendCategoriesList()` تلقائياً لعرض كل الخدمات النشطة كقائمة مسطّحة
واحدة (السلوك الأصلي قبل هذه الميزة) — البوت لا يتوقف أبداً بسبب عدم
وجود أقسام.

**حالات المحادثة** (مخزّنة في `customers.conversation_state`):

```
MAIN_MENU → (يكتب "الخدمات") → CATEGORY_LIST
CATEGORY_LIST → (يختار قسماً) → SERVICE_LIST
SERVICE_LIST → (يختار خدمة) → SERVICE_SELECTED → WAITING_FOR_DATA
WAITING_FOR_DATA → (يرسل بياناته) → COMPLETED
```

---

## 8) التثبيت والتشغيل

```bash
# 1) تثبيت الحزم
npm install

# 2) إعداد متغيرات البيئة
cp .env.example .env
# ثم عدّل .env: JWT_SECRET، ومتغيرات WhatsApp عند توفرها

# 3) تشغيل وضع التطوير (مع إعادة تشغيل تلقائية)
npm run dev

# أو تشغيل عادي
npm start
```

عند أول تشغيل، `backend/database/db.js` ينفّذ `schema.sql` تلقائياً
وينشئ ملف `bot.db` — لا حاجة لأي أمر migration منفصل.

افتح `http://localhost:3000/` — ستُحوَّل تلقائياً إلى `login.html`.

---

## 9) إنشاء أول Admin

لا يوجد أي مستخدم افتراضي مزروع مسبقاً (تفادياً لبيانات دخول ثابتة
معروفة). أنشئ أول حساب عبر السكربت التفاعلي:

```bash
npm run seed:admin
```

سيطلب منك اسم المستخدم وكلمة المرور، ثم يخزّن `bcrypt` hash فقط.

---

## 10) طريقة ربط WhatsApp (Meta Cloud API)

**الطريقة المفضّلة الآن: من داخل اللوحة نفسها، بلا لمس أي ملف.**

1. أنشئ تطبيقاً على [developers.facebook.com](https://developers.facebook.com)
   من نوع Business، وأضف منتج **WhatsApp**.
2. من صفحة **WhatsApp → API Setup** في Meta، خذ:
   - **Temporary access token** (للتجربة) أو **System User token** دائم (للإنتاج)
   - **Phone number ID** الظاهر هناك
3. سجّل الدخول للوحتك → **الاتصال بواتساب** → الصق الـ Phone Number ID والـ
   Access Token. الحقل "Webhook Callback URL" مملوء تلقائياً برابط خادمك،
   و"Verify Token" مُقترَح جاهزاً (يمكنك تركه أو كتابة نص خاص بك).
4. اضغط **حفظ واختبار الاتصال** — يحفظ البيانات في قاعدة البيانات فوراً
   *ويختبرها حقاً* باستعلام مباشر من Meta؛ ستظهر بيانات رقمك (الاسم
   الموثَّق، جودة الرقم) عند النجاح، أو رسالة الخطأ الفعلية من Meta عند
   الفشل (توكن خاطئ، رقم غير صحيح، ...).
5. انسخ قيمتي **Webhook Callback URL** و**Verify Token** الظاهرتين في
   اللوحة (زر النسخ بجانب كل منهما)، والصقهما في Meta: **WhatsApp →
   Configuration → Callback URL / Verify Token** → **Verify and Save**
   (هذا ما يستدعي `GET /webhook` في مشروعك) → فعّل الاشتراك في حقل
   **messages**.
6. للتجربة محلياً بدون دومين عام، استخدم نفقاً مؤقتاً مثل `ngrok`:
   ```bash
   ngrok http 3000
   ```
   والصق رابط `https://xxxx.ngrok-free.app/webhook` في اللوحة كـ Webhook
   Callback URL بدل الرابط المحلي، وفي خطوة Meta أيضاً.

يمكنك لاحقاً الضغط على **إعادة اختبار الاتصال** في أي وقت للتأكد أن
التوكن ما زال صالحاً (تنتهي صلاحية Temporary tokens خلال 24 ساعة).

**بديل متقدّم:** لا تزال متغيرات `WHATSAPP_ACCESS_TOKEN` /
`WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_VERIFY_TOKEN` في `.env` تعمل
كتراجع (fallback) إن لم تُضبط بعد أي بيانات من اللوحة — مفيد لنشر آلي
(CI/CD) لا يمر بواجهة المستخدم. أول حفظ أو اختبار من اللوحة يرحّلها
تلقائياً إلى قاعدة البيانات لتصبح هي المصدر النهائي بعدها.

---

## 11) طريقة اختبار Webhook

**اختبار التحقق (GET):**

```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=12345"
# متوقع: يرد بالنص 12345 وحالة 200
```

**محاكاة رسالة واردة (POST)** — بدون الحاجة لواتساب فعلي:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "0",
      "changes": [{
        "field": "messages",
        "value": {
          "messaging_product": "whatsapp",
          "metadata": { "phone_number_id": "0" },
          "messages": [{
            "from": "201234567890",
            "id": "wamid.TEST123",
            "timestamp": "1700000000",
            "type": "text",
            "text": { "body": "الخدمات" }
          }]
        }
      }]
    }]
  }'
```

راقب سجل الخادم في الطرفية، وتحقّق من ظهور العميل في قسم "العملاء"
باللوحة. الرد الفعلي على واتساب لن يصل إلا إذا كان `WHATSAPP_ACCESS_TOKEN`
حقيقياً وصالحاً.

---

## 12) التشغيل في بيئة الإنتاج

- استخدم مدير عمليات مثل `pm2` لإبقاء الخادم يعمل وإعادة تشغيله تلقائياً:
  ```bash
  npm install -g pm2
  pm2 start backend/server.js --name whatsapp-bot-admin
  pm2 save
  ```
- ضع الخادم خلف reverse proxy (Nginx) يوفّر **HTTPS** (عبر Let's Encrypt/certbot)
  — إلزامي عملياً لأن Meta لا تقبل webhook بدون HTTPS، ولأن المواصفات
  تطلب HTTPS للاتصالات الحساسة في الإنتاج.
- اضبط `CORS_ORIGIN` على نطاق لوحة التحكم الفعلي بدل `*`.
- اضبط `NODE_ENV=production`.
- **حدود هذا التنفيذ عند التوسّع الأفقي**: قاعدة SQLite وطابور الرسائل
  الجماعية كلاهما داخل نفس عملية Node.js، لذا هذا التصميم يناسب **خادماً
  واحداً**. عند الحاجة لأكثر من عملية/خادم خلف موازن حمل، يُنصح بالانتقال
  إلى PostgreSQL (بدل SQLite) وRedis+BullMQ (بدل الطابور الداخلي) —
  البنية الحالية (repositories معزولة + `messageQueue.js` كوحدة مستقلة)
  صُمِّمت لتسهيل هذا الترقية لاحقاً دون إعادة كتابة الـ controllers.
- خذ نسخاً احتياطية دورية لملف `bot.db` (أو لمجلد `backend/database/`
  بالكامل، شاملاً ملفات `-wal`/`-shm` أثناء التشغيل).

---

## ملاحظات أمنية مطبَّقة

`helmet` · `cors` مضبوط عبر env · `express-rate-limit` (عام + أشد على
تسجيل الدخول) · `express-validator` على كل مدخلات الكتابة · Parameterized
Queries حصراً عبر `node:sqlite` (لا تجميع نصوص SQL يدوياً في أي مكان)
· `bcryptjs` للتجزئة · تعقيم إخراج HTML في الواجهة (`escapeHtml`) لمنع XSS ·
لا كلمات مرور/توكنات/أسرار داخل الكود، كلها في `.env` أو `whatsapp_settings`
(كلاهما مستثنى من Git) — و`access_token` تحديداً لا يُعاد أبداً كاملاً في
أي استجابة API، فقط تلميح آخر 4 خانات ·
رسائل خطأ عامة للمستخدم مع تسجيل التفاصيل في السيرفر فقط (لا تُكشف تفاصيل
قاعدة البيانات) · نفس رسالة الخطأ لاسم مستخدم غير موجود أو كلمة مرور
خاطئة (منع تخمين أسماء المستخدمين).
