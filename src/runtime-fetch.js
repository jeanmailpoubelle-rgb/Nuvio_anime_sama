// Nuvio 0.5.9/0.5.10 exposes this bridge to its fetch polyfill. Its ordinary
// fetch eagerly base64-decodes every text response. Reuse the same transport
// while decoding binary data only when requested; other runtimes use fetch.
function nativeFetch(call,url,options = {},transport = {}) {
  let method=(options.method || 'GET').toUpperCase();
  const requestHeaders={...options.headers};
  // TV 1.0.0 maps HEAD to GET. Its text-only bridge is learned from an earlier
  // response; a one-byte range avoids buffering video for a header-only probe.
  if (transport.textOnly && method === 'HEAD') { method='GET';requestHeaders.Range=requestHeaders.Range || 'bytes=0-0'; }
  return Promise.resolve(call(url,method,JSON.stringify(requestHeaders),'none','',true)).then(raw => {
    const data=JSON.parse(raw),headers={};
    if (data.ok) transport.textOnly=typeof data.bodyBase64 !== 'string';
    for(const [key,value] of Object.entries(data.headers || {}))headers[key.toLowerCase()]=value;
    return {ok:data.ok,status:data.status,url:data.url || url,
      headers:{get:name=>headers[name.toLowerCase()] || null},
      text:()=>Promise.resolve(data.body || ''),
      arrayBuffer:maxBytes=>{
        if (typeof data.bodyBase64 !== 'string') throw Object.assign(new Error('Native runtime has no binary response support.'),{code:'BINARY_UNAVAILABLE'});
        const encoded=data.bodyBase64 || '';
        const bounded=Number.isFinite(maxBytes) ? encoded.slice(0,Math.ceil(maxBytes/3)*4) : encoded;
        const binary=atob(bounded),bytes=new Uint8Array(Number.isFinite(maxBytes) ? Math.min(binary.length,maxBytes) : binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        return Promise.resolve(bytes.buffer);
      }};
  });
}
function runtimeFetch(fallback) {
  const transport={};
  return typeof __native_fetch === 'function' ? (url,options)=>nativeFetch(__native_fetch,url,options,transport) : fallback;
}
module.exports = {nativeFetch,runtimeFetch};
