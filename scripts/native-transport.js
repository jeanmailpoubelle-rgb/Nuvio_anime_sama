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
  return {ok:response.ok,status:response.status,url:response.url,body:bytes.toString('utf8')+(size===1048576?'\n...[truncated]':''),bodyBase64:bytes.toString('base64'),headers:Object.fromEntries(response.headers)};
}
async function sample(stream) {
  const provider=new AnimeSamaProvider(),options={headers:stream.headers};
  let response=await provider.http.request(stream.url,options),playlist=Hls.parse(response.body,response.url);
  if(playlist.variants.length){response=await provider.http.request(playlist.variants[0].url,options);playlist=Hls.parse(response.body,response.url);}
  if(!playlist.segments.length)throw new Error('No segment');
  const r=await provider.http.request(playlist.segments[0],{...options,headers:{...stream.headers,Range:'bytes=0-4095'},binary:true,prefix:true,maxBytes:4096});
  if(!r.body.length||[60,123].includes(r.body[0]))throw new Error('Invalid segment');
  return {status:r.status,bytes:r.body.length};
}
module.exports={bridgeFetch,sample};
