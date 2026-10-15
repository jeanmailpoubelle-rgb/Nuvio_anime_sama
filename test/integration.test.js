const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { AnimeSamaProvider } = require('../src/provider');
const Addon = require('../src/addon');
const { createServer } = require('../src/server');
const { resolveSelection, getStreams, onSettings } = require('../src/native');
const { encodeEpisode } = require('../src/ids');
const { parse:parseHls } = require('../src/extractors/hls');
const read=name=>fs.readFileSync(__dirname+'/fixtures/'+name,'utf8');
function provider() {
  const calls=[];
  const p=new AnimeSamaProvider({animeSamaBaseUrl:'https://domain-b.example'}, {fetch:async url=>{
    calls.push(url);const u=new URL(url);let body;
    if(u.pathname==='/catalogue/')body=read('search.html');
    else if(u.pathname==='/catalogue/jujutsu-kaisen/')body=read('jujutsu.html');
    else if(u.pathname.endsWith('/saison1/vostfr/'))body=read('jjk-season.html');
    else if(u.pathname.endsWith('/saison1/vf/'))body=read('jjk-vf.html');
    else if(u.pathname.includes('/saison1/vostfr/episodes.js'))body=read('jjk-season.js');
    else if(u.pathname.includes('/saison1/vf/episodes.js'))body=read('jjk-vf.js');
    return new Response(body||'',{status:body?200:404});
  }});
  return {p,calls};
}
test('search → addon metadata → selected episode preserves both versions and website order',async()=>{
  const {p}=provider();
  const c=await Addon.catalog(p,'series','as-all',{search:'Jujutsu'});
  assert.equal(c.metas.length,1);assert.equal(c.metas[0].id,'as:jujutsu-kaisen');
  const {meta}=await Addon.meta(p,'series',c.metas[0].id);
  assert.equal(meta.videos.length,24);assert.equal(meta.videos[0].season,1);assert.equal(meta.videos[0].episode,1);
  assert.ok(meta.videos[0].overview.includes('VF'));assert.ok(meta.videos[0].overview.includes('VOSTFR'));
  const vf=await Addon.meta(p,'series','as:jujutsu-kaisen:vf');assert.ok(!vf.meta.videos[0].overview.includes('VOSTFR'));
});
test('explicit native mapping bypasses all metadata/search requests and keeps relative paths',async()=>{
  const {p,calls}=provider();
  const settings={sourceMap:JSON.stringify({'tv:95479':{seasons:{1:{path:'/catalogue/jujutsu-kaisen/saison1/',indexOffset:0,languages:['vostfr']}}}})};
  const refs=await resolveSelection(p,'95479','tv',1,4,settings,'');
  assert.equal(calls.length,0);assert.equal(refs[0].index,3);assert.equal(refs[0].script,'/catalogue/jujutsu-kaisen/saison1/vostfr/episodes.js');
  assert.deepEqual(await resolveSelection(p,'95479','tv',2,1,settings,''),[]);
  await assert.rejects(resolveSelection(p,'95479','tv',1,1,{sourceMap:'invalid'},''));
});
test('automatic native matching preserves published episodes when catalog counts differ',async()=>{
  const {p}=provider();
  const original=p.http.fetch;let count=24;
  p.http.fetch=async(url,opts)=>url.startsWith('https://api.themoviedb.org')?new Response(JSON.stringify(url.includes('/season/')?{episodes:Array.from({length:count},(_,i)=>({episode_number:i+1}))}:{name:'Jujutsu Kaisen',genres:[{id:16}],first_air_date:'2020-10-03'})):original(url,opts);
  const refs=await resolveSelection(p,'95479','tv',1,2,{},'test-key');assert.equal(refs.length,2);assert.equal(refs[0].index,1);
  count=25;assert.equal((await resolveSelection(p,'95479','tv',1,2,{},'test-key')).length,2);
  await assert.rejects(resolveSelection(p,'95479','tv',1,25,{},'test-key'),{code:'SOURCE_EPISODE_UNAVAILABLE'});
});
test('native plugin fails soft on unsupported IDs and publishes editable settings',async()=>{
  assert.deepEqual(await getStreams('not-a-tmdb-id','tv',1,1),[]);
  assert.equal(onSettings().find(f=>f.key==='animeSamaBaseUrl').type,'text');
  assert.equal(onSettings().find(f=>f.key==='diagnostics').type,'toggle');
  assert.ok(onSettings().every(f=>['info','header','text','select','toggle'].includes(f.type)));
  const m=require('../manifest.json');assert.equal(m.scrapers[0].hasSettings,true);assert.equal(m.scrapers[0].filename,'providers/anime-sama.js');
});
test('HTTP addon serves discovery/metadata/streams and native plugin files as different contracts',async t=>{
  const {p}=provider();const server=createServer({provider:p});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const m=await (await fetch(base+'/manifest.json')).json();assert.ok(m.catalogs.length>=7);assert.equal(m.resources[0].name,'catalog');
  const plugin=await(await fetch(base+'/plugin/manifest.json')).json();assert.equal(plugin.scrapers[0].id,'anime-sama');
  const bundle=await fetch(base+'/plugin/providers/anime-sama.js');assert.equal(bundle.status,200);assert.ok((await bundle.text()).includes('getStreams'));
  const c=await(await fetch(base+'/catalog/series/as-all/search=Jujutsu.json')).json();assert.equal(c.metas.length,1);
  const d=await(await fetch(base+'/meta/series/as%3Ajujutsu-kaisen.json')).json();assert.equal(d.meta.name,'Jujutsu Kaisen');
  const r=await fetch(base+'/stream/series/'+encodeURIComponent(encodeEpisode([],'vf'))+'.json');assert.deepEqual(await r.json(),{streams:[]});assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+'/health')).headers.get('access-control-allow-origin'),'*');
  assert.equal((await fetch(base+'/missing')).status,404);
});
test('HLS with external audio stays a master stream, preserving rendition associations',()=>{
  const body='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="jp",LANGUAGE="ja",URI="ja.m3u8"\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,AUDIO="jp"\nvideo.m3u8';
  const p=parseHls(body,'https://cdn.test/master.m3u8');assert.equal(p.tracks[0].language,'ja');assert.equal(p.variants[0].audioGroup,'jp');
});
test('a VF-only playlist keeps known VOSTFR-only episode gaps unavailable',async()=>{
  const p=new AnimeSamaProvider({animeSamaBaseUrl:'https://domain-b.example'});
  const groups=[{path:'/catalogue/example/saison1/',name:'Saison 1',id:1},{path:'/catalogue/example/saison2/',name:'Saison 2',id:2}];
  p.details=async()=>({title:'Example',groups});
  p.versions=async g=>[{group:g,language:'vostfr',path:g.path+'vostfr/',script:g.path+'vostfr/episodes.js',episodes:[{name:'Épisode 1',number:1,index:0,servers:['https://host.test/e']}]}];
  const result=await p.episodes('/catalogue/example/','vf');assert.equal(result.episodes.length,2);assert.equal(result.episodes[1].season,2);
  for(const row of result.episodes){assert.equal(row.available,false);assert.equal((await p.streams(row.id)).metrics.requests,0);}
});
test('automatic native selection reuses the episode data it just fetched, avoiding a duplicate GET',async()=>{
  const {p,calls}=provider();
  const original=p.http.fetch;
  p.http.fetch=async(url,opts)=>url.startsWith('https://api.themoviedb.org')?new Response(JSON.stringify(url.includes('/season/')?{episodes:Array.from({length:24},()=>({}))}:{name:'Jujutsu Kaisen',genres:[{id:16}],first_air_date:'2020-10-03'})):original(url,opts);
  const refs=await resolveSelection(p,'95479','tv',1,1,{},'test-key');
  const before=calls.filter(u=>u.includes('episodes.js')).length;
  await p.streams(encodeEpisode(refs),{reuseDiscovery:true});
  assert.equal(calls.filter(u=>u.includes('episodes.js')).length,before);
});
