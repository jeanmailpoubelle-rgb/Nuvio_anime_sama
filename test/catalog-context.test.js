const {test} = require('node:test');
const assert = require('node:assert/strict');
const Catalog = require('../src/catalog-context');
const {sourceTitle,chooseCatalogEpisode,episodeReferences} = require('../src/native');
const {AnimeSamaProvider} = require('../src/provider');
const Pages = require('../src/pages');
const fs = require('node:fs');
const path = require('node:path');
const titleHtml = '<script type="application/ld+json">/* <![CDATA[ */'+JSON.stringify({'@type':'TVSeries',name:'ONE PIECE',genre:['Animation','Adventure'],startDate:'1999-10-20'})+'/* ]]> */</script>';
const seasonHtml = '<section class="episode_list">'+[62,63,64].map(n=>`<article class="episode"><span class="episode_number">${n}</span><h3 class="episode_title"><a>Episode ${n}</a></h3></article>`).join('')+'</section>';
test('native catalog IDs accept TMDB, IMDb and Kitsu with episode suffixes',()=>{
  for(const id of ['37854','tmdb:37854','series:37854:1:1','tmdb/37854'])assert.equal(Catalog.nativeId(id),'37854');
  assert.equal(Catalog.nativeId('tt0388629:1:1'),'tt0388629');assert.equal(Catalog.nativeId('kitsu:12:1'),'kitsu:12');assert.equal(Catalog.nativeId('kitsu-anime:12'),'kitsu:12');
  assert.equal(Catalog.nativeId('unsupported:12'),null);
});
test('public metadata and actual season numbers parse without an API credential',()=>{
  const t=Catalog.publicTitle(titleHtml,'tv');assert.equal(t.name,'ONE PIECE');assert.equal(t.first_air_date,'1999-10-20');assert.equal(t.genres[0].id,16);
  assert.deepEqual(Catalog.publicSeason(seasonHtml).episodes.map(e=>e.episode_number),[62,63,64]);
  assert.throws(()=>Catalog.publicTitle('<script type="application/ld+json">{"@type":"WebSite","name":"TMDB"}</script>','tv'));
  assert.throws(()=>Catalog.publicSeason('<html>No episode list</html>'));
});
test('a missing/rejected app TMDB key falls back to public title/season metadata',async()=>{
  const calls=[];const provider=new AnimeSamaProvider({}, {fetch:async url=>{calls.push(url);return new Response(url.includes('api.themoviedb.org')?'{}':url.includes('/season/')?seasonHtml:titleHtml,{status:url.includes('api.themoviedb.org')?401:200});}});
  assert.equal((await Catalog.titleContext(provider,'37854','tv','test-key')).name,'ONE PIECE');
  assert.equal((await Catalog.seasonContext(provider,'37854',2,'test-key')).episodes[0].episode_number,62);
  assert.equal(calls.length,5);assert.equal(calls.filter(u=>u.startsWith('https://www.themoviedb.org')).length,2);
});
test('Nuvio Catalog resolves the exact catalog identity and season in one keyless request',async()=>{
  const calls=[];
  const provider=new AnimeSamaProvider({}, {fetch:async url=>{
    calls.push(url);
    assert.equal(url,'https://catalog.nuvio.tv/meta/series/tmdb:37854.json');
    return new Response(JSON.stringify({meta:{id:'tt0388629',type:'series',name:'One Piece',genres:['Animation'],released:'1999-10-20',videos:[{season:0,episode:1},{season:1,episode:1},{season:1,episode:2},{season:2,episode:1}]}}));
  }});
  const metadata=await Catalog.titleContext(provider,'37854','tv','unneeded-key',2);
  const season=await Catalog.seasonContext(provider,'37854',2,'unneeded-key',metadata);
  assert.equal(metadata.name,'One Piece');assert.equal(metadata.genres[0].id,16);
  assert.equal(season.absoluteOffset,2);assert.equal(season.episodes[0].episode_number,1);assert.equal(calls.length,1);
});
test('Kitsu anime identities need no TMDB translation or invented episode count',async()=>{
  const calls=[];const provider=new AnimeSamaProvider({}, {fetch:async url=>{calls.push(url);return new Response(JSON.stringify({data:{attributes:{canonicalTitle:'One Piece',titles:{en:'One Piece'},startDate:'1999-10-20',subtype:'TV',episodeCount:null}}}));}});
  const metadata=await Catalog.titleContext(provider,'kitsu:12','tv','');assert.equal(metadata.name,'One Piece');assert.equal(metadata.genres[0].id,16);
  const context=await Catalog.seasonContext(provider,'kitsu:12',1,'',metadata);assert.deepEqual(chooseCatalogEpisode(context,62),{number:62,position:61});assert.equal(calls.length,1);
});
test('source alias matching resolves translated titles while excluding spinoffs',async()=>{
  const provider={search:async()=>({items:[{path:'/catalogue/junior/',title:'Junior High'},{path:'/catalogue/titan/',title:'Shingeki no Kyojin'}]}),details:async path=>path.includes('junior')?{path,title:'Junior High',aliases:['Attack on Titan Junior High'],year:2015}:{path,title:'Shingeki no Kyojin',aliases:['Attack on Titan'],year:2013}};
  const selected=await sourceTitle(provider,{name:'Attack on Titan',first_air_date:'2013-04-07'},'tv');assert.equal(selected.path,'/catalogue/titan/');
  await assert.rejects(sourceTitle(provider,{name:'Attack on Titan',first_air_date:'2023-04-07'},'tv'),{code:'NO_EXACT_SOURCE_ALIAS'});
});
test('declared source saga ranges map seasonal or continuous catalog episode numbers',async()=>{
  const group1={path:'/catalogue/one-piece/saison1/',name:'Saga 1 [Episode 1 à 61]'};
  const group2={path:'/catalogue/one-piece/saison2/',name:'Saga 2 [Episode 62 à 143]'};
  const calls=[];const provider={config:{version:'vostfr'},versions:async group=>{calls.push(group.path);return [{path:group.path+'vostfr/',language:'vostfr',script:group.path+'vostfr/episodes.js',episodes:Array.from({length:group===group1?61:82},(_,index)=>({index,number:(group===group1?1:62)+index,servers:['https://player.test/e']}))}];}};
  const detail={path:'/catalogue/one-piece/',groups:[group1,group2]};
  const catalog={episodes:[62,63,64].map(episode_number=>({episode_number}))};
  for(const [season,episode,context] of [[2,1,catalog],[2,62,catalog],[1,62,{absolute:true}]]) {
    const refs=await episodeReferences(provider,detail,context,season,episode);assert.equal(refs[0].path,group2.path+'vostfr/');assert.equal(refs[0].index,0);
  }
  assert.ok(calls.every(p=>p===group2.path));
});
test('ongoing sagas map catalog seasons and absolute/local numbers to exact published slots',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'fixtures/one-piece-elbaf.html'),'utf8');
  const egghead=fs.readFileSync(path.join(__dirname,'fixtures/one-piece-egghead.html'),'utf8');
  const closed={path:'/catalogue/one-piece/saison11/',name:'Saga 11 [Episode 1089 à 1155]'};
  const open={path:'/catalogue/one-piece/saison12/',name:'Saga 12 [Episode 1156 à ...]'};
  const detail={path:'/catalogue/one-piece/',groups:[closed,open]};
  const rows=(first,count)=>Array.from({length:count},(_,i)=>({episode_number:first+i}));
  const season23={episodes:rows(1156,25),absoluteOffset:1155};
  const calls=[];
  const provider={config:{version:'all'},versions:async group=>{
    calls.push(group.path);
    const count=group===closed?74:25;
    const script='eps1='+JSON.stringify(Array.from({length:count},(_,i)=>`https://player.test/${i}`));
    const episodes=Pages.episodeSlots(script,group===closed?egghead:html,'https://domain-b.example');
    return ['vostfr','vf'].map(language=>({path:group.path+language+'/',language,episodes:language==='vf'?episodes.slice(0,2):episodes}));
  }};
  for(const [context,season,episode,group,index] of [
    [season23,23,1180,open,24],[season23,23,25,open,24],
    [season23,23,1156,open,0],[season23,23,1,open,0],
    [{episodes:rows(1089,67),absoluteOffset:1088},22,1155,closed,73],
    [{absolute:true},1,1155,closed,73],[{absolute:true},1,1180,open,24],
    [{episodes:rows(1,25),absoluteOffset:1155},23,25,open,24]
  ]) {
    const refs=await episodeReferences(provider,detail,context,season,episode);
    assert.equal(refs[0].path,group.path+'vostfr/');assert.equal(refs[0].index,index);
    assert.ok(refs.every(r=>r.index===index));
    if(index>1)assert.ok(refs.every(r=>r.language==='vostfr'),'do not substitute an earlier VF episode');
  }
  for(const range of ['[Episode 1156 à ...]','[Épisodes 1156 à …]']) {
    const unicode={...detail,groups:[closed,{...open,name:range}]};
    assert.equal((await episodeReferences(provider,unicode,season23,23,1180))[0].index,24);
  }
  await assert.rejects(episodeReferences(provider,detail,{absolute:true},1,1181),{code:'SOURCE_EPISODE_UNAVAILABLE'});
  await assert.rejects(episodeReferences(provider,detail,{episodes:rows(1156,26),absoluteOffset:1155},23,1181),{code:'SOURCE_EPISODE_UNAVAILABLE'});
  assert.ok(calls.every(p=>[closed.path,open.path].includes(p)));
});
test('ambiguous ranges and conflicting source labels fail safely without positional substitution',async()=>{
  const group={path:'/catalogue/one-piece/saison12/',name:'Saga 12 [Episode 1156 à ...]'};
  const context={episodes:Array.from({length:25},(_,i)=>({episode_number:1156+i})),absoluteOffset:1155};
  let calls=0;
  const provider={config:{version:'vostfr'},versions:async()=>{
    calls++;
    return [{path:group.path+'vostfr/',language:'vostfr',episodes:Array.from({length:25},(_,index)=>({index,number:index+1,servers:['https://player.test/wrong']}))}];
  }};
  const detail={path:'/catalogue/one-piece/',groups:[group]};
  // Even when its path happens to equal the catalog season, a declared source
  // range must agree with the numbered slot. A malformed helper cannot play E25.
  await assert.rejects(episodeReferences(provider,detail,context,12,1180),{code:'SOURCE_EPISODE_UNAVAILABLE'});
  assert.equal(calls,1);
  detail.groups.push({path:'/catalogue/one-piece/saison13/',name:'Saga 13 [Episode 1180 à ...]'});
  await assert.rejects(episodeReferences(provider,detail,context,23,1180),{code:'SOURCE_SEASON_AMBIGUOUS'});
  assert.equal(calls,1,'reject overlapping saga ranges before network discovery');
});
test('unpublished VF slots stay unavailable while known VOSTFR slots resolve',async()=>{
  const g={path:'/catalogue/test/saison1/',name:'Saison 1'};
  const provider={config:{version:'all'},versions:async()=>['vf','vostfr'].map(language=>({path:g.path+language+'/',language,episodes:[{index:0,number:1,servers:language==='vf'?[]:['https://player.test/e']}]}))};
  const refs=await episodeReferences(provider,{path:'/catalogue/test/',groups:[g]},{episodes:[{episode_number:1},{episode_number:2}]},1,1);assert.equal(refs.length,1);assert.equal(refs[0].language,'vostfr');
});
test('oversized/truncated Cinemeta keeps complete metadata and requested-season rows without parsing the tail',()=>{
  const prefix=JSON.stringify({meta:{name:'One Piece',genres:['Animation'],releaseInfo:'1999–',videos:[{season:0,episode:1},{season:1,episode:1},{season:1,episode:2},{season:2,episode:1}]}});
  const truncated=prefix.slice(0,-3)+',{"season":23,"episode":';
  const first=Catalog.cinemetaMeta(truncated,1);assert.equal(first.name,'One Piece');assert.equal(first.catalogEpisodes.length,2);assert.equal(first.absoluteOffset,0);
  const second=Catalog.cinemetaMeta(truncated,2);assert.equal(second.catalogEpisodes.length,1);assert.equal(second.absoluteOffset,2);
});
