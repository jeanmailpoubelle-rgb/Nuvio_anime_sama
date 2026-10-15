// Exercise the actual native bundle in QuickJS, using Nuvio 0.5.9-compatible
// polyfills, empty settings and real upstream HTTP. Never persist signed URLs.
const fs = require('node:fs/promises');
const {fork} = require('node:child_process');
const {ProxyAgent,setGlobalDispatcher} = require('undici');
const {runNative} = require('../test/helpers/nuvio-runtime');
const {bridgeFetch,sample} = require('./native-transport');
const CASES=[['One Piece S1E1 TMDB','37854','tv'],['One Piece S1E1 IMDb','tt0388629','tv'],['One Piece E1 Kitsu','kitsu:12','series'],['Jujutsu Kaisen S1E1 TMDB','95479','tv']];
async function oneCase(index) {
  const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;if(proxy)setGlobalDispatcher(new ProxyAgent(proxy));
  const [name,id,type]=CASES[index],started=Date.now();
  // Live cases own a short-lived process. Keep the WASM runtime alive until that
  // process exits; deterministic tests separately exercise explicit VM disposal.
  const result=await runNative({},[id,type,1,1],{}, {fetch:bridgeFetch,budgetMs:45000,processLifetime:true,drainNative:true});
  const row={name,id,ms:Date.now()-started,resultReadyMs:result.resultReadyMs,runtimeDrainMs:result.runtimeDrainMs,requests:result.calls.length,streams:result.streams.map(s=>({source:s.source,quality:s.quality||null,version:s.version,type:s.type,audio:s.audioLanguages||null,subtitles:s.subtitleLanguages||null}))};
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
