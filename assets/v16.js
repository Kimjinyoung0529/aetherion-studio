/* AETHERION v0.16 — theme, flowing glow, liquid glass (vanilla port of the SVG displacement idea from rdev/liquid-glass-react, MIT). */
(function(){
  var d=document,root=d.documentElement,KEY='ae.theme';
  var mq=matchMedia('(prefers-color-scheme: dark)');
  function sys(){return mq.matches?'dark':'light';}
  if(!root.dataset.theme){var st=null;try{st=localStorage.getItem(KEY);}catch(e){}root.dataset.theme=st||sys();}
  mq.addEventListener&&mq.addEventListener('change',function(){var st=null;try{st=localStorage.getItem(KEY);}catch(e){}if(!st){root.dataset.theme=sys();meta();}});
  function meta(){var m=d.querySelector('meta[name=theme-color]');if(m)m.content=root.dataset.theme==='dark'?'#0b0b0d':'#ffffff';}
  var isSite=d.body&&d.body.classList.contains('s');
  function glow(host,cls){var g=d.createElement('div');g.className=cls;g.setAttribute('aria-hidden','true');g.innerHTML='<i></i><i></i>';host.insertBefore(g,host.firstChild);return g;}
  // displacement map: edges refract inward, center flat (128px canvas, generated once)
  function lgFilter(){
    var ua=navigator.userAgent;if(!/Chrome\//.test(ua)||/Edg\/|OPR\//.test(ua)&&false)return false;
    try{var c=d.createElement('canvas'),n=128;c.width=c.height=n;var x=c.getContext('2d'),im=x.createImageData(n,n);
      for(var j=0;j<n;j++)for(var i=0;i<n;i++){var u=i/(n-1)*2-1,v=j/(n-1)*2-1,e=Math.max(Math.abs(u),Math.abs(v)),k=Math.pow(Math.max(0,(e-.72)/.28),2);
        var p=(j*n+i)*4;im.data[p]=128-u*k*127;im.data[p+1]=128-v*k*127;im.data[p+2]=128;im.data[p+3]=255;}
      x.putImageData(im,0,0);var url=c.toDataURL();
      var s=d.createElement('div');s.innerHTML='<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="ae-lg-filter" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feImage href="'+url+'" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="28" xChannelSelector="R" yChannelSelector="G"/></filter></svg>';
      d.body.appendChild(s.firstChild);return true;}catch(e){return false;}
  }
  function init(){
    meta();
    var refr=lgFilter();
    if(isSite){
      glow(d.body,'ae-glow');
      var nav=d.querySelector('.hdr .nav');
      if(nav){nav.classList.add('lg');if(refr)nav.classList.add('lg-refract');
        var b=d.createElement('button');b.type='button';b.className='th-tg';b.setAttribute('aria-label','라이트/다크 테마 전환');
        b.innerHTML=(window.AEIcon?AEIcon('moon','i-moon')+AEIcon('sun','i-sun'):'');
        b.addEventListener('click',function(){var t=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=t;try{localStorage.setItem(KEY,t);}catch(e){}meta();});
        var menu=nav.querySelector('.mmenu');nav.insertBefore(b,menu||null);}
      d.querySelectorAll('.prod,.sc-card,.stat,.lab,.paper,.feat').forEach(function(el){el.classList.add('lg');});
    }else{
      var comp=d.querySelector('.composer');if(comp){comp.classList.add('lg');if(refr)comp.classList.add('lg-refract');}
      d.querySelectorAll('header.top,.side-search').forEach(function(el){el.classList.add('lg');});
      var sc=d.querySelector('main');if(sc&&getComputedStyle(sc).position==='static')sc.style.position='relative';
      if(sc){var g=glow(sc,'pg-glow');}
    }

    // frame governor: sample ~1.5s; if the device can't hold ~55fps with the moving glow, freeze it (static glow, still pretty)
    var lite=false;try{lite=localStorage.getItem('ae.lite')==='1';}catch(e){}
    if(lite)root.classList.add('ae-lite');
    else if(!matchMedia('(prefers-reduced-motion: reduce)').matches){setTimeout(function(){var n=0,t0=0;function f(t){if(!t0)t0=t;n++;if(t-t0<1500)requestAnimationFrame(f);else{var fps=1000*(n-1)/(t-t0);if(fps<55&&!d.hidden){root.classList.add('ae-lite');}}}requestAnimationFrame(f);},1200);}
    // pause animation when tab hidden or offscreen
    function vis(){root.classList.toggle('ae-paused',d.hidden);}d.addEventListener('visibilitychange',vis);vis();
  }
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',init);else init();
})();
