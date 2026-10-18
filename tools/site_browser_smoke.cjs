/* AETHERION whole-site Chromium smoke test (viewport + real DOM interaction).
 * Runs without loading any AI model weights. Does not test GPU shader correctness.
 * Requires playwright-core (provided by site-quality.yml) and Chromium/Chrome.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pwPath=process.env.PW_CORE_DIR;
if(!pwPath)throw Error('PW_CORE_DIR env is required');
const {chromium}=require(pwPath);
const host='http://127.0.0.1:8765';
const cases=[
 ['/', '홈페이지'],['/chat/','AI 채팅'],['/agent/','에이전트'],
 ['/runtime/','로컬 실행기'],['/runtime/experiments/','커널 실험'],['/lab/','Native Lab'],
 ['/lab/ternary/','Ternary'],['/lab/bonsai/','Bonsai'],
 ['/lab/generate/','Generator 0.3'],['/lab/generate/v4/','Generator 0.4'],
 ['/legacy/','Legacy']
];
(async()=>{
 const browser=await chromium.launch({
  headless:true,executablePath:process.env.BROWSER_EXECUTABLE,
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
 });
 const failures=[];
 try{
  fs.mkdirSync('browser-smoke-screenshots',{recursive:true});
  for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:820},locale:'ko-KR',deviceScaleFactor:1});
   for(const [route,label] of cases){
    const page=await context.newPage();
    const errors=[],resourceErrors=[];
    page.on('pageerror',e=>errors.push(String(e.message)));
    page.on('response',r=>{
     if(r.url().startsWith(host)&&r.status()>=400)resourceErrors.push(r.status()+' '+r.url().slice(host.length));
    });
    try{
     const res=await page.goto(host+route,{waitUntil:'domcontentloaded',timeout:20000});
     if(!res||res.status()!==200)throw Error('HTML request failed: '+res?.status());
     const result=await page.evaluate(()=>{
      const body=document.body;
      const all=[...document.querySelectorAll('*')];
      const tooWide=all.filter(el=>{
       const r=el.getBoundingClientRect();
       return r.width>0 && (r.right>innerWidth+5||r.left< -5) &&
        !['SCRIPT','STYLE','LINK'].includes(el.tagName);
      }).slice(0,6).map(el=>el.tagName+'.'+String(el.className||'').slice(0,70));
      return {
       lang:document.documentElement.lang,
       main:document.querySelectorAll('main#main').length,
       header:!!document.querySelector('.ae-header'),footer:!!document.querySelector('.ae-footer'),
       brandStyles:getComputedStyle(document.querySelector('.ae-header')).backgroundColor,
       horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
       tooWide,sidebar:!!document.querySelector('.ae-drawer'),
       firstHeading:document.querySelector('h1')?.textContent?.trim().slice(0,55)
      };
     });
     assert.equal(result.lang,'ko');
     assert.equal(result.main,1);
     assert.ok(result.header&&result.footer&&result.sidebar);
     assert.ok(result.firstHeading?.length>1);
     if(result.horizontalOverflow>5){
      failures.push(width+'px '+route+' horizontal overflow '+result.horizontalOverflow+'px suspects '+JSON.stringify(result.tooWide));
     }
     if(width===390){
      const menu=page.locator('.ae-menu summary');
      assert.equal(await menu.isVisible(),true);
      await menu.click();
      assert.equal(await page.locator('.ae-drawer a[href="/runtime/"]').isVisible(),true,'Mobile menu missing Runtime');
      await menu.click();
     }else{
      assert.equal(await page.locator('.ae-header__links').isVisible(),true);
     }
     if(route==='/runtime/experiments/'){
      assert.equal(await page.locator('#run').count(),1,'Independent six-way GPU button missing');
      assert.equal(await page.locator('#results').count(),1,'Independent GPU result table missing');
     }
     if(route==='/runtime/'){
      assert.equal(await page.locator('#autoRun').count(),1,'GPU v2 button missing');
      assert.equal(await page.locator('#autoResults').count(),1,'GPU score table missing');
      assert.equal(await page.locator('#backend').count(),1,'Model picker missing');
     }
     if(route==='/chat/'||route==='/agent/'){
      assert.equal(await page.locator('#navLaunch').count(),1,'Original CTA must remain wired');
     }
     if(route==='/'){
      await page.screenshot({path:'browser-smoke-screenshots/home-'+width+'.png',fullPage:true});
     }
     if(route==='/runtime/'){
      await page.screenshot({path:'browser-smoke-screenshots/runtime-'+width+'.png',fullPage:true});
     }
     for(const error of resourceErrors)failures.push(width+'px '+route+' local asset '+error);
     for(const error of errors)failures.push(width+'px '+route+' browser JS '+error.slice(0,220));
     console.log('PASS',width+'px',label,'overflow',result.horizontalOverflow+'px');
    }catch(e){
     failures.push(width+'px '+route+' '+String(e.message));
    }finally{await page.close()}
   }
   await context.close();
  }
 }finally{await browser.close()}
 if(failures.length){
  console.error('\nSITE BROWSER SMOKE FAILED '+failures.length+' checks:\n'+failures.join('\n'));
  process.exitCode=1;
 }else console.log('PASS 11 pages × 2 viewports, Chromium DOM and mobile menu interactions, no script errors or local 404s');
})().catch(e=>{console.error(e);process.exitCode=1});
