const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeEpisode } = require('../src/ids');
const { runNative } = require('./helpers/nuvio-runtime');
const {version} = require('../package.json');
const fs = require('node:fs');
const path = require('node:path');

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
function automaticRoutes() {
  const path='/catalogue/one-piece/saison1/vostfr/';
  return {
    'https://catalog.nuvio.tv/meta/series/tmdb:37854.json':JSON.stringify({meta:{id:'tt0388629',type:'series',name:'One Piece',genres:['Animation'],released:'1999-10-20',videos:[{season:1,episode:1}]}}),
    'https://www.themoviedb.org/tv/37854':'<script type="application/ld+json">{"@type":"TVSeries","name":"ONE PIECE","genre":["Animation"],"startDate":"1999-10-20"}</script>',
    'https://www.themoviedb.org/tv/37854/season/1':'<div class="episode_list"><article class="episode"><span class="episode_number">1</span></article></div>',
    'https://kitsu.io/api/edge/anime/12':JSON.stringify({data:{attributes:{canonicalTitle:'One Piece',startDate:'1999-10-20',subtype:'TV'}}}),
    'https://anime-sama.to/catalogue/?type%5B%5D=Anime&search=ONE%20PIECE&page=1':'<a href="/catalogue/one-piece/"><h3>One Piece</h3><img src="/cover.jpg"></a>',
    'https://anime-sama.to/catalogue/?type%5B%5D=Anime&search=One%20Piece&page=1':'<a href="/catalogue/one-piece/"><h3>One Piece</h3><img src="/cover.jpg"></a>',
    'https://anime-sama.to/catalogue/one-piece/':'<h1>One Piece</h1><span class="info-lbl">Année</span><span>1999</span><script>panneauAnime("Saga 1 [Episode 1 à 61]","saison1/vostfr/");</script>',
    ['https://anime-sama.to'+path]:'<script src="episodes.js"></script><script>finirListe(1);</script>',
    ['https://anime-sama.to'+path+'episodes.js']:"eps1=['https://ansembed.net/e'];",
    'https://ansembed.net/e':"<video src='https://cdn.test/video.mp4'></video>",
    'https://cdn.test/video.mp4':''
  };
}
test('fresh-install Nuvio Catalog resolution works without a key and waits for native teardown',async()=>{
  const result=await runNative({},['37854','series',1,1],automaticRoutes(),{drainNative:true});
  assert.equal(result.streams.length,1,result.logs.join('\n'));assert.equal(result.streams[0].version,'VOSTFR');
  assert.equal(result.calls.filter(c=>c.url.includes('episodes.js')).length,1,'reuse episode data within this native call');
  assert.equal(result.calls.filter(c=>c.url.includes('catalog.nuvio.tv')).length,1);
  assert.ok(!result.calls.some(c=>c.url.includes('themoviedb.org')));
  assert.ok(result.runtimeDrainMs<500,`Canceled timers added ${result.runtimeDrainMs}ms`);
});
test('Nuvio settings evaluate with the same module wrapper and publish a visible diagnostic toggle',async()=>{
  const result=await runNative({},[],{}, {settingsLayout:true});
  assert.equal(result.calls.length,0);
  assert.ok(result.streams.some(f=>f.type==='info' && f.label.includes(version)));
  assert.equal(result.streams.find(f=>f.key==='diagnostics').type,'toggle');
});
test('Ktor empty query/fragment markers do not reject a base URL, while actual URL components remain invalid',async()=>{
  const sourceMap=JSON.stringify({'tv:123':{seasons:{1:{path:'/catalogue/test/saison1/',languages:['vf']}}}});
  const routes={
    'https://domain-b.example/catalogue/test/saison1/vf/episodes.js':"eps1=['https://ansembed.net/e'];",
    'https://ansembed.net/e':"<video src='https://cdn.test/video.mp4'></video>",
    'https://cdn.test/video.mp4':''
  };
  const ok=await runNative({animeSamaBaseUrl:'https://domain-b.example',sourceMap},['123','tv',1,1],routes);
  assert.equal(ok.streams.length,1,ok.logs.join('\n'));
  for(const suffix of ['?a=1','#fragment','/catalogue/']) {
    const bad=await runNative({animeSamaBaseUrl:'https://domain-b.example'+suffix,sourceMap},['123','tv',1,1],routes);
    assert.deepEqual(bad.streams,[]);assert.equal(bad.calls.length,0);
  }
});
test('fresh-install QuickJS accepts Kitsu catalog IDs and series media type without a manual map',async()=>{
  const result=await runNative({},['kitsu:12:1','series',1,1],automaticRoutes());
  assert.equal(result.streams.length,1,result.logs.join('\n'));assert.equal(result.streams[0].source,'ANSEmbed');
  assert.ok(!result.calls.some(c=>c.url.includes('themoviedb.org')));
});
test('Android TV resolves catalog episodes with its actual timerless polyfills and synchronous HTTP bridge',async()=>{
  const result=await runNative({},['37854','tv',1,1],automaticRoutes(),{tvRuntime:true,drainNative:true});
  assert.equal(result.streams.length,1,result.logs.join('\n'));
  assert.equal(result.streams[0].name,'Anime-Sama • VOSTFR');
  assert.equal(result.streams[0].headers.Origin,'https://ansembed.net');
  assert.ok(result.calls.length>1);
});
test('timerless Android TV skips dead/duplicate players and retains a healthy alternate host',async()=>{
  const ref={path:'/catalogue/test/saison1/vf/',index:0,language:'vf',script:'/catalogue/test/saison1/vf/episodes.js'};
  const routes={
    ['https://domain-b.example'+ref.script]:"eps1=['https://ansembed.net/dead'];eps2=['https://ansembed.net/good'];eps3=['https://ansembed.net/good'];",
    'https://ansembed.net/good':"<video src='https://cdn.test/video.mp4'></video>",
    'https://cdn.test/video.mp4':''
  };
  const result=await runNative({animeSamaBaseUrl:'https://domain-b.example'},[encodeEpisode([ref]),'tv',1,1],routes,{tvRuntime:true});
  assert.equal(result.streams.length,1,result.logs.join('\n'));assert.equal(result.streams[0].version,'VF');
  assert.equal(result.calls.filter(c=>c.url==='https://ansembed.net/good').length,1);
  assert.equal(result.streams[0].headers.Referer,'https://ansembed.net/good');
});
test('timerless TV stops after a working host per edition while preserving both VF and VOSTFR',async()=>{
  const refs=['vostfr','vf'].map(language=>({path:`/catalogue/test/saison1/${language}/`,index:0,language,script:`/catalogue/test/saison1/${language}/episodes.js`}));
  const routes={};
  for(const ref of refs) {
    routes['https://domain-b.example'+ref.script]=`eps1=['https://ansembed.net/${ref.language}'];eps2=['https://slow.test/${ref.language}'];`;
    routes['https://ansembed.net/'+ref.language]=`<video src='https://cdn.test/${ref.language}.mp4'></video>`;
    routes[`https://cdn.test/${ref.language}.mp4`]='';
  }
  const result=await runNative({animeSamaBaseUrl:'https://domain-b.example'},[encodeEpisode(refs),'tv',1,1],routes,{tvRuntime:true});
  assert.deepEqual(result.streams.map(s=>s.version).sort(),['VF','VOSTFR']);
  assert.ok(!result.calls.some(c=>c.url.includes('slow.test')),'a secondary blocking host must not delay an already working edition');
});
test('newer timerless TV binary-capable polyfills retain compatibility with the same bundle',async()=>{
  const result=await runNative({},['37854','tv',1,1],automaticRoutes(),{tvRuntime:true,modernTv:true});
  assert.equal(result.streams.length,1,result.logs.join('\n'));
});
test('phone and timerless TV resolve S23 E1180 through Saga 12 using the correct cached player position',async()=>{
  const routes=automaticRoutes();
  const base='https://anime-sama.to',group='/catalogue/one-piece/saison12/vostfr/';
  routes['https://catalog.nuvio.tv/meta/series/tmdb:37854.json']=JSON.stringify({meta:{name:'One Piece',genres:['Animation'],released:'1999-10-20',videos:[
    ...Array.from({length:1155},(_,i)=>({season:22,episode:i+1})),
    ...Array.from({length:25},(_,i)=>({season:23,episode:1156+i}))
  ]}});
  routes[base+'/catalogue/one-piece/']='<h1>One Piece</h1><script>panneauAnime("Saga 11 [Episode 1089 à 1155]","saison11/vostfr/");panneauAnime("Saga 12 [Episode 1156 à ...]","saison12/vostfr/");</script>';
  routes[base+group]=fs.readFileSync(path.join(__dirname,'fixtures/one-piece-elbaf.html'),'utf8');
  routes[base+group+'episodes.js?filever=4747']='eps1='+JSON.stringify(Array.from({length:25},(_,i)=>`https://ansembed.net/episode-${1156+i}`));
  routes['https://ansembed.net/episode-1180']="<video src='https://cdn.test/video.mp4'></video>";
  for(const tvRuntime of [false,true]) {
    const result=await runNative({diagnostics:true},['37854','tv',23,1180],routes,{tvRuntime});
    assert.equal(result.streams.length,1,result.logs.join('\n'));
    assert.equal(result.streams[0].headers.Referer,'https://ansembed.net/episode-1180');
    assert.equal(result.calls.filter(c=>c.url.includes('episodes.js')).length,1,'reuse discovery without a second script fetch');
    assert.ok(result.calls.some(c=>c.url===base+group));
    assert.ok(!result.calls.some(c=>/saison23|episode-1156|saison11\/vostfr\//.test(c.url)));
    assert.ok(result.logs.some(l=>l.includes('"index":24')));
  }
});
