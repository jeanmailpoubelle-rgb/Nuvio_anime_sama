const {test} = require('node:test');
const assert = require('node:assert/strict');
const {episodeReferences} = require('../src/episode-mapping');
function setup() {
  const path='/catalogue/example/';
  const group=n=>({path:path+`saison${n}/`,name:`Saison ${n}`,languages:['vostfr'],id:n+1});
  const regular=[1,2,3].map(group);
  const detail={path,groups:[regular[0],{path:path+'film/',name:'Film'},regular[1],{path:path+'oav/',name:'OAV'},regular[2],{path:path+'kai/',name:'Kai'}]};
  const versions=new Map(regular.map((g,i)=>[g.path, ['vostfr','vf'].map(language=>({group:g,path:g.path+language+'/',language,script:g.path+language+'/episodes.js',
    episodes:Array.from({length:[24,23,12][i]},(_,index)=>({index,number:index+1,servers:['https://player.test/'+language+'/'+index]}))}))]));
  const calls=[];
  const provider={config:{version:'all'},version:async(g,l)=>{calls.push(['canonical',g.path,l]);return versions.get(g.path)?.find(v=>v.language===l) || null;},
    versions:async g=>{calls.push(['selected',g.path]);return (versions.get(g.path)||[]).filter(v=>provider.config.version==='all'||v.language===provider.config.version);}};
  const context={singleSeason:true,absoluteOffset:0,episodes:Array.from({length:60},(_,i)=>({episode_number:i+1}))};
  return {provider,detail,context,regular,versions,calls};
}
test('flattened catalogs map both season boundaries, ignoring intervening films/OAV/Kai',async()=>{
  const {provider,detail,context,regular,calls}=setup();
  for(const [episode,season,index] of [[1,1,0],[24,1,23],[25,2,0],[47,2,22],[48,3,0],[59,3,11]]) {
    calls.length=0;
    const refs=await episodeReferences(provider,detail,context,1,episode);
    assert.deepEqual(refs.map(r=>[r.path,r.index]),['vostfr','vf'].map(l=>[regular[season-1].path+l+'/',index]));
    assert.deepEqual(calls.filter(c=>c[0]==='canonical').map(c=>c[1]),regular.slice(0,season).map(g=>g.path));
    assert.deepEqual(calls.filter(c=>c[0]==='selected').map(c=>c[1]),[regular[season-1].path]);
  }
  await assert.rejects(episodeReferences(provider,detail,context,1,60),{code:'SOURCE_EPISODE_UNAVAILABLE'});
  const refs=await episodeReferences(provider,detail,{absolute:true},1,25);
  assert.equal(refs[0].path,regular[1].path+'vostfr/');
});
test('canonical counts retain dead slots and ignore lagging VF lengths and inserted specials',async()=>{
  const {provider,detail,context,regular,versions}=setup();
  const first=versions.get(regular[0].path), second=versions.get(regular[1].path);
  first[0].episodes[5].servers=[];
  first[1].episodes.length=5; // Never shift E25 because the earlier dub is late.
  second[1].episodes.length=1;
  second[0].episodes.splice(0,0,{number:null,index:0,servers:['https://player.test/special']});
  second[0].episodes.forEach((s,index)=>{s.index=index;});
  let refs=await episodeReferences(provider,detail,context,1,25);
  assert.deepEqual(refs.map(r=>[r.language,r.index]),[['vostfr',1],['vf',0]]);
  refs=await episodeReferences(provider,detail,context,1,26);
  assert.deepEqual(refs.map(r=>[r.language,r.index]),[['vostfr',2]]);
  provider.config.version='vf';
  await assert.rejects(episodeReferences(provider,detail,context,1,26),{code:'SOURCE_EPISODE_UNAVAILABLE'});
});
test('global source labels and catalog number gaps retain their actual episode identities',async()=>{
  const {provider,detail,context,regular,versions}=setup();
  versions.get(regular[1].path)[0].episodes.forEach(s=>{s.number+=24;});
  const refs=await episodeReferences(provider,detail,context,1,25);
  assert.deepEqual(refs.map(r=>r.index),[0,0]);
  context.episodes.splice(1,1);
  assert.equal((await episodeReferences(provider,detail,context,1,3))[0].index,2,'a missing catalog row cannot renumber E3 to E2');
});
test('missing canonical seasons, gaps and duplicate episode labels fail safely',async()=>{
  for(const failure of ['missing-page','missing-group','number-gap','duplicate']) {
    const {provider,detail,context,regular,versions}=setup();
    if(failure==='missing-page')versions.delete(regular[0].path);
    if(failure==='missing-group')detail.groups=detail.groups.filter(g=>g!==regular[1]);
    if(failure==='number-gap')versions.get(regular[0].path)[0].episodes.splice(3,1);
    if(failure==='duplicate')versions.get(regular[0].path)[0].episodes[3].number=3;
    await assert.rejects(episodeReferences(provider,detail,context,1,25),{code:failure==='missing-page'?'SOURCE_LAYOUT_UNAVAILABLE':'SOURCE_LAYOUT_AMBIGUOUS'});
  }
});
test('ordinary multi-season catalogs retain direct season mappings without flattening',async()=>{
  const {provider,detail,context,regular,calls}=setup();
  context.singleSeason=false;
  await assert.rejects(episodeReferences(provider,detail,context,1,25),{code:'SOURCE_EPISODE_UNAVAILABLE'});
  assert.equal((await episodeReferences(provider,detail,context,2,1))[0].path,regular[1].path+'vostfr/');
  assert.ok(!calls.some(c=>c[0]==='canonical'));
});
test('a flattened catalog with explicit source saga ranges uses those ranges without counting earlier seasons',async()=>{
  const {provider,detail,context,regular,versions,calls}=setup();
  const starts=[1,25,48],ends=[24,47,'...'];
  regular.forEach((g,i)=>{
    g.name=`Saga ${i+1} [Episode ${starts[i]} à ${ends[i]}]`;
    versions.get(g.path).forEach(v=>v.episodes.forEach(e=>{e.number+=starts[i]-1;}));
  });
  context.episodes.splice(1,1); // Keep explicit numbers even if a catalog row is missing.
  assert.equal((await episodeReferences(provider,detail,context,1,25))[0].index,0);
  assert.equal((await episodeReferences(provider,detail,context,1,59))[0].index,11);
  assert.ok(!calls.some(c=>c[0]==='canonical'),'published ranges eliminate prefix discovery');
});
