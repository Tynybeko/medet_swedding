/* Админка: вход по паролю, публикация/снятие с публикации, удаление любых фото. */

let token = sessionStorage.getItem('admin-token') || null;
let tab = 'pending';
let photos = [];

const loginView = document.getElementById('login-view');
const panelView = document.getElementById('panel-view');
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const stats = document.getElementById('stats');
const toast = document.getElementById('toast');

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 3000);
}

function authHeaders() {
  return { Authorization: 'Bearer ' + token };
}

/* ---------- вход ---------- */
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    document.getElementById('login-error').textContent = 'Неверный пароль';
    gsap.fromTo('#login-form', { x: -8 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
    return;
  }
  token = (await res.json()).token;
  sessionStorage.setItem('admin-token', token);
  enterPanel();
});

function enterPanel() {
  loginView.hidden = true;
  panelView.hidden = false;
  gsap.from('#panel-view', { opacity: 0, y: 24, duration: 0.7, ease: 'power3.out' });
  refresh();
}

/* ---------- данные ---------- */
async function refresh() {
  const res = await fetch('/api/admin/photos', { headers: authHeaders() });
  if (res.status === 401) {
    sessionStorage.removeItem('admin-token');
    token = null;
    loginView.hidden = false;
    panelView.hidden = true;
    return;
  }
  photos = await res.json();
  const pub = photos.filter((p) => p.published).length;
  stats.textContent = `Всего: ${photos.length} · Опубликовано: ${pub} · Ожидает: ${photos.length - pub}`;
  render();
}

function render() {
  const list = photos.filter((p) =>
    tab === 'pending' ? !p.published : tab === 'published' ? p.published : true
  );
  empty.hidden = list.length > 0;
  grid.innerHTML = '';
  list.forEach((p, i) => {
    const date = new Date(p.uploadedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'admin-item';
    item.innerHTML = `
      <img src="${p.url}" alt="" loading="lazy" style="cursor:zoom-in" />
      <div class="meta">
        <span class="badge ${p.published ? 'pub' : ''}">${p.published ? 'В альбоме' : 'На модерации'}</span><br/>
        ${p.guestName ? '📷 ' + escapeHtml(p.guestName) + ' · ' : ''}${date}${p.ip ? '<br/>IP: ' + escapeHtml(p.ip) : ''}
      </div>
      <div class="actions">
        <button class="pub-btn ${p.published ? 'on' : ''}">${p.published ? 'Снять' : 'Опубликовать'}</button>
        <button class="del-btn">Удалить</button>
      </div>`;
    item.querySelector('img').addEventListener('click', () => window.open(p.url, '_blank'));
    item.querySelector('.pub-btn').addEventListener('click', async () => {
      await fetch(`/api/admin/photos/${p.id}/publish`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: !p.published }),
      });
      showToast(p.published ? 'Снято с публикации' : 'Опубликовано в альбоме ✓');
      refresh();
    });
    item.querySelector('.del-btn').addEventListener('click', async () => {
      if (!confirm('Удалить это фото безвозвратно?')) return;
      gsap.to(item, { opacity: 0, scale: 0.85, duration: 0.3 });
      await fetch(`/api/photos/${p.id}`, { method: 'DELETE', headers: authHeaders() });
      showToast('Фото удалено');
      refresh();
    });
    grid.appendChild(item);
    gsap.from(item, { opacity: 0, y: 18, duration: 0.45, delay: Math.min(i * 0.04, 0.5), ease: 'power2.out' });
  });
}

/* ---------- вкладки и массовая публикация ---------- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });
});

document.getElementById('publish-all').addEventListener('click', async () => {
  const res = await fetch('/api/admin/photos/publish-all', { method: 'POST', headers: authHeaders() });
  const { count } = await res.json();
  showToast(count ? `Опубликовано фото: ${count}` : 'Новых фото нет');
  refresh();
});

/* ---------- старт ---------- */
if (token) {
  // проверяем, жив ли токен
  fetch('/api/admin/photos', { headers: authHeaders() }).then((r) => {
    if (r.ok) enterPanel();
    else sessionStorage.removeItem('admin-token');
  });
}
setInterval(() => { if (token && !panelView.hidden) refresh(); }, 15000);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
