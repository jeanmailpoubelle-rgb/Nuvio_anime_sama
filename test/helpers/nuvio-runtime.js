const assert = require('node:assert/strict');
const fs = require('node:fs');
const { getQuickJS } = require('quickjs-emscripten');
const cheerio = require('cheerio');
async function runNative(settings,args,routes,options = {}) {
  const QuickJS=await getQuickJS(),vm=QuickJS.newContext(),runtime=vm.runtime;
  const docs=new Map(),elements=new Map(),timers=new Set(),deferreds=new Set(),calls=[];
  let serial=0,captured,closed=false,pendingFetches=0,resultAt;
  const started=Date.now();
  const logs=[];
  function register(name,fn) {
    const handle=vm.newFunction(name,(...handles)=>vm.newString(String(fn(...handles.map(h=>vm.dump(h))))));
    vm.setProp(vm.global,name,handle);handle.dispose();
  }
  function nodes(list) {
    return JSON.stringify(list.map(el=>{const id=String(++serial);elements.set(id,el);return id;}));
  }
  register('__parse_url',raw=>{const u=new URL(raw);return JSON.stringify({protocol:u.protocol,host:u.host,hostname:u.hostname,port:u.port,pathname:u.pathname,search:options.tvRuntime ? u.search : u.search || '?',hash:options.tvRuntime ? u.hash : u.hash || '#'});});
  register('__get_scraper_id',()=> 'anime-sama');
  register('__get_scraper_settings',()=>JSON.stringify(settings));
  register('__get_tmdb_api_key',()=>options.key || '');
  register('__cheerio_load',html=>{const id=String(++serial);docs.set(id,cheerio.load(html));return id;});
  register('__cheerio_select',(doc,selector)=>nodes(docs.get(doc)(selector).toArray()));
  register('__cheerio_find',(doc,id,selector)=>nodes(docs.get(doc)(elements.get(id)).find(selector).toArray()));
  register('__cheerio_text',(doc,ids)=>ids.split(',').map(id=>docs.get(doc)(elements.get(id)).text()).join(''));
  register('__cheerio_inner_html',(doc,id)=>docs.get(doc)(elements.get(id)).html()||'');
  register('__cheerio_html',(doc,id)=>id?docs.get(doc).html(elements.get(id)):docs.get(doc).html());
  register('__cheerio_attr',(doc,id,key)=>docs.get(doc)(elements.get(id)).attr(key)??'__UNDEFINED__');
  register('__cheerio_next',(doc,id)=>{const n=docs.get(doc)(elements.get(id)).next().get(0);if(!n)return '__NONE__';const next=String(++serial);elements.set(next,n);return next;});
  register('__capture_result',value=>{captured=JSON.parse(value);resultAt=Date.now();return '';});
  for(const name of ['log','info','warn','error'])register('__console_'+name,(...args)=>{logs.push(args.join(' '));return '';});
  if (!options.tvRuntime) {
    const sleep=vm.newFunction('__plugin_sleep',ms=>{
    const d=vm.newPromise();deferreds.add(d);
    const timer=setTimeout(()=>{timers.delete(timer);d.resolve(vm.undefined);},vm.dump(ms));timers.add(timer);return d.handle.dup();
    });vm.setProp(vm.global,'__plugin_sleep',sleep);sleep.dispose();
  }
  function mockResponse(u) {
    const found=routes[u],item=typeof found==='object'?found:{body:found,status:found===undefined?404:200};
    return {ok:item.status>=200&&item.status<300,status:item.status,url:u,body:item.body||'',bodyBase64:Buffer.from(item.body||'').toString('base64'),headers:{}};
  }
  const fetch=vm.newFunction('__native_fetch',(url,method,headers)=>{
    if (closed) return vm.newString(JSON.stringify({ok:false,status:0,body:'',bodyBase64:'',headers:{}}));
    const u=vm.dump(url),methodValue=vm.dump(method),headerValue=JSON.parse(vm.dump(headers));calls.push({url:u,method:methodValue,headers:headerValue});
    if (options.tvRuntime) {
      const response=options.fetchSync ? options.fetchSync(u,methodValue,headerValue) : mockResponse(u);
      if (!options.modernTv) delete response.bodyBase64;
      return vm.newString(JSON.stringify(response));
    }
    const d=vm.newPromise();deferreds.add(d);
    pendingFetches++;
    Promise.resolve().then(async () => {
      if (options.fetch) return options.fetch(u,methodValue,headerValue);
      return mockResponse(u);
    }).then(result=>{
      if (closed) return;
      const value=vm.newString(JSON.stringify(result));d.resolve(value);value.dispose();
    },()=>{
      if (closed) return;
      const value=vm.newString(JSON.stringify({ok:false,status:0,url:u,body:'',bodyBase64:'',headers:{}}));d.resolve(value);value.dispose();
    }).finally(()=>{pendingFetches--;});
    return d.handle.dup();
  });vm.setProp(vm.global,'__native_fetch',fetch);fetch.dispose();
  function evaluate(code) {
    const r=vm.evalCode(code);
    if(r.error){const value=vm.dump(r.error);r.error.dispose();throw new Error(JSON.stringify(value));}r.value.dispose();
  }
  try {
    evaluate(`var console={log:__console_log,info:__console_info,warn:__console_warn,error:__console_error};var SCRAPER_SETTINGS=${JSON.stringify(settings)};var TMDB_API_KEY=${JSON.stringify(options.key || '')};var module={exports:{}};`);
    evaluate(fs.readFileSync(__dirname+'/../fixtures/'+(options.tvRuntime ? options.modernTv ? 'nuvio-tv-modern-polyfills.txt':'nuvio-tv-polyfills.txt':'nuvio-polyfills.txt'),'utf8'));
    evaluate('(function(){\n'+fs.readFileSync(__dirname+'/../../providers/anime-sama.js','utf8')+'\n})();');
    const call=options.settingsLayout ? 'module.exports.onSettings()' : `module.exports.getStreams(...${JSON.stringify(args)})`;
    evaluate(`Promise.resolve(${call}).then(function(v){__capture_result(JSON.stringify(v));},function(e){__capture_result(JSON.stringify({error:e.message}));});`);
    const until=Date.now()+(options.budgetMs || 5000);
    while(captured===undefined&&Date.now()<until) {
      const jobs=runtime.executePendingJobs();
      if(jobs.error){const e=vm.dump(jobs.error);jobs.error.dispose();throw new Error(JSON.stringify(e));}
      await new Promise(r=>setTimeout(r,1));
    }
    assert.notEqual(captured,undefined,'QuickJS plugin must complete');
    // dokar3's evaluate awaits native callbacks as well as the captured JS value.
    // Keep the host sleeps alive to catch canceled long-timer tail latency.
    if (options.drainNative) {
      while((timers.size || pendingFetches) && Date.now()<until) {
        const jobs=runtime.executePendingJobs();
        if(jobs.error){const e=vm.dump(jobs.error);jobs.error.dispose();throw new Error(JSON.stringify(e));}
        await new Promise(r=>setTimeout(r,1));
      }
      assert.equal(timers.size+pendingFetches,0,'Native host work must settle');
    }
    return {streams:captured,calls,logs,resultReadyMs:resultAt-started,runtimeDrainMs:Date.now()-resultAt};
  } finally {
    closed=true;
    for(const timer of timers)clearTimeout(timer);
    // Settle guest continuations before freeing the runtime. Real fetches/timers
    // may still be pending when the resolver's success window cancels its work.
    for(const d of deferreds)d.resolve(vm.undefined);
    for(let i=0;i<100;i++) {
      const pending=runtime.executePendingJobs();
      if(pending.error){pending.error.dispose();break;}
      if(!pending.value)break;
    }
    for(const d of deferreds)d.dispose();
    if (!options.processLifetime) vm.dispose();
  }
}
module.exports = {runNative};
