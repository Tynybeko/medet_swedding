/* Альбом: показывает только опубликованные админом фото,
   обновляется каждые 10 секунд, лайтбокс по клику. */

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');

gsap.from('.page-head', { opacity: 0, y: 30, duration: 1, ease: 'power3.out' });

let shownIds = new Set();

async function refresh() {
  try {
    const res = await fetch('/api/photos/published');
    const photos = await res.json();
    empty.hidden = photos.length > 0;

    const freshIds = new Set(photos.map((p) => p.id));
    // убираем удалённые/снятые с публикации
    [...grid.children].forEach((el) => {
      if (!freshIds.has(el.dataset.id)) {
        gsap.to(el, { opacity: 0, scale: 0.85, duration: 0.4, onComplete: () => el.remove() });
        shownIds.delete(el.dataset.id);
      }
    });
    // добавляем новые
    photos.forEach((p) => {
      if (shownIds.has(p.id)) return;
      shownIds.add(p.id);
      const item = document.createElement('div');
      item.className = 'album-item';
      item.dataset.id = p.id;
      item.innerHTML = `<img src="${p.url}" alt="" loading="lazy" />` +
        (p.guestName ? `<span class="by">📷 ${escapeHtml(p.guestName)}</span>` : '');
      item.addEventListener('click', () => {
        lightboxImg.src = p.url;
        lightbox.classList.add('open');
      });
      grid.prepend(item);
      gsap.from(item, { opacity: 0, y: 40, scale: 0.95, duration: 0.8, ease: 'power3.out' });
    });
  } catch (e) {
    /* сервер недоступен */
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

lightbox.addEventListener('click', () => lightbox.classList.remove('open'));
document.addEventListener('keydown', (e) => e.key === 'Escape' && lightbox.classList.remove('open'));

refresh();
setInterval(refresh, 10000);
