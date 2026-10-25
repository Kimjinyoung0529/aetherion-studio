/* AETHERION v0.19 — drawer redesign, Floating UI menus, AutoAnimate, NumberFlow, Shiki, Driver.js tour, voice conversation (SiriWave). All MIT. */
(function(){
  var d=document,w=window,$=function(i){return d.getElementById(i)};
  // extra Lucide icons (ISC)
  var X={'audio-lines':'<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    keyboard:'<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    'settings-2':'<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    'square-pen':'<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
    'panel-left':'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    activity:'<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    'phone-off':'<path d="M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473"/><path d="m2 2 20 20"/>',
    'mic-off':'<path d="M12 19v3"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M16.95 16.95A7 7 0 0 1 5 12v-2"/><path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/><path d="m2 2 20 20"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>'};
  function sprite(){var s=$('ae-sprite');if(!s)return setTimeout(sprite,50);var h='';for(var k in X)h+='<symbol id="i-'+k+'" viewBox="0 0 24 24">'+X[k]+'</symbol>';s.insertAdjacentHTML('beforeend',h);}
  var I=function(n){return w.AEIcon?w.AEIcon(n):''};
  function drawer(){
    var map={'side-close':'panel-left','side-open':'panel-left','new2':'square-pen'};
    for(var id in map){var b=$(id);if(b)b.innerHTML=I(map[id]);}
    var n=$('new');if(n)n.innerHTML=I('square-pen')+'<span>새 대화</span>';
    var sb=d.querySelector('.side-search svg');if(sb)sb.outerHTML=I('search');
    var f=[['open-settings','settings-2'],['theme',null],['news-link','newspaper'],['status-link','activity']];
    d.querySelectorAll('.side-foot .side-btn').forEach(function(b){var h=b.getAttribute('href')||'';var ic=b.id==='open-settings'?'settings-2':b.id==='theme'?(d.documentElement.dataset.theme==='dark'?'sun':'moon'):h.indexOf('news')>-1?'newspaper':h.indexOf('status')>-1?'activity':null;var s=b.querySelector('svg');if(ic&&s)s.outerHTML=I(ic);});
    d.body.classList.add('v19');
  }
  // Floating UI: position open popovers so they never clip (iPhone Safari edges)
  function floaters(){
    var F=w.FloatingUIDOM;if(!F)return;
    d.querySelectorAll('.pop-wrap > .pop').forEach(function(pop){
      var btn=pop.parentNode.querySelector('button'),clean=null;
      new MutationObserver(function(){
        if(pop.hidden){if(clean){clean();clean=null;}return;}
        pop.classList.add('fl');
        clean=F.autoUpdate(btn,pop,function(){F.computePosition(btn,pop,{strategy:'fixed',placement:pop.classList.contains('up')?'top-start':(pop.classList.contains('right')?'bottom-end':'bottom-start'),
          middleware:[F.offset(8),F.flip({padding:8}),F.shift({padding:8}),F.size({padding:8,apply:function(a){pop.style.maxHeight=Math.max(160,a.availableHeight)+'px';}})]}).then(function(r){pop.style.left=r.x+'px';pop.style.top=r.y+'px';});});
      }).observe(pop,{attributes:true,attributeFilter:['hidden']});
    });
  }
  function anim(){var A=w.AEAutoAnimate;if(!A||matchMedia('(prefers-reduced-motion: reduce)').matches)return;var c=$('convs');if(c)A(c,{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});var a=$('attach-row');if(a)A(a,{duration:180});}
  // NumberFlow: animate "N 토큰 · X tok/s" in finished answers
  function numbers(){
    if(!w.customElements||!customElements.get('number-flow'))return;
    var box=$('msgs');if(!box)return;var re=/^(.*?)(\d+) 토큰 · ([\d.]+) tok\/s(.*)$/;
    function up(){box.querySelectorAll('.meta').forEach(function(m){if(m.querySelector('number-flow'))return;var t=m.textContent,x=re.exec(t);if(!x||m.dataset.nf===t)return;m.dataset.nf=t;
      m.textContent='';m.append(x[1]);var a=d.createElement('number-flow'),b=d.createElement('number-flow');a.className='nf';b.className='nf';m.append(a,' 토큰 · ',b,' tok/s'+x[4]);
      b.format={maximumFractionDigits:1};requestAnimationFrame(function(){a.update(0);b.update(0);setTimeout(function(){a.update(+x[2]);b.update(+x[3]);},60);});});}
    var tm;new MutationObserver(function(){clearTimeout(tm);tm=setTimeout(up,250);}).observe(box,{childList:true,subtree:true,characterData:true});
    w.AENumberFlow=up;
  }
  // Shiki: re-highlight finished code blocks with VS Code grammars (light/dark via CSS vars)
  var LANGS={js:'javascript',javascript:'javascript',ts:'typescript',typescript:'typescript',py:'python',python:'python',html:'html',xml:'html',css:'css',json:'json',bash:'bash',sh:'bash',shell:'bash',zsh:'bash',sql:'sql',java:'java',c:'c',cpp:'cpp','c++':'cpp',go:'go',rust:'rust',rs:'rust',yaml:'yaml',yml:'yaml',md:'markdown',markdown:'markdown',jsx:'jsx',tsx:'tsx'};
  var hlP=null;
  function shiki(){
    var box=$('msgs');if(!box)return;
    function run(){
      if(w.AEPG&&w.AEPG.isBusy())return;
      var codes=[].slice.call(box.querySelectorAll('pre code:not([data-shiki])')).filter(function(c){var m=/language-([\w+-]+)/.exec(c.className);return m&&LANGS[m[1].toLowerCase()];});
      if(!codes.length)return;
      hlP=hlP||import('/assets/vendor/shiki.min.mjs').then(function(m){return m.getHL();});
      hlP.then(function(hl){codes.forEach(function(c){if(c.dataset.shiki)return;var lang=LANGS[/language-([\w+-]+)/.exec(c.className)[1].toLowerCase()];
        try{var html=hl.codeToHtml(c.textContent,{lang:lang,themes:{light:'github-light',dark:'github-dark'},defaultColor:false});var t=d.createElement('div');t.innerHTML=html;var nc=t.querySelector('code');if(!nc)return;c.innerHTML=nc.innerHTML;c.dataset.shiki='1';c.closest('pre').classList.add('shiki-on');}catch(e){c.dataset.shiki='x';}});w.AEStats&&(w.AEStats.shiki=true);}).catch(function(){});
    }
    var tm;new MutationObserver(function(){clearTimeout(tm);tm=setTimeout(run,700);}).observe(box,{childList:true,subtree:true});
    new MutationObserver(function(){if(!d.getElementById('form').classList.contains('busy')){clearTimeout(tm);tm=setTimeout(run,300);}}).observe($('form'),{attributes:true,attributeFilter:['class']});
    setTimeout(run,800);
  }
  // Driver.js: first-visit tour, shown once
  function tour(force){
    var D=w.driver&&w.driver.js&&w.driver.js.driver;if(!D)return;
    if(!force){try{if(localStorage.getItem('ae.tour19')||navigator.webdriver)return;}catch(e){return;}}
    var mob=matchMedia('(max-width: 820px)').matches;
    var steps=[{element:'#q',popover:{title:'여기에 물어보세요',description:'Enter로 보내고, / 로 명령어를 열 수 있어요.'}},
      {element:'#voice-mode',popover:{title:'음성 대화',description:'눌러서 말로 대화해요. 말하는 중에 화면을 누르면 끊고 다시 들어요.'}},
      {element:'#plus',popover:{title:'첨부와 도구',description:'이미지·파일 첨부, 이미지 생성, 가상 컴퓨터가 여기 있어요.'}},
      {element:mob?'#side-open':'#side',popover:{title:'대화 목록',description:'지난 대화, 검색, 설정, 테마 전환이 서랍 안에 있어요.'}}];
    var dr=D({showProgress:true,nextBtnText:'다음',prevBtnText:'이전',doneBtnText:'시작하기',progressText:'{{current}} / {{total}}',popoverClass:'ae-tour',steps:steps,onDestroyed:function(){try{localStorage.setItem('ae.tour19','1');}catch(e){}}});
    setTimeout(function(){dr.drive();},force?100:1200);
  }
  w.AETour=function(){tour(true);};
  // ---------- voice conversation ----------
  function voice(){
    var btn=$('voice-mode');if(!btn)return;
    var SR=w.SpeechRecognition||w.webkitSpeechRecognition;
    var ov=d.createElement('div');ov.className='vc';ov.hidden=true;ov.setAttribute('role','dialog');ov.setAttribute('aria-label','음성 대화');
    ov.innerHTML='<div class="vc-card"><div class="vc-top"><span class="vc-badge">'+I('audio-lines')+' 음성 대화</span><button class="vc-x" type="button" aria-label="닫기">'+I('x')+'</button></div>'+
      '<div class="vc-orb" role="button" tabindex="0" aria-label="말하기 / 끊기"><div class="vc-glow"></div><div class="vc-wave"></div></div>'+
      '<p class="vc-state" aria-live="polite">눌러서 시작</p><p class="vc-said"></p>'+
      '<div class="vc-bar"><button class="vc-b vc-mute" type="button" aria-label="마이크 끄기">'+I('mic')+'</button><button class="vc-b vc-end" type="button" aria-label="대화 끝내기">'+I('phone-off')+'</button></div>'+
      '<p class="vc-note">목소리: 서버 음성 합성 · 응답이 느리면 기기 음성으로 대신 읽어요</p></div>';
    d.body.appendChild(ov);
    var st=ov.querySelector('.vc-state'),said=ov.querySelector('.vc-said'),orb=ov.querySelector('.vc-orb'),wave=null,ac=null,an=null,micStream=null,micAn=null;
    var on=false,muted=false,phase='idle',rec=null,playing=null,abortTTS=null,raf=0;
    function setPhase(p,msg){phase=p;ov.dataset.phase=p;st.textContent=msg;}
    function level(a){if(!a)return 0;var b=new Uint8Array(a.fftSize);a.getByteTimeDomainData(b);var s=0;for(var i=0;i<b.length;i++){var v=(b[i]-128)/128;s+=v*v;}return Math.sqrt(s/b.length);}
    function loop(){raf=requestAnimationFrame(loop);var l=phase==='speaking'?.04+.03*Math.sin(Date.now()/120):phase==='listening'?lv:0;var amp=phase==='thinking'?.5:Math.min(3,.25+l*12);
      if(wave){wave.setAmplitude(amp);wave.setSpeed(phase==='thinking'?.12:.2);}orb.style.setProperty('--lv',Math.min(1,l*6).toFixed(3));}
    var lv=0;
    function ensureAudio(){ // inside the tap: unlock the shared HTMLAudioElement (iOS)
      w.AEAudio&&w.AEAudio.unlock('rec');
      if(!wave&&w.SiriWave){wave=new w.SiriWave({container:ov.querySelector('.vc-wave'),style:'ios9',width:240,height:120,amplitude:.3,speed:.2,autostart:true,cover:true});}
    }
    function listen(){
      if(!on)return;if(muted)return setPhase('muted','마이크 꺼짐 · 눌러서 켜기');
      if(!w.AESTT){setPhase('idle','이 브라우저는 음성 인식을 지원하지 않아요');return;}
      said.textContent='';lv=0;
      rec=w.AESTT.listen({onStart:function(){setPhase('listening','듣고 있어요');},onBusy:function(){setPhase('thinking','받아 적는 중');},onLevel:function(l){lv=l;},onPartial:function(t){said.textContent=t;}});
      var me=rec;
      me.promise.then(function(t){if(rec===me)rec=null;if(!on||me.aborted)return;if(t){said.textContent=t;ask(t);}else setPhase('idle','말소리가 들리지 않았어요 · 눌러서 다시 말하기');})
        .catch(function(e){if(rec===me)rec=null;if(on)setPhase('idle',(e&&e.message)||'음성 인식 오류 · 눌러서 다시');});
    }
    function lastBot(){var a=d.querySelectorAll('#msgs .msg.bot .md');return a.length?a[a.length-1]:null;}
    function ask(text){
      setPhase('thinking','생각 중');var q=$('q');q.value=text;q.dispatchEvent(new Event('input'));
      var before=lastBot();$('form').requestSubmit();
      var t0=Date.now(),seenBusy=false,iv=setInterval(function(){
        if(!on){clearInterval(iv);return;}var busy=$('form').classList.contains('busy');if(busy)seenBusy=true;
        if((seenBusy&&!busy)||Date.now()-t0>180000||(!seenBusy&&Date.now()-t0>8000)){clearInterval(iv);var m=lastBot();speakAll(m&&m!==before?m.innerText:(m?m.innerText:''));}
      },300);
    }
    function tts(text,sig){return w.AEAudio.tts(text,sig);}
    function play(blob){playing={stop:function(){w.AEAudio.stop();}};return w.AEAudio.playBlob(blob).then(function(){playing=null;});}
    function fallback(t){return new Promise(function(ok){var S=w.speechSynthesis;if(!S)return ok();var u=new SpeechSynthesisUtterance(t);u.lang='ko-KR';u.onend=u.onerror=function(){ok();};playing={stop:function(){S.cancel();ok();}};S.speak(u);});}
    function speakAll(text){
      if(!on)return;var parts=(w.AEPG.chunks(text||'')||[]).slice(0,12);if(!parts.length)return listen();
      if(w.AEAudio&&w.AEAudio.isIOS&&w.AESTT)w.AESTT.release();var ctl=new AbortController();abortTTS=ctl;setPhase('speaking','말하는 중 · 눌러서 끊기');var useFb=false;
      var queue=parts.map(function(){return null;});function fetchAt(i){if(i<parts.length&&!queue[i])queue[i]=tts(parts[i],ctl.signal).catch(function(){useFb=true;return null;});return queue[i];}
      (function next(i){if(!on||ctl.signal.aborted)return;if(i>=parts.length){abortTTS=null;return listen();}
        fetchAt(i);fetchAt(i+1);
        (useFb?Promise.resolve(null):queue[i]).then(function(buf){if(!on||ctl.signal.aborted)return;return buf?play(buf):fallback(parts[i]);}).then(function(){next(i+1);});})(0);
    }
    function interrupt(){if(abortTTS){abortTTS.abort();abortTTS=null;}if(playing){try{playing.stop();}catch(e){}playing=null;}try{w.speechSynthesis&&w.speechSynthesis.cancel();}catch(e){}}
    function open(){ensureAudio();on=true;ov.hidden=false;d.body.classList.add('vc-open');said.textContent='';if(!raf)loop();w.AEPG&&w.AEPG.stopSpeak();listen();}
    function close(){on=false;interrupt();if(rec){try{rec.abort();}catch(e){}rec=null;}w.AESTT&&w.AESTT.release();cancelAnimationFrame(raf);raf=0;ov.hidden=true;d.body.classList.remove('vc-open');setPhase('idle','눌러서 시작');btn.focus();}
    btn.addEventListener('click',open);
    ov.querySelector('.vc-x').onclick=close;ov.querySelector('.vc-end').onclick=close;
    ov.querySelector('.vc-mute').onclick=function(){ensureAudio();muted=!muted;this.innerHTML=I(muted?'mic-off':'mic');this.classList.toggle('on',muted);if(muted){if(rec){try{rec.abort();}catch(e){}rec=null;}setPhase('muted','마이크 꺼짐 · 눌러서 켜기');}else if(phase==='muted')listen();};
    function tapOrb(){ensureAudio();if(phase==='speaking'){interrupt();listen();}else if(phase==='idle'||phase==='muted'){muted=false;listen();}else if(phase==='listening'&&rec){try{rec.stop();}catch(e){}}else if(phase==='thinking'&&!rec){}}
    orb.addEventListener('click',tapOrb);orb.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();tapOrb();}});
    d.addEventListener('keydown',function(e){if(e.key==='Escape'&&on)close();});
    w.AEVoice={open:open,close:close,state:function(){return phase;}};
  }
  function init(){sprite();setTimeout(function(){drawer();floaters();anim();numbers();shiki();voice();tour(/[?&]tour=1/.test(location.search));},0);}
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',init);else init();
})();
