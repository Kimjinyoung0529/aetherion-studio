// AETHERION Playground v4: Gemma 4 agent + live artifacts (versioned), files/PDF Q&A, Python (Pyodide), CSV charts, share links,
// custom instructions & memory, templates, feedback, sentence-chunked TTS, PWA.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const LS = { ep: 'ae.endpoint', key: 'ae.key', hist: 'ae.history', convs: 'ae.convs', cur: 'ae.current', theme: 'ae.theme', tools: 'ae.tools', custom: 'ae.custom', mem: 'ae.memory', voice: 'ae.voice', auto: 'ae.autoread', rate: 'ae.rate' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '#';
  const ICON = {
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 011-1h9"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    win: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>',
  };
  const TOOLS = {
    web_search: ['🔎', '웹검색'], fetch_url: ['📄', '페이지 읽기'], weather: ['🌤️', '날씨'], calculator: ['🧮', '계산기'],
    datetime: ['🕒', '날짜·시간'], wikipedia: ['📚', '위키백과'], convert: ['💱', '변환'], news: ['📰', '뉴스'], price: ['📈', '시세'], qr: ['🔳', 'QR 코드'],
  };

  // ---------- state ----------
  let convs = [], cur = null, busy = false, ctrl = null, defaultEp = '', art = null;
  try { convs = JSON.parse(localStorage.getItem(LS.convs) || '[]'); } catch { convs = []; }
  try { // migrate v1 single history
    const old = JSON.parse(localStorage.getItem(LS.hist) || 'null');
    if (Array.isArray(old) && old.length && !convs.length) convs.push({ id: uid(), title: titleOf(old[0].content), ts: Date.now(), msgs: old });
    localStorage.removeItem(LS.hist);
  } catch {}
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function titleOf(t) { t = String(t || '새 대화').replace(/\s+/g, ' ').trim(); return t.length > 34 ? t.slice(0, 34) + '…' : t; }
  function persist() {
    convs.sort((a, b) => b.ts - a.ts);
    let data = JSON.stringify(convs.slice(0, 60));
    while (data.length > 4.5e6 && convs.length > 1) { convs.pop(); data = JSON.stringify(convs); }
    try { localStorage.setItem(LS.convs, data); localStorage.setItem(LS.cur, cur?.id || ''); } catch {}
  }
  const conv = () => cur || (cur = { id: uid(), title: '새 대화', ts: Date.now(), msgs: [] }, convs.unshift(cur), cur);

  // ---------- UI helpers ----------
  const endpoint = () => ($('ep').value.trim() || defaultEp).replace(/\/+$/, '');
  function setStatus(cls, txt) { for (const [d, s] of [['dot', 'stxt'], ['dot2', 'stxt2']]) { $(d).className = 'dot ' + cls; $(s).textContent = txt; } }
  function toast(t, ms) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), ms || 1800); }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast('복사했어요'); if (btn) { const h = btn.innerHTML; btn.innerHTML = btn.innerHTML.replace(/<svg[\s\S]*?<\/svg>/, ICON.check); setTimeout(() => btn.innerHTML = h, 1200); }
  }
  const scroller = $('scroll'); let stick = true;
  scroller.addEventListener('scroll', () => { stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80; });
  const toBottom = force => { if (force || stick) scroller.scrollTop = scroller.scrollHeight; };

  // ---------- lazy vendor loading (KaTeX, mermaid) ----------
  const loaded = {};
  const loadJs = src => loaded[src] || (loaded[src] = new Promise((ok, no) => { const e = document.createElement('script'); e.src = src; e.onload = ok; e.onerror = no; document.head.appendChild(e); }));
  const loadCss = href => { if (!document.querySelector(`link[href="${href}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); } };
  const hasMath = t => /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(^|[^\\$\w])\$[^\s$][^$\n]*?\$(?!\d)/.test(t);
  function mathOut(t, store) {
    if (!window.katex) return t;
    const put = (tex, disp) => { try { store.push(katex.renderToString(tex, { displayMode: disp, throwOnError: false, trust: false, strict: 'ignore', output: 'html' })); return `@@M${store.length - 1}@@`; } catch { return tex; } };
    return t.replace(/\$\$([\s\S]+?)\$\$/g, (_, x) => put(x, true)).replace(/\\\[([\s\S]+?)\\\]/g, (_, x) => put(x, true))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, x) => put(x, false)).replace(/(^|[^\\$\w])\$([^\s$][^$\n]*?)\$(?!\d)/g, (_, a, x) => a + put(x, false));
  }
  async function renderDiagrams(root) {
    const blocks = root.querySelectorAll('.cb[data-lang=mermaid]:not([data-done])'); if (!blocks.length) return;
    try { await loadJs('/assets/vendor/mermaid.min.js'); mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false }, theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark' }); } catch { return; }
    for (const cb of blocks) {
      cb.dataset.done = 1;
      try { const { svg } = await mermaid.render('mm' + uid(), cb.querySelector('code').textContent); const d = document.createElement('div'); d.className = 'diagram'; d.innerHTML = svg; /* mermaid securityLevel 'strict' sanitizes labels */ cb.before(d); cb.querySelector('pre').hidden = true; }
      catch { /* leave code visible */ }
    }
  }

  // ---------- markdown ----------
  let mdReady = false;
  function setupMd() {
    if (mdReady || !window.marked) return; mdReady = true;
    const r = new marked.Renderer();
    r.code = (code, lang) => {
      const l = (lang || '').trim().split(/\s/)[0].toLowerCase();
      const runnable = ['html', 'svg', 'xml'].includes(l) && /<(html|body|div|svg|canvas|script|style|!doctype)/i.test(code);
      const py = ['python', 'py'].includes(l), csv = l === 'csv';
      return `<div class="cb" data-lang="${esc(l)}"><div class="cb-h"><span class="lang">${esc(l || 'text')}</span>${runnable ? `<button type="button" class="run" data-act="preview">${ICON.play}미리보기</button>` : ''}${py ? `<button type="button" class="run" data-act="pyrun">${ICON.play}실행</button>` : ''}${csv ? `<button type="button" class="run" data-act="chart">📊 차트</button>` : ''}<button type="button" data-act="copy-code">${ICON.copy}복사</button></div><pre><code class="${l ? 'language-' + esc(l) : ''}">${esc(code)}</code></pre></div>`;
    };
    r.table = (header, body) => `<div class="tw"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
    r.link = (href, title, text) => `<a href="${esc(safeUrl(href))}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
    marked.setOptions({ renderer: r, gfm: true, breaks: true });
  }
  function md(text, sources, streaming) {
    setupMd();
    // close an open code fence while streaming so it renders as code
    let t = text; if (streaming && ((t.match(/^```/gm) || []).length % 2)) t += '\n```';
    // citations [n] → chips (outside code fences)
    t = t.split(/(```[\s\S]*?```)/).map((p, i) => i % 2 ? p : p.replace(/\[(\d{1,2})\](?!\()/g, (m, n) => { const s = sources?.[+n - 1]; return s ? `<a class="cite" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener" title="${esc(s.title)}">${n}</a>` : m; })).join('');
    if (!window.marked || !window.DOMPurify) return `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;
    const store = [];
    if (hasMath(t)) { if (window.katex) t = t.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((p, i) => i % 2 ? p : mathOut(p, store)).join(''); else { loadCss('/assets/vendor/katex.min.css'); loadJs('/assets/vendor/katex.min.js').then(() => { if (!busy) renderAll(); }).catch(() => {}); } }
    let html = DOMPurify.sanitize(marked.parse(t), { ADD_ATTR: ['target', 'data-act', 'data-lang'], FORBID_TAGS: ['style', 'iframe', 'form', 'input'] });
    return store.length ? html.replace(/@@M(\d+)@@/g, (_, n) => store[+n] || '') : html;
  }
  function highlight(root) {
    if (!window.hljs) return;
    root.querySelectorAll('pre code:not(.hljs)').forEach(c => { try { hljs.highlightElement(c); } catch {} });
  }
  // replace runnable code blocks in finished answers with an artifact card (code still reachable)
  function decorateArtifacts(root, msgIdx) {
    root.querySelectorAll('.cb').forEach((cb, k) => {
      if (!cb.querySelector('[data-act=preview]') || cb.dataset.card) return;
      cb.dataset.card = 1;
      const lang = cb.dataset.lang, code = cb.querySelector('code').textContent;
      const name = (code.match(/<title>([^<]{1,60})<\/title>/i)?.[1] || (lang === 'svg' ? 'SVG 그림' : 'HTML 페이지')).trim();
      const card = document.createElement('button'); card.type = 'button'; card.className = 'art-card'; card.dataset.act = 'preview';
      card.innerHTML = `<span class="aci">${ICON.win}</span><span><b>${esc(name)}</b><small>${lang.toUpperCase()} · ${code.split('\n').length}줄 · 눌러서 미리보기</small></span>`;
      cb.before(card); cb.hidden = false;
    });
  }

  // ---------- rendering ----------
  function stepHtml(s) {
    const [ic, nm] = TOOLS[s.name] || ['🛠️', s.name];
    const arg = s.args?.query || s.args?.url || '';
    let body = '';
    if (s.error) body = `<div class="sb">⚠️ ${esc(s.error)}</div>`;
    else if (s.results) body = `<div class="sb"><ol>${s.results.length ? s.results.map(x => `<li value="${x.n}"><a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">${esc(x.title)}</a><span class="host">${esc(host(x.url))}</span></li>`).join('') : '<li>결과 없음</li>'}</ol></div>`;
    else if (s.data?.now) body = `<div class="sb">${esc(s.data.place)} · 지금 ${esc(s.data.now.desc)}<div class="wx"><div><b>${s.data.now.temp}°</b>현재 (체감 ${s.data.now.feels}°)</div>${s.data.days.map(d => `<div><b>${Math.round(d.max)}° / ${Math.round(d.min)}°</b>${esc(d.date.slice(5))} ${esc(d.desc)} · ☔${d.rain}%</div>`).join('')}</div></div>`;
    else if (s.text) body = `<div class="sb">${s.url ? `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>\n` : ''}${esc(s.text.slice(0, 600))}</div>`;
    const st = s.error ? '실패' : s.done ? (s.results ? `결과 ${s.results.length}개` : '완료') : '실행 중';
    return `<details class="step ${s.error ? 'err' : s.done ? '' : 'run'}"><summary><span class="sic">${ic}</span><span class="sn">${nm}</span><span class="sa">${esc(arg)}</span><span class="ss">${st}</span>${ICON.chev}</summary>${body}</details>`;
  }
  function srcHtml(sources) {
    return (sources || []).map(s => `<a class="src" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener" title="${esc(s.title)}"><span class="n">${s.n}</span><img alt="" loading="lazy" src="https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(host(s.url))}"><span class="st">${esc(host(s.url) || s.title)}</span></a>`).join('');
  }
  function msgEl(m, i) {
    const d = document.createElement('div'); d.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot'); d.dataset.i = i;
    if (m.role === 'user') {
      d.innerHTML = `<div class="bub"></div><div class="acts"><button type="button" data-act="copy" title="복사" aria-label="복사">${ICON.copy}</button><button type="button" data-act="edit" title="수정" aria-label="수정">${ICON.edit}</button></div>`;
      d.querySelector('.bub').textContent = m.content;
      if (m.doc) { const f = document.createElement('div'); f.className = 'doc-chip'; f.textContent = '📎 ' + m.doc.name + ' · ' + m.doc.text.length.toLocaleString() + '자'; d.prepend(f); }
      if (m.thumbs?.length) { const g = document.createElement('div'); g.className = 'thumbs'; m.thumbs.forEach(u => { const im = new Image(); im.src = u; im.alt = '첨부 이미지'; g.appendChild(im); }); d.prepend(g); }
    } else {
      d.innerHTML = `<div class="av" aria-hidden="true"><img src="/assets/brand/logo-128.png" alt=""></div><div class="bot-col"><details class="think" hidden><summary>💭 <span class="tl">생각 과정</span></summary><div class="think-body"></div></details><div class="steps"></div><div class="status"></div><div class="md"></div><div class="srcs"></div><div class="acts"><button type="button" data-act="copy" title="복사" aria-label="복사">${ICON.copy}</button><button type="button" data-act="regen" title="다시 생성" aria-label="다시 생성">${ICON.redo}</button><button type="button" data-act="speak" title="소리내어 읽기" aria-label="소리내어 읽기"><svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/></svg></button><button type="button" data-act="up" title="좋아요" aria-label="좋은 답변">👍</button><button type="button" data-act="down" title="별로예요" aria-label="아쉬운 답변">👎</button><span class="meta"></span></div></div>`;
      fillBot(d, m, false);
    }
    return d;
  }
  function fillBot(d, m, streaming) {
    const th = d.querySelector('.think');
    if (m.thinking) { th.hidden = false; th.querySelector('.think-body').textContent = m.thinking; th.querySelector('.tl').textContent = streaming && !m.content ? '생각 중…' : `생각 과정 (${m.thinking.length.toLocaleString()}자)`; if (streaming && !m.content) th.open = true; }
    d.querySelector('.steps').innerHTML = (m.steps || []).map(stepHtml).join('');
    const body = d.querySelector('.md');
    if (m.error) body.innerHTML = `<div class="err-box">⚠️ ${esc(m.error)}</div>`;
    else { body.innerHTML = md(m.content || '', m.sources, streaming); body.classList.toggle('cursor', !!streaming); }
    if (!streaming) { decorateArtifacts(body); highlight(body); renderDiagrams(body); }
    d.querySelector('.srcs').innerHTML = streaming ? '' : srcHtml(m.sources);
    d.querySelector('.meta').textContent = m.meta || '';
    d.querySelectorAll('[data-act=up],[data-act=down]').forEach(b => { b.classList.toggle('on', m.fb === b.dataset.act); b.hidden = streaming || !!m.error; });
    d.querySelector('.status').textContent = streaming ? (m.status || '') : '';
  }
  function renderAll() {
    const box = $('msgs'); box.innerHTML = '';
    const msgs = cur?.msgs || [];
    msgs.forEach((m, i) => box.appendChild(msgEl(m, i)));
    $('empty').hidden = msgs.length > 0;
    box.querySelectorAll('.msg.bot .acts [data-act=regen]').forEach((b, k, all) => b.hidden = k !== all.length - 1);
    box.querySelectorAll('.msg.user .acts [data-act=edit]').forEach((b, k, all) => b.hidden = k !== all.length - 1);
    renderConvs(); toBottom(true);
  }
  function renderConvs() {
    $('convs').innerHTML = convs.filter(c => c.msgs.length).map(c => `<div class="conv${c === cur ? ' on' : ''}" data-id="${c.id}" role="button" tabindex="0"><span class="t">${esc(c.title)}</span><span class="a"><button type="button" data-cact="rename" title="이름 바꾸기" aria-label="이름 바꾸기">${ICON.edit}</button><button type="button" data-cact="del" title="삭제" aria-label="삭제">${ICON.trash}</button></span></div>`).join('') || '<div class="side-label" style="font-weight:400">아직 대화가 없어요</div>';
  }

  // ---------- artifact panel ----------
  const isMobile = () => matchMedia('(max-width:860px)').matches;
  function wrapDoc(code, lang) {
    if (lang === 'svg' || /^\s*<svg/i.test(code)) return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${code}</body>`;
    return /<html|<!doctype/i.test(code) ? code : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${code}</body></html>`;
  }
  let arts = []; // version history for this conversation
  function artName(code, lang) { return (code.match(/<title>([^<]{1,60})<\/title>/i)?.[1] || ({ svg: 'SVG 그림', python: 'Python 실행', csv: 'CSV 차트' }[lang] || 'HTML 페이지')).trim(); }
  function showArt() { $('art').hidden = false; $('art-toggle').hidden = false; }
  function openArt(code, lang, opts = {}) {
    lang = lang || 'html';
    const last = arts[arts.length - 1];
    if (!last || last.code !== code) arts.push({ code, lang, name: artName(code, lang), ts: Date.now() });
    art = arts[arts.length - 1]; art.live = false; showArt(); drawVersions();
    $('art-title').textContent = art.name;
    const c = $('art-code').firstChild; c.textContent = art.src || code; c.className = 'language-' + (lang === 'svg' ? 'xml' : lang === 'python' ? 'python' : 'html'); if (window.hljs) { c.removeAttribute('data-highlighted'); try { hljs.highlightElement(c); } catch {} }
    if (!opts.keepTab) tab('preview'); runArt();
  }
  function drawVersions() {
    const sel = $('art-ver'); sel.hidden = arts.length < 2;
    sel.innerHTML = arts.map((a, k) => `<option value="${k}">v${k + 1} · ${esc(a.name.slice(0, 18))}</option>`).join(''); sel.value = String(arts.indexOf(art));
  }
  $('art-ver').onchange = e => { art = arts[+e.target.value]; $('art-title').textContent = art.name; const c = $('art-code').firstChild; c.textContent = art.src || art.code; runArt(); };
  // live preview while the model is still writing a ```html / ```svg block
  let liveT = 0, liveCode = '';
  function liveArt(text) {
    const m = text.match(/```(html|svg)[^\n]*\n([\s\S]*)$/i); if (!m || /\n```/.test(m[2])) { const done = text.match(/```(html|svg)[^\n]*\n([\s\S]*?)\n```/i); if (done && liveCode && done[2] !== liveCode) { liveCode = done[2]; paintLive(done[1].toLowerCase()); } return; }
    const code = m[2]; if (code.length < 40 || !/<(html|body|div|svg|canvas|style|!doctype|head|h1|main|section)/i.test(code)) return;
    liveCode = code; const now = Date.now(); if (now - liveT < 1200) return; liveT = now; paintLive(m[1].toLowerCase());
  }
  function paintLive(lang) {
    if ($('art').hidden && isMobile()) { $('art-toggle').hidden = false; $('art-toggle').classList.add('pulse'); return; }
    art = { code: liveCode, lang, name: artName(liveCode, lang) + ' · 작성 중', live: true }; showArt(); tab('preview');
    $('art-title').textContent = art.name; $('art-frame').srcdoc = wrapDoc(liveCode, lang);
  }
  function runArt() { if (art) $('art-frame').srcdoc = art.lang === 'python' ? pyDoc(art.code) : art.lang === 'csv' ? chartDoc(art.code) : wrapDoc(art.code, art.lang); }
  // Python via Pyodide (loaded from jsDelivr inside the sandboxed iframe)
  function pyDoc(code) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Python</title><style>body{font:14px/1.5 ui-monospace,Menlo,monospace;margin:0;padding:14px;background:#0f1117;color:#e8e8e8}#st{color:#ffb067;margin-bottom:8px}pre{white-space:pre-wrap;margin:0}.err{color:#ff7b7b}img{max-width:100%;background:#fff;border-radius:8px;margin-top:10px}</style></head><body><div id="st">Python 런타임(Pyodide) 불러오는 중… 처음엔 10~20초 걸려요</div><pre id="out"></pre><div id="figs"></div>
<script src="https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js"><\/script><script>
const CODE=${JSON.stringify(code).replace(/</g, '\\u003c')};const out=document.getElementById('out'),st=document.getElementById('st');
(async()=>{try{const py=await loadPyodide({stdout:t=>out.textContent+=t+'\\n',stderr:t=>out.innerHTML+='<span class=err>'+t.replace(/</g,'&lt;')+'</span>\\n'});
st.textContent='패키지 확인 중…';await py.loadPackagesFromImports(CODE);
if(/matplotlib/.test(CODE)){await py.runPythonAsync("import matplotlib\\nmatplotlib.use('Agg')");}
st.textContent='실행 중…';const t0=performance.now();const r=await py.runPythonAsync(CODE);if(r!==undefined&&r!==null)out.textContent+=String(r)+'\\n';
if(/matplotlib/.test(CODE)){const imgs=await py.runPythonAsync("import io,base64\\nimport matplotlib.pyplot as plt\\n_r=[]\\nfor n in plt.get_fignums():\\n  b=io.BytesIO();plt.figure(n).savefig(b,format='png',dpi=110,bbox_inches='tight');_r.append(base64.b64encode(b.getvalue()).decode())\\nplt.close('all')\\n_r");for(const b of imgs.toJs()){const i=new Image();i.src='data:image/png;base64,'+b;document.getElementById('figs').appendChild(i);}}
st.textContent='✓ 완료 ('+((performance.now()-t0)/1000).toFixed(2)+'초)';}catch(e){st.textContent='오류';out.innerHTML+='<span class=err>'+String(e.message||e).replace(/</g,'&lt;')+'</span>';}})();
<\/script></body></html>`;
  }
  // CSV -> chart (no library, canvas)
  function parseCsv(t) {
    const rows = []; let row = [], f = '', q = false; t = t.replace(/^\uFEFF/, '');
    const sep = (t.split('\n')[0].match(/\t/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    for (let i = 0; i < t.length; i++) { const c = t[i];
      if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
      else if (c === '"') q = true; else if (c === sep) { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }
  function chartDoc(csv) {
    const rows = parseCsv(csv).slice(0, 501); const head = rows.shift() || [];
    const num = v => +String(v).replace(/[,%₩$원\s]/g, '');
    const cols = head.map((h, k) => ({ h, k, n: rows.filter(r => r[k] !== undefined && r[k] !== '' && !isNaN(num(r[k]))).length })).filter(c => c.n >= rows.length * .7 && c.n);
    const data = { head, rows, numCols: cols.map(c => c.k) };
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CSV 차트</title><style>body{margin:0;padding:14px;font:14px system-ui,sans-serif;background:#fff;color:#222}.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center}select,button{font:inherit;padding:5px 8px;border-radius:8px;border:1px solid #ccc;background:#fafafa}canvas{width:100%;height:360px;display:block}table{border-collapse:collapse;margin-top:14px;font-size:12px}td,th{border:1px solid #ddd;padding:3px 7px}.note{color:#777;font-size:12px}</style></head><body>
<div class="bar"><b>📊 CSV 차트</b><select id="ty"><option value="bar">막대</option><option value="line">선</option></select><label>값 <select id="ys" multiple size="1"></select></label><span class="note" id="nt"></span></div><canvas id="c"></canvas><div id="tb"></div>
<script>const D=${JSON.stringify(data).replace(/</g, '\\u003c')};const num=v=>+String(v).replace(/[,%₩$원\\s]/g,'');const C=['#ff6a3d','#3d8bff','#22b07d','#a35cff','#f2b400','#e0457b'];
const ys=document.getElementById('ys');D.numCols.forEach((k,i)=>{const o=new Option(D.head[k]||('열'+(k+1)),k);o.selected=i<3&&(D.numCols.length===1||k!==0||D.numCols.length<2);ys.add(o)});ys.size=Math.min(4,Math.max(1,D.numCols.length));
const labCol=D.head.findIndex((h,k)=>!D.numCols.includes(k));
function draw(){const cv=document.getElementById('c'),r=devicePixelRatio||1,W=cv.clientWidth,H=360;cv.width=W*r;cv.height=H*r;const g=cv.getContext('2d');g.scale(r,r);g.clearRect(0,0,W,H);
const sel=[...ys.selectedOptions].map(o=>+o.value);if(!sel.length){document.getElementById('nt').textContent='숫자 열이 없어요';return}
const rows=D.rows.slice(0,200),vals=sel.map(k=>rows.map(r=>num(r[k])));const all=vals.flat().filter(v=>isFinite(v));let mx=Math.max(0,...all),mn=Math.min(0,...all);if(mx===mn)mx=mn+1;
const L=56,R=12,T=24,B=46,w=W-L-R,h=H-T-B,y=v=>T+h-(v-mn)/(mx-mn)*h;g.font='11px system-ui';g.fillStyle='#666';g.strokeStyle='#eee';
for(let i=0;i<=5;i++){const v=mn+(mx-mn)*i/5,yy=y(v);g.beginPath();g.moveTo(L,yy);g.lineTo(W-R,yy);g.stroke();g.fillText(+v.toPrecision(4),4,yy+4)}
const n=rows.length,ty=document.getElementById('ty').value,bw=w/n;
sel.forEach((k,si)=>{g.fillStyle=g.strokeStyle=C[si%C.length];g.lineWidth=2;if(ty==='line'){g.beginPath();vals[si].forEach((v,i)=>{const xx=L+bw*(i+.5);i?g.lineTo(xx,y(v)):g.moveTo(xx,y(v))});g.stroke()}else{const sw=bw*.8/sel.length;vals[si].forEach((v,i)=>{const xx=L+bw*i+bw*.1+sw*si;g.fillRect(xx,Math.min(y(v),y(0)),Math.max(1,sw-1),Math.abs(y(v)-y(0)))})}
g.fillRect(L+si*120,4,10,10);g.fillStyle='#333';g.fillText(String(D.head[k]).slice(0,14),L+si*120+14,13)});
g.fillStyle='#666';const step=Math.ceil(n/Math.max(1,Math.floor(w/70)));rows.forEach((r,i)=>{if(i%step)return;g.fillText(String(labCol>=0?r[labCol]:i+1).slice(0,10),L+bw*i+2,H-B+16)});
document.getElementById('nt').textContent=D.rows.length+'행'+(D.rows.length>200?' (앞 200행만 그림)':'')}
document.getElementById('tb').innerHTML='<table><tr>'+D.head.map(h=>'<th>'+String(h).replace(/</g,'&lt;')+'</th>').join('')+'</tr>'+D.rows.slice(0,15).map(r=>'<tr>'+r.map(c=>'<td>'+String(c).replace(/</g,'&lt;')+'</td>').join('')+'</tr>').join('')+'</table>'+(D.rows.length>15?'<p class=note>… 외 '+(D.rows.length-15)+'행</p>':'');
ys.onchange=draw;document.getElementById('ty').onchange=draw;addEventListener('resize',draw);draw();<\/script></body></html>`;
  }

  function tab(t) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('art-code').hidden = t !== 'code'; $('art-frame').hidden = t === 'code';
  }
  function closeArt() { $('art').hidden = true; $('art').classList.remove('full'); $('art-frame').srcdoc = ''; }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
  $('art-reload').onclick = runArt;
  $('art-copy').onclick = e => art && copy(art.code, e.currentTarget);
  $('art-dl').onclick = () => { if (!art) return; const ext = { svg: 'svg', python: 'py', csv: 'csv' }[art.lang] || 'html'; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ext === 'html' ? wrapDoc(art.code) : art.code], { type: ext === 'svg' ? 'image/svg+xml' : ext === 'html' ? 'text/html' : 'text/plain' })); a.download = art.name.replace(/[\\/:*?"<>| ]+/g, '_') + '.' + ext; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  $('art-tab').onclick = () => {
    if (!art) return; const w = window.open('', '_blank'); if (!w) return toast('팝업이 차단됐어요');
    w.document.write('<!doctype html><title>AETHERION 미리보기</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style><iframe sandbox="allow-scripts allow-modals allow-pointer-lock"></iframe>');
    w.document.close(); w.document.querySelector('iframe').srcdoc = $('art-frame').srcdoc;
  };
  $('art-full').onclick = () => { const p = $('art'); if (p.requestFullscreen && !isMobile()) { document.fullscreenElement ? document.exitFullscreen() : p.requestFullscreen().catch(() => p.classList.toggle('full')); } else p.classList.toggle('full'); };
  $('art-close').onclick = closeArt;
  $('art-toggle').onclick = () => { $('art-toggle').classList.remove('pulse'); if (!$('art').hidden) return closeArt(); if (art?.live) { showArt(); $('art-frame').srcdoc = wrapDoc(liveCode, art.lang); } else if (art) openArt(art.code, art.lang); };

  // ---------- message actions ----------
  $('msgs').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const msgDiv = b.closest('.msg'), i = +msgDiv?.dataset.i, m = cur?.msgs[i];
    const act = b.dataset.act;
    if (act === 'copy-code') return copy(b.closest('.cb').querySelector('code').textContent, b);
    if (act === 'preview') { const cb = b.classList.contains('art-card') ? b.nextElementSibling : b.closest('.cb'); return openArt(cb.querySelector('code').textContent, cb.dataset.lang); }
    if (act === 'pyrun') return openArt(b.closest('.cb').querySelector('code').textContent, 'python');
    if (act === 'chart') return openArt(b.closest('.cb').querySelector('code').textContent, 'csv');
    if (!m) return;
    if (act === 'up' || act === 'down') return feedback(m, i, act, b);
    if (act === 'copy') return copy(m.content, b);
    if (act === 'speak') return speak(m.content, b);
    if (act === 'regen' && !busy) { cur.msgs.splice(i); renderAll(); return run(); }
    if (act === 'edit' && !busy) {
      const bub = msgDiv.querySelector('.bub'); const box = document.createElement('div'); box.className = 'edit-box'; box.style.width = '100%';
      box.innerHTML = `<textarea></textarea><div><button type="button" class="btn sm" data-e="no">취소</button><button type="button" class="btn sm primary" data-e="ok">보내기</button></div>`;
      box.querySelector('textarea').value = m.content; bub.replaceWith(box); msgDiv.querySelector('.acts').hidden = true; box.querySelector('textarea').focus();
      box.onclick = ev => { const k = ev.target.dataset.e; if (k === 'no') renderAll(); if (k === 'ok') { const v = box.querySelector('textarea').value.trim(); if (!v) return; cur.msgs.splice(i); cur.msgs.push({ role: 'user', content: v }); renderAll(); run(); } };
    }
  });

  // ---------- conversations ----------
  function select(c) { if (busy) ctrl?.abort(); arts = []; art = null; $('art-toggle').hidden = true; cur = c; localStorage.setItem(LS.cur, c?.id || ''); closeArt(); renderAll(); closeSide(); }
  function newChat() { if (busy) ctrl?.abort(); arts = []; art = null; $('art-toggle').hidden = true; cur = null; closeArt(); renderAll(); closeSide(); $('q').focus(); }
  $('new').onclick = newChat; $('new2').onclick = newChat;
  $('convs').addEventListener('click', e => {
    const row = e.target.closest('.conv'); if (!row) return; const c = convs.find(x => x.id === row.dataset.id); if (!c) return;
    const a = e.target.closest('[data-cact]')?.dataset.cact;
    if (a === 'rename') { const t = prompt('대화 이름', c.title); if (t?.trim()) { c.title = titleOf(t); persist(); renderConvs(); } return; }
    if (a === 'del') { if (!confirm('이 대화를 삭제할까요?')) return; convs = convs.filter(x => x !== c); if (c === cur) cur = null; persist(); renderAll(); return; }
    select(c);
  });
  $('convs').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('conv')) e.target.click(); });

  // sidebar
  const app = $('app');
  function closeSide() { app.classList.remove('side-open'); }
  $('side-open').onclick = () => isMobile() ? app.classList.add('side-open') : app.classList.remove('side-hidden');
  $('side-close').onclick = () => isMobile() ? closeSide() : app.classList.add('side-hidden');
  $('scrim').onclick = closeSide;

  // theme
  function applyTheme(t) {
    document.documentElement.dataset.theme = t; $('hl-dark').disabled = t === 'light'; $('hl-light').disabled = t !== 'light';
    $('theme-txt').textContent = t === 'light' ? '다크 모드' : '라이트 모드';
    document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#fbfaf8' : '#0b0d12';
  }
  $('theme').onclick = () => { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; localStorage.setItem(LS.theme, t); applyTheme(t); };
  applyTheme(document.documentElement.dataset.theme || 'dark');

  // settings
  const dlg = $('settings');
  const openSettings = () => { closeSide(); dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', ''); };
  $('open-settings').onclick = openSettings; $('model-chip').onclick = openSettings;
  $('save').onclick = () => { localStorage.setItem(LS.ep, $('ep').value.trim()); localStorage.setItem(LS.key, $('key').value.trim()); check().then(() => { if ($('dot').classList.contains('ok')) { dlg.close?.(); toast('연결됐어요'); } }); };
  $('clear-all').onclick = () => { if (!confirm('모든 대화 기록을 지울까요?')) return; convs = []; cur = null; persist(); renderAll(); dlg.close?.(); };
  $('custom').value = localStorage.getItem(LS.custom) || ''; $('custom').onchange = () => { localStorage.setItem(LS.custom, $('custom').value.slice(0, 1000)); toast('지시사항을 저장했어요'); };
  $('voice').onchange = () => localStorage.setItem(LS.voice, $('voice').value);
  $('rate').value = localStorage.getItem(LS.rate) || '1.05'; $('rate').onchange = () => localStorage.setItem(LS.rate, $('rate').value);
  $('autoread').checked = localStorage.getItem(LS.auto) === '1'; $('autoread').onchange = () => localStorage.setItem(LS.auto, $('autoread').checked ? '1' : '0');
  $('tts-test').onclick = () => speak('안녕하세요. 에테리온 읽어주기 테스트예요. 문장 단위로 나눠서 끊김 없이 읽어요.', $('tts-test'));
  if (/iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone) $('ios-hint').hidden = false;
  $('tools').onchange = () => localStorage.setItem(LS.tools, $('tools').checked ? '1' : '0');

  async function check() {
    const ep = endpoint();
    if (!ep) return setStatus('bad', '서버 주소가 없어요');
    setStatus('wait', '연결 확인 중…');
    try {
      const j = await (await fetch(ep + '/health', { signal: AbortSignal.timeout(8000) })).json();
      if (!j.llm) return setStatus('bad', '모델 서버 꺼짐 · 자동 재시작 중');
      setStatus('ok', j.busy ? '응답 중' + (j.queue ? ` · 대기 ${j.queue}` : '') : '온라인' + (j.tools ? ` · 도구 ${j.tools.length}개` : ''));
    } catch { setStatus('bad', '오프라인 (서버 꺼짐 또는 주소 변경)'); }
  }

  // ---------- composer ----------
  const q = $('q');
  const grow = () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 220) + 'px'; $('send').disabled = !busy && !q.value.trim() && !pending.length && !pendingDoc; };
  q.addEventListener('input', grow);
  let composing = false;
  q.addEventListener('compositionstart', () => composing = true);
  q.addEventListener('compositionend', () => setTimeout(() => composing = false, 0));
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !composing && e.keyCode !== 229 && !isMobile()) { e.preventDefault(); $('form').requestSubmit(); }
  });
  $('form').addEventListener('submit', e => { e.preventDefault(); if (busy) return ctrl?.abort(); const t = q.value.trim(); if (!t && !pending.length && !pendingDoc) return; q.value = ''; grow(); hideSlash(); ask(t || (pendingDoc ? '이 파일의 핵심 내용을 요약해줘' : '이 이미지를 자세히 설명해줘')); });
  // slash commands
  const SLASH = [
    ['/검색', '웹에서 검색해서 출처와 함께 알려줘: ', '웹검색'], ['/뉴스', '최신 뉴스를 찾아서 정리해줘: ', '뉴스'], ['/시세', '현재 시세를 알려줘: ', '주식·코인'],
    ['/코드', 'CSS와 JS를 포함한 단일 HTML 파일로 만들어줘: ', '미리보기 실행'], ['/번역', '다음 글을 자연스럽게 번역해줘 (한국어면 영어로, 그 외는 한국어로). 번역문만 써줘:\n', '한↔영'],
    ['/요약', '다음 URL이나 글을 읽고 핵심을 5줄로 요약해줘: ', 'URL·글 요약'], ['/수식', '수식은 LaTeX($...$, $$...$$)로 써서 설명해줘: ', 'KaTeX'],
    ['/다이어그램', 'mermaid 코드 블록(```mermaid)으로 다이어그램을 그려줘: ', 'mermaid'], ['/qr', 'QR 코드를 만들어줘: ', 'QR 코드'], ['/리서치', '', '딥 리서치 모드'], ['/파이썬', '```python 코드 블록으로 작성해줘(브라우저에서 실행돼요): ', 'Python 실행'], ['/기억', '', '나에 대해 기억시키기'],
  ];
  const slashBox = $('slash');
  function hideSlash() { slashBox.hidden = true; }
  q.addEventListener('input', () => {
    const v = q.value; if (!v.startsWith('/') || /\s/.test(v)) return hideSlash();
    const list = SLASH.filter(c => c[0].startsWith(v)); if (!list.length) return hideSlash();
    slashBox.innerHTML = list.map(c => `<button type="button" data-cmd="${c[0]}"><b>${c[0]}</b><span>${c[2]}</span></button>`).join(''); slashBox.hidden = false;
  });
  slashBox.addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (!b) return; q.value = b.dataset.cmd + ' '; hideSlash(); q.focus(); grow(); });
  function expandSlash(t) {
    const m = t.match(/^(\/\S+)\s*([\s\S]*)$/); if (!m) return { text: t };
    if (m[1] === '/리서치') return { text: m[2] || t, mode: 'research' };
    if (m[1] === '/기억') return { text: m[2], remember: true };
    const c = SLASH.find(x => x[0] === m[1]); return c ? { text: c[1] + m[2] } : { text: t };
  }
  // image attach (resized client-side to ≤1024px JPEG)
  let pending = [];
  function shrink(file, max) { return new Promise((ok, no) => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', .85)); }; img.onerror = no; img.src = URL.createObjectURL(file); }); }
  async function addFiles(files) {
    const docs = [...files].filter(f => !/^image\//.test(f.type)); if (docs.length) addDoc(docs[0]);
    for (const f of [...files].filter(f => /^image\//.test(f.type)).slice(0, 2 - pending.length)) { try { pending.push({ full: await shrink(f, 1024), thumb: await shrink(f, 160) }); } catch { toast('이미지를 읽지 못했어요'); } }
    drawPending();
  }
  function drawPending() { $('attach-row').innerHTML = pending.map((p, i) => `<span class="att"><img src="${p.thumb}" alt="첨부 이미지 ${i + 1}"><button type="button" data-rm="${i}" aria-label="첨부 삭제">×</button></span>`).join('') + (pendingDoc ? `<span class="att doc">📎 ${esc(pendingDoc.name)}${pendingDoc.pages ? ` · ${pendingDoc.pages}쪽` : ''}<button type="button" data-rmdoc="1" aria-label="파일 삭제">×</button></span>` : ''); $('attach-row').hidden = !pending.length && !pendingDoc; grow(); }
  $('attach-row').addEventListener('click', e => { const i = e.target.dataset.rm; if (i != null) { pending.splice(+i, 1); drawPending(); } if (e.target.dataset.rmdoc) { pendingDoc = null; drawPending(); } });
  $('img-btn').onclick = () => $('img-in').click();
  $('img-in').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  q.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
  $('form').addEventListener('dragover', e => e.preventDefault());
  $('form').addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  // voice input (Web Speech API)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let rec = null;
  if (!SR) $('mic').hidden = true;
  const SR_ERR = { 'not-allowed': '마이크 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 마이크를 허용해 주세요. (아이폰: 설정 > Safari > 마이크, 설정 > 일반 > 키보드 > 받아쓰기 켜기)', 'service-not-allowed': '이 기기에서 음성 인식을 쓸 수 없어요. 아이폰은 설정 > 일반 > 키보드 > 받아쓰기를 켜 주세요.', 'no-speech': '말소리가 들리지 않았어요. 다시 눌러서 말해 주세요.', 'audio-capture': '마이크를 찾을 수 없어요.', network: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', 'language-not-supported': '한국어 음성 인식을 지원하지 않는 브라우저예요.' };
  let recT = 0;
  $('mic').onclick = () => {
    if (rec) { rec.stop(); return; }
    try { rec = new SR(); } catch { return toast('이 브라우저는 음성 입력을 지원하지 않아요'); }
    rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = false; const base = q.value ? q.value + ' ' : '';
    rec.onresult = ev => { q.value = base + [...ev.results].map(r => r[0].transcript).join(''); grow(); clearTimeout(recT); recT = setTimeout(() => rec?.stop(), 4000); };
    rec.onend = () => { clearTimeout(recT); rec = null; $('mic').classList.remove('on'); };
    rec.onerror = ev => { if (ev.error !== 'aborted') toast(SR_ERR[ev.error] || '음성 인식 오류: ' + ev.error, 4200); };
    $('mic').classList.add('on'); recT = setTimeout(() => { rec?.stop(); }, 15000);
    try { rec.start(); toast('듣고 있어요… 말씀하세요'); } catch (e) { rec = null; $('mic').classList.remove('on'); toast('음성 인식을 시작하지 못했어요'); }
  };
  // read aloud: sentence chunks, voice picker, iOS-safe start/stop
  const TTS = window.speechSynthesis; let ttsQ = [], ttsBtn = null, ttsOn = false;
  const voicesReady = new Promise(ok => { if (!TTS) return ok([]); const v = TTS.getVoices(); if (v.length) return ok(v); TTS.addEventListener?.('voiceschanged', () => ok(TTS.getVoices()), { once: true }); setTimeout(() => ok(TTS.getVoices()), 1500); });
  function fillVoices(list) {
    const sel = $('voice'); if (!sel) return; const ko = list.filter(v => /^ko/i.test(v.lang)); const use = ko.length ? ko : list;
    sel.innerHTML = '<option value="">자동 (한국어)</option>' + use.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    sel.value = localStorage.getItem(LS.voice) || '';
  }
  voicesReady.then(fillVoices);
  function chunks(text) {
    const plain = text.replace(/```[\s\S]*?```/g, ' 코드는 생략할게요. ').replace(/\$\$[\s\S]*?\$\$/g, ' 수식 생략. ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[(\d+)\]/g, '').replace(/[#*_>|`~]+/g, ' ').replace(/^\s*[-•]\s+/gm, '').replace(/[ \t]+/g, ' ').trim().slice(0, 6000);
    const out = []; for (const sent of plain.split(/(?<=[.!?。…요다죠니까])\s+|\n+/)) { let t = sent.trim(); while (t.length > 180) { const sp = t.lastIndexOf(' ', 180); const cut = sp > 60 ? sp : 180; out.push(t.slice(0, cut)); t = t.slice(cut).trim(); } if (t) out.push(t); }
    return out;
  }
  function stopSpeak() { ttsOn = false; ttsQ = []; try { TTS?.cancel(); } catch {} ttsBtn?.classList.remove('on'); ttsBtn = null; }
  function speakNext() {
    if (!ttsOn || !ttsQ.length) return stopSpeak();
    const u = new SpeechSynthesisUtterance(ttsQ.shift()); u.lang = 'ko-KR'; u.rate = +(localStorage.getItem(LS.rate) || 1.05);
    const want = localStorage.getItem(LS.voice), vs = TTS.getVoices(); const v = (want && vs.find(x => x.voiceURI === want)) || vs.find(x => /^ko/i.test(x.lang)); if (v) u.voice = v;
    u.onend = () => speakNext(); u.onerror = e => { if (e.error !== 'interrupted' && e.error !== 'canceled') toast('읽기 오류: ' + e.error); if (ttsOn) speakNext(); };
    TTS.speak(u);
  }
  function speak(text, btn) {
    if (!TTS) return toast('이 브라우저는 읽어주기를 지원하지 않아요');
    if (ttsOn) { const same = ttsBtn === btn; stopSpeak(); if (same) return; }
    try { TTS.cancel(); } catch {}
    ttsQ = chunks(text); if (!ttsQ.length) return; ttsOn = true; ttsBtn = btn; btn?.classList.add('on');
    if (TTS.paused) TTS.resume();
    speakNext(); // first utterance starts inside the tap handler (required on iOS Safari)
    if (btn) toast('읽는 중… 다시 누르면 멈춰요');
  }
  window.__aeTTS = { chunks }; // exposed for automated tests
  // feedback 👍/👎 -> server log
  async function feedback(m, i, rating, btn) {
    m.fb = m.fb === rating ? null : rating; persist(); fillBot(btn.closest('.msg'), m, false);
    if (!m.fb) return;
    const qm = cur.msgs.slice(0, i).reverse().find(x => x.role === 'user');
    try { const r = await fetch(endpoint() + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + $('key').value.trim() }, body: JSON.stringify({ rating, q: qm?.content || '', a: m.content.slice(0, 600) }) }); toast(r.ok ? '피드백 고마워요! 개선에 쓸게요' : '피드백을 보내지 못했어요'); } catch { toast('피드백을 보내지 못했어요 (서버 오프라인)'); }
  }
  // shareable link: the conversation is compressed into the URL fragment (never sent to any server)
  async function shareLink() {
    if (!cur?.msgs.length) return toast('공유할 대화가 없어요');
    const data = { t: cur.title, m: cur.msgs.filter(m => m.content).map(m => ({ r: m.role === 'user' ? 'u' : 'a', c: m.content.slice(0, 20000), s: (m.sources || []).map(s => ({ n: s.n, t: s.title, u: s.url })) })) };
    let bytes = new TextEncoder().encode(JSON.stringify(data)), z = 'j';
    if (window.CompressionStream) { bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); z = 'z'; }
    let bin = ''; for (let k = 0; k < bytes.length; k += 8192) bin += String.fromCharCode(...bytes.subarray(k, k + 8192));
    const url = location.origin + '/share/#' + z + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (url.length > 60000) toast('대화가 길어서 링크가 아주 길어요. 일부 메신저에서 잘릴 수 있어요', 3500);
    if (navigator.share && isMobile()) return navigator.share({ title: cur.title, url }).catch(() => {});
    await copy(url); toast('공유 링크를 복사했어요. 이미지는 포함되지 않아요', 2600);
    return url;
  }
  $('share').onclick = shareLink; window.__aeShare = shareLink;
  // file / PDF Q&A (text is extracted in the browser)
  let pendingDoc = null;
  async function readDoc(f) {
    if (f.size > 25e6) throw new Error('25MB보다 큰 파일은 못 읽어요');
    if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
      const pdfjs = await import('/assets/vendor/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise; let out = '';
      for (let p = 1; p <= Math.min(pdf.numPages, 60) && out.length < 40000; p++) { const tc = await (await pdf.getPage(p)).getTextContent(); out += `\n[${p}쪽]\n` + tc.items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join(''); }
      if (!out.replace(/\[\d+쪽\]|\s/g, '')) throw new Error('글자를 찾지 못했어요 (스캔 이미지 PDF일 수 있어요)');
      return { text: out.trim(), pages: pdf.numPages };
    }
    if (f.size > 3e6) throw new Error('텍스트 파일은 3MB까지 읽을 수 있어요');
    return { text: (await f.text()).trim() };
  }
  async function addDoc(f) {
    toast('파일 읽는 중…');
    try {
      const r = await readDoc(f); const LIM = 9000; const cut = r.text.length > LIM;
      pendingDoc = { name: f.name, text: r.text.slice(0, LIM), full: r.text.length, pages: r.pages, csv: /\.(csv|tsv)$/i.test(f.name) || /csv/.test(f.type) };
      drawPending(); toast(cut ? `앞부분 ${LIM.toLocaleString()}자만 보낼게요 (전체 ${r.text.length.toLocaleString()}자)` : '파일을 붙였어요', 2600);
      if (pendingDoc.csv) openArt(r.text.slice(0, 200000), 'csv');
    } catch (e) { toast('파일을 읽지 못했어요: ' + e.message, 3500); }
  }
  $('file-btn').onclick = () => $('file-in').click();
  $('file-in').onchange = e => { const f = e.target.files[0]; if (f) addDoc(f); e.target.value = ''; };
  // custom instructions & memory (kept in this browser only)
  const memList = () => { try { return JSON.parse(localStorage.getItem(LS.mem) || '[]'); } catch { return []; } };
  function drawMem() { const l = memList(); $('mem-list').innerHTML = l.length ? l.map((x, k) => `<li><span>${esc(x)}</span><button type="button" class="btn sm" data-mrm="${k}" aria-label="기억 삭제">삭제</button></li>`).join('') : '<li class="muted">아직 기억한 게 없어요. 채팅에서 <b>/기억 내용</b> 으로 추가해요.</li>'; }
  $('mem-list').onclick = e => { const k = e.target.dataset.mrm; if (k == null) return; const l = memList(); l.splice(+k, 1); localStorage.setItem(LS.mem, JSON.stringify(l)); drawMem(); };
  function remember(t) { const l = memList(); l.push(t.slice(0, 200)); localStorage.setItem(LS.mem, JSON.stringify(l.slice(-30))); drawMem(); toast('기억했어요: ' + t.slice(0, 30)); }
  const customText = () => { const c = (localStorage.getItem(LS.custom) || '').trim(), mm = memList(); return [c && '지시사항: ' + c, mm.length && '사용자에 대해 기억할 것:\n- ' + mm.join('\n- ')].filter(Boolean).join('\n').slice(0, 1500); };
  // prompt template gallery
  const TPL = [
    ['글쓰기', '✉️', '정중한 이메일', '다음 내용을 정중한 업무 이메일로 써줘. 제목도 붙여줘:\n'], ['글쓰기', '📝', '자기소개서 다듬기', '아래 자기소개서를 자연스럽고 설득력 있게 다듬고, 바꾼 이유도 짧게 알려줘:\n'],
    ['글쓰기', '📣', 'SNS 홍보 문구', '다음 내용을 인스타그램 홍보 문구 3가지 버전(해시태그 포함)으로 써줘:\n'],
    ['공부', '🎓', '쉽게 설명', '초등학생도 이해할 수 있게 비유를 들어 설명해줘: '], ['공부', '🧠', '퀴즈 만들기', '다음 주제로 객관식 퀴즈 5문제와 정답·해설을 만들어줘: '],
    ['공부', '🗂️', '요약 노트', '다음 글을 시험 공부용 요약 노트(핵심 개념·표)로 정리해줘:\n'],
    ['개발', '🐞', '코드 리뷰', '다음 코드의 버그와 개선점을 찾아서 고친 코드와 함께 알려줘:\n'], ['개발', '🐍', '파이썬 실행', '/파이썬 계산하고 결과를 matplotlib 그래프로도 보여줘: '],
    ['개발', '🧪', '정규식', '다음 조건에 맞는 정규식을 만들고 예시로 설명해줘: '], ['개발', '🌐', '랜딩 페이지', '/코드 다음 서비스의 반응형 랜딩 페이지: '],
    ['일상', '🍳', '냉장고 레시피', '냉장고에 있는 재료로 만들 수 있는 요리 3개를 추천해줘. 재료: '], ['일상', '✈️', '여행 일정', '다음 여행지로 2박 3일 일정을 시간대별 표로 짜줘: '],
    ['분석', '📊', '데이터 분석', '첨부한 CSV를 분석해서 핵심 인사이트 3가지를 알려줘.'], ['분석', '📄', 'PDF 요약', '첨부한 문서를 요약하고, 중요한 숫자와 결론을 표로 정리해줘.'],
    ['분석', '⚖️', '장단점 비교', '다음 선택지들의 장단점을 표로 비교하고 추천해줘: '], ['분석', '🔎', '팩트 체크', '/검색 다음 주장이 사실인지 출처와 함께 확인해줘: '],
  ];
  function drawTpl() {
    const cats = [...new Set(TPL.map(t => t[0]))];
    $('tpl-body').innerHTML = cats.map(c => `<h3>${c}</h3><div class="tpl-grid">${TPL.map((t, k) => t[0] === c ? `<button type="button" class="tpl" data-tpl="${k}"><span>${t[1]}</span><b>${t[2]}</b></button>` : '').join('')}</div>`).join('');
  }
  $('tpl-btn').onclick = () => { drawTpl(); $('tpl').showModal ? $('tpl').showModal() : $('tpl').setAttribute('open', ''); };
  $('tpl-body').onclick = e => { const b = e.target.closest('[data-tpl]'); if (!b) return; q.value = TPL[+b.dataset.tpl][3]; $('tpl').close?.(); q.focus(); grow(); };
  // export conversation as markdown
  $('export').onclick = () => {
    if (!cur?.msgs.length) return toast('내보낼 대화가 없어요');
    const md = `# ${cur.title}\n\n_AETHERION AI · ${new Date().toLocaleString('ko-KR')}_\n\n` + cur.msgs.map(m => m.role === 'user' ? `## 🙋 사용자\n\n${m.content}\n` : `## ✦ AETHERION\n\n${m.content}\n${(m.sources || []).length ? '\n**출처**\n' + m.sources.map(s => `${s.n}. [${s.title}](${s.url})`).join('\n') + '\n' : ''}`).join('\n');
    const file = new File([md], (cur.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'chat') + '.md', { type: 'text/markdown' });
    if (navigator.canShare?.({ files: [file] }) && isMobile()) return navigator.share({ files: [file], title: cur.title }).catch(() => {});
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('마크다운으로 저장했어요');
  };
  // mode
  const modeSel = $('mode'); modeSel.value = localStorage.getItem('ae.mode') || 'fast'; modeSel.onchange = () => localStorage.setItem('ae.mode', modeSel.value);
  document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => ask(b.dataset.q)));
  function setBusy(v) { busy = v; $('form').classList.toggle('busy', v); $('send').setAttribute('aria-label', v ? '중지' : '전송'); grow(); }

  function ask(raw) {
    if (busy) return;
    const { text, mode, remember: rem } = expandSlash(raw);
    if (rem) { if (text.trim()) remember(text.trim()); else toast('/기억 다음에 기억할 내용을 써 주세요'); return; }
    const c = conv(); if (!c.msgs.length) c.title = titleOf(raw);
    const um = { role: 'user', content: text };
    if (pendingDoc) { um.doc = { name: pendingDoc.name, text: pendingDoc.text }; pendingDoc = null; drawPending(); }
    if (pending.length) { um.thumbs = pending.map(p => p.thumb); run.images = pending.map(p => p.full); pending = []; drawPending(); } else run.images = null;
    run.mode = mode || null;
    c.msgs.push(um); c.ts = Date.now(); persist(); renderAll(); run();
  }

  // ---------- streaming ----------
  async function run() {
    const ep = endpoint(), key = $('key').value.trim(), c = cur;
    if (!key) { setStatus('bad', '접속 키를 입력해 주세요'); return openSettings(); }
    setBusy(true);
    const m = { role: 'assistant', content: '', steps: [], sources: [], status: '연결 중…', thinking: '' };
    const mode = run.mode || (modeSel.value === 'research' ? 'research' : null), images = run.images; run.mode = run.images = null;
    let artifact = null;
    const history = c.msgs.map(({ role, content, doc }) => ({ role, content: doc ? `[첨부 파일: ${doc.name}]\n<문서 시작>\n${doc.text}\n<문서 끝>\n\n${content}` : content }));
    liveCode = ''; liveT = 0; let idle = 0; const IDLE_MS = mode === 'research' ? 240000 : 120000; let timedOut = false;
    const kick = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; ctrl?.abort(); }, IDLE_MS); };
    c.msgs.push(m); const i = c.msgs.length - 1;
    const d = msgEl(m, i); $('msgs').appendChild(d); $('empty').hidden = true; toBottom(true);
    let raf = 0; const paint = () => { raf = 0; if (cur === c) { fillBot(d, m, true); toBottom(); } };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
    ctrl = new AbortController(); kick();
    try {
      const r = await fetch(ep + '/api/chat', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ messages: history, tools: $('tools').checked, think: modeSel.value === 'think', mode, images: images || undefined, custom: customText() || undefined }) });
      if (!r.ok) throw new Error(r.status === 401 ? '접속 키가 올바르지 않아요. 연결 설정에서 키를 확인해 주세요.' : r.status === 429 ? '요청이 너무 많아요. 1분 뒤 다시 시도해 주세요.' : '서버 오류 ' + r.status);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break; kick();
        buf += dec.decode(value, { stream: true }); let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, k).trim(); buf = buf.slice(k + 2);
          if (!line.startsWith('data:')) continue; let e; try { e = JSON.parse(line.slice(5)); } catch { continue; }
          if (e.type === 'status') m.status = e.message;
          else if (e.type === 'delta') { m.content += e.text; m.status = ''; liveArt(m.content); }
          else if (e.type === 'thinking') { m.thinking += e.text; m.status = '생각 중…'; }
          else if (e.type === 'tool_call') { m.steps.push({ id: e.id, name: e.name, args: e.args }); m.content = ''; m.status = (TOOLS[e.name]?.[1] || e.name) + ' 사용 중…'; }
          else if (e.type === 'tool_result') { const s = m.steps.find(x => x.id === e.id); if (s) Object.assign(s, { done: true, results: e.results, text: e.text, data: e.data, title: e.title, url: e.url, error: e.error }); if (e.artifact) artifact = e.artifact; }
          else if (e.type === 'sources') m.sources = e.sources;
          else if (e.type === 'done') m.meta = `${e.mode === 'research' ? '딥 리서치 · ' : ''}${e.tokens} 토큰 · ${e.tok_s ?? '-'} tok/s · ${(e.ms / 1000).toFixed(1)}초`;
          else if (e.type === 'error') { const er = new Error(e.message); er.code = e.code; throw er; }
          schedule();
        }
      }
      if (!m.content.trim()) m.error = '빈 응답이 왔어요. 다시 생성해 보세요.';
    } catch (err) {
      if (timedOut) { m.meta = '시간 초과'; if (!m.content) m.error = `응답이 ${IDLE_MS / 60000}분 넘게 없어서 멈췄어요. 서버가 바쁘거나 꺼졌을 수 있어요. 잠시 뒤 다시 생성해 보세요.`; }
      else if (err.name === 'AbortError') m.meta = '중지됨';
      else if (err.code === 'model_down') m.error = '모델 서버가 꺼져 있어요. 자동으로 다시 켜는 중이니 1~2분 뒤 다시 시도해 주세요.';
      else if (!m.content) m.error = err.message === 'Failed to fetch' || err.name === 'TypeError' ? '서버에 연결할 수 없어요. 서버가 꺼져 있거나 주소가 바뀌었을 수 있어요. 연결 설정에서 주소를 확인하고, 상태 페이지(/status/)도 확인해 보세요.' : err.message;
      check();
    } finally {
      clearTimeout(idle); cancelAnimationFrame(raf); delete m.status; if (!m.thinking) delete m.thinking;
      if (artifact && !m.content.includes('```')) m.content += `\n\n\`\`\`${artifact.lang}\n${artifact.code}\n\`\`\``;
      if (artifact) setTimeout(() => openArt(artifact.code, artifact.lang), 50); m.steps.forEach(s => s.done = true);
      c.ts = Date.now(); persist(); setBusy(false); ctrl = null;
      if (cur === c) {
        renderAll();
        const blocks = [...$('msgs').lastElementChild.querySelectorAll('.cb')].filter(b => b.querySelector('[data-act=preview]'));
        if (blocks.length && !m.error) { const b = blocks[blocks.length - 1], code = b.querySelector('code').textContent; if (!isMobile() || !$('art').hidden) openArt(code, b.dataset.lang); else { arts.push({ code, lang: b.dataset.lang, name: artName(code, b.dataset.lang) }); art = arts[arts.length - 1]; $('art-toggle').hidden = false; $('art-toggle').classList.add('pulse'); } }
        else if (art?.live) { closeArt(); art = arts[arts.length - 1] || null; }
        if (localStorage.getItem(LS.auto) === '1' && m.content && !m.error) speak(m.content, null);
      }
    }
  }

  // ---------- PWA ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  // ---------- boot ----------
  $('ep').value = localStorage.getItem(LS.ep) || ''; $('key').value = localStorage.getItem(LS.key) || '';
  const last = localStorage.getItem(LS.cur); cur = convs.find(c => c.id === last && c.msgs.length) || null;
  if (isMobile()) app.classList.remove('side-hidden');
  window.addEventListener('load', () => { renderAll(); grow(); });
  drawMem(); renderAll(); grow();
  fetch('/config/endpoint.json', { cache: 'no-store' }).then(r => r.json()).then(j => { defaultEp = j.endpoint || ''; if (defaultEp) $('ep').placeholder = defaultEp; }).catch(() => {}).finally(check);
})();
