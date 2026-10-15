const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { getQuickJS } = require('quickjs-emscripten');
const cheerio = require('cheerio');
const { encodeEpisode } = require('../src/ids');
async function runNative(settings,args,routes) {
  const QuickJS=await getQuickJS(),runtime=QuickJS.newRuntime(),vm=runtime.newContext();
  const docs=new Map(),elements=new Map(),timers=new Set(),deferreds=new Set(),calls=[];
  let serial=0,captured;
  function register(name,fn) {
    const handle=vm.newFunction(name,(...handles)=>vm.newString(String(fn(...handles.map(h=>vm.dump(h))))));
    vm.setProp(vm.global,name,handle);handle.dispose();
  }
  function nodes(list) {
    return JSON.stringify(list.map(el=>{const id=String(++serial);elements.set(id,el);return id;}));
  }
  register('__parse_url',raw=>{const u=new URL(raw);return JSON.stringify({protocol:u.protocol,host:u.host,hostname:u.hostname,port:u.port,pathname:u.pathname,search:u.search,hash:u.hash});});
  register('__cheerio_load',html=>{const id=String(++serial);docs.set(id,cheerio.load(html));return id;});
  register('__cheerio_select',(doc,selector)=>nodes(docs.get(doc)(selector).toArray()));
  register('__cheerio_find',(doc,id,selector)=>nodes(docs.get(doc)(elements.get(id)).find(selector).toArray()));
  register('__cheerio_text',(doc,ids)=>ids.split(',').map(id=>docs.get(doc)(elements.get(id)).text()).join(''));
  register('__cheerio_inner_html',(doc,id)=>docs.get(doc)(elements.get(id)).html()||'');
  register('__cheerio_html',(doc,id)=>id?docs.get(doc).html(elements.get(id)):docs.get(doc).html());
  register('__cheerio_attr',(doc,id,key)=>docs.get(doc)(elements.get(id)).attr(key)??'__UNDEFINED__');
  register('__cheerio_next',(doc,id)=>{const n=docs.get(doc)(elements.get(id)).next().get(0);if(!n)return '__NONE__';const next=String(++serial);elements.set(next,n);return next;});
  register('__capture_result',value=>{captured=JSON.parse(value);return '';});
  for(const name of ['log','warn','error'])register('__console_'+name,()=> '');
  const sleep=vm.newFunction('__plugin_sleep',ms=>{
    const d=vm.newPromise();deferreds.add(d);
    const timer=setTimeout(()=>{timers.delete(timer);d.resolve(vm.undefined);},vm.dump(ms));timers.add(timer);return d.handle;
  });vm.setProp(vm.global,'__plugin_sleep',sleep);sleep.dispose();
  const fetch=vm.newFunction('__native_fetch',(url,method,headers)=>{
    const d=vm.newPromise();deferreds.add(d);
    const u=vm.dump(url);calls.push({url:u,method:vm.dump(method),headers:JSON.parse(vm.dump(headers))});
    const found=routes[u],item=typeof found==='object'?found:{body:found,status:found===undefined?404:200};
    const result={ok:item.status>=200&&item.status<300,status:item.status,url:u,body:item.body||'',bodyBase64:Buffer.from(item.body||'').toString('base64'),headers:{}};
    const value=vm.newString(JSON.stringify(result));d.resolve(value);value.dispose();return d.handle;
  });vm.setProp(vm.global,'__native_fetch',fetch);fetch.dispose();
  function evaluate(code) {
    const r=vm.evalCode(code);
    if(r.error){const value=vm.dump(r.error);r.error.dispose();throw new Error(JSON.stringify(value));}r.value.dispose();
  }
  try {
    evaluate(`var console={log:__console_log,warn:__console_warn,error:__console_error};var SCRAPER_SETTINGS=${JSON.stringify(settings)};var TMDB_API_KEY='';var module={exports:{}};`);
    evaluate(fs.readFileSync(__dirname+'/fixtures/nuvio-polyfills.txt','utf8'));
    evaluate(fs.readFileSync(__dirname+'/../providers/anime-sama.js','utf8'));
    evaluate(`module.exports.getStreams(...${JSON.stringify(args)}).then(function(v){__capture_result(JSON.stringify(v));},function(e){__capture_result(JSON.stringify({error:e.message}));});`);
    const until=Date.now()+5000;
    while(captured===undefined&&Date.now()<until) {
      const jobs=runtime.executePendingJobs();
      if(jobs.error){const e=vm.dump(jobs.error);jobs.error.dispose();throw new Error(JSON.stringify(e));}
      await new Promise(r=>setTimeout(r,1));
    }
    assert.notEqual(captured,undefined,'QuickJS plugin must complete');
    return {streams:captured,calls};
  } finally {
    for(const timer of timers)clearTimeout(timer);
    for(const d of deferreds)d.dispose();
    vm.dispose();runtime.dispose();
  }
}
test('built bundle resolves real-shaped streams in QuickJS with Nuvio URL/fetch/DOM/timer polyfills',async()=>{
  const ref={path:'/catalogue/test/saison1/vostfr/',index:0,language:'vostfr',script:'/catalogue/test/saison1/vostfr/episodes.js'};
  const routes={
    ['https://domain-b.example'+ref.script]:`eps1=['https://ansembed.net/e'];`,
    'https://ansembed.net/e':`<script>jwplayer('v').setup({sources:[{file:'//cdn.test/path/master.m3u8'}]});</script>`,
    'https://cdn.test/path/master.m3u8':'#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nhigh.m3u8',
    'https://cdn.test/path/high.m3u8':'#EXTM3U\n#EXTINF:10,\nsegment.ts'
  };
  const r=await runNative({animeSamaBaseUrl:'https://domain-b.example'},[encodeEpisode([ref]),'tv',1,1],routes);
  assert.equal(r.streams.length,1);assert.equal(r.streams[0].quality,'1080p');assert.equal(r.calls.length,4);
  assert.equal(r.streams[0].headers.Origin,'https://ansembed.net');assert.equal(r.streams[0].audioLanguages,undefined);
});
test('QuickJS native TMDB source-map path works without keys, Node builtins or metadata requests',async()=>{
  const routes={
    'https://domain-b.example/catalogue/test/saison1/vf/episodes.js':`eps1=['https://generic.test/e'];`,
    'https://generic.test/e':`<video src='https://cdn.test/video.mp4'></video>`,
    'https://cdn.test/video.mp4':''
  };
  const sourceMap=JSON.stringify({'tv:123':{seasons:{1:{path:'/catalogue/test/saison1/',languages:['vf']}}}});
  const r=await runNative({animeSamaBaseUrl:'https://domain-b.example',sourceMap},['123','tv',1,1],routes);
  assert.equal(r.streams.length,1);assert.equal(r.streams[0].version,'VF');assert.deepEqual(r.streams[0].audioLanguages,['fr']);assert.equal(r.calls.length,3);
});
