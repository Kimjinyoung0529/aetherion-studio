// AETHERION playground: talks to the Kanana agent proxy (SSE over fetch).
(() => {
  const $ = id => document.getElementById(id);
  const LS = { ep: 'ae.endpoint', key: 'ae.key', hist: 'ae.history' };
  let defaultEp = '', history = [], busy = false, ctrl = null;
  try { history = JSON.parse(localStorage.getItem(LS.hist) || '[]'); } catch {}
  const endpoint = () => ($('ep').value.trim() || defaultEp).replace(/\/+$/, '');
  const setStatus = (cls, txt) => { $('dot').className = 'k-dot ' + cls; $('stxt').textContent = txt; };
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const linkify = (s, srcs) => esc(s).replace(/\[(\d+)\]/g, (m, n) => { const x = srcs[+n - 1]; return x ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">[${n}]</a>` : m; });

  async function check() {
    const ep = endpoint();
    if (!ep) return setStatus('bad', '서버 주소가 없어요');
    setStatus('wait', '연결 확인 중…');
    try {
      const r = await fetch(ep + '/health', { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (!j.llm) return setStatus('wait', '서버는 켜졌지만 모델 준비 중');
      setStatus('ok', `연결됨 · ${j.busy ? '응답 중' : '대기'}${j.queue ? ` · 대기열 ${j.queue}` : ''}`);
    } catch { setStatus('bad', '서버에 연결할 수 없어요 (꺼져 있거나 주소가 바뀌었어요)'); }
  }

  function addMsg(role, text) {
    $('empty')?.remove();
    const d = document.createElement('div'); d.className = 'k-msg ' + role;
    if (role === 'user') d.innerHTML = `<span class="k-bub"></span>`, d.firstChild.textContent = text;
    else d.innerHTML = `<div class="k-stat-line"></div><div class="k-steps"></div><div class="k-body"></div><div class="k-src"></div><div class="k-meta"></div>`;
    $('msgs').appendChild(d); $('msgs').scrollTop = 1e9; return d;
  }
  function render() { for (const m of history) { const d = addMsg(m.role, m.content); if (m.role === 'assistant') d.querySelector('.k-body').innerHTML = linkify(m.content, m.sources || []); } }

  async function send(text) {
    if (busy || !text.trim()) return;
    const ep = endpoint(), key = $('key').value.trim();
    if (!key) { $('side').classList.add('open'); return setStatus('bad', '접속 키를 먼저 입력해 주세요'); }
    busy = true; $('send').textContent = '중지';
    history.push({ role: 'user', content: text }); addMsg('user', text);
    const d = addMsg('bot'), body = d.querySelector('.k-body'), st = d.querySelector('.k-stat-line'), steps = d.querySelector('.k-steps');
    let out = '', sources = [], tools = {};
    ctrl = new AbortController();
    try {
      const r = await fetch(ep + '/api/chat', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), tools: $('tools').checked }) });
      if (!r.ok) { let m = r.status === 401 ? '접속 키가 올바르지 않아요.' : r.status === 429 ? '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' : '서버 오류 ' + r.status; throw new Error(m); }
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
          if (!line.startsWith('data:')) continue; const e = JSON.parse(line.slice(5));
          if (e.type === 'status') st.textContent = e.message;
          else if (e.type === 'delta') { out += e.text; body.textContent = out; st.textContent = ''; }
          else if (e.type === 'tool_call') {
            const det = document.createElement('details'); det.className = 'k-tool'; det.open = true;
            det.innerHTML = `<summary>${e.name === 'web_search' ? '🔎 웹검색' : '📄 페이지 읽기'}: ${esc(e.args.query || e.args.url || '')}</summary><ol></ol>`;
            steps.appendChild(det); tools[e.id] = det; out = ''; body.textContent = '';
          } else if (e.type === 'tool_result') {
            const det = tools[e.id], ol = det?.querySelector('ol'); if (!ol) continue;
            if (e.error) ol.innerHTML = `<li>오류: ${esc(e.error)}</li>`;
            else if (e.results) ol.innerHTML = e.results.length ? e.results.map(x => `<li value="${x.n}"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join('') : '<li>결과 없음</li>';
            else ol.innerHTML = `<li value="${e.n}">${esc(e.text || '')}…</li>`;
            det.open = false;
          } else if (e.type === 'sources') {
            sources = e.sources;
            d.querySelector('.k-src').innerHTML = sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">[${s.n}] ${esc(s.title)}</a>`).join('');
          } else if (e.type === 'done') d.querySelector('.k-meta').textContent = `${e.tokens} 토큰 · ${e.tok_s ?? '-'} tok/s · ${(e.ms / 1000).toFixed(1)}초`;
          else if (e.type === 'error') throw new Error(e.message);
          $('msgs').scrollTop = 1e9;
        }
      }
      body.innerHTML = linkify(out, sources);
      history.push({ role: 'assistant', content: out, sources });
      localStorage.setItem(LS.hist, JSON.stringify(history.slice(-30)));
    } catch (err) {
      st.textContent = ''; body.textContent = err.name === 'AbortError' ? (out || '') + ' (중지됨)' : '⚠️ ' + (err.message === 'Failed to fetch' ? '서버에 연결할 수 없어요. 서버 주소를 확인하거나 브라우저 WebGPU 채팅을 써보세요.' : err.message);
      if (out) history.push({ role: 'assistant', content: out }); else history.pop();
      check();
    } finally { busy = false; ctrl = null; $('send').textContent = '전송'; }
  }

  $('form').addEventListener('submit', ev => { ev.preventDefault(); if (busy) return ctrl?.abort(); const t = $('q').value; $('q').value = ''; send(t); });
  $('q').addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); $('form').requestSubmit(); } });
  document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => send(b.dataset.q)));
  $('save').addEventListener('click', () => { localStorage.setItem(LS.ep, $('ep').value.trim()); localStorage.setItem(LS.key, $('key').value.trim()); $('side').classList.remove('open'); check(); });
  $('clear').addEventListener('click', () => { history = []; localStorage.removeItem(LS.hist); location.reload(); });
  $('menu').addEventListener('click', () => $('side').classList.toggle('open'));
  $('ep').value = localStorage.getItem(LS.ep) || ''; $('key').value = localStorage.getItem(LS.key) || '';
  render();
  fetch('/config/endpoint.json', { cache: 'no-store' }).then(r => r.json()).then(j => { defaultEp = j.endpoint || ''; $('ep').placeholder = defaultEp || $('ep').placeholder; }).catch(() => {}).finally(check);
})();
