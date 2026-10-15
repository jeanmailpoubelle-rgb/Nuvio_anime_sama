// Exercise the actual native bundle in QuickJS, using Nuvio 0.5.9-compatible
// polyfills, empty settings and real upstream HTTP. Never persist signed URLs.
const fs = require('node:fs/promises');
const {fork} = require('node:child_process');
const {ProxyAgent,setGlobalDispatcher} = require('undici');
const {runNative} = require('../test/helpers/nuvio-runtime');
const {AnimeSamaProvider} = require('../src/provider');
const Hls = require('../src/extractors/hls');
async function bridgeFetch(url,method,headers) {
  const response = await fetch(url,{method,headers,signal:AbortSignal.timeout(12000)});
  const chunks=[];let size=0;
  if (response.body) {
    const reader=response.body.getReader();
    try {
      while(size<1048576) {
        const {done,value}=await reader.read();if(done)break;
        const part=value.subarray(0,1048576-size);chunks.push(part);size+=part.length;
      }
    } finally {await reader.cancel().catch(()=>{});}
  }
  const bytes=Buffer.concat(chunks,size);
  return {ok:response.ok,status:response.status,url:response.url,body:bytes.toString('utf8'),bodyBase64:bytes.toString('base64'),headers:Object.fromEntries(response.headers)};
}
async function sample(stream) {
  const provider=new AnimeSamaProvider();
  const options={headers:stream.headers};
  let response=await provider.http.request(stream.url,options),playlist=Hls.parse(response.body,response.url);
  if(playlist.variants.length){response=await provider.http.request(playlist.variants[0].url,options);playlist=Hls.parse(response.body,response.url);}
  if(!playlist.segments.length)throw new Error('No segment');
  const r=await provider.http.request(playlist.segments[0],{...options,headers:{...stream.headers,Range:'bytes=0-4095'},binary:true,prefix:true,maxBytes:4096});
  if(!r.body.length||[60,123].includes(r.body[0]))throw new Error('Invalid segment');
  return {status:r.status,bytes:r.body.length};
}
const CASES=[['One Piece S1E1 TMDB','37854','tv'],['One Piece S1E1 IMDb','tt0388629','tv'],['One Piece E1 Kitsu','kitsu:12','series'],['Jujutsu Kaisen S1E1 TMDB','95479','tv']];
async function oneCase(index) {
  const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;if(proxy)setGlobalDispatcher(new ProxyAgent(proxy));
  const [name,id,type]=CASES[index],started=Date.now();
  // Live cases own a short-lived process. Keep the WASM runtime alive until that
  // process exits; deterministic tests separately exercise explicit VM disposal.
  const result=await runNative({},[id,type,1,1],{}, {fetch:bridgeFetch,budgetMs:45000,processLifetime:true});
  const row={name,id,ms:Date.now()-started,requests:result.calls.length,streams:result.streams.map(s=>({source:s.source,quality:s.quality||null,version:s.version,type:s.type,audio:s.audioLanguages||null,subtitles:s.subtitleLanguages||null}))};
  const hls=result.streams.find(s=>s.type==='hls');
  if(hls){try{row.mediaSample=await sample(hls);}catch(_error){row.mediaSample={error:'Playlist/segment unavailable'};}}
  row.diagnostics=result.logs;
  return row;
}
async function main() {
  const worker=process.argv.indexOf('--native-worker');
  if(worker>=0) {
    const row=await oneCase(Number(process.argv[worker+1]));
    process.send(row,()=>process.exit(0));
    return;
  }
  const report={checkedAt:new Date().toISOString(),pluginVersion:require('../package.json').version,
    runtime:'QuickJS with Nuvio 0.5.9-beta-compatible fetch/DOM callbacks in a short-lived process per case; not a device playback/teardown test',
    settings:{},injectedTmdbKey:false,manualMappings:false,cases:[]};
  for(let index=0;index<CASES.length;index++) {
    const row=await new Promise((resolve,reject)=>{
      const child=fork(__filename,['--native-worker',String(index)],{stdio:['ignore','inherit','inherit','ipc']});
      let result;
      child.on('message',value=>{result=value;});
      child.on('error',reject);
      child.on('exit',code=>code===0&&result ? resolve(result) : reject(new Error('Native verification worker failed.')));
    });
    report.cases.push(row);console.log(JSON.stringify(row));
  }
  const i=process.argv.indexOf('--output');if(i>=0)await fs.writeFile(process.argv[i+1],JSON.stringify(report,null,2)+'\n');
  if(report.cases.some(c=>!c.streams.length||c.mediaSample?.bytes!==4096))process.exitCode=1;
}
main().catch(e=>{console.error('Native verification failed:',e.status?`HTTP ${e.status}`:e.code||e.message);process.exitCode=1;});
