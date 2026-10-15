const {test} = require('node:test');
const assert = require('node:assert/strict');
const { AnimeSamaProvider } = require('../src/provider');
const { Cache } = require('../src/cache');
const { HttpClient } = require('../src/http');
const { configuration } = require('../src/config');
const { encodeEpisode } = require('../src/ids');
const { deduplicate, streamObject, addonStream } = require('../src/streams');
const base='https://domain-b.example';
const ref={path:'/catalogue/test/saison1/vostfr/',index:0,language:'vostfr',script:'/catalogue/test/saison1/vostfr/episodes.js?filever=1'};
const response=(body,url,status=200,headers={})=>new Response(body,{status,headers});
function mockProvider(routes,config={}) {
  const calls=[];
  const fetch=async(url,options)=>{
    calls.push({url,method:options.method,headers:options.headers});
    const route=routes[url];
    if (typeof route==='function')return route(url,options);
    if (route instanceof Response)return route.clone();
    return response(route??'',url,route===undefined?404:200);
  };
  return {provider:new AnimeSamaProvider({animeSamaBaseUrl:base,requestTimeoutMs:80,hostTimeoutMs:120,resolutionTimeoutMs:200,successGraceMs:30,...config},{fetch}),calls};
}
const player=`<script>jwplayer('v').setup({sources:[{file:'https://cdn.test/master.m3u8'}]});</script>`;
const master='#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",VIDEO-RANGE=SDR\nhigh.m3u8';
const media='#EXTM3U\n#EXTINF:10,\nsegment.ts';
const healthyRoutes={
  [base+ref.script]:`eps1=['https://ansembed.test/e'];`,
  'https://ansembed.test/e':player,'https://cdn.test/master.m3u8':master,'https://cdn.test/high.m3u8':media
};
test('retained episode context costs one discovery + embed + master + variant, with exact headers',async()=>{
  const {provider,calls}=mockProvider(healthyRoutes);
  const {streams,metrics}=await provider.streams(encodeEpisode([ref]));
  assert.equal(streams.length,1);assert.equal(metrics.requests,4);assert.deepEqual(metrics.requestCategories,{discovery:1,embed:1,validation:2});
  assert.equal(streams[0].quality,'1080p');assert.equal(streams[0].source,'ANSEmbed');assert.equal(streams[0].version,'VOSTFR');assert.deepEqual(streams[0].subtitleLanguages,['fr']);assert.equal(streams[0].audioLanguages,undefined);
  assert.equal(calls[0].headers.Referer,base+ref.path);
  for(const call of calls.slice(2)) {assert.equal(call.headers.Referer,'https://ansembed.test/e');assert.equal(call.headers.Origin,'https://ansembed.test');assert.ok(call.headers['User-Agent']);}
});
test('changing one config value moves requests/Referers and leaves IDs domain-free',async()=>{
  for(const origin of ['https://domain-a.example','https://domain-b.example']) {
    const urls=[];
    const p=new AnimeSamaProvider({animeSamaBaseUrl:origin},{fetch:async(url,opts)=>{urls.push([url,opts.headers]);return new Response('eps1=[]');}});
    const id=encodeEpisode([ref]);await p.streams(id);
    assert.equal(urls.length,1);assert.equal(urls[0][0],origin+ref.script);assert.equal(urls[0][1].Referer,origin+ref.path);
    assert.ok(!id.includes(origin));
  }
});
test('a missing retained script uses the season page only once',async()=>{
  const {script:_script,...legacy}=ref;
  const {provider,calls}=mockProvider({...healthyRoutes,[base+ref.path]:`<script src='episodes.js?filever=1'></script>`});
  const r=await provider.streams(encodeEpisode([legacy]));assert.equal(r.streams.length,1);assert.equal(calls.length,5);
});
test('failed, unknown, malformed, dead, duplicate and slow players do not fail healthy links',async()=>{
  const routes={...healthyRoutes,
    [base+ref.script]:`eps1=['https://ansembed.test/e'];eps2=['https://dead.test/e'];eps3=['https://unknown.test/e'];eps4=['https://slow.test/e'];eps5=['https://ansembed.test/e'];eps6=['https://bad.test/e'];`,
    'https://unknown.test/e':'<script>var ads="https://ad.test/video.mp4";</script>',
    'https://bad.test/e':'<script>sources: malformed</script>',
    'https://slow.test/e':()=>new Promise(()=>{})};
  const {provider}=mockProvider(routes);
  const r=await provider.streams(encodeEpisode([ref]));
  assert.equal(r.streams.length,1);assert.equal(r.metrics.players,5);assert.ok(r.metrics.elapsedMs<150);
  assert.ok(r.metrics.hosts.some(h=>h.host==='slow.test'&&h.streams===0));
});
test('host concurrency is bounded while extra queued hosts still get attempted',async()=>{
  let active=0,maxActive=0;
  const routes={[base+ref.script]:Array.from({length:7},(_,i)=>`eps${i+1}=['https://host${i}.test/e'];`).join('')};
  for(let i=0;i<7;i++)routes[`https://host${i}.test/e`]=async()=>{
    active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,4));active--;return new Response('<html>No player</html>');
  };
  const {provider}=mockProvider(routes,{extractorConcurrency:2});
  const r=await provider.streams(encodeEpisode([ref]));assert.equal(r.streams.length,0);assert.equal(maxActive,2);assert.equal(r.metrics.hosts.length,7);
});
test('concurrent resolutions coalesce discovery but never cache signed stream URLs',async()=>{
  const routes={...healthyRoutes,[base+ref.script]:async()=>{await new Promise(r=>setTimeout(r,5));return new Response(`eps1=['https://ansembed.test/e'];`);}};
  const {provider,calls}=mockProvider(routes);
  const [a,b]=await Promise.all([provider.streams(encodeEpisode([ref])),provider.streams(encodeEpisode([ref]))]);
  assert.equal(a.streams.length,1);assert.equal(b.streams.length,1);assert.equal(calls.filter(c=>c.url===base+ref.script).length,1);
  await provider.streams(encodeEpisode([ref]));assert.equal(calls.filter(c=>c.url===base+ref.script).length,2);
});
test('empty selected-language references make no HTTP requests',async()=>{
  const {provider,calls}=mockProvider({});const r=await provider.streams(encodeEpisode([],'vf'));assert.deepEqual(r.streams,[]);assert.equal(calls.length,0);
});
test('Sendvid placeholder is excluded even when HTTP reports success',async()=>{
  const bytes=new Uint8Array(44),v=new DataView(bytes.buffer);v.setUint32(0,44);bytes.set([109,111,111,118],4);v.setUint32(8,36);bytes.set([109,118,104,100],12);v.setUint32(28,1000);v.setUint32(32,5000);
  const {provider,calls}=mockProvider({[base+ref.script]:`eps1=['https://sendvid.com/embed/id'];`,'https://sendvid.com/embed/id':`<video><source src='https://cdn.test/video.mp4'></video>`,'https://cdn.test/video.mp4':new Response(bytes,{headers:{'content-type':'video/mp4'}})});
  const r=await provider.streams(encodeEpisode([ref]));assert.equal(r.streams.length,0);assert.match(r.metrics.hosts[0].reason,/placeholder/);assert.equal(calls[2].headers.Range,'bytes=0-65535');
});
test('HLS validation falls back after a denied highest variant and rejects HTML/empty masters',async()=>{
  const {provider,calls}=mockProvider({...healthyRoutes,'https://cdn.test/master.m3u8':master+'\n#EXT-X-STREAM-INF:RESOLUTION=854x480\nlow.m3u8','https://cdn.test/high.m3u8':new Response('denied',{status:403}),'https://cdn.test/low.m3u8':media});
  const r=await provider.streams(encodeEpisode([ref]));assert.equal(r.streams[0].quality,'480p');assert.equal(r.streams[0].url,'https://cdn.test/low.m3u8');assert.equal(r.streams[0].adaptive,undefined);assert.equal(calls.length,5);
  for(const body of ['<html>Error #EXTM3U</html>','#EXTM3U']) {
    const p=mockProvider({...healthyRoutes,'https://cdn.test/master.m3u8':body}).provider;
    assert.equal((await p.streams(encodeEpisode([ref]))).streams.length,0);
  }
});
test('HLS aliases are fallbacks; first healthy one prevents mirror fetches',async()=>{
  const {provider,calls}=mockProvider({...healthyRoutes,'https://ansembed.test/e':`<script>var cfg={hls:'https://cdn.test/master.m3u8',hls2:'https://cdn.test/mirror.txt'};sources:[{file:cfg.hls||cfg.hls2}]</script>`});
  const r=await provider.streams(encodeEpisode([ref]));assert.equal(r.streams.length,1);assert.equal(calls.length,4);
});
test('direct video HEAD 405 stays usable; HTML is rejected',async()=>{
  const routes={[base+ref.script]:`eps1=['https://generic.test/e'];`,'https://generic.test/e':`<video src='https://cdn.test/video.mp4'></video>`,'https://cdn.test/video.mp4':new Response(null,{status:405})};
  assert.equal((await mockProvider(routes).provider.streams(encodeEpisode([ref]))).streams.length,1);
  routes['https://cdn.test/video.mp4']=new Response(null,{headers:{'Content-Type':'text/html'}});
  assert.equal((await mockProvider(routes).provider.streams(encodeEpisode([ref]))).streams.length,0);
});
test('deduplication retains language/header distinctions and omits unknown metadata',()=>{
  const a={url:'https://cdn.test/a.mp4',type:'video',source:'Test',version:'VOSTFR',headers:{Referer:'https://p.test'}};
  const b=streamObject(a);assert.equal(b.quality,undefined);assert.equal(b.codecs,undefined);assert.equal(b.audioLanguages,undefined);
  assert.equal(deduplicate([b,b,{...b,version:'VF'},{...b,headers:{Referer:'https://q.test'}}]).length,3);
  assert.deepEqual(addonStream(b).behaviorHints.proxyHeaders.request,b.headers);
});
test('cache TTL/LRU, failed loaders and in-flight work behave deterministically',async()=>{
  let time=0,count=0;const cache=new Cache(2,()=>time),load=async()=>++count;
  assert.equal(await cache.get('a',10,load),1);assert.equal(await cache.get('a',10,load),1);
  assert.equal(await cache.get('a',0,load),2);time=11;assert.equal(await cache.get('a',10,load),3);
  await cache.get('b',10,load);await cache.get('c',10,load);assert.equal(cache.entries.size,2);
  await assert.rejects(cache.get('fail',10,()=>Promise.reject(new Error('bad'))));assert.equal(await cache.get('fail',10,load),6);
});
test('HTTP cancellation and timeouts bound even a fetch shim that ignores AbortSignal',async()=>{
  const client=new HttpClient(configuration({requestTimeoutMs:15}),()=>new Promise(()=>{}));
  await assert.rejects(client.request('https://slow.test'),{code:'TIMEOUT'});
  const c=new AbortController();c.abort();await assert.rejects(client.request('https://slow.test',{signal:c.signal}),{code:'ABORTED'});
});
test('bounded MP4 prefix reader cancels a stream when Range is ignored',async()=>{
  let canceled=false;
  const client=new HttpClient(configuration(),async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(131072));},cancel(){canceled=true;}})));
  const r=await client.request('https://cdn.test/video.mp4',{binary:true,prefix:true,maxBytes:65536});assert.equal(r.body.length,65536);assert.equal(canceled,true);
});
test('canceling one caller leaves another coalesced episode-data request alive',async()=>{
  const {provider,calls}=mockProvider({...healthyRoutes,[base+ref.script]:async()=>{await new Promise(r=>setTimeout(r,15));return new Response(`eps1=['https://ansembed.test/e'];`);}});
  const controller=new AbortController();
  const a=provider.streams(encodeEpisode([ref]),{signal:controller.signal});
  const b=provider.streams(encodeEpisode([ref]));
  setTimeout(()=>controller.abort(),3);
  const [one,two]=await Promise.all([a,b]);assert.equal(one.streams.length,0);assert.equal(two.streams.length,1);assert.equal(calls.filter(c=>c.url===base+ref.script).length,1);
});
