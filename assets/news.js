/* AETHERION v4 shared script for /news/, /news/post/, /patch-notes/, /status/, /share/ and the home "최근 소식" strip. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getPosts = () => fetch('/content/index.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw Error(r.status); return r.json(); }).then(j => j.posts);
  const fail = el => { el.innerHTML = '<p class="muted">소식을 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</p>'; };
  const card = (p, h = 'h2') => `<a class="pcard${p.pinned ? ' pinned' : ''}" href="${esc(p.url)}">${p.pinned ? '<span class="tag pin">고정</span>' : ''}<span class="tag ${esc(p.type)}">${esc(p.type_label)}</span><time datetime="${esc(p.date)}">${esc(p.date)}</time><${h}>${esc(p.title)}</${h}><p>${esc(p.summary)}</p></a>`;

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

  // status — probes every path in config/endpoint.json (Funnel primary + runlocal fallback)
  if ($('st-card')) {
    const set = (cls, main, sub) => { $('st-dot').className = 'dot ' + cls; $('st-main').textContent = main; $('st-sub').textContent = sub || ''; };
    const fmtUp = s => s >= 86400 ? Math.floor(s / 86400) + '일 ' + Math.floor(s % 86400 / 3600) + '시간' : s >= 3600 ? Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분' : Math.floor(s / 60) + '분';
    const shortHost = u => { try { return new URL(u).host; } catch { return u; } };
    let paths = [];
    let preferred = '';
    const classify = (label, url, i) => {
      const L = (label || '').toLowerCase();
      if (/funnel|기본|tailscale/.test(L) || /\.ts\.net$/i.test(url)) return 'primary';
      if (/runlocal|예비|fallback/.test(L) || /runlocal\.eu/i.test(url)) return 'fallback';
      return i === 0 ? 'primary' : 'fallback';
    };
    const kindLabel = k => k === 'primary' ? '기본 · Funnel' : '예비 · runlocal';
    const probeOne = async (url) => {
      const t0 = performance.now();
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      try {
        let r = await fetch(url + '/status', { signal: ctl.signal, cache: 'no-store' });
        if (r.status === 404) r = await fetch(url + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (!r.ok) throw Error('HTTP ' + r.status);
        const j = await r.json();
        return { ok: true, ms: Math.round(performance.now() - t0), j };
      } catch (e) {
        clearTimeout(t);
        return { ok: false, ms: Math.round(performance.now() - t0), err: e.name === 'AbortError' ? '시간 초과' : (e.message || '오류') };
      }
    };
    const renderPaths = (results) => {
      const box = $('st-paths'); if (!box) return;
      box.innerHTML = paths.map((p, i) => {
        const r = results[i] || {};
        const cls = r.ok ? 'ok' : (r.err ? 'bad' : 'wait');
        const state = r.ok ? (r.ms + 'ms') : (r.err || '확인 전');
        const role = kindLabel(p.kind);
        const using = preferred === p.url ? '<em class="st-using">사용 중</em>' : '';
        return `<li class="st-path ${cls}"><span class="dot ${cls}"></span><div class="st-path-body"><b>${esc(p.label || role)}</b><small class="st-path-role">${esc(role)}</small><code class="st-path-host">${esc(shortHost(p.url))}</code></div><span class="st-path-ms">${esc(state)}</span>${using}</li>`;
      }).join('');
    };
    const tick = async () => {
      try {
        if (!paths.length) {
          const c = await fetch('/config/endpoint.json', { cache: 'no-cache' }).then(r => r.json());
          const raw = (c.endpoints && c.endpoints.length) ? c.endpoints : [{ url: c.endpoint, label: '기본' }];
          paths = raw.map((e, i) => {
            const url = String(e.url || '').replace(/\/+$/, '');
            return { url, label: e.label || '', kind: classify(e.label, url, i) };
          }).filter(p => /^https:\/\//.test(p.url));
          preferred = (localStorage.getItem('ae.endpoint') || c.endpoint || (paths[0] && paths[0].url) || '').replace(/\/+$/, '');
          if ($('st-ep')) $('st-ep').textContent = preferred || '-';
        }
        const results = await Promise.all(paths.map(p => probeOne(p.url)));
        renderPaths(results);
        const primaryIdx = paths.findIndex(p => p.kind === 'primary');
        const pick = (primaryIdx >= 0 && results[primaryIdx] && results[primaryIdx].ok) ? primaryIdx : results.findIndex(r => r.ok);
        const primaryOk = primaryIdx >= 0 && results[primaryIdx] && results[primaryIdx].ok;
        const anyOk = results.some(r => r.ok);
        const fallbackOk = paths.some((p, i) => p.kind === 'fallback' && results[i] && results[i].ok);
        if (primaryOk) set('ok', '정상 운영 중', '기본 경로(Funnel)가 응답해요.' + (fallbackOk ? ' 예비 경로도 준비돼 있어요.' : ' 예비 경로는 지금 응답하지 않아요.'));
        else if (anyOk) set('wait', '예비 경로로 연결 중', '기본 경로(Funnel)가 응답하지 않아 예비(runlocal)를 쓰고 있어요. 플레이그라운드는 자동으로 넘어가요.');
        else set('bad', '서버에 연결할 수 없어요', '기본·예비 경로 모두 응답하지 않아요. 주소가 바뀌었거나 서버가 꺼져 있을 수 있어요.');
        if (pick >= 0) {
          const j = results[pick].j || {};
          if (j.llm === false) set('wait', '모델 서버 꺼짐 · 자동 재시작 중', '연결 경로는 살아 있지만 모델이 꺼져 있어요. 보통 1~2분 안에 다시 켜져요.');
          const rows = [['모델', j.model || 'Gemma 4 26B-A4B'], ['모델 상태', j.model_status || (j.llm ? 'ok' : 'down')], ['가동 시간', j.uptime_s != null ? fmtUp(j.uptime_s) : '-'], ['최근 속도', j.tok_s_recent ? j.tok_s_recent + ' tok/s' : '-'], ['대기 중 요청', j.queue ?? '-'], ['처리한 요청', j.requests ?? '-'], ['오류', j.errors ?? '-'], ['버전', j.version ? 'v' + j.version : '-']];
          $('st-grid').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
        } else {
          $('st-grid').innerHTML = '';
        }
      } catch (e) {
        set('bad', '서버에 연결할 수 없어요', '설정(config/endpoint.json)을 읽지 못했거나 네트워크 오류예요. (' + (e.message || e) + ')');
        $('st-grid').innerHTML = '';
        if ($('st-paths')) $('st-paths').innerHTML = '<li class="muted">경로를 확인하지 못했어요.</li>';
      }
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
