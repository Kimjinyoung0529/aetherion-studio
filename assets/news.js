/* AETHERION v4 shared script for /news/, /news/post/, /patch-notes/, /status/, /share/ and the home "최근 소식" strip. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getPosts = () => fetch('/content/index.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw Error(r.status); return r.json(); }).then(j => j.posts);
  const fail = el => { el.innerHTML = '<p class="muted">소식을 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</p>'; };
  const card = (p, h = 'h2') => `<a class="pcard" href="${esc(p.url)}"><span class="tag ${esc(p.type)}">${esc(p.type_label)}</span><time datetime="${esc(p.date)}">${esc(p.date)}</time><${h}>${esc(p.title)}</${h}><p>${esc(p.summary)}</p></a>`;

  // home strip
  const ns = $('ns-list');
  if (ns) getPosts().then(ps => { ns.innerHTML = ps.slice(0, 3).map(p => `<a class="ns-item" href="${esc(p.url)}"><span class="tag ${esc(p.type)}">${esc(p.type_label)}</span><b>${esc(p.title)}</b><time datetime="${esc(p.date)}">${esc(p.date)}</time></a>`).join(''); }).catch(() => {});

  // lists
  const list = $('post-list');
  if (list) getPosts().then(ps => {
    if (list.dataset.list === 'patch-full') {
      const pp = ps.filter(p => p.type === 'patch');
      list.innerHTML = pp.map(p => `<article class="patch" id="${esc(p.version || p.slug)}"><time datetime="${esc(p.date)}">${esc(p.date)}</time><h2><a href="${esc(p.url)}">${esc(p.title)}</a></h2><div class="post-body">${p.html}</div></article>`).join('') || '<p class="muted">아직 패치 노트가 없어요.</p>';
      return;
    }
    let type = new URLSearchParams(location.search).get('type') || 'all';
    const draw = () => {
      document.querySelectorAll('.ntab').forEach(b => { const on = b.dataset.type === type; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      const f = ps.filter(p => type === 'all' || p.type === type);
      list.innerHTML = f.map(p => card(p)).join('') || '<p class="muted">아직 글이 없어요.</p>';
    };
    document.querySelectorAll('.ntab').forEach(b => b.addEventListener('click', () => { type = b.dataset.type; history.replaceState(null, '', type === 'all' ? location.pathname : '?type=' + type); draw(); }));
    draw();
  }).catch(() => fail(list));

  // single post
  if ($('post')) getPosts().then(ps => {
    const slug = new URLSearchParams(location.search).get('p'); const p = ps.find(x => x.slug === slug);
    if (!p) { $('post-title').textContent = '글을 찾을 수 없어요'; $('post-body').innerHTML = '<p><a href="/news/">소식 목록으로 돌아가기</a></p>'; return; }
    document.title = p.title + ' | AETHERION AI';
    $('post-title').textContent = p.title;
    $('post-meta').innerHTML = `<span class="tag ${esc(p.type)}">${esc(p.type_label)}</span><time datetime="${esc(p.date)}">${esc(p.date)}</time>`;
    $('post-body').innerHTML = p.html; // generated from repo markdown by tools/build_content.mjs (escaped)
  }).catch(() => fail($('post-body')));

  // status
  if ($('st-card')) {
    const set = (cls, main, sub) => { $('st-dot').className = 'dot ' + cls; $('st-main').textContent = main; $('st-sub').textContent = sub || ''; };
    const fmtUp = s => s >= 86400 ? Math.floor(s / 86400) + '일 ' + Math.floor(s % 86400 / 3600) + '시간' : s >= 3600 ? Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분' : Math.floor(s / 60) + '분';
    let ep = '';
    const tick = async () => {
      try {
        if (!ep) { const c = await fetch('/config/endpoint.json', { cache: 'no-cache' }).then(r => r.json()); ep = (localStorage.getItem('ae.endpoint') || c.endpoint || '').replace(/\/+$/, ''); $('st-ep').textContent = ep || '-'; }
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
        let r = await fetch(ep + '/status', { signal: ctl.signal, cache: 'no-store' }); if (r.status === 404) r = await fetch(ep + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t); if (!r.ok) throw Error('HTTP ' + r.status);
        const j = await r.json();
        if (j.llm) set('ok', '정상 운영 중', '모델이 응답할 준비가 됐어요.');
        else set('wait', '모델 서버 꺼짐 · 자동 재시작 중', '보통 1~2분 안에 다시 켜져요.');
        const rows = [['모델', j.model || 'Kanana 1.5 15.7B-A3B'], ['모델 상태', j.model_status || (j.llm ? 'ok' : 'down')], ['가동 시간', j.uptime_s != null ? fmtUp(j.uptime_s) : '-'], ['최근 속도', j.tok_s_recent ? j.tok_s_recent + ' tok/s' : '-'], ['대기 중 요청', j.queue ?? '-'], ['처리한 요청', j.requests ?? '-'], ['오류', j.errors ?? '-'], ['버전', j.version ? 'v' + j.version : '-']];
        $('st-grid').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
      } catch (e) { set('bad', '서버에 연결할 수 없어요', '서버가 꺼져 있거나 주소가 바뀌었을 수 있어요. (' + (e.name === 'AbortError' ? '시간 초과' : e.message) + ')'); $('st-grid').innerHTML = ''; }
      $('st-time').textContent = new Date().toLocaleTimeString('ko-KR');
    };
    tick(); setInterval(tick, 30000);
  }

  // shared conversation (#z<base64url deflate-raw json> or #j<base64url json>)
  if ($('sh-msgs')) (async () => {
    const box = $('sh-msgs');
    try {
      const h = location.hash.slice(1); if (!h) { box.innerHTML = '<p class="muted">공유 링크에 대화가 없어요. 플레이그라운드에서 공유 버튼으로 링크를 만들어 보세요.</p>'; return; }
      const b64 = h.slice(1).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      let bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      if (h[0] === 'z') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      const d = JSON.parse(new TextDecoder().decode(bytes));
      $('sh-title').textContent = (d.t || '공유된 대화').slice(0, 120); document.title = $('sh-title').textContent + ' | AETHERION AI';
      const body = c => esc(c).replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, code) => `<pre><code>${code}</code></pre>`);
      box.innerHTML = (d.m || []).map(m => `<div class="smsg ${m.r === 'u' ? 'u' : 'a'}"><b class="who">${m.r === 'u' ? '나' : 'AETHERION'}</b>${body(m.c)}${m.s?.length ? '<ol>' + m.s.map(s => /^https?:\/\//.test(s.u) ? `<li><a href="${esc(s.u)}" rel="noopener nofollow" target="_blank">${esc(s.t || s.u)}</a></li>` : '').join('') + '</ol>' : ''}</div>`).join('');
    } catch (e) { box.innerHTML = '<p class="muted">링크가 손상됐거나 너무 길어서 대화를 열 수 없어요.</p>'; }
  })();
})();
