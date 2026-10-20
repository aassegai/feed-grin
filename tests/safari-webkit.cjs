/* WebKit DOM/API compatibility checks. Safari's native extension runtime is not
 * available on Linux; these API doubles do not replace Apple-device testing. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const [content, css, manifestText, modern, mobile] = await Promise.all([
    fs.readFile(path.join(root,'extension/content.js'),'utf8'),
    fs.readFile(path.join(root,'extension/content.css'),'utf8'),
    fs.readFile(path.join(root,'extension/manifest.json'),'utf8'),
    fs.readFile(path.join(__dirname,'fixtures/modern-feed.html'),'utf8'),
    fs.readFile(path.join(__dirname,'fixtures/mobile-feed.html'),'utf8')
  ]);
  const manifest=JSON.parse(manifestText);
  const browser=await webkit.launch({headless:true,...(process.env.FEED_GRIN_WEBKIT_EXECUTABLE?{executablePath:process.env.FEED_GRIN_WEBKIT_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const storage={};
  let feed;
  let checks=0;
  const pass=label=>{checks++;console.log(`PASS ${label}`);};
  const errors=[];
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.exposeBinding('__feedGrinApi',async(_source,request)=>{
    if(request.method==='get')return {...request.defaults,...storage};
    if(request.method==='set'){
      const changes={};
      for(const [key,value] of Object.entries(request.values)){
        if(storage[key]!==value)changes[key]={oldValue:storage[key],newValue:value};
        storage[key]=value;
      }
      await Promise.all(context.pages().map(page=>page.evaluate(changes=>window.__feedGrinEmit?.(changes),changes).catch(()=>{})));
      return;
    }
    if(request.method==='query')return [{id:1}];
    if(request.method==='message')return feed.evaluate(message=>window.__feedGrinStatus(message),request.message);
    throw new Error(`Unsupported test API method: ${request.method}`);
  });
  await context.addInitScript(({manifest})=>{
    const changes=[];
    const handlers=[];
    window.__feedGrinEmit=value=>changes.forEach(fn=>fn(value,'local'));
    window.__feedGrinStatus=message=>new Promise(resolve=>{
      for(const fn of handlers)fn(message,{},resolve);
    });
    window.chrome={
      runtime:{getManifest:()=>manifest,getURL:()=> 'https://www.linkedin.com/__feed_grin_asset.jpg',onMessage:{addListener:fn=>handlers.push(fn)}},
      storage:{local:{get:defaults=>window.__feedGrinApi({method:'get',defaults}),set:values=>window.__feedGrinApi({method:'set',values})},onChanged:{addListener:fn=>changes.push(fn)}},
      tabs:{query:()=>window.__feedGrinApi({method:'query'}),sendMessage:(_id,message)=>window.__feedGrinApi({method:'message',message})}
    };
    // Exercise the polling fallback used in Safari without the Navigation API.
    Object.defineProperty(window,'navigation',{configurable:true,value:undefined});
  },{manifest});
  await context.route('https://www.linkedin.com/**',async route=>{
    if(route.request().url().endsWith('__feed_grin_asset.jpg'))return route.fulfill({contentType:'image/jpeg',body:await fs.readFile(path.join(root,'extension/assets/replacement.jpg'))});
    return route.fulfill({contentType:'text/html',body:route.request().url().includes('layout=mobile')?mobile:modern});
  });
  await context.route('https://feed-grin.test/**',async route=>{
    const name=new URL(route.request().url()).pathname.slice(1);
    if(!['popup.html','popup.js','popup.css'].includes(name))return route.abort();
    return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:await fs.readFile(path.join(root,'extension',name))});
  });
  async function load(layout){
    await feed.goto(`https://www.linkedin.com/feed/?layout=${layout}`);
    await feed.addStyleTag({content:css});
    await feed.evaluate(content);
  }
  async function visibility(id,visible){
    await feed.locator('#'+id).waitFor({state:visible?'visible':'hidden'});
  }
  async function image(){
    await feed.waitForFunction(()=>{
      const img=document.querySelector('#feed-grin-replacement')?.shadowRoot?.querySelector('img');
      return img?.complete&&img.naturalWidth===900;
    });
    assert.equal(await feed.locator('#feed-grin-replacement').count(),1);
  }
  try{
    feed=await context.newPage();
    await load('modern');
    await visibility('modern-organic',false);
    await visibility('modern-ad',false);
    await visibility('modern-unknown',true);
    await visibility('modern-sidebar',true);
    await image();
    pass('WebKit desktop feed: default hiding, image, unknown modules and sidebar');
    const popup=await context.newPage();
    await popup.goto('https://feed-grin.test/popup.html');
    await popup.waitForFunction(()=>!document.querySelector('#enabled').disabled);
    for(const id of ['enabled','hideAds','showTrollface'])assert.equal(await popup.locator('#'+id).isChecked(),true);
    pass('Safari popup scripts load with the documented Promise API shape');
    await popup.locator('#hideAds').uncheck();
    await visibility('modern-ad',true);
    await visibility('modern-organic',false);
    pass('WebKit desktop ad toggle restores only ads');
    await popup.locator('#enabled').uncheck();
    await visibility('modern-organic',true);
    assert.equal(await feed.locator('#feed-grin-replacement').count(),0);
    await popup.locator('#hideAds').check();
    await visibility('modern-ad',false);
    await visibility('modern-organic',true);
    await image();
    pass('WebKit independent ad-only mode and image');
    await popup.locator('#enabled').check();
    await visibility('modern-organic',false);
    await feed.evaluate(()=>history.pushState({},'','/jobs/'));
    await visibility('modern-organic',true);
    await visibility('modern-ad',true);
    await feed.evaluate(()=>history.pushState({},'','/feed/'));
    await visibility('modern-organic',false);
    await visibility('modern-ad',false);
    pass('WebKit navigation without the Navigation API');
    await popup.locator('#enabled').uncheck();
    await feed.evaluate(()=>document.querySelector('#modern-organic > p').textContent='Promoted');
    await visibility('modern-organic',false);
    await feed.evaluate(()=>document.querySelector('#modern-organic > p').textContent='3h');
    await visibility('modern-organic',true);
    pass('WebKit virtualized cards reclassified on label changes');
    await popup.locator('#enabled').check();
    await feed.setViewportSize({width:390,height:844});
    await load('mobile');
    await visibility('mobile-organic',false);
    await visibility('mobile-organic-ru',false);
    await visibility('mobile-ad',false);
    await visibility('mobile-unknown',true);
    await visibility('mobile-nav',true);
    await visibility('mobile-footer',true);
    await image();
    assert.equal(await feed.locator('.composer').isVisible(),true);
    pass('WebKit mobile ol/li feed, native article cards and sponsored attributes');
    assert.equal(await feed.locator('#feed-grin-replacement img').evaluate(img=>{const r=img.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;}),true);
    pass('WebKit phone viewport image fits without horizontal overflow');
    await popup.locator('#hideAds').uncheck();
    await visibility('mobile-ad',true);
    await visibility('mobile-organic',false);
    await popup.locator('#enabled').uncheck();
    await visibility('mobile-organic',true);
    await popup.locator('#hideAds').check();
    await visibility('mobile-ad',false);
    await visibility('mobile-organic',true);
    pass('WebKit mobile independent switches');
    await popup.locator('#showTrollface').uncheck();
    await feed.locator('#feed-grin-replacement').waitFor({state:'detached'});
    await load('mobile');
    await visibility('mobile-ad',false);
    await visibility('mobile-organic',true);
    assert.equal(await feed.locator('#feed-grin-replacement').count(),0);
    pass('WebKit reload keeps saved settings');
    await popup.locator('#showTrollface').check();
    await image();
    await popup.evaluate(()=>refreshStatus());
    assert.match(await popup.locator('#status').textContent(),/Скрыто карточек: 1\. Из них рекламных: 1\./);
    pass('WebKit popup reports live mobile card counts');
    await popup.setViewportSize({width:280,height:800});
    assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    pass('WebKit popup fits a narrow phone sheet');
    await popup.locator('#enabled').check();
    await visibility('mobile-organic',false);
    await fs.mkdir(path.join(root,'test-results'),{recursive:true});
    await feed.screenshot({path:path.join(root,'test-results/safari-mobile.png'),fullPage:true});
    await popup.screenshot({path:path.join(root,'test-results/safari-popup.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(`${checks} WebKit checks passed.`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
