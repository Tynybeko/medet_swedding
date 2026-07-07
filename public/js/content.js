/**
 * Загрузчик текстов из content.json.
 * Все элементы с data-t="path.to.key" получают текст из JSON,
 * data-t-ph — placeholder. Файл опрашивается каждые 3 секунды,
 * поэтому правки content.json видны сразу, без перезагрузки страницы.
 */
window.Content = (() => {
  let data = null;
  const listeners = [];

  function get(path, obj = data) {
    if (!obj) return undefined;
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function apply() {
    if (!data) return;
    document.querySelectorAll('[data-t]').forEach((el) => {
      const val = get(el.dataset.t);
      if (typeof val === 'string' && el.textContent !== val) el.textContent = val;
    });
    document.querySelectorAll('[data-t-ph]').forEach((el) => {
      const val = get(el.dataset.tPh);
      if (typeof val === 'string' && el.placeholder !== val) el.placeholder = val;
    });
    const title = get('meta.title');
    if (title && document.title !== title) document.title = title;
  }

  async function load() {
    try {
      const res = await fetch('/content.json?v=' + Date.now());
      const fresh = await res.json();
      const changed = JSON.stringify(fresh) !== JSON.stringify(data);
      if (changed) {
        data = fresh;
        apply();
        listeners.forEach((fn) => fn(data));
      }
    } catch (e) {
      /* сервер недоступен — оставляем текущие тексты */
    }
  }

  function onChange(fn) {
    listeners.push(fn);
    if (data) fn(data);
  }

  load();
  setInterval(load, 3000);

  return { get: (p) => get(p), onChange, ready: load() };
})();
