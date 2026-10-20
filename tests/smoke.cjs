/* Real MV3 extension in Chromium. LinkedIn responses are local fixtures.
 * npm install && npx playwright install chromium && npm test
 * CHROMIUM_PATH optionally selects an existing browser binary.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const extension = path.resolve(__dirname, '../extension');
const extensionId = [...crypto.createHash('sha256').update(extension).digest('hex').slice(0,32)].map(n => String.fromCharCode(97 + parseInt(n,16))).join('');
const host = '#feed-grin-replacement';
const card = (id, subtitle, body, attrs='') => `<div class="occludable-update"><article id="${id}" class="feed-shared-update-v2" ${attrs}><header>Example author <span class="update-components-actor__sub-description">${subtitle}</span></header><p>${body}</p><button>Comment</button></article></div>`;
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; img-src 'self'; style-src 'unsafe-inline'; media-src data:">
<style>
body { margin:0; background:#f3f2ef; font:16px Arial; color:#222; }
nav { height:54px; background:white; padding:0 24px; display:flex; gap:28px; align-items:center; }
.scaffold-layout { max-width:1128px; margin:24px auto; display:grid; grid-template-columns:200px minmax(0,560px) 270px; gap:24px; }
.scaffold-layout__sidebar, article, .scaffold-layout__aside, .composer { background:white; padding:20px; border-radius:12px; margin-bottom:16px; }
@media(max-width:700px) { .scaffold-layout { display:block; margin:12px; } .scaffold-layout__sidebar { display:none; } }
</style></head><body><nav aria-label="Global"><a href="/feed/">Home</a><a href="/jobs/">Jobs</a><a href="/messaging/">Messaging</a></nav>
<div class="scaffold-layout"><section class="scaffold-layout__sidebar">Your profile</section><main class="scaffold-layout__main">
<div class="composer"><button>Start a post</button></div>
${card('organic','6h • Edited','Ordinary user post')}
${card('ad','Promoted','Advertisement — must stay visible')}
${card('organic-ru','2 ч. •','Пользовательский пост')}
${card('ad-ru','Продвигается','Реклама должна остаться')}
${card('ad-marker','3h •','Sponsored post with explicit ad metadata','data-ad-id="campaign-123"')}
${card('unknown','Unrecognized header','Unknown card — preserve it')}
${card('body-mentions-ad','1 day ago •','My post talks about Promoted and Sponsored posts')}
</main><aside class="scaffold-layout__aside">Recommendations and sidebar advertisement</aside></div>
<div id="message-dock"><button>Open messages</button></div></body></html>`;

async function hiddenFeed(page, image=true) {
  await page.waitForFunction(() => getComputedStyle(document.getElementById('organic').parentElement).display === 'none');
  for (const id of ['organic','organic-ru','body-mentions-ad']) assert.equal(await page.locator(`#${id}`).isVisible(),false,id);
  for (const id of ['ad','ad-ru','ad-marker','unknown']) assert.equal(await page.locator(`#${id}`).isVisible(),true,id);
  for (const selector of ['nav','.composer','.scaffold-layout__aside','#message-dock']) assert.equal(await page.locator(selector).isVisible(),true,selector);
  if (image) {
    await page.waitForFunction(() => {
      const img=document.querySelector('#feed-grin-replacement')?.shadowRoot?.querySelector('img');
      return img?.complete && img.naturalWidth===900;
    });
    assert.equal(await page.locator(host).count(),1);
  } else assert.equal(await page.locator(host).count(),0);
}
async function original(page) {
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-feed-grin-active'));
  assert.equal(await page.locator(host).count(),0);
  assert.equal(await page.locator('#organic').isVisible(),true);
  assert.equal(await page.locator('#ad').isVisible(),true);
}
(async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'feed-grin-test-'));
  let context;
  let count=0;
  const pass=name=>{count++;console.log(`PASS ${name}`);};
  try {
    context=await chromium.launchPersistentContext(profile,{
      channel:'chromium', headless:true,
      ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
      ignoreDefaultArgs:['--disable-extensions'],
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--autoplay-policy=no-user-gesture-required'],
      viewport:{width:1280,height:900}
    });
    const modernFixture = await fs.readFile(path.join(__dirname, 'fixtures/modern-feed.html'), 'utf8');
    await context.route(/^https:\/\/(www\.)?linkedin\.com\//,route=>route.fulfill({contentType:'text/html',body:route.request().url().includes('layout=modern')?modernFixture:fixture}));
    const page=await context.newPage();
    const errors=[];
    context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    page.on('pageerror',e=>errors.push(e.message));
    // Regression: no main element, no Ember classes, only modern feed/list roles.
    await page.goto('https://www.linkedin.com/feed/?layout=modern');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('modern-organic')).display === 'none', null, {timeout:5000});
    pass('modern feed cards hidden without legacy classes or a main element');
    for (const id of ['modern-tracking-organic','modern-ru','modern-split-time','modern-sr-time','modern-roleless']) {
      assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
    }
    for (const id of ['modern-ad','modern-ad-ru','modern-metadata-ad','modern-tracking-ad','modern-unknown','modern-sidebar']) {
      assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
    }
    assert.equal(await page.locator('.composer').isVisible(), true);
    assert.equal(await page.locator(host).count(), 1);
    pass('modern ad labels, sponsored tracking, component keys and unknown modules preserved');
    pass('modern split, invisible and screen-reader timestamps recognized; roleless cards covered');
    await page.goto('https://www.linkedin.com/feed/?trk=test');
    await hiddenFeed(page);
    pass('default: organic posts hidden; ads, unknown cards, composer and sidebars preserved; image on by default');

    const popup=await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#enabled').waitFor({state:'visible'});
    await popup.waitForFunction(()=>!document.querySelector('#enabled').disabled);
    assert.equal(await popup.locator('#hideAds').isChecked(), false);
    assert.equal(await popup.locator('#showTrollface').isChecked(), true);
    await popup.locator('#showTrollface').check();
    await hiddenFeed(page,true);
    pass('popup enables trollface live; bundled image loads under page CSP');

    await popup.locator('#enabled').uncheck();
    await original(page);
    await popup.locator('#enabled').check();
    await hiddenFeed(page,true);
    pass('global toggle restores posts and reapplies settings without reloading');

    await page.reload();
    await hiddenFeed(page,true);
    pass('settings persist across page reloads');

    await page.evaluate(()=>{
      const node=document.querySelector('#unknown .update-components-actor__sub-description');
      node.firstChild.data='4h •';
    });
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#unknown').parentElement).display==='none');
    await page.evaluate(()=>document.querySelector('#unknown .update-components-actor__sub-description').firstChild.data='Sponsored');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#unknown').parentElement).display!=='none');
    pass('late ad label restores a previously classified card');

    await page.evaluate(()=>{
      const card=document.querySelector('#organic');
      card.setAttribute('data-is-sponsored','true');
    });
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#organic').parentElement).display!=='none');
    await page.evaluate(()=>document.querySelector('#organic').removeAttribute('data-is-sponsored'));
    await hiddenFeed(page,true);
    pass('late ad metadata overrides timestamps');

    await page.evaluate(()=>{
      const main=document.querySelector('main');
      main.querySelector('#feed-grin-replacement')?.remove();
      main.replaceWith(main.cloneNode(true));
    });
    await hiddenFeed(page,true);
    pass('replacement of the feed DOM restores classification and a single image');

    await page.evaluate(()=>history.pushState({},'','/jobs/'));
    await original(page);
    await page.goBack();
    await hiddenFeed(page,true);
    await page.goForward();
    await original(page);
    pass('SPA navigation, Back and Forward');

    for (const route of ['/messaging/','/in/example/','/search/results/all/','/notifications/','/feed/update/urn:li:activity:123/','/']) {
      await page.goto(`https://www.linkedin.com${route}`);
      await original(page);
    }
    pass('messages, profiles, search, notifications, direct posts and landing page preserved');
    for (const route of ['/feed','/feed/following/','/feed/hashtag/example/']) {
      await page.goto(`https://www.linkedin.com${route}`);
      await hiddenFeed(page,true);
    }
    pass('feed route variants');
    await page.goto('https://www.linkedin.com/jobs/');
    await page.evaluate(()=>history.replaceState({},'','/feed/'));
    await hiddenFeed(page,true);
    pass('replaceState to feed without DOM mutation');

    const wave = Buffer.alloc(44 + 48000);
    wave.write('RIFF',0); wave.writeUInt32LE(wave.length-8,4); wave.write('WAVEfmt ',8);
    wave.writeUInt32LE(16,16); wave.writeUInt16LE(1,20); wave.writeUInt16LE(1,22);
    wave.writeUInt32LE(8000,24); wave.writeUInt32LE(16000,28);
    wave.writeUInt16LE(2,32); wave.writeUInt16LE(16,34); wave.write('data',36); wave.writeUInt32LE(48000,40);
    const paused=await page.evaluate(async src=>{
      const results=[];
      for (const id of ['organic','ad']) {
        const audio=document.createElement('audio');
        audio.src=src;
        document.getElementById(id).append(audio);
        await audio.play().catch(()=>{});
        results.push(audio.paused);
        audio.pause();
      }
      return results;
    }, 'data:audio/wav;base64,'+wave.toString('base64'));
    assert.deepEqual(paused,[true,false]);
    pass('organic media paused; ad media left untouched');

    await page.setViewportSize({width:390,height:844});
    await hiddenFeed(page,true);
    assert.equal(await page.locator(`${host} img`).evaluate(img=>{
      const r=img.getBoundingClientRect();return r.width>100&&r.left>=0&&r.right<=innerWidth;
    }),true);
    pass('image fits a narrow viewport');
    await page.setViewportSize({width:1280,height:900});
    await page.goto('https://linkedin.com/feed/');
    await hiddenFeed(page,true);
    pass('bare LinkedIn hostname');

    await popup.locator('#showTrollface').uncheck();
    await page.waitForSelector(host,{state:'detached'});
    await hiddenFeed(page,false);
    await page.reload();
    await hiddenFeed(page,false);
    pass('explicit image-off setting survives reload despite the image-on default');
    await popup.locator('#showTrollface').check();
    await hiddenFeed(page,true);
    pass('trollface toggle leaves feed hiding and ad visibility unchanged');
    await page.goto('https://www.linkedin.com/feed/?layout=modern');
    await page.waitForSelector(host, {state:'visible'});
    await page.waitForFunction(() => {
      const img=document.querySelector('#feed-grin-replacement')?.shadowRoot?.querySelector('img');
      return img?.complete && img.naturalWidth===900;
    });
    assert.equal(await page.locator(host).count(), 1);
    assert.equal(await page.locator('#modern-ad').isVisible(), true);
    pass('one trollface replaces modern organic cards while ads remain visible');

    await page.bringToFront();
    await popup.evaluate(() => refreshStatus());
    assert.match(await popup.locator('#status').textContent(), /Скрыто карточек: 6\. Реклама сохранена: 4\./);
    pass('popup reports actual hidden and preserved ad counts from the active tab');

    await page.evaluate(() => document.querySelector('#modern-organic').setAttribute('data-view-tracking-scope', JSON.stringify([{transporterKeys:['sponsored']}])));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-organic')).display!=='none');
    await page.evaluate(() => document.querySelector('#modern-organic').removeAttribute('data-view-tracking-scope'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-organic')).display==='none');
    pass('late sponsored tracking restores modern cards');

    await page.evaluate(() => {
      document.querySelector('#modern-organic > p').textContent='Promoted';
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-organic')).display!=='none');
    assert.equal(await page.locator('#modern-organic').isVisible(), true);
    assert.equal(await page.locator(host).count(), 1);
    await page.evaluate(() => document.querySelector('#modern-organic > p').textContent='3h');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-organic')).display==='none');
    pass('virtualized modern card can change from organic to ad and back');

    await popup.locator('#enabled').uncheck();
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-feed-grin-active'));
    for (const id of ['modern-organic','modern-ad','modern-tracking-organic','modern-sidebar']) assert.equal(await page.locator(`#${id}`).isVisible(), true);
    await popup.locator('#enabled').check();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-organic')).display==='none');
    pass('modern feed settings restore original cards and reapply hiding');

    await popup.locator('#hideAds').check();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-ad')).display==='none');
    for (const id of ['modern-ad','modern-ad-ru','modern-metadata-ad','modern-tracking-ad','modern-organic']) assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
    for (const id of ['modern-unknown','modern-sidebar']) assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
    await page.bringToFront();
    await popup.evaluate(() => refreshStatus());
    assert.match(await popup.locator('#status').textContent(), /Скрыто карточек: 10\. Из них рекламных: 4\./);
    pass('separate ad toggle hides recognized modern ads and updates counts');

    await popup.locator('#hideAds').uncheck();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-ad')).display!=='none');
    assert.equal(await page.locator('#modern-organic').isVisible(), false);
    pass('turning ad hiding off restores ads while organic hiding stays enabled');

    await popup.locator('#hideAds').check();
    await popup.locator('#enabled').uncheck();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-organic')).display!=='none');
    assert.equal(await page.locator('#modern-ad').isVisible(), false);
    assert.equal(await popup.locator('#showTrollface').isEnabled(), true);
    assert.equal(await page.locator(host).count(), 1);
    pass('ad hiding and trollface work independently of organic post hiding');

    await popup.locator('#hideAds').uncheck();
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-feed-grin-active'));
    for (const id of ['modern-organic','modern-ad','modern-metadata-ad','modern-sidebar']) assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
    assert.equal(await page.locator(host).count(), 0);
    assert.equal(await popup.locator('#showTrollface').isDisabled(), true);
    pass('both hiding toggles off restores all cards and removes the image');

    await popup.locator('#hideAds').check();
    await page.reload();
    await popup.reload();
    await popup.waitForFunction(() => !document.querySelector('#hideAds').disabled);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-ad')).display==='none');
    assert.equal(await popup.locator('#enabled').isChecked(), false);
    assert.equal(await popup.locator('#hideAds').isChecked(), true);
    assert.equal(await popup.locator('#showTrollface').isChecked(), true);
    assert.equal(await page.locator('#modern-organic').isVisible(), true);
    pass('independent settings survive page and popup reloads');

    await page.evaluate(() => document.querySelector('#modern-organic > p').textContent='Promoted');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-organic')).display==='none');
    await page.evaluate(() => document.querySelector('#modern-organic > p').textContent='3h');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-organic')).display!=='none');
    pass('ad-only mode reclassifies virtualized cards and restores organic content');

    const secondTab = await context.newPage();
    await secondTab.goto('https://www.linkedin.com/feed/?layout=modern');
    await secondTab.waitForFunction(() => getComputedStyle(document.querySelector('#modern-ad')).display==='none');
    await popup.locator('#hideAds').uncheck();
    await secondTab.waitForFunction(() => getComputedStyle(document.querySelector('#modern-ad')).display!=='none');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#modern-ad')).display!=='none');
    await popup.locator('#hideAds').check();
    await secondTab.waitForFunction(() => getComputedStyle(document.querySelector('#modern-ad')).display==='none');
    await secondTab.close();
    pass('ad toggle applies live to multiple LinkedIn tabs');

    await page.goto('https://www.linkedin.com/feed/');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#ad').parentElement).display==='none');
    for (const id of ['ad','ad-ru','ad-marker']) assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
    for (const id of ['organic','organic-ru','unknown']) assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
    pass('ad-only mode supports legacy feed cards');

    const adPaused = await page.evaluate(async src => {
      const audio=document.createElement('audio');
      audio.src=src;
      document.getElementById('ad').append(audio);
      await audio.play().catch(()=>{});
      const paused=audio.paused;
      audio.pause();
      return paused;
    }, 'data:audio/wav;base64,'+wave.toString('base64'));
    assert.equal(adPaused, true);
    pass('hidden ad media playback is stopped');

    await popup.locator('#enabled').check();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#organic').parentElement).display==='none');
    assert.equal(await page.locator('#ad').isVisible(), false);
    assert.equal(await page.locator('#unknown').isVisible(), true);
    pass('both hiding toggles work together on legacy cards');

    await page.goto('https://www.linkedin.com/jobs/');
    await original(page);
    await popup.locator('#hideAds').uncheck();
    await page.goto('https://www.linkedin.com/feed/');
    await hiddenFeed(page,true);
    pass('ad hiding stays limited to feed routes and can be disabled live');

    const output=path.resolve(__dirname,'../test-results');
    await fs.mkdir(output,{recursive:true});
    await page.screenshot({path:path.join(output,'feed-preview.png'),fullPage:true});
    await popup.screenshot({path:path.join(output,'settings-preview.png')});
    assert.deepEqual(errors,[]);
    console.log(`${count} checks passed.`);
  } finally {
    await context?.close();
    await fs.rm(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
