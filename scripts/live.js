// Opt-in HTTP verification. Reports deliberately omit stream URLs and signed queries.
const fs = require('node:fs/promises');
const { ProxyAgent, setGlobalDispatcher } = require('undici');
const { AnimeSamaProvider } = require('../src/provider');
const { encodeEpisode } = require('../src/ids');
const Hls = require('../src/extractors/hls');
const { createServer } = require('../src/server');
function configureProxy() {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));
}
async function sample(provider,stream) {
  if (stream.type !== 'hls') return {skipped:'HLS segment sample uses the first HLS stream'};
  const metrics={requests:0,requestCategories:{},networkMs:0};
  const opts={headers:stream.headers,category:'sample'};
  let r=await provider.http.request(stream.url,opts,metrics);
  let hls=Hls.parse(r.body,r.url);
  if(hls.variants.length) {r=await provider.http.request(hls.variants[0].url,opts,metrics);hls=Hls.parse(r.body,r.url);}
  if(!hls.segments.length)throw new Error('No media segments');
  const media=await provider.http.request(hls.segments[0],{...opts,headers:{...stream.headers,Range:'bytes=0-4095'},binary:true,prefix:true,maxBytes:4096},metrics);
  if(!media.body.length||[60,123].includes(media.body[0]))throw new Error('Invalid segment sample');
  return {status:media.status,bytes:media.body.length,contentType:media.headers.get('content-type'),requests:metrics.requests};
}
function publicStream(s) {
  return {source:s.source,quality:s.quality??null,version:s.version,type:s.type,audio:s.audioLanguages??null,subtitles:s.subtitleLanguages??null,
    codecs:s.codecs??null,videoRange:s.videoRange??null,name:s.name,playbackHeaderNames:Object.keys(s.headers),externalSubtitles:s.subtitles?.map(t=>({language:t.language,name:t.name}))||[]};
}
async function main() {
  configureProxy();
  const provider=new AnimeSamaProvider();
  const report={checkedAt:new Date().toISOString(),environment:'Cloud development machine through configured HTTPS proxy; HTTP validation, no device playback',browsing:{},cases:[]};
  let start=Date.now();
  const search=await provider.search('Jujutsu');
  report.browsing.search={ms:Date.now()-start,titles:search.items.map(c=>c.title),passed:search.items.some(c=>c.path==='/catalogue/jujutsu-kaisen/')};
  start=Date.now();const latest=await provider.catalog('latest');
  report.browsing.latest={ms:Date.now()-start,count:latest.items.length};
  start=Date.now();const metadata=await provider.episodes('/catalogue/jujutsu-kaisen/');
  report.browsing.metadata={ms:Date.now()-start,title:metadata.detail.title,year:metadata.detail.year,groups:metadata.detail.groups.map(g=>({name:g.name,key:g.id})),episodes:metadata.episodes.length,versions:[...new Set(metadata.versions.map(v=>v.language))]};
  const cases=[
    {name:'Jujutsu Kaisen S1 E1 VOSTFR',group:'/catalogue/jujutsu-kaisen/saison1/',language:'vostfr',index:0},
    {name:'Jujutsu Kaisen S1 E1 VF',group:'/catalogue/jujutsu-kaisen/saison1/',language:'vf',index:0},
    {name:'Jujutsu Kaisen S3 E1 (recent season)',group:'/catalogue/jujutsu-kaisen/saison3/',language:'vostfr',index:0},
    {name:'One Piece saga 2 E62 (older)',group:'/catalogue/one-piece/saison2/',language:'vostfr',index:0},
    {name:'One Piece first film',group:'/catalogue/one-piece/film/',language:'vostfr',index:0},
    {name:'Your Name film',group:'/catalogue/your-name/film/',language:'vostfr',index:0},
    {name:'Akashic Records E1',group:'/catalogue/akashic-records/saison1/',language:'vostfr',index:0},
    {name:'Akashic Records E2 (known dead/placeholder)',group:'/catalogue/akashic-records/saison1/',language:'vostfr',index:1}
  ];
  const refs=[];
  for(const c of cases) {
    try {
      const v=await provider.version({path:c.group,name:c.name,id:1,languages:[c.language]},c.language);
      if(!v)throw new Error('No published version');
      const ref={path:v.path,index:c.index,language:c.language,script:v.script};refs.push(ref);
      const r=await provider.streams(encodeEpisode([ref]));
      const row={test:c.name,path:v.path,episodeIndex:c.index,...r.metrics,returned:r.streams.map(publicStream)};
      if(r.streams.some(s=>s.type==='hls')) {
        try {row.mediaSample=await sample(provider,r.streams.find(s=>s.type==='hls'));}catch(_error){row.mediaSample={error:'Playlist or segment sample unavailable'};}
      }
      report.cases.push(row);
      console.log(JSON.stringify({test:row.test,players:row.players,streams:row.streams,ms:row.elapsedMs,requests:row.requests,sample:row.mediaSample}));
    } catch(_error){report.cases.push({test:c.name,error:'Source/version unavailable'});console.log(JSON.stringify(report.cases.at(-1)));}
  }
  if(refs.length>=2) {
    const t=Date.now();const results=await Promise.all(refs.slice(0,2).map(ref=>provider.streams(encodeEpisode([ref]))));
    report.simultaneous={ms:Date.now()-t,counts:results.map(r=>r.streams.length),requests:results.map(r=>r.metrics.requests)};
  }
  // Exercise the actual built provider entry with an explicit binding and no TMDB key.
  const native=require('../providers/anime-sama.js');
  globalThis.SCRAPER_SETTINGS={sourceMap:JSON.stringify({'tv:95479':{seasons:{1:{path:'/catalogue/jujutsu-kaisen/saison1/',languages:['vf']}}}})};
  const nativeStart=Date.now(),nativeStreams=await native.getStreams('95479','tv',1,1);
  delete globalThis.SCRAPER_SETTINGS;
  report.nativeBundle={ms:Date.now()-nativeStart,count:nativeStreams.length,streams:nativeStreams.map(publicStream)};
  // Test a complete local HTTP search → meta → stream request against live upstreams.
  const server=createServer({provider});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const directFetch=async suffix=>{
    // An empty Agent is direct only for loopback, never upstream destinations.
    const {Agent}=require('undici');const agent=new Agent();
    try{return await (await fetch(`http://127.0.0.1:${server.address().port}`+suffix,{dispatcher:agent})).json();}finally{await agent.close();}
  };
  try {
    const catalog=await directFetch('/catalog/series/as-all/search=Jujutsu.json');
    const meta=await directFetch('/meta/series/'+encodeURIComponent(catalog.metas[0].id)+'.json');
    const streams=await directFetch('/stream/series/'+encodeURIComponent(meta.meta.videos[0].id)+'.json');
    report.httpChain={catalog:catalog.metas.length,episodes:meta.meta.videos.length,streams:streams.streams.length};
  } finally {await new Promise(r=>server.close(r));}
  const index=process.argv.indexOf('--output');
  if(index>=0)await fs.writeFile(process.argv[index+1],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({browsing:report.browsing,simultaneous:report.simultaneous,nativeBundleCount:report.nativeBundle.count,httpChain:report.httpChain}));
  if(!report.browsing.search.passed||!report.browsing.metadata.episodes||!report.nativeBundle.count||report.cases.filter(c=>c.streams>0).length<4)process.exitCode=1;
}
main().catch(e=>{console.error('Live verification failed:',e.status?`HTTP ${e.status}`:e.message);process.exitCode=1;});
