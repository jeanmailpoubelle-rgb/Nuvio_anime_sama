const {test} = require('node:test');
const assert = require('node:assert/strict');
const {nativeFetch,runtimeFetch} = require('../src/runtime-fetch');
test('native text transport preserves bridge arguments/headers without binary decoding',async()=>{
  let args;const raw=JSON.stringify({ok:true,status:200,url:'https://redirect.test/e',headers:{'CONTENT-TYPE':'text/html'},body:'<html>OK</html>',bodyBase64:'deliberately invalid base64 which must not be decoded'});
  const response=await nativeFetch((...a)=>{args=a;return Promise.resolve(raw);},'https://player.test/e',{headers:{Referer:'https://source.test/'}});
  assert.deepEqual(args,['https://player.test/e','GET','{"Referer":"https://source.test/"}','none','',true]);
  assert.equal(await response.text(),'<html>OK</html>');assert.equal(response.headers.get('Content-Type'),'text/html');assert.equal(response.url,'https://redirect.test/e');
});
test('native binary transport decodes only on demand and fallback transport remains available',async()=>{
  const response=await nativeFetch(()=>Promise.resolve(JSON.stringify({ok:true,status:206,bodyBase64:'AAECAw=='})),'https://cdn.test/file');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0,1,2,3]);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer(2))],[0,1]);
  const fallback=()=>{};assert.equal(runtimeFetch(fallback),fallback);
});
test('native transport also accepts the synchronous NuvioTV bridge result',async()=>{
  const response=await nativeFetch(()=>JSON.stringify({ok:true,status:200,body:'OK'}),'https://player.test');assert.equal(await response.text(),'OK');
});
test('TV 1.0.0 text-only transport avoids video downloads for HEAD and never invents binary data',async()=>{
  const state={},calls=[];
  const bridge=(...args)=>{calls.push(args);return JSON.stringify({ok:true,status:200,body:'text',headers:{}});};
  const r=await nativeFetch(bridge,'https://site.test',{},state);
  assert.equal(state.textOnly,true);assert.throws(()=>r.arrayBuffer(),{code:'BINARY_UNAVAILABLE'});
  await nativeFetch(bridge,'https://cdn.test/video.mp4',{method:'HEAD',headers:{Referer:'https://embed.test'}},state);
  assert.equal(calls[1][1],'GET');assert.equal(JSON.parse(calls[1][2]).Range,'bytes=0-0');
  assert.equal(JSON.parse(calls[1][2]).Referer,'https://embed.test');
});
