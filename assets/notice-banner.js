/* Pinned notice banner (home + playground). Shows the newest pinned post from /content/index.json; dismiss is remembered per post. */
(() => {
  'use strict';
  const KEY = 'aeth.notice.dismissed';
  fetch('/content/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
    const p = j && (j.posts || []).find(x => x.pinned);
    if (!p || localStorage.getItem(KEY) === p.slug) return;
    const bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    // v7.2: in-flow compact top bar (never fixed over content/composer)
    const main = document.querySelector('body.pg .main');
    bar.className = 'ae-notice';
    bar.style.cssText = 'position:relative;z-index:25;flex:none;display:flex;gap:8px;align-items:center;box-sizing:border-box;width:100%;padding:' + (main ? '6px 12px' : '8px 14px') + ';background:rgba(255,244,232,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#3a2a1a;border-bottom:1px solid rgba(255,140,90,.45);font:' + (main ? '13px' : '14px') + '/1.4 system-ui,sans-serif';
    const a = document.createElement('a');
    a.href = p.url; a.style.cssText = 'color:inherit;text-decoration:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    a.textContent = '▲ [공지] ' + p.title;
    const x = document.createElement('button');
    x.type = 'button'; x.setAttribute('aria-label', '공지 닫기'); x.textContent = '✕';
    x.style.cssText = 'border:0;background:none;font-size:16px;cursor:pointer;color:inherit;padding:2px 6px';
    x.onclick = () => { localStorage.setItem(KEY, p.slug); bar.remove(); };
    bar.append(a, x);
    if (main) main.prepend(bar); else document.body.prepend(bar);
  }).catch(() => {});
})();
