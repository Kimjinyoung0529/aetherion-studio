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
    bar.style.cssText = 'position:relative;z-index:25;flex:none;display:flex;gap:8px;align-items:center;box-sizing:border-box;width:100%;padding:' + (main ? '6px 12px' : '8px 14px') + ';background:color-mix(in srgb,var(--bg,#fff) 82%,transparent);-webkit-backdrop-filter:blur(14px) saturate(170%);backdrop-filter:blur(14px) saturate(170%);color:var(--text,#15171c);border-bottom:1px solid var(--line,#e8eaef);font:' + (main ? '13px' : '14px') + '/1.4 var(--font-sans,system-ui,sans-serif)';
    const a = document.createElement('a');
    a.href = p.url; a.style.cssText = 'color:inherit;text-decoration:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    a.innerHTML = (window.AEIcon ? AEIcon('newspaper') + ' ' : '') + '<b>공지</b> '; a.append(p.title);
    const x = document.createElement('button');
    x.type = 'button'; x.setAttribute('aria-label', '공지 닫기'); x.innerHTML = window.AEIcon ? AEIcon('x') : '닫기';
    x.style.cssText = 'border:0;background:none;font-size:16px;cursor:pointer;color:inherit;padding:2px 6px';
    x.onclick = () => { localStorage.setItem(KEY, p.slug); bar.remove(); };
    bar.append(a, x);
    if (main) main.prepend(bar); else document.body.prepend(bar);
  }).catch(() => {});
})();
