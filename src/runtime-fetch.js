// Nuvio 0.5.9/0.5.10 exposes this bridge to its fetch polyfill. Its ordinary
// fetch eagerly base64-decodes every text response. Reuse the same transport
// while decoding binary data only when requested; other runtimes use fetch.
function nativeFetch(call,url,options = {}) {
  return Promise.resolve(call(url,(options.method || 'GET').toUpperCase(),JSON.stringify(options.headers || {}),'none','',true)).then(raw => {
    const data=JSON.parse(raw),headers={};
    for(const [key,value] of Object.entries(data.headers || {}))headers[key.toLowerCase()]=value;
    return {ok:data.ok,status:data.status,url:data.url || url,
      headers:{get:name=>headers[name.toLowerCase()] || null},
      text:()=>Promise.resolve(data.body || ''),
      arrayBuffer:maxBytes=>{
        const encoded=data.bodyBase64 || '';
        const bounded=Number.isFinite(maxBytes) ? encoded.slice(0,Math.ceil(maxBytes/3)*4) : encoded;
        const binary=atob(bounded),bytes=new Uint8Array(Number.isFinite(maxBytes) ? Math.min(binary.length,maxBytes) : binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        return Promise.resolve(bytes.buffer);
      }};
  });
}
function runtimeFetch(fallback) {
  return typeof __native_fetch === 'function' ? (url,options)=>nativeFetch(__native_fetch,url,options) : fallback;
}
module.exports = {nativeFetch,runtimeFetch};
