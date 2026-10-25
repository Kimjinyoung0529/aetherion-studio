/* AETHERION v0.20–0.22 - Safari-safe audio output and speech input */
(function(){
  var w=window,d=document,nav=navigator;
  var ua=nav.userAgent||'';
  var isIOS=/iP(hone|ad|od)/.test(ua)||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
  var isSafari=/Safari/.test(ua)&&!/Chrome|CriOS|Chromium|Edg|FxiOS|Android/.test(ua);
  var SR=w.SpeechRecognition||w.webkitSpeechRecognition;
  /* ---------- output: one HTMLAudioElement (plays even with the silent switch on) ---------- */
  /* v0.21: real 0.2s silent WAV (iOS refused the old 1-sample clip, so the element never unlocked) */
  function mkSilent(){var n=4800,buf=new ArrayBuffer(44+n*2),v=new DataView(buf),o=0;function S(t){for(var i=0;i<t.length;i++)v.setUint8(o++,t.charCodeAt(i));}function U32(x){v.setUint32(o,x,true);o+=4;}function U16(x){v.setUint16(o,x,true);o+=2;}
    S('RIFF');U32(36+n*2);S('WAVE');S('fmt ');U32(16);U16(1);U16(1);U32(24000);U32(48000);U16(2);U16(16);S('data');U32(n*2);
    var bin='',u=new Uint8Array(buf);for(var i=0;i<u.length;i++)bin+=String.fromCharCode(u[i]);return 'data:audio/wav;base64,'+btoa(bin);}
  var SILENT=mkSilent();
  var el=null,url=null,unlocked=false,stopCb=null,ctx=null,src=null,tapEl=null;
  function audio(){if(!el){el=new Audio();el.setAttribute('playsinline','');el.setAttribute('webkit-playsinline','');el.preload='auto';el.id='ae-audio';el.style.display='none';(d.body||d.documentElement).appendChild(el);}return el;}
  /* v0.22: 'playback' blocks the microphone on iOS, so it is only used for read-aloud; capture switches to 'play-and-record' */
  var micWanted=false;
  function session(t){try{if(nav.audioSession&&nav.audioSession.type!==t)nav.audioSession.type=t;}catch(e){}}
  function unlock(mode){ /* call synchronously inside a tap; mode 'rec' = a mic tap */
    if(mode==='rec')micWanted=true;
    session(micWanted?'play-and-record':'playback'); /* iOS 17+: playback plays through the silent switch */
    try{var C=w.AudioContext||w.webkitAudioContext;if(C){if(!ctx)ctx=new C();if(ctx.state!=='running')ctx.resume();var bs=ctx.createBufferSource();bs.buffer=ctx.createBuffer(1,1,22050);bs.connect(ctx.destination);bs.start(0);}}catch(e){}
    var a=audio();if(unlocked&&!a.paused)return;
    try{a.muted=false;a.volume=1;a.src=SILENT;var p=a.play();if(p&&p.then)p.then(function(){unlocked=true;}).catch(function(e){console.warn('[audio] unlock',e&&e.name);});else unlocked=true;}catch(e){}
  }
  function viaContext(blob){ /* fallback path: Web Audio (context was resumed during the tap) */
    if(!ctx||ctx.state!=='running')return Promise.reject(new Error('ctx'));
    return blob.arrayBuffer().then(function(ab){return new Promise(function(ok,no){ctx.decodeAudioData(ab,ok,no);});}).then(function(buf){
      return new Promise(function(ok){src=ctx.createBufferSource();src.buffer=buf;src.connect(ctx.destination);var fin=function(){src=null;stopCb=null;ok();};src.onended=fin;stopCb=fin;src.start(0);});
    });
  }
  function askTap(blob){ /* last resort: visible button so the play() happens inside a real tap */
    return new Promise(function(ok){
      if(tapEl)tapEl.remove();tapEl=d.createElement('button');tapEl.type='button';tapEl.className='ae-tap-play';tapEl.textContent='눌러서 듣기';
      tapEl.style.cssText='position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;padding:12px 22px;border-radius:999px;border:1px solid rgba(127,127,127,.3);background:rgba(20,20,24,.86);color:#fff;font:600 15px/1 inherit;-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)';
      var fin=function(){if(tapEl){tapEl.remove();tapEl=null;}stopCb=null;ok();};stopCb=fin;
      tapEl.onclick=function(){var t=tapEl;tapEl=null;t.remove();unlock();var a=audio();a.onended=a.onerror=function(){a.onended=a.onerror=null;stopCb=null;ok();};stopCb=function(){a.onended=a.onerror=null;stopCb=null;ok();};a.src=url;var p=a.play();if(p&&p.catch)p.catch(function(){stopCb&&stopCb();});};
      d.body.appendChild(tapEl);
    });
  }
  function playBlob(blob){
    var a=audio();if(url)URL.revokeObjectURL(url);
    if(!/^audio\//.test(blob.type||''))blob=new Blob([blob],{type:'audio/wav'});
    url=URL.createObjectURL(blob);
    return new Promise(function(ok){
      var settled=false,started=false;
      var done=function(){if(settled)return;settled=true;a.onended=a.onerror=a.onplaying=null;stopCb=null;ok();};
      var fail=function(why){if(settled||started)return done();settled=true;a.onended=a.onerror=a.onplaying=null;console.warn('[audio] element failed:',why);
        viaContext(blob).catch(function(){return askTap(blob);}).then(ok,ok);};
      a.onplaying=function(){started=true;};a.onended=done;a.onerror=function(){fail('error '+(a.error&&a.error.code));};stopCb=done;
      a.src=url;var p=a.play();if(p&&p.catch)p.catch(function(e){fail(e&&e.name);});
    });
  }
  function stop(){var a=el;if(a){try{a.pause();}catch(e){}}try{src&&src.stop();}catch(e){}if(tapEl){tapEl.remove();tapEl=null;}if(stopCb)stopCb();}
  function ttsFetch(text,sig){var P=w.AEPG;return fetch(P.endpoint()+'/api/tts',{method:'POST',signal:sig,headers:{'Content-Type':'application/json',Authorization:'Bearer '+P.key()},body:JSON.stringify({text:text,lang:'ko'})}).then(function(r){if(!r.ok)throw new Error('tts '+r.status);return r.blob();});}
  w.AEAudio={version:'0.22',unlock:unlock,playBlob:playBlob,stop:stop,tts:ttsFetch,el:audio,isIOS:isIOS,isSafari:isSafari};

  /* ---------- input: Web Speech first (Chrome), server STT for Safari or on failure ---------- */
  var SR_MSG={'not-allowed':'마이크 권한이 꺼져 있어요. 설정 > Safari > 마이크에서 허용해 주세요.','service-not-allowed':'기기 음성 인식이 꺼져 있어요. 서버 음성 인식으로 바꿔서 들을게요.','audio-capture':'마이크를 찾을 수 없어요.','no-speech':'말소리가 들리지 않았어요.'};
  var forceServer=isSafari||!SR||/[?&]stt=server/.test(location.search);
  function pickMime(){var M=w.MediaRecorder;if(!M||!M.isTypeSupported)return '';var c=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'];for(var i=0;i<c.length;i++)if(M.isTypeSupported(c[i]))return c[i];return '';}
  /* Record until ~1.2s of silence after speech, max 15s. getUserMedia must be first called in a tap. */
  var stream=null;
  function getMic(){micWanted=true;session('play-and-record');if(stream&&stream.active)return Promise.resolve(stream);return nav.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}).then(function(s){stream=s;return s;});}
  function releaseMic(){micWanted=false;if(stream){stream.getTracks().forEach(function(t){t.stop();});stream=null;}}
  function micErr(e){var n=(e&&e.name)||'Error',m={NotAllowedError:'마이크 권한이 막혀 있어요. 설정 > 앱 > Safari > 마이크, 또는 주소창 aA > 웹 사이트 설정 > 마이크에서 허용해 주세요.',NotFoundError:'마이크를 찾을 수 없어요.',NotReadableError:'다른 앱이 마이크를 쓰고 있어요. 통화나 녹음 앱을 닫고 다시 눌러 주세요.',InvalidStateError:'오디오 상태 때문에 마이크를 열지 못했어요. 한 번 더 눌러 주세요.',SecurityError:'보안 설정 때문에 마이크를 열지 못했어요.'};var x=new Error((m[n]||'마이크를 열 수 없어요.')+' ('+n+')');x.code=n;return x;}
  function serverListen(o){
    o=o||{};var ctl={stopped:false,stop:function(){ctl.stopped=true;if(rec&&rec.state==='recording')rec.stop();},abort:function(){ctl.aborted=true;ctl.stop();}};var rec=null,ac=null;
    ctl.promise=new Promise(function(ok,no){
      if(!nav.mediaDevices||!w.MediaRecorder)return no(new Error('이 브라우저는 녹음을 지원하지 않아요'));
      getMic().then(function(s){
        if(ctl.stopped)return ok('');
        var mime=pickMime();try{rec=mime?new MediaRecorder(s,{mimeType:mime}):new MediaRecorder(s);}catch(e){rec=new MediaRecorder(s);}
        var chunks=[];rec.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data);};
        var C=w.AudioContext||w.webkitAudioContext,an=null,heard=false,quietSince=0,t0=Date.now(),iv=0;
        try{ac=new C();an=ac.createAnalyser();an.fftSize=1024;ac.createMediaStreamSource(s).connect(an);if(ac.state==='suspended')ac.resume();}catch(e){an=null;}
        var buf=an?new Uint8Array(an.fftSize):null;
        iv=setInterval(function(){
          var now=Date.now();if(now-t0>(o.max||15000))return ctl.stop();
          if(!an)return;an.getByteTimeDomainData(buf);var sum=0;for(var i=0;i<buf.length;i++){var v=(buf[i]-128)/128;sum+=v*v;}var l=Math.sqrt(sum/buf.length);o.onLevel&&o.onLevel(l);
          if(l>0.035){heard=true;quietSince=0;}else if(heard){if(!quietSince)quietSince=now;else if(now-quietSince>1200)ctl.stop();}
          else if(now-t0>(o.idle||8000))ctl.stop();
        },60);
        rec.onstop=function(){
          clearInterval(iv);try{ac&&ac.close();}catch(e){}if(o.release)releaseMic();
          if(ctl.aborted||!chunks.length||(an&&!heard))return ok('');
          o.onBusy&&o.onBusy();
          var blob=new Blob(chunks,{type:rec.mimeType||mime||'audio/mp4'}),P=w.AEPG;
          fetch(P.endpoint()+'/api/stt',{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream',Authorization:'Bearer '+P.key()},body:blob})
            .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||('stt '+r.status));return j;});})
            .then(function(j){ok(String(j.text||'').trim());}).catch(no);
        };
        rec.start(250);o.onStart&&o.onStart();
      }).catch(function(e){console.warn('[mic]',e&&e.name,e&&e.message);if(e&&e.name==='InvalidStateError'&&!o._retry){o._retry=1;releaseMic();var r2=serverListen(o);ctl.stop=r2.stop;ctl.abort=r2.abort;return r2.promise.then(ok,no);}no(micErr(e));});
    });
    return ctl;
  }
  function webListen(o){
    o=o||{};var r=new SR(),fin='',ctl={stop:function(){try{r.stop();}catch(e){}},abort:function(){ctl.aborted=true;try{r.abort();}catch(e){}}};
    r.lang='ko-KR';r.interimResults=true;r.continuous=false;
    ctl.promise=new Promise(function(ok,no){
      var err=null;
      r.onresult=function(ev){var t='';for(var i=0;i<ev.results.length;i++)t+=ev.results[i][0].transcript;fin=t;o.onPartial&&o.onPartial(t);};
      r.onerror=function(ev){err=ev.error;};
      r.onend=function(){if(ctl.aborted)return ok('');if(err&&err!=='no-speech'&&err!=='aborted'){var e=new Error(SR_MSG[err]||('음성 인식 오류: '+err));e.code=err;return no(e);}ok(fin.trim());};
      r.start();o.onStart&&o.onStart(); /* synchronous: must stay inside the tap */
    });
    return ctl;
  }
  /* listen(): returns controller with .promise -> text. Falls back to the server on any Web Speech failure. */
  function listen(o){
    o=o||{};
    if(!forceServer&&SR){
      var c;try{c=webListen(o);}catch(e){forceServer=true;return serverListen(o);}
      var outer={stop:function(){c.stop();},abort:function(){c.abort();}};
      outer.promise=c.promise.catch(function(e){if(e.code==='not-allowed'&&!o.retry)throw e;forceServer=true;var s=serverListen(o);outer.stop=s.stop;outer.abort=s.abort;return s.promise;});
      return outer;
    }
    return serverListen(o);
  }
  w.AESTT={listen:listen,release:releaseMic,mode:function(){return forceServer?'server':'web';}};

  /* ---------- composer mic button ---------- */
  function micButton(){
    var b=d.getElementById('mic'),q=d.getElementById('q');if(!b||!q)return;
    var nb=b.cloneNode(true);nb.hidden=!(SR||(nav.mediaDevices&&w.MediaRecorder));b.parentNode.replaceChild(nb,b); /* drop old handler */
    var cur=null;
    function toast(m){(w.AEToast||function(x){console.log(x);})(m);}
    nb.addEventListener('click',function(){
      if(cur){cur.stop();return;}
      unlock('rec');var base=q.value?q.value+' ':'';
      nb.classList.add('on');
      cur=listen({release:true,onStart:function(){toast('듣고 있어요. 말이 끝나면 자동으로 멈춰요');},onBusy:function(){toast('받아 적는 중이에요');},onPartial:function(t){q.value=base+t;q.dispatchEvent(new Event('input'));}});
      cur.promise.then(function(t){if(t){q.value=base+t;q.dispatchEvent(new Event('input'));q.focus();}else toast('말소리가 들리지 않았어요');})
        .catch(function(e){toast(e.message||'음성 인식 오류');})
        .then(function(){cur=null;nb.classList.remove('on');});
    });
  }
  function init(){micButton();}
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',init);else init();
})();
