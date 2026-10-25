/* AETHERION v0.18 — Paper Shaders mesh background (Apache-2.0), Motion springs (MIT), Lenis smooth scroll (MIT). */
(function(){
  var d=document,root=d.documentElement,w=window;
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse=matchMedia('(pointer: coarse)').matches;
  var isSite=d.body&&d.body.classList.contains('s');
  var PAL={light:['#ffffff','#dbe6ff','#efe1fb','#ffe3e6','#d9f1ff'],dark:['#0b0b0d','#1c2a52','#35204a','#4a1f2a','#0f3346']};
  w.AEStats={mesh:'off',speed:0,lenis:false,motion:false};
  function mesh(){
    var P=w.AEPaper;if(!P)return;
    var host=d.createElement('div');host.className='ae-mesh';host.setAttribute('aria-hidden','true');
    if(isSite)d.body.insertBefore(host,d.body.firstChild);else{var m=d.querySelector('main');if(!m)return;host.classList.add('in-main');m.insertBefore(host,m.firstChild);}
    function cols(){var t=root.dataset.theme==='dark'?'dark':'light';return PAL[t].map(P.getShaderColorFromString);}
    var base=reduce?0:0.18,sm;
    try{
      sm=new P.ShaderMount(host,P.meshGradientFragmentShader,{u_colors:cols(),u_colorsCount:5,u_distortion:.8,u_swirl:.35,u_grainMixer:0,u_grainOverlay:0,
        u_fit:P.ShaderFitOptions.cover,u_scale:1,u_rotation:0,u_originX:.5,u_originY:.5,u_offsetX:0,u_offsetY:0,u_worldWidth:0,u_worldHeight:0},
        {alpha:false,premultipliedAlpha:false,antialias:false,powerPreference:'low-power'},base,0,1,960*540);
    }catch(e){host.remove();return;}
    if(!host.querySelector('canvas')){host.remove();return;}
    root.classList.add('ae-mesh-on');w.AEStats.mesh='on';w.AEStats.speed=base;
    new MutationObserver(function(){sm.setUniforms({u_colors:cols()});}).observe(root,{attributes:true,attributeFilter:['data-theme']});
    var throttled=false;
    function vis(){var s=d.hidden||throttled?0:base;sm.setSpeed(s);w.AEStats.speed=s;}
    d.addEventListener('visibilitychange',vis);
    // governor: if the device can't hold ~50fps while the mesh flows, freeze it (still a static gradient)
    if(base)setTimeout(function(){var n=0,t0=0;function f(t){if(!t0)t0=t;n++;if(t-t0<1500)requestAnimationFrame(f);else{var fps=1000*(n-1)/(t-t0);w.AEStats.probeFps=Math.round(fps);if(fps<50&&!d.hidden){throttled=true;w.AEStats.mesh='throttled';vis();}}}requestAnimationFrame(f);},1500);
  }
  function springs(){
    var M=w.Motion;if(!M||reduce)return;w.AEStats.motion=true;
    var sp={type:'spring',stiffness:260,damping:26,mass:.9};
    if(isSite){
      var els=[].slice.call(d.querySelectorAll('.prod,.sc-card,.stat,.lab,.paper,.feat'));
      els.forEach(function(el){el.style.opacity='0';el.style.transform='translateY(14px)';});
      var done=new WeakSet();
      M.inView(els,function(el){if(done.has(el))return;done.add(el);M.animate(el,{opacity:[0,1],transform:['translateY(14px)','translateY(0px)']},sp);},{amount:.15});
      setTimeout(function(){els.forEach(function(el){if(!done.has(el)){var r=el.getBoundingClientRect();if(r.top<innerHeight){done.add(el);el.style.opacity='';el.style.transform='';}}});},2500);
    }else{
      var box=d.querySelector('.scroll');if(!box)return;
      new MutationObserver(function(recs){
        var added=[];recs.forEach(function(r){r.addedNodes.forEach(function(n){if(n.nodeType===1&&n.classList.contains('msg'))added.push(n);});});
        if(added.length===0||added.length>2)return; // full re-render (load/switch) -> no animation
        added.forEach(function(n){M.animate(n,{opacity:[0,1],transform:['translateY(10px) scale(.985)','translateY(0px) scale(1)']},sp);});
      }).observe(box,{childList:true,subtree:true});
    }
  }
  function smooth(){
    if(!isSite||reduce||coarse||!w.Lenis)return;
    d.querySelectorAll('pre,.tw,[style*="overflow"]').forEach(function(el){el.setAttribute('data-lenis-prevent','');});
    try{w.AELenis=new w.Lenis({autoRaf:true,lerp:.12,smoothWheel:true});w.AEStats.lenis=true;}catch(e){}
  }
  function init(){mesh();springs();smooth();}
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',init);else init();
})();
