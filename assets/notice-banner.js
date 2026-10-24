/* Pinned notice banner (home + playground). Shows the newest pinned post from /content/index.json; dismiss is remembered per post. */
(() => {
  'use strict';
  const KEY = 'aeth.notice.dismissed';
  fetch('/content/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
    const p = j && (j.posts || []).find(x => x.pinned);
    if (!p || localStorage.getItem(KEY) === p.slug) return;
    const bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:9999;max-width:min(680px,calc(100vw - 24px));display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:14px;background:rgba(255,248,240,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#3a2a1a;border:1px solid rgba(255,140,90,.5);box-shadow:0 8px 30px rgba(0,0,0,.18);font:14px/1.4 system-ui,sans-serif';
    const a = document.createElement('a');
    a.href = p.url; a.style.cssText = 'color:inherit;text-decoration:none;flex:1';
    a.textContent = '📌 [공지] ' + p.title;
    const x = document.createElement('button');
    x.type = 'button'; x.setAttribute('aria-label', '공지 닫기'); x.textContent = '✕';
    x.style.cssText = 'border:0;background:none;font-size:16px;cursor:pointer;color:inherit;padding:2px 6px';
    x.onclick = () => { localStorage.setItem(KEY, p.slug); bar.remove(); };
    bar.append(a, x); document.body.append(bar);
  }).catch(() => {});
})();
