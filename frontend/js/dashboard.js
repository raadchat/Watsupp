// js/dashboard.js

const STATE_LABELS = {
  MAIN_MENU: 'القائمة الرئيسية',
  CATEGORY_LIST: 'يستعرض الأقسام',
  SERVICE_LIST: 'يستعرض الخدمات',
  SERVICE_SELECTED: 'اختار خدمة',
  WAITING_FOR_DATA: 'بانتظار بياناته',
  COMPLETED: 'اكتمل طلبه',
};

const SECTION_TITLES = {
  categories: 'الأقسام',
  services: 'الخدمات',
  customers: 'العملاء',
  bulk: 'الرسائل الجماعية',
  settings: 'الاتصال بواتساب',
};

// ---------- أدوات عامة ----------

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truncateText(str, len) {
  if (!str) return '—';
  return str.length > len ? `${str.slice(0, len)}…` : str;
}

function formatDate(sqliteDatetime) {
  if (!sqliteDatetime) return '—';
  const iso = `${sqliteDatetime.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return sqliteDatetime;
  return d.toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}

function renderSkeletonRows(colCount, rowCount = 4) {
  const row = `<tr class="skeleton-row">${'<td><div class="skeleton-bar"></div></td>'.repeat(colCount)}</tr>`;
  return row.repeat(rowCount);
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function setBtnLoading(btn, isLoading) {
  btn.disabled = isLoading;
  btn.classList.toggle('loading', isLoading);
}

// ---------- الحالة العامة ----------

let categoriesCache = [];
let servicesCache = [];
let itemToDelete = null; // { type: 'service' | 'category', data }
let customersState = { search: '', page: 1, pageSize: 20, total: 0 };
let searchDebounceTimer = null;
let trackedJobId = null;
let jobsPollTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!getToken()) {
    location.href = 'login.html';
    return;
  }

  const admin = getStoredAdmin();
  if (admin && admin.username) {
    document.getElementById('admin-username').textContent = admin.username;
  }

  setupNavigation();
  setupMobileSidebar();
  setupLogout();
  setupCategoriesSection();
  setupServicesSection();
  setupCustomersSection();
  setupBulkSection();
  setupDeleteModal();
  setupSettingsSection();

  loadCategories(); // القسم الافتراضي عند فتح اللوحة (المستوى الأول في قائمة واتساب)
});

// ---------- التنقّل بين الأقسام ----------

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });
}

function showSection(name) {
  document.querySelectorAll('.section').forEach((el) => el.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === name);
  });

  document.getElementById('topbar-title').textContent = SECTION_TITLES[name];
  closeMobileSidebar();

  if (name === 'categories') loadCategories();
  if (name === 'services') loadServices();
  if (name === 'customers') loadCustomers();
  if (name === 'bulk') {
    openBulkSection();
  } else {
    stopJobsPolling();
  }
  if (name === 'settings') loadSettings();
}

function setupMobileSidebar() {
  document.getElementById('menu-toggle').addEventListener('click', openMobileSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeMobileSidebar);
}

function openMobileSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.remove('hidden');
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

function setupLogout() {
  document.getElementById('logout-btn').addEventListener('click', () => {
    clearToken();
    localStorage.removeItem('admin');
    location.href = 'login.html';
  });
}

// =====================================================================
// قسم الأقسام (المستوى الأول في قائمة واتساب)
// =====================================================================

function setupCategoriesSection() {
  document.getElementById('add-category-btn').addEventListener('click', () => openCategoryModal());
  document.getElementById('add-category-btn-empty').addEventListener('click', () => openCategoryModal());
  document.getElementById('category-modal-close').addEventListener('click', closeCategoryModal);
  document.getElementById('category-cancel-btn').addEventListener('click', closeCategoryModal);
  document.getElementById('category-form').addEventListener('submit', handleCategoryFormSubmit);

  document.getElementById('categories-tbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-category-btn');
    const deleteBtn = e.target.closest('.delete-category-btn');
    if (editBtn) openCategoryModal(findCategoryById(editBtn.dataset.id));
    if (deleteBtn) openDeleteModal('category', findCategoryById(deleteBtn.dataset.id));
  });
}

function findCategoryById(id) {
  return categoriesCache.find((c) => String(c.id) === String(id));
}

async function loadCategories() {
  const tbody = document.getElementById('categories-tbody');
  const emptyEl = document.getElementById('categories-empty');
  tbody.innerHTML = renderSkeletonRows(7, 4);
  emptyEl.classList.add('hidden');

  try {
    const result = await api.getCategories();
    categoriesCache = result.data;

    if (categoriesCache.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }
    tbody.innerHTML = categoriesCache.map(renderCategoryRow).join('');
  } catch (err) {
    tbody.innerHTML = '';
    showToast(err.message, 'error');
  }
}

function renderCategoryRow(c) {
  const statusLabel = c.status === 'active' ? 'نشط' : 'غير نشط';
  const liveDot = c.status === 'active' ? '<span class="live-dot"></span>' : '';
  return `
    <tr>
      <td data-label="المعرف"><span class="mono">${escapeHtml(c.category_id)}</span></td>
      <td data-label="اسم القسم" class="cell-title">${escapeHtml(c.name)}</td>
      <td data-label="الوصف">${escapeHtml(truncateText(c.description, 60))}</td>
      <td data-label="الترتيب" class="mono">${c.display_order}</td>
      <td data-label="الحالة"><span class="status-badge ${c.status}">${liveDot}${statusLabel}</span></td>
      <td data-label="آخر تعديل" class="cell-muted mono">${formatDate(c.updated_at)}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="icon-btn edit-category-btn" data-id="${c.id}" title="تعديل">✏️</button>
          <button type="button" class="icon-btn danger delete-category-btn" data-id="${c.id}" title="حذف">🗑️</button>
        </div>
      </td>
    </tr>
  `;
}

function openCategoryModal(category = null) {
  const form = document.getElementById('category-form');
  form.reset();

  const idField = document.getElementById('category-id');

  if (category) {
    document.getElementById('category-modal-title').textContent = 'تعديل القسم';
    document.getElementById('category-db-id').value = category.id;
    idField.value = category.category_id;
    idField.disabled = true; // لا يمكن تغيير معرف قسم قائم بعد إنشائه
    document.getElementById('category-name').value = category.name;
    document.getElementById('category-description').value = category.description || '';
    document.getElementById('category-display-order').value = category.display_order;
    document.getElementById('category-status').value = category.status;
  } else {
    document.getElementById('category-modal-title').textContent = 'إضافة قسم';
    document.getElementById('category-db-id').value = '';
    idField.disabled = false;
    document.getElementById('category-display-order').value = categoriesCache.length;
  }

  document.getElementById('category-modal-overlay').classList.remove('hidden');
}

function closeCategoryModal() {
  document.getElementById('category-modal-overlay').classList.add('hidden');
}

async function handleCategoryFormSubmit(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('category-save-btn');
  const dbId = document.getElementById('category-db-id').value;

  const payload = {
    category_id: document.getElementById('category-id').value.trim(),
    name: document.getElementById('category-name').value.trim(),
    description: document.getElementById('category-description').value.trim(),
    display_order: Number(document.getElementById('category-display-order').value) || 0,
    status: document.getElementById('category-status').value,
  };

  setBtnLoading(saveBtn, true);
  try {
    if (dbId) {
      await api.updateCategory(dbId, payload);
      showToast('تم تحديث القسم بنجاح');
    } else {
      await api.createCategory(payload);
      showToast('تمت إضافة القسم بنجاح، وسيظهر للعملاء فوراً');
    }
    closeCategoryModal();
    loadCategories();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading(saveBtn, false);
  }
}

// =====================================================================
// قسم الخدمات
// =====================================================================

function setupServicesSection() {
  document.getElementById('add-service-btn').addEventListener('click', () => openServiceModal());
  document.getElementById('add-service-btn-empty').addEventListener('click', () => openServiceModal());
  document.getElementById('service-modal-close').addEventListener('click', closeServiceModal);
  document.getElementById('service-cancel-btn').addEventListener('click', closeServiceModal);
  document.getElementById('service-form').addEventListener('submit', handleServiceFormSubmit);

  document.getElementById('services-tbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-service-btn');
    const deleteBtn = e.target.closest('.delete-service-btn');
    if (editBtn) openServiceModal(findServiceById(editBtn.dataset.id));
    if (deleteBtn) openDeleteModal('service', findServiceById(deleteBtn.dataset.id));
  });
}

function findServiceById(id) {
  return servicesCache.find((s) => String(s.id) === String(id));
}

async function loadServices() {
  const tbody = document.getElementById('services-tbody');
  const emptyEl = document.getElementById('services-empty');
  tbody.innerHTML = renderSkeletonRows(8, 5);
  emptyEl.classList.add('hidden');

  try {
    const result = await api.getServices();
    servicesCache = result.data;

    if (servicesCache.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }
    tbody.innerHTML = servicesCache.map(renderServiceRow).join('');
  } catch (err) {
    tbody.innerHTML = '';
    showToast(err.message, 'error');
  }
}

function renderServiceRow(s) {
  const statusLabel = s.status === 'active' ? 'نشطة' : 'غير نشطة';
  const liveDot = s.status === 'active' ? '<span class="live-dot"></span>' : '';
  return `
    <tr>
      <td data-label="المعرف"><span class="mono">${escapeHtml(s.service_id)}</span></td>
      <td data-label="اسم الخدمة" class="cell-title">${escapeHtml(s.name)}</td>
      <td data-label="الوصف">${escapeHtml(truncateText(s.description, 60))}</td>
      <td data-label="القسم">${escapeHtml(s.category_name || '—')}</td>
      <td data-label="الحالة"><span class="status-badge ${s.status}">${liveDot}${statusLabel}</span></td>
      <td data-label="تاريخ الإنشاء" class="cell-muted mono">${formatDate(s.created_at)}</td>
      <td data-label="آخر تعديل" class="cell-muted mono">${formatDate(s.updated_at)}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="icon-btn edit-service-btn" data-id="${s.id}" title="تعديل">✏️</button>
          <button type="button" class="icon-btn danger delete-service-btn" data-id="${s.id}" title="حذف">🗑️</button>
        </div>
      </td>
    </tr>
  `;
}

/** يُحمّل قائمة الأقسام الحالية في القائمة المنسدلة قبل عرض نموذج الخدمة، حتى تكون محدَّثة دائماً. */
async function populateServiceCategoryOptions(selectedCategoryId) {
  const select = document.getElementById('service-category');
  select.innerHTML = '<option value="">بدون قسم (يظهر ضمن القائمة المسطّحة إن لم توجد أقسام)</option>';

  try {
    const result = await api.getCategories();
    categoriesCache = result.data; // نُحدّث الذاكرة المؤقتة أيضاً حتى قسم الأقسام يبقى متسقاً
    result.data.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.status === 'active' ? c.name : `${c.name} (غير نشط)`;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast('تعذّر تحميل قائمة الأقسام', 'error');
  }

  if (selectedCategoryId) {
    select.value = String(selectedCategoryId);
  }
}

async function openServiceModal(service = null) {
  const form = document.getElementById('service-form');
  form.reset();

  const idField = document.getElementById('service-id');

  await populateServiceCategoryOptions(service ? service.category_id : null);

  if (service) {
    document.getElementById('service-modal-title').textContent = 'تعديل الخدمة';
    document.getElementById('service-db-id').value = service.id;
    idField.value = service.service_id;
    idField.disabled = true; // لا يمكن تغيير معرف خدمة قائمة بعد إنشائها
    document.getElementById('service-name').value = service.name;
    document.getElementById('service-description').value = service.description || '';
    document.getElementById('service-status').value = service.status;
  } else {
    document.getElementById('service-modal-title').textContent = 'إضافة خدمة';
    document.getElementById('service-db-id').value = '';
    idField.disabled = false;
  }

  document.getElementById('service-modal-overlay').classList.remove('hidden');
}

function closeServiceModal() {
  document.getElementById('service-modal-overlay').classList.add('hidden');
}

async function handleServiceFormSubmit(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('service-save-btn');
  const dbId = document.getElementById('service-db-id').value;
  const categoryValue = document.getElementById('service-category').value;

  const payload = {
    service_id: document.getElementById('service-id').value.trim(),
    name: document.getElementById('service-name').value.trim(),
    description: document.getElementById('service-description').value.trim(),
    category_id: categoryValue ? Number(categoryValue) : null,
    status: document.getElementById('service-status').value,
  };

  setBtnLoading(saveBtn, true);
  try {
    if (dbId) {
      await api.updateService(dbId, payload);
      showToast('تم تحديث الخدمة بنجاح');
    } else {
      await api.createService(payload);
      showToast('تمت إضافة الخدمة بنجاح، وستظهر للعملاء فوراً');
    }
    closeServiceModal();
    loadServices();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading(saveBtn, false);
  }
}

// =====================================================================
// Modal تأكيد الحذف (مشترك بين الأقسام والخدمات)
// =====================================================================

function setupDeleteModal() {
  document.getElementById('delete-modal-close').addEventListener('click', closeDeleteModal);
  document.getElementById('delete-cancel-btn').addEventListener('click', closeDeleteModal);
  document.getElementById('delete-confirm-btn').addEventListener('click', handleDeleteConfirm);
}

function openDeleteModal(type, data) {
  if (!data) return;
  itemToDelete = { type, data };

  const label = type === 'category' ? 'القسم' : 'الخدمة';
  const consequence =
    type === 'category'
      ? 'لن يظهر بعد الآن للعملاء على واتساب (ولن يمكن الحذف إن كانت خدمات لا تزال مرتبطة به)'
      : 'لن تظهر بعد الآن للعملاء على واتساب';

  document.getElementById('delete-modal-text').textContent =
    `هل أنت متأكد من حذف ${label} "${data.name}"؟ ${consequence}، ولا يمكن التراجع عن هذا الإجراء.`;
  document.getElementById('delete-modal-overlay').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('delete-modal-overlay').classList.add('hidden');
  itemToDelete = null;
}

async function handleDeleteConfirm() {
  if (!itemToDelete) return;
  const btn = document.getElementById('delete-confirm-btn');
  const { type, data } = itemToDelete;

  setBtnLoading(btn, true);
  try {
    if (type === 'category') {
      await api.deleteCategory(data.id);
      showToast('تم حذف القسم');
      closeDeleteModal();
      loadCategories();
    } else {
      await api.deleteService(data.id);
      showToast('تم حذف الخدمة');
      closeDeleteModal();
      loadServices();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

// =====================================================================
// قسم العملاء
// =====================================================================

function setupCustomersSection() {
  document.getElementById('customer-search').addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    const value = e.target.value.trim();
    searchDebounceTimer = setTimeout(() => {
      customersState.search = value;
      customersState.page = 1;
      loadCustomers();
    }, 400);
  });

  document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (customersState.page > 1) {
      customersState.page -= 1;
      loadCustomers();
    }
  });

  document.getElementById('next-page-btn').addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(customersState.total / customersState.pageSize));
    if (customersState.page < totalPages) {
      customersState.page += 1;
      loadCustomers();
    }
  });
}

async function loadCustomers() {
  const tbody = document.getElementById('customers-tbody');
  const emptyEl = document.getElementById('customers-empty');
  tbody.innerHTML = renderSkeletonRows(6, 5);
  emptyEl.classList.add('hidden');

  try {
    const result = await api.getCustomers({
      search: customersState.search || undefined,
      page: customersState.page,
      pageSize: customersState.pageSize,
    });
    customersState.total = result.meta.total;

    if (result.data.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
    } else {
      tbody.innerHTML = result.data.map(renderCustomerRow).join('');
    }
    updatePaginationUI();
  } catch (err) {
    tbody.innerHTML = '';
    showToast(err.message, 'error');
  }
}

function renderCustomerRow(c) {
  const stateLabel = STATE_LABELS[c.conversation_state] || c.conversation_state;
  const statusClass = c.status === 'active' ? 'active' : 'blocked';
  const statusLabel = c.status === 'active' ? 'نشط' : 'محظور';
  return `
    <tr>
      <td data-label="رقم الهاتف"><span class="mono">${escapeHtml(c.phone_number)}</span></td>
      <td data-label="آخر تواصل" class="cell-muted mono">${formatDate(c.last_contact)}</td>
      <td data-label="حالة المحادثة">${escapeHtml(stateLabel)}</td>
      <td data-label="الحالة"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      <td data-label="تاريخ الإنشاء" class="cell-muted mono">${formatDate(c.created_at)}</td>
      <td data-label="آخر تحديث" class="cell-muted mono">${formatDate(c.updated_at)}</td>
    </tr>
  `;
}

function updatePaginationUI() {
  const { page, pageSize, total } = customersState;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  document.getElementById('pagination-info').textContent = `صفحة ${page} من ${totalPages} — ${total} عميل`;
  document.getElementById('prev-page-btn').disabled = page <= 1;
  document.getElementById('next-page-btn').disabled = page >= totalPages;
}

// =====================================================================
// قسم الرسائل الجماعية
// =====================================================================

function setupBulkSection() {
  const fileDropEl = document.getElementById('file-drop');
  const fileInputEl = document.getElementById('bulk-file');

  fileDropEl.addEventListener('click', () => fileInputEl.click());
  fileInputEl.addEventListener('change', () => {
    if (fileInputEl.files.length > 0) {
      fileDropEl.textContent = `📄 ${fileInputEl.files[0].name}`;
      fileDropEl.classList.add('has-file');
    } else {
      resetFileDrop();
    }
  });

  document.getElementById('bulk-form').addEventListener('submit', handleBulkFormSubmit);
}

function resetFileDrop() {
  document.getElementById('file-drop').textContent = '📄 اضغط لاختيار ملف نصي (رقم في كل سطر)';
  document.getElementById('file-drop').classList.remove('has-file');
}

async function handleBulkFormSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('bulk-submit');

  const message = document.getElementById('bulk-message').value.trim();
  const numbersText = document.getElementById('bulk-numbers').value.trim();
  const fileInputEl = document.getElementById('bulk-file');
  const file = fileInputEl.files[0];

  if (!message) {
    showToast('نص الرسالة مطلوب', 'error');
    return;
  }
  if (!numbersText && !file) {
    showToast('أدخل أرقاماً يدوياً أو ارفع ملف أرقام', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('message', message);
  if (numbersText) formData.append('phone_numbers', numbersText);
  if (file) formData.append('file', file);

  setBtnLoading(submitBtn, true);
  try {
    const result = await api.sendBulkMessages(formData);
    showToast(`بدأ الإرسال إلى ${result.data.total_count} رقم على التوالي`);

    document.getElementById('bulk-form').reset();
    fileInputEl.value = '';
    resetFileDrop();

    startJobsPolling(result.data.job_id);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading(submitBtn, false);
  }
}

async function openBulkSection() {
  try {
    const result = await api.getMessagesStatus();
    const ongoing = result.data.find((j) => j.status === 'pending' || j.status === 'processing');

    if (ongoing) {
      startJobsPolling(ongoing.id); // يعرض الجدول والإحصائيات فوراً بنفسه
    } else {
      renderJobsTable(result.data);
      if (result.data[0]) updateStatBoxes(result.data[0]);
      stopJobsPolling();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadJobsStatus() {
  try {
    const result = await api.getMessagesStatus();
    renderJobsTable(result.data);

    const activeJob = (trackedJobId && result.data.find((j) => j.id === trackedJobId)) || result.data[0];
    if (activeJob) {
      updateStatBoxes(activeJob);
      const isOngoing = activeJob.status === 'pending' || activeJob.status === 'processing';
      if (!isOngoing) stopJobsPolling();
    }
  } catch (err) {
    console.error('[bulk] فشل تحديث حالة الوظائف:', err);
  }
}

function renderJobsTable(jobs) {
  const tbody = document.getElementById('jobs-tbody');
  const emptyEl = document.getElementById('jobs-empty');

  if (jobs.length === 0) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  tbody.innerHTML = jobs.map((j) => `
    <tr>
      <td data-label="#" class="mono">${j.id}</td>
      <td data-label="الرسالة">${escapeHtml(truncateText(j.message_text, 40))}</td>
      <td data-label="الحالة">${jobStatusBadge(j.status)}</td>
      <td data-label="مرسَل / إجمالي" class="mono">${j.sent_count} / ${j.total_count}${j.failed_count ? ` (فشل ${j.failed_count})` : ''}</td>
    </tr>
  `).join('');
}

function jobStatusBadge(status) {
  const map = {
    pending: ['قيد الانتظار', 'inactive'],
    processing: ['جارٍ الإرسال', 'active'],
    completed: ['مكتملة', 'active'],
    failed: ['فشلت', 'blocked'],
  };
  const [label, cls] = map[status] || [status, 'inactive'];
  return `<span class="status-badge ${cls}">${escapeHtml(label)}</span>`;
}

function updateStatBoxes(job) {
  document.getElementById('stat-total').textContent = job.total_count;
  document.getElementById('stat-sent').textContent = job.sent_count;
  document.getElementById('stat-failed').textContent = job.failed_count;
}

function startJobsPolling(jobId) {
  trackedJobId = jobId;
  stopJobsPolling();
  loadJobsStatus();
  jobsPollTimer = setInterval(loadJobsStatus, 2000);
}

function stopJobsPolling() {
  if (jobsPollTimer) {
    clearInterval(jobsPollTimer);
    jobsPollTimer = null;
  }
}

// =====================================================================
// قسم الاتصال بواتساب
// =====================================================================

function setupSettingsSection() {
  document.getElementById('settings-webhook-url').value = `${location.origin}/webhook`;

  document.getElementById('settings-form').addEventListener('submit', handleSettingsFormSubmit);
  document.getElementById('settings-retest-btn').addEventListener('click', handleRetestClick);

  document.getElementById('copy-verify-token-btn').addEventListener('click', () => {
    copyToClipboard(document.getElementById('settings-verify-token').value, 'تم نسخ Verify Token');
  });
  document.getElementById('copy-webhook-url-btn').addEventListener('click', () => {
    copyToClipboard(document.getElementById('settings-webhook-url').value, 'تم نسخ رابط الـ Webhook');
  });
}

function copyToClipboard(text, successMessage) {
  if (!text) return;
  navigator.clipboard
    .writeText(text)
    .then(() => showToast(successMessage))
    .catch(() => showToast('تعذّر النسخ — انسخه يدوياً', 'error'));
}

async function loadSettings() {
  try {
    const result = await api.getWhatsAppSettings();
    applySettingsToForm(result.data);
    updateStatusBadge(result.data.status);
    renderSettingsResult(
      result.data.last_test_result
        ? { success: result.data.status === 'connected', error: result.data.status !== 'connected' ? result.data.last_test_result : null, message: result.data.last_test_result, lastTestedAt: result.data.last_tested_at }
        : null
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function applySettingsToForm(data) {
  document.getElementById('settings-phone-number-id').value = data.phone_number_id || '';
  document.getElementById('settings-business-account-id').value = data.business_account_id || '';
  document.getElementById('settings-verify-token').value = data.verify_token || '';

  const tokenField = document.getElementById('settings-access-token');
  const tokenHint = document.getElementById('settings-token-hint');
  tokenField.value = '';
  if (data.has_access_token) {
    tokenField.placeholder = data.access_token_preview;
    tokenHint.textContent = `توكن محفوظ حالياً (${data.access_token_preview}) — اترك الحقل فارغاً للإبقاء عليه، أو الصق توكناً جديداً لاستبداله.`;
  } else {
    tokenField.placeholder = 'الصق التوكن هنا';
    tokenHint.textContent = 'لم يُحفظ أي توكن بعد.';
  }
}

function updateStatusBadge(status) {
  const badge = document.getElementById('settings-status-badge');
  if (status === 'connected') {
    badge.innerHTML = '<span class="pulse-dot"></span> متصل';
  } else {
    badge.innerHTML = '⚠️ غير متصل';
  }
}

function renderSettingsResult(test) {
  const el = document.getElementById('settings-result');

  if (!test) {
    el.innerHTML = `
      <div class="state-icon">🔌</div>
      <h3>لم يُختبر الاتصال بعد</h3>
      <p>املأ البيانات واضغط "حفظ واختبار الاتصال".</p>
    `;
    return;
  }

  if (test.success) {
    const d = test.details;
    const bodyText = d
      ? [d.display_phone_number, d.verified_name, d.quality_rating ? `جودة الرقم: ${d.quality_rating}` : null]
          .filter(Boolean)
          .map(escapeHtml)
          .join('<br>')
      : escapeHtml(test.message || '');
    el.innerHTML = `
      <div class="state-icon">✅</div>
      <h3>الاتصال يعمل</h3>
      <p>${bodyText}</p>
    `;
  } else {
    el.innerHTML = `
      <div class="state-icon">❌</div>
      <h3>فشل الاتصال</h3>
      <p>${escapeHtml(test.error || test.message || 'خطأ غير معروف')}</p>
    `;
  }
}

async function handleSettingsFormSubmit(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('settings-save-btn');

  const payload = {
    phone_number_id: document.getElementById('settings-phone-number-id').value.trim(),
    verify_token: document.getElementById('settings-verify-token').value.trim(),
    business_account_id: document.getElementById('settings-business-account-id').value.trim() || null,
  };
  const tokenValue = document.getElementById('settings-access-token').value.trim();
  if (tokenValue) payload.access_token = tokenValue; // فارغ = الإبقاء على التوكن المحفوظ (يتولاه الخادم)

  setBtnLoading(saveBtn, true);
  try {
    const result = await api.saveWhatsAppSettings(payload);
    applySettingsToForm(result.data.settings);
    updateStatusBadge(result.data.settings.status);
    renderSettingsResult(result.data.test);
    showToast(result.data.test.success ? 'تم الحفظ والاتصال يعمل بنجاح' : 'تم الحفظ، لكن الاختبار فشل — راجع التفاصيل بالأسفل', result.data.test.success ? 'success' : 'error');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading(saveBtn, false);
  }
}

async function handleRetestClick() {
  const btn = document.getElementById('settings-retest-btn');
  setBtnLoading(btn, true);
  try {
    const result = await api.retestWhatsAppConnection();
    applySettingsToForm(result.data.settings);
    updateStatusBadge(result.data.settings.status);
    renderSettingsResult(result.data.test);
    showToast(result.data.test.success ? 'الاتصال يعمل بنجاح' : 'فشل الاختبار — راجع التفاصيل بالأسفل', result.data.test.success ? 'success' : 'error');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}
