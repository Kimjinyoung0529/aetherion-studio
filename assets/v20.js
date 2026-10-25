/* AETHERION v0.20 - Safari-safe audio output and speech input */
(function(){
  var w=window,d=document,nav=navigator;
  var ua=nav.userAgent||'';
  var isIOS=/iP(hone|ad|od)/.test(ua)||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
  var isSafari=/Safari/.test(ua)&&!/Chrome|CriOS|Chromium|Edg|FxiOS|Android/.test(ua);
  var SR=w.SpeechRecognition||w.webkitSpeechRecognition;
  /* ---------- output: one HTMLAudioElement (plays even with the silent switch on) ---------- */
  var SILENT='data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==';
  var el=null,url=null,unlocked=false,stopCb=null;
  function audio(){if(!el){el=new Audio();el.setAttribute('playsinline','');el.preload='auto';el.id='ae-audio';}return el;}
  function unlock(){ /* call synchronously inside a tap */
    var a=audio();if(unlocked&&!a.paused)return;
    try{a.muted=false;a.src=SILENT;var p=a.play();if(p&&p.then)p.then(function(){unlocked=true;}).catch(function(){});}catch(e){}
  }
  function playBlob(blob){
    return new Promise(function(ok){
      var a=audio();if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);
      var done=function(){a.onended=a.onerror=null;stopCb=null;ok();};
      a.onended=done;a.onerror=done;stopCb=done;a.src=url;
      var p=a.play();if(p&&p.catch)p.catch(function(){done();});
    });
  }
  function stop(){var a=el;if(a){try{a.pause();}catch(e){}}if(stopCb)stopCb();}
  function ttsFetch(text,sig){var P=w.AEPG;return fetch(P.endpoint()+'/api/tts',{method:'POST',signal:sig,headers:{'Content-Type':'application/json',Authorization:'Bearer '+P.key()},body:JSON.stringify({text:text,lang:'ko'})}).then(function(r){if(!r.ok)throw new Error('tts '+r.status);return r.blob();});}
  w.AEAudio={unlock:unlock,playBlob:playBlob,stop:stop,tts:ttsFetch,el:audio,isIOS:isIOS,isSafari:isSafari};

  /* ---------- input: Web Speech first (Chrome), server STT for Safari or on failure ---------- */
  var SR_MSG={'not-allowed':'마이크 권한이 꺼져 있어요. 설정 > Safari > 마이크에서 허용해 주세요.','service-not-allowed':'기기 음성 인식이 꺼져 있어요. 서버 음성 인식으로 바꿔서 들을게요.','audio-capture':'마이크를 찾을 수 없어요.','no-speech':'말소리가 들리지 않았어요.'};
  var forceServer=isSafari||!SR||/[?&]stt=server/.test(location.search);
  function pickMime(){var M=w.MediaRecorder;if(!M||!M.isTypeSupported)return '';var c=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'];for(var i=0;i<c.length;i++)if(M.isTypeSupported(c[i]))return c[i];return '';}
  /* Record until ~1.2s of silence after speech, max 15s. getUserMedia must be first called in a tap. */
  var stream=null;
  function getMic(){if(stream&&stream.active)return Promise.resolve(stream);return nav.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}).then(function(s){stream=s;return s;});}
  function releaseMic(){if(stream){stream.getTracks().forEach(function(t){t.stop();});stream=null;}}
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
      }).catch(function(e){no(new Error(e&&e.name==='NotAllowedError'?'마이크 권한이 꺼져 있어요. 설정 > Safari > 마이크에서 허용해 주세요.':'마이크를 열지 못했어요'));});
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
      unlock();var base=q.value?q.value+' ':'';
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
