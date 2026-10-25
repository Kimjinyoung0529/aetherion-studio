// v0.15 interactive layer: scroll reveal, pointer spotlight, pipeline explorer, token stream, context slider, WebGPU probe
(() => { if (window.__ae15) return; window.__ae15 = 1;
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = document.querySelectorAll('.sec h2, .panel, .feat, .paper, .prod, .road>div, .sc-card, .stat');
  if (!RM && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el, i) => { if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('rv'); el.style.transitionDelay = (i % 4) * 60 + 'ms'; io.observe(el); } });
  }
  document.querySelectorAll('.panel, .feat, .paper, .prod, .sc-card').forEach(el => el.classList.add('spot'));
  addEventListener('pointermove', e => { const t = e.target.closest?.('.spot'); if (!t) return; const r = t.getBoundingClientRect(); t.style.setProperty('--mx', e.clientX - r.left + 'px'); t.style.setProperty('--my', e.clientY - r.top + 'px'); }, { passive: true });
  const P = document.getElementById('pipe'); if (!P) return;
  const D = { route: '질문이 들어오면 작은 라우터 모델(270M)이 먼저 읽고, 도구가 필요한지 0.2~0.4초 안에 판단해요. 확신이 없으면 메인 모델에 넘겨요.', tool: '필요하면 웹 검색 · 뉴스 · 날씨 · 환율 · 가상 컴퓨터 같은 도구를 병렬로 불러요. 검색은 여러 출처를 동시에 묻고 상위 페이지를 읽어요.', model: '메인 모델이 32K 토큰 문맥 안에서 대화와 도구 결과를 함께 읽고 답을 만들어요. 반복되는 표현은 n-gram 추측 디코딩으로 더 빨리 써요.', stream: '토큰이 만들어지는 대로 화면에 흘려보내요. 탭을 닫거나 다른 앱으로 가도 서버는 답을 끝까지 만들어 두고, 돌아오면 이어서 보여줘요.', cite: '사용한 출처를 번호로 달고, 답 아래에 다음에 물어볼 만한 질문을 제안해요.' };
  const desc = document.getElementById('pipe-desc');
  P.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; P.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); desc.textContent = D[b.dataset.k]; });
  // token stream demo (illustrative, runs locally — no server call)
  const T = document.getElementById('tok'), meta = document.getElementById('tok-meta');
  const words = '서울은 오늘 오후부터 맑아지고, 낮 최고 기온은 19도예요. 바람이 조금 불어서 얇은 겉옷을 챙기면 좋아요.'.split(' ');
  let timer = 0;
  const play = () => { clearInterval(timer); T.textContent = ''; let i = 0; const t0 = performance.now();
    if (RM) { T.innerHTML = words.map(w => `<span>${w} </span>`).join(''); meta.textContent = `${words.length} 조각 · 예시`; return; }
    timer = setInterval(() => { if (i >= words.length) { clearInterval(timer); return; } const s = document.createElement('span'); s.textContent = words[i++] + ' '; T.appendChild(s); const sec = (performance.now() - t0) / 1000; meta.innerHTML = `<span>${i} 조각</span><span>${(i / Math.max(sec, .05)).toFixed(0)} tok/s · 예시 재생</span>`; }, 55); };
  document.getElementById('tok-play').onclick = play;
  new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { play(); o.disconnect(); } }).observe(T);
  // context window slider
  const bar = document.getElementById('ctx-bar'), rng = document.getElementById('ctx-r'), out = document.getElementById('ctx-o');
  bar.innerHTML = '<i></i>'.repeat(32);
  const ctx = () => { const k = +rng.value; [...bar.children].forEach((x, j) => x.classList.toggle('on', j < k)); out.textContent = `${(k * 1024).toLocaleString()} 토큰`; };
  rng.oninput = ctx; ctx();
  // WebGPU probe
  const g = document.getElementById('gpu');
  (async () => { let ok = false, name = ''; try { const a = await navigator.gpu?.requestAdapter(); ok = !!a; name = a?.info?.vendor || ''; } catch {} g.querySelector('.dot15').classList.toggle('ok', ok); g.querySelector('span:last-child').textContent = ok ? `이 브라우저는 WebGPU를 지원해요${name ? ' · ' + name : ''}` : '이 브라우저에서는 WebGPU를 쓸 수 없어요 (CPU 경로로 동작)'; })();
})();
