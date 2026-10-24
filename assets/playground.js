// AETHERION Playground v2: conversations, markdown, tool timeline, sandboxed artifact preview.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const LS = { ep: 'ae.endpoint', key: 'ae.key', hist: 'ae.history', convs: 'ae.convs', cur: 'ae.current', theme: 'ae.theme', tools: 'ae.tools' };
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
    datetime: ['🕒', '날짜·시간'], wikipedia: ['📚', '위키백과'], convert: ['💱', '변환'],
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
  function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), 1600); }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast('복사했어요'); if (btn) { const h = btn.innerHTML; btn.innerHTML = btn.innerHTML.replace(/<svg[\s\S]*?<\/svg>/, ICON.check); setTimeout(() => btn.innerHTML = h, 1200); }
  }
  const scroller = $('scroll'); let stick = true;
  scroller.addEventListener('scroll', () => { stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80; });
  const toBottom = force => { if (force || stick) scroller.scrollTop = scroller.scrollHeight; };

  // ---------- markdown ----------
  let mdReady = false;
  function setupMd() {
    if (mdReady || !window.marked) return; mdReady = true;
    const r = new marked.Renderer();
    r.code = (code, lang) => {
      const l = (lang || '').trim().split(/\s/)[0].toLowerCase();
      const runnable = ['html', 'svg', 'xml'].includes(l) && /<(html|body|div|svg|canvas|script|style|!doctype)/i.test(code);
      return `<div class="cb" data-lang="${esc(l)}"><div class="cb-h"><span class="lang">${esc(l || 'text')}</span>${runnable ? `<button type="button" class="run" data-act="preview">${ICON.play}미리보기</button>` : ''}<button type="button" data-act="copy-code">${ICON.copy}복사</button></div><pre><code class="${l ? 'language-' + esc(l) : ''}">${esc(code)}</code></pre></div>`;
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
    return DOMPurify.sanitize(marked.parse(t), { ADD_ATTR: ['target', 'data-act', 'data-lang'], FORBID_TAGS: ['style', 'iframe', 'form', 'input'] });
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
    } else {
      d.innerHTML = `<div class="av" aria-hidden="true">A</div><div class="bot-col"><div class="steps"></div><div class="status"></div><div class="md"></div><div class="srcs"></div><div class="acts"><button type="button" data-act="copy" title="복사" aria-label="복사">${ICON.copy}</button><button type="button" data-act="regen" title="다시 생성" aria-label="다시 생성">${ICON.redo}</button><span class="meta"></span></div></div>`;
      fillBot(d, m, false);
    }
    return d;
  }
  function fillBot(d, m, streaming) {
    d.querySelector('.steps').innerHTML = (m.steps || []).map(stepHtml).join('');
    const body = d.querySelector('.md');
    if (m.error) body.innerHTML = `<div class="err-box">⚠️ ${esc(m.error)}</div>`;
    else { body.innerHTML = md(m.content || '', m.sources, streaming); body.classList.toggle('cursor', !!streaming); }
    if (!streaming) { decorateArtifacts(body); highlight(body); }
    d.querySelector('.srcs').innerHTML = streaming ? '' : srcHtml(m.sources);
    d.querySelector('.meta').textContent = m.meta || '';
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
  function openArt(code, lang) {
    art = { code, lang: lang || 'html' };
    $('art').hidden = false; $('art-toggle').hidden = false;
    $('art-title').textContent = (code.match(/<title>([^<]{1,60})<\/title>/i)?.[1] || 'artifact') + '.' + (art.lang === 'svg' ? 'svg' : 'html');
    const c = $('art-code').firstChild; c.textContent = code; c.className = 'language-' + (art.lang === 'svg' ? 'xml' : 'html'); if (window.hljs) { c.removeAttribute('data-highlighted'); try { hljs.highlightElement(c); } catch {} }
    tab('preview'); runArt();
  }
  function runArt() { if (art) $('art-frame').srcdoc = wrapDoc(art.code, art.lang); }
  function tab(t) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('art-code').hidden = t !== 'code'; $('art-frame').hidden = t === 'code';
  }
  function closeArt() { $('art').hidden = true; $('art').classList.remove('full'); $('art-frame').srcdoc = ''; }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
  $('art-reload').onclick = runArt;
  $('art-copy').onclick = e => art && copy(art.code, e.currentTarget);
  $('art-dl').onclick = () => { if (!art) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([art.lang === 'svg' ? art.code : wrapDoc(art.code)], { type: art.lang === 'svg' ? 'image/svg+xml' : 'text/html' })); a.download = $('art-title').textContent; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  $('art-tab').onclick = () => {
    if (!art) return; const w = window.open('', '_blank'); if (!w) return toast('팝업이 차단됐어요');
    w.document.write('<!doctype html><title>AETHERION 미리보기</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style><iframe sandbox="allow-scripts allow-modals allow-pointer-lock"></iframe>');
    w.document.close(); w.document.querySelector('iframe').srcdoc = wrapDoc(art.code, art.lang);
  };
  $('art-full').onclick = () => { const p = $('art'); if (p.requestFullscreen && !isMobile()) { document.fullscreenElement ? document.exitFullscreen() : p.requestFullscreen().catch(() => p.classList.toggle('full')); } else p.classList.toggle('full'); };
  $('art-close').onclick = closeArt;
  $('art-toggle').onclick = () => $('art').hidden ? (art ? openArt(art.code, art.lang) : 0) : closeArt();

  // ---------- message actions ----------
  $('msgs').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const msgDiv = b.closest('.msg'), i = +msgDiv?.dataset.i, m = cur?.msgs[i];
    const act = b.dataset.act;
    if (act === 'copy-code') return copy(b.closest('.cb').querySelector('code').textContent, b);
    if (act === 'preview') { const cb = b.classList.contains('art-card') ? b.nextElementSibling : b.closest('.cb'); return openArt(cb.querySelector('code').textContent, cb.dataset.lang); }
    if (!m) return;
    if (act === 'copy') return copy(m.content, b);
    if (act === 'regen' && !busy) { cur.msgs.splice(i); renderAll(); return run(); }
    if (act === 'edit' && !busy) {
      const bub = msgDiv.querySelector('.bub'); const box = document.createElement('div'); box.className = 'edit-box'; box.style.width = '100%';
      box.innerHTML = `<textarea></textarea><div><button type="button" class="btn sm" data-e="no">취소</button><button type="button" class="btn sm primary" data-e="ok">보내기</button></div>`;
      box.querySelector('textarea').value = m.content; bub.replaceWith(box); msgDiv.querySelector('.acts').hidden = true; box.querySelector('textarea').focus();
      box.onclick = ev => { const k = ev.target.dataset.e; if (k === 'no') renderAll(); if (k === 'ok') { const v = box.querySelector('textarea').value.trim(); if (!v) return; cur.msgs.splice(i); cur.msgs.push({ role: 'user', content: v }); renderAll(); run(); } };
    }
  });

  // ---------- conversations ----------
  function select(c) { if (busy) ctrl?.abort(); cur = c; localStorage.setItem(LS.cur, c?.id || ''); closeArt(); renderAll(); closeSide(); }
  function newChat() { if (busy) ctrl?.abort(); cur = null; closeArt(); renderAll(); closeSide(); $('q').focus(); }
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
  $('tools').checked = localStorage.getItem(LS.tools) !== '0';
  $('tools').onchange = () => localStorage.setItem(LS.tools, $('tools').checked ? '1' : '0');

  async function check() {
    const ep = endpoint();
    if (!ep) return setStatus('bad', '서버 주소가 없어요');
    setStatus('wait', '연결 확인 중…');
    try {
      const j = await (await fetch(ep + '/health', { signal: AbortSignal.timeout(8000) })).json();
      if (!j.llm) return setStatus('wait', '모델 준비 중');
      setStatus('ok', j.busy ? '응답 중' + (j.queue ? ` · 대기 ${j.queue}` : '') : '온라인' + (j.tools ? ` · 도구 ${j.tools.length}개` : ''));
    } catch { setStatus('bad', '오프라인 (서버 꺼짐 또는 주소 변경)'); }
  }

  // ---------- composer ----------
  const q = $('q');
  const grow = () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 220) + 'px'; $('send').disabled = !busy && !q.value.trim(); };
  q.addEventListener('input', grow);
  let composing = false;
  q.addEventListener('compositionstart', () => composing = true);
  q.addEventListener('compositionend', () => setTimeout(() => composing = false, 0));
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !composing && e.keyCode !== 229 && !isMobile()) { e.preventDefault(); $('form').requestSubmit(); }
  });
  $('form').addEventListener('submit', e => { e.preventDefault(); if (busy) return ctrl?.abort(); const t = q.value.trim(); if (!t) return; q.value = ''; grow(); ask(t); });
  document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => ask(b.dataset.q)));
  function setBusy(v) { busy = v; $('form').classList.toggle('busy', v); $('send').setAttribute('aria-label', v ? '중지' : '전송'); grow(); }

  function ask(text) {
    if (busy) return;
    const c = conv(); if (!c.msgs.length) c.title = titleOf(text);
    c.msgs.push({ role: 'user', content: text }); c.ts = Date.now(); persist(); renderAll(); run();
  }

  // ---------- streaming ----------
  async function run() {
    const ep = endpoint(), key = $('key').value.trim(), c = cur;
    if (!key) { setStatus('bad', '접속 키를 입력해 주세요'); return openSettings(); }
    setBusy(true);
    const m = { role: 'assistant', content: '', steps: [], sources: [], status: '연결 중…' };
    const history = c.msgs.map(({ role, content }) => ({ role, content }));
    c.msgs.push(m); const i = c.msgs.length - 1;
    const d = msgEl(m, i); $('msgs').appendChild(d); $('empty').hidden = true; toBottom(true);
    let raf = 0; const paint = () => { raf = 0; if (cur === c) { fillBot(d, m, true); toBottom(); } };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
    ctrl = new AbortController();
    try {
      const r = await fetch(ep + '/api/chat', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ messages: history, tools: $('tools').checked }) });
      if (!r.ok) throw new Error(r.status === 401 ? '접속 키가 올바르지 않아요. 연결 설정에서 키를 확인해 주세요.' : r.status === 429 ? '요청이 너무 많아요. 1분 뒤 다시 시도해 주세요.' : '서버 오류 ' + r.status);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, k).trim(); buf = buf.slice(k + 2);
          if (!line.startsWith('data:')) continue; let e; try { e = JSON.parse(line.slice(5)); } catch { continue; }
          if (e.type === 'status') m.status = e.message;
          else if (e.type === 'delta') { m.content += e.text; m.status = ''; }
          else if (e.type === 'tool_call') { m.steps.push({ id: e.id, name: e.name, args: e.args }); m.content = ''; m.status = (TOOLS[e.name]?.[1] || e.name) + ' 사용 중…'; }
          else if (e.type === 'tool_result') { const s = m.steps.find(x => x.id === e.id); if (s) Object.assign(s, { done: true, results: e.results, text: e.text, data: e.data, title: e.title, url: e.url, error: e.error }); }
          else if (e.type === 'sources') m.sources = e.sources;
          else if (e.type === 'done') m.meta = `${e.tokens} 토큰 · ${e.tok_s ?? '-'} tok/s · ${(e.ms / 1000).toFixed(1)}초`;
          else if (e.type === 'error') throw new Error(e.message);
          schedule();
        }
      }
      if (!m.content.trim()) m.error = '빈 응답이 왔어요. 다시 생성해 보세요.';
    } catch (err) {
      if (err.name === 'AbortError') m.meta = '중지됨';
      else if (!m.content) m.error = err.message === 'Failed to fetch' || err.name === 'TypeError' ? '서버에 연결할 수 없어요. 연결 설정에서 주소를 확인하거나 브라우저 WebGPU 채팅을 써보세요.' : err.message;
      check();
    } finally {
      cancelAnimationFrame(raf); delete m.status; m.steps.forEach(s => s.done = true);
      c.ts = Date.now(); persist(); setBusy(false); ctrl = null;
      if (cur === c) {
        renderAll();
        const blocks = [...$('msgs').lastElementChild.querySelectorAll('.cb')].filter(b => b.querySelector('[data-act=preview]'));
        if (blocks.length && !m.error) { const b = blocks[blocks.length - 1]; openArt(b.querySelector('code').textContent, b.dataset.lang); }
      }
    }
  }

  // ---------- boot ----------
  $('ep').value = localStorage.getItem(LS.ep) || ''; $('key').value = localStorage.getItem(LS.key) || '';
  const last = localStorage.getItem(LS.cur); cur = convs.find(c => c.id === last && c.msgs.length) || null;
  if (isMobile()) app.classList.remove('side-hidden');
  window.addEventListener('load', () => { renderAll(); grow(); });
  renderAll(); grow();
  fetch('/config/endpoint.json', { cache: 'no-store' }).then(r => r.json()).then(j => { defaultEp = j.endpoint || ''; if (defaultEp) $('ep').placeholder = defaultEp; }).catch(() => {}).finally(check);
})();
