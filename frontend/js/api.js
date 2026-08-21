// js/api.js
// API helper موحّد: كل صفحة تستدعي كائن `api` بدل تكرار fetch في كل مكان.
// يتولى: إرفاق JWT، ضبط الترويسات، تحليل JSON، توحيد الأخطاء، وتحويل 401
// تلقائياً إلى login.html بعد حذف التوكن (القسم 16 في المواصفات).

const API_BASE_URL = '/api';

function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function clearToken() {
  localStorage.removeItem('token');
}

function getStoredAdmin() {
  try {
    const raw = localStorage.getItem('admin');
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function setStoredAdmin(admin) {
  localStorage.setItem('admin', JSON.stringify(admin));
}

/**
 * طلب عام للـ API. body عادي يُحوَّل تلقائياً إلى JSON، أو مرّر FormData
 * مباشرة مع isFormData=true (يُترك Content-Type للمتصفح ليضبط الـ boundary).
 */
async function apiRequest(endpoint, { method = 'GET', body, isFormData = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let requestBody = body;
  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, { method, headers, body: requestBody });
  } catch (networkErr) {
    throw new Error('تعذّر الاتصال بالخادم، تحقق من اتصالك بالشبكة.');
  }

  if (response.status === 401) {
    clearToken();
    localStorage.removeItem('admin');
    if (!location.pathname.endsWith('login.html')) {
      location.href = 'login.html';
    }
    throw new Error('انتهت الجلسة، الرجاء تسجيل الدخول مرة أخرى.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch (parseErr) {
    data = null;
  }

  if (!response.ok || !data || data.success === false) {
    const message = data?.error?.message || 'حدث خطأ غير متوقع، حاول مرة أخرى.';
    throw new Error(message);
  }

  return data;
}

const api = {
  login: (username, password) => apiRequest('/login', { method: 'POST', body: { username, password } }),

  getCategories: () => apiRequest('/categories'),
  createCategory: (category) => apiRequest('/categories', { method: 'POST', body: category }),
  updateCategory: (id, category) => apiRequest(`/categories/${id}`, { method: 'PUT', body: category }),
  deleteCategory: (id) => apiRequest(`/categories/${id}`, { method: 'DELETE' }),

  getServices: () => apiRequest('/services'),
  createService: (service) => apiRequest('/services', { method: 'POST', body: service }),
  updateService: (id, service) => apiRequest(`/services/${id}`, { method: 'PUT', body: service }),
  deleteService: (id) => apiRequest(`/services/${id}`, { method: 'DELETE' }),

  getCustomers: ({ search, page, pageSize } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (page) params.set('page', page);
    if (pageSize) params.set('pageSize', pageSize);
    const qs = params.toString();
    return apiRequest(`/customers${qs ? `?${qs}` : ''}`);
  },
  getCustomer: (id) => apiRequest(`/customers/${id}`),

  sendBulkMessages: (formData) => apiRequest('/messages/bulk', { method: 'POST', body: formData, isFormData: true }),
  getMessagesStatus: () => apiRequest('/messages/status'),

  getWhatsAppSettings: () => apiRequest('/settings/whatsapp'),
  saveWhatsAppSettings: (settings) => apiRequest('/settings/whatsapp', { method: 'PUT', body: settings }),
  retestWhatsAppConnection: () => apiRequest('/settings/whatsapp/test', { method: 'POST' }),
};
