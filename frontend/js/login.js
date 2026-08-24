// js/login.js

function redirectByRole(admin) {
  location.href = admin && admin.role === 'agent' ? 'agent.html' : 'dashboard.html';
}

document.addEventListener('DOMContentLoaded', () => {
  // إذا كان هناك توكن مخزّن مسبقاً، لا داعي لإعادة تسجيل الدخول
  if (getToken()) {
    redirectByRole(getStoredAdmin());
    return;
  }

  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    errorEl.textContent = '';
    errorEl.classList.add('hidden');

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    setLoading(true);

    try {
      const result = await api.login(username, password);
      setToken(result.data.token);
      setStoredAdmin(result.data.admin);
      redirectByRole(result.data.admin); // وكيل خدمة عملاء → صفحته المبسّطة، مدير → اللوحة الكاملة
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.classList.toggle('loading', isLoading);
  }
});
