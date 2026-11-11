/* Главная страница: GSAP-анимации, отсчёт, программа, RSVP */
gsap.registerPlugin(ScrollTrigger);

/* ---------- вступительная анимация hero ---------- */
const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
intro
  .from('.floral-frame', { opacity: 0, scale: 0.92, y: 40, duration: 1.4 })
  .from('.floral-eyebrow', { opacity: 0, y: 18, duration: 0.8 }, '-=0.7')
  .from('.floral-names span', { opacity: 0, y: 26, stagger: 0.15, duration: 0.9 }, '-=0.5')
  .from('.floral-rule', { scaleX: 0, duration: 0.7 }, '-=0.4')
  .from('.floral-date, .floral-loc', { opacity: 0, y: 14, stagger: 0.12, duration: 0.7 }, '-=0.4')
  .from('.floral-scroll', { opacity: 0, duration: 0.6 }, '-=0.2');

gsap.to('.floral-scroll', { y: 8, repeat: -1, yoyo: true, duration: 0.9, ease: 'sine.inOut' });

/* параллакс картинки при скролле */
gsap.to('.floral-art', {
  yPercent: 8,
  scale: 1.06,
  ease: 'none',
  scrollTrigger: { trigger: '.floral-hero', start: 'top top', end: 'bottom top', scrub: true },
});
gsap.to('.floral-blur', {
  yPercent: -12,
  ease: 'none',
  scrollTrigger: { trigger: '.floral-hero', start: 'top top', end: 'bottom top', scrub: true },
});

/* лёгкий наклон карточки за курсором */
const frame = document.querySelector('.floral-frame');
if (frame && matchMedia('(pointer:fine)').matches) {
  const qx = gsap.quickTo(frame, 'rotationY', { duration: 0.6, ease: 'power2.out' });
  const qy = gsap.quickTo(frame, 'rotationX', { duration: 0.6, ease: 'power2.out' });
  gsap.set(frame, { transformPerspective: 900 });
  document.querySelector('.floral-hero').addEventListener('mousemove', (e) => {
    const r = frame.getBoundingClientRect();
    qx(((e.clientX - r.left) / r.width - 0.5) * 6);
    qy(-((e.clientY - r.top) / r.height - 0.5) * 6);
  });
  document.querySelector('.floral-hero').addEventListener('mouseleave', () => { qx(0); qy(0); });
}

/* ---------- падающие лепестки ---------- */
const PETAL_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><path d="M13 2 C20 6 22 14 13 24 C4 14 6 6 13 2 Z" fill="#c87538" opacity="0.92"/><path d="M13 5 Q14 14 13 21" fill="none" stroke="#f4d2a4" stroke-width=".8"/></svg>`
  );

function spawnPetal(hero) {
  const p = document.createElement('img');
  p.src = PETAL_SVG;
  p.className = 'petal';
  p.style.width = 10 + Math.random() * 16 + 'px';
  p.style.left = Math.random() * 100 + 'vw';
  hero.appendChild(p);
  gsap.fromTo(
    p,
    { y: -40, rotation: Math.random() * 360, opacity: 0 },
    {
      y: hero.offsetHeight + 60,
      x: `+=${(Math.random() - 0.5) * 220}`,
      rotation: `+=${(Math.random() - 0.5) * 540}`,
      opacity: 0.9,
      duration: 7 + Math.random() * 6,
      ease: 'none',
      onComplete: () => p.remove(),
    }
  );
}
const hero = document.querySelector('.floral-hero');
for (let i = 0; i < 6; i++) setTimeout(() => spawnPetal(hero), i * 900);
setInterval(() => document.hidden || spawnPetal(hero), 1800);

/* ---------- появление секций при скролле ---------- */
gsap.utils.toArray('.reveal').forEach((el) => {
  gsap.from(el, {
    opacity: 0,
    y: 48,
    duration: 1,
    ease: 'power3.out',
    scrollTrigger: { trigger: el, start: 'top 82%' },
  });
});

/* ---------- обратный отсчёт ---------- */
const cd = {
  days: document.getElementById('cd-days'),
  hours: document.getElementById('cd-hours'),
  min: document.getElementById('cd-min'),
  sec: document.getElementById('cd-sec'),
};
function setCell(el, val) {
  const str = String(val).padStart(2, '0');
  if (el.textContent === str) return;
  el.textContent = str;
  gsap.fromTo(el, { y: -8, opacity: 0.4 }, { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out' });
}
function tick() {
  const iso = window.Content && Content.get('hero.isoDate');
  if (!iso) return;
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) {
    document.getElementById('countdown').innerHTML =
      `<p style="font-size:1.4rem;color:var(--rose-deep)">${Content.get('countdown.past') || '🤍'}</p>`;
    return;
  }
  setCell(cd.days, Math.floor(diff / 86400000));
  setCell(cd.hours, Math.floor(diff / 3600000) % 24);
  setCell(cd.min, Math.floor(diff / 60000) % 60);
  setCell(cd.sec, Math.floor(diff / 1000) % 60);
}
setInterval(tick, 1000);

/* ---------- данные из JSON: программа и карта ---------- */
Content.onChange((data) => {
  tick();
  const schedule = document.getElementById('schedule');
  if (schedule) schedule.innerHTML = '';
  (data.programme.items || []).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'schedule-row';
    row.innerHTML = `<span class="schedule-time"></span><span class="schedule-label"></span>`;
    row.querySelector('.schedule-time').textContent = item.time;
    row.querySelector('.schedule-label').textContent = item.label;
    if (schedule) schedule.appendChild(row);
  });
  const map = document.getElementById('map-link');
  if (map && data.venue.mapLink) map.href = data.venue.mapLink;
});

/* ---------- RSVP (локально, с анимацией благодарности) ---------- */
let attend = null;
document.querySelectorAll('.rsvp-choice-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    attend = btn.dataset.attend;
    document.querySelectorAll('.rsvp-choice-btn').forEach((b) => b.classList.toggle('active', b === btn));
    gsap.fromTo(btn, { scale: 0.94 }, { scale: 1, duration: 0.35, ease: 'back.out(2.5)' });
  });
});

const toast = document.getElementById('toast');
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 3200);
}
window.showToast = showToast;

document.getElementById('rsvp-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('rsvp-name').value.trim();
  if (!name) return;
  const message = document.getElementById('rsvp-msg').value.trim();
  const attendLabel =
    attend === 'no'
      ? Content.get('rsvp.attendNo') || 'Тилекке каршы, келе албайм'
      : Content.get('rsvp.attendYes') || 'Сүйүнүү менен келем';

  // формируем сообщение и открываем WhatsApp пары
  const lines = [
    Content.get('rsvp.waIntro') || '💐 Ответ на приглашение',
    '',
    `Аты: ${name}`,
    `Келүүсү: ${attendLabel}`,
  ];
  if (message) lines.push(`Каалоо-тилек: ${message}`);
  const phone = (Content.get('rsvp.whatsapp') || '+996 559 02 01 99').replace(/\D/g, '');
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;

  const card = e.target.closest('.section-card');
  gsap.to(card, { scale: 0.98, yoyo: true, repeat: 1, duration: 0.15 });
  showToast(Content.get('rsvp.thanks') || 'Спасибо!');
  e.target.reset();
  window.open(waUrl, '_blank', 'noopener'); // на телефоне откроется приложение WhatsApp
});

/* ---------- фоновая музыка ---------- */
const music = document.getElementById('bg-music');
const musicBtn = document.getElementById('music-toggle');
let musicWanted = true; // false — гость сам выключил, не навязываем

function updateMusicBtn() {
  musicBtn.classList.toggle('is-muted', music.paused);
  musicBtn.setAttribute('aria-label', music.paused ? 'Музыканы күйгүзүү' : 'Музыканы өчүрүү');
}

function tryPlayMusic() {
  if (!musicWanted || !music.paused) return;
  music.volume = 0;
  music
    .play()
    .then(() => {
      gsap.to(music, { volume: 0.55, duration: 2.5, ease: 'power1.in' }); // плавное нарастание
      updateMusicBtn();
    })
    .catch(() => {
      /* автозапуск заблокирован браузером — запустимся при первом касании */
    });
}

tryPlayMusic();
// браузеры разрешают звук после первого взаимодействия — ловим любое
['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach((ev) =>
  window.addEventListener(ev, () => tryPlayMusic(), { once: true, passive: true })
);

musicBtn.addEventListener('click', () => {
  if (music.paused) {
    musicWanted = true;
    music.volume = 0.55;
    music.play().then(updateMusicBtn).catch(() => {});
  } else {
    musicWanted = false;
    music.pause();
    updateMusicBtn();
  }
  gsap.fromTo(musicBtn, { scale: 0.85 }, { scale: 1, duration: 0.4, ease: 'back.out(2.5)' });
});

/* лёгкое «дыхание» кнопок фото-блока */
gsap.to('.photo-cta .btn:first-child', {
  scale: 1.03,
  repeat: -1,
  yoyo: true,
  duration: 1.4,
  ease: 'sine.inOut',
});
