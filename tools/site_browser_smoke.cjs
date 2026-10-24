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
 ['/', '홈페이지'],['/news/','소식'],['/news/post/?p=2026-10-24-patch-v5','소식 글'],
 ['/patch-notes/','패치 노트'],['/status/','서버 상태'],['/share/','공유된 대화'],['/models/','모델 · 모드별 사양'],['/playground/','플레이그라운드']
];
const shotDir=process.env.SHOT_DIR||'browser-smoke-screenshots';
const shotPrefix=process.env.SHOT_PREFIX||'';
(async()=>{
 const browser=await chromium.launch({
  headless:true,executablePath:process.env.BROWSER_EXECUTABLE,
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
 });
 const failures=[];
 try{
  fs.mkdirSync(shotDir,{recursive:true});
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
       horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
       tooWide,sidebar:!!document.querySelector('.ae-drawer'),
       firstHeading:document.querySelector('h1')?.textContent?.trim().slice(0,55)
      };
     });
     assert.equal(result.lang,'ko');
     assert.equal(result.main,1);
     const app=route==='/playground/';
     if(!app)assert.ok(result.header&&result.footer&&result.sidebar,'missing ae-header/ae-footer/ae-drawer');
     if(!app)assert.ok(result.firstHeading?.length>1,'missing h1');
     if(result.horizontalOverflow>5){
      failures.push(width+'px '+route+' horizontal overflow '+result.horizontalOverflow+'px suspects '+JSON.stringify(result.tooWide));
     }
     if(app){
      for(const id of ['q','send','share','file-btn','file-in','tpl-btn','tpl','art-ver','custom','mem-list','voice','rate','autoread','tts-test','plus','plus-menu','more','vm','gen','conv-search','temp','use-vm','seltools','keys'])
       assert.equal(await page.locator('#'+id).count(),1,'playground #'+id+' missing');
      assert.equal(await page.locator('a[href="/chat/"]').count(),0,'WebGPU link must be gone');
      await page.locator('#plus').click();
      assert.equal(await page.locator('#plus-menu').isVisible(),true,'+ menu did not open');
      await page.locator('#tpl-btn').click();
      assert.ok(await page.locator('#tpl .tpl').count()>=12,'template gallery empty');
      await page.locator('#tpl .tpl').first().click();
      assert.ok((await page.locator('#q').inputValue()).length>5,'template did not fill the input');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>window.__ae.fixMermaid('A -->|x < 5| B')),'A -->|x #lt; 5| B','mermaid label escape');
      await page.locator('#more').click();
      assert.equal(await page.locator('#more-menu').isVisible(),true,'more menu did not open');
      await page.locator('#keys-open').click();
      assert.equal(await page.locator('#keys').isVisible(),true,'shortcut dialog');
      await page.keyboard.press('Escape');
      const parts=await page.evaluate(()=>window.__aeTTS.chunks('첫 문장이에요. 두 번째 문장이에요! ```js\nx\n``` 끝.'));
      assert.ok(parts.length>=3&&!parts.join(' ').includes('```'),'TTS chunking');
     }else if(width===390){
      const menu=page.locator('.ae-menu summary');
      assert.equal(await menu.isVisible(),true);
      await menu.click();
      assert.equal(await page.locator('.ae-drawer a[href="/news/"]').isVisible(),true,'Mobile menu missing 소식');
      await menu.click();
     }else{
      assert.equal(await page.locator('.ae-header__links').isVisible(),true);
     }
     if(route==='/news/'){
      await page.waitForSelector('#post-list .pcard',{timeout:8000});
      assert.ok(await page.locator('#post-list .pcard').count()>=6,'news list');
      await page.locator('.ntab[data-type="event"]').click();
      assert.equal(await page.locator('#post-list .pcard').count(),1,'event tab filter');
     }
     if(route==='/patch-notes/'){
      await page.waitForSelector('#post-list .patch',{timeout:8000});
      assert.ok(await page.locator('#post-list .patch').count()>=4,'patch notes');
     }
     if(route.startsWith('/news/post/')){
      await page.waitForFunction(()=>document.querySelector('#post-body h2'),null,{timeout:8000});
      assert.match(await page.locator('#post-title').textContent(),/v5/);
     }
     if(route==='/'){
      await page.waitForSelector('#ns-list .ns-item time',{timeout:8000});
     }
     if(route==='/share/'){
      const enc=await page.evaluate(async()=>{
       const data={t:'공유 테스트',m:[{r:'u',c:'안녕?'},{r:'a',c:'반가워요 <b>x</b>',s:[]}]};
       const bytes=new Uint8Array(await new Response(new Blob([new TextEncoder().encode(JSON.stringify(data))]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
       let bin='';for(const b of bytes)bin+=String.fromCharCode(b);
       return 'z'+btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      });
      await page.goto(host+'/share/#'+enc);await page.reload();
      await page.waitForSelector('.smsg',{timeout:8000});
      assert.equal(await page.locator('.smsg').count(),2,'share decode');
      assert.equal(await page.locator('.smsg b:not(.who)').count(),0,'share must escape HTML');
     }
     const name=route==='/'?'home':route.split('?')[0].replace(/^\/|\/$/g,'').replace(/\//g,'-');
     await page.screenshot({path:path.join(shotDir,shotPrefix+name+'-'+width+'.png'),fullPage:!app});
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
 }else console.log('PASS '+cases.length+' pages × 2 viewports, Chromium DOM and mobile menu interactions, no script errors or local 404s');
})().catch(e=>{console.error(e);process.exitCode=1});
