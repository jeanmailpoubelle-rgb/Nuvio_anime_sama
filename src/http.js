const { abortError } = require('./concurrency');
const {runtimeFetch} = require('./runtime-fetch');
const {setTimer,clearTimer} = require('./timers');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
class HttpError extends Error { constructor(status) { super(`HTTP ${status}`); this.status = status; } }
class HttpClient {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl === fetch ? runtimeFetch(fetchImpl) : fetchImpl; }
  async request(url, options = {}, metrics) {
    if (options.signal?.aborted) throw abortError();
    const controller = new AbortController();
    let timer, listener;
    const started = Date.now();
    const category = options.category || 'site';
    if (metrics) { metrics.requests++; metrics.requestCategories[category] = (metrics.requestCategories[category] || 0) + 1; }
    const limit = options.maxBytes || 4000000;
    const job = async () => {
      const response = await this.fetch(url, {method:options.method || 'GET', headers:{'User-Agent':USER_AGENT,...options.headers}, signal:controller.signal});
      if (!response.ok) throw new HttpError(response.status);
      let body;
      if (options.method === 'HEAD') body = '';
      else if (response.body?.getReader) {
        // Stop bounded reads even when a CDN ignores Range.
        const reader = response.body.getReader(), chunks = [];
        let size = 0;
        try {
          while (size < limit) {
            const {done,value} = await reader.read();
            if (done) break;
            const piece = value.subarray(0,limit-size);
            size += piece.length; chunks.push(piece);
            if (!options.prefix && (value.length > piece.length || size >= limit)) throw new Error('Response too large.');
          }
        } finally { await reader.cancel().catch(() => {}); }
        const bytes = new Uint8Array(size); let pos = 0;
        for (const chunk of chunks) { bytes.set(chunk,pos); pos += chunk.length; }
        body = options.binary ? bytes : new TextDecoder().decode(bytes);
      } else {
        // Current Nuvio fetch buffers at most its host bridge limit before exposing data.
        body = options.binary ? new Uint8Array(await response.arrayBuffer(options.prefix ? limit : undefined)) : await response.text();
        if (body.length > limit && !options.prefix) throw new Error('Response too large.');
        body = body.slice(0,limit);
      }
      if (!options.binary && options.method !== 'HEAD' && /cf-chl-|<title>Just a moment/i.test(body)) throw new Error('Browser verification required.');
      return {body, url:response.url || url, status:response.status, headers:response.headers};
    };
    // Nuvio's fetch shim currently ignores AbortSignal. Racing here still bounds
    // the returned result; Node/browser transports additionally cancel the request.
    const stopped = new Promise((_resolve,reject) => {
      const stop = () => { controller.abort(); reject(options.signal?.aborted ? abortError() : Object.assign(new Error('Request timed out.'),{code:'TIMEOUT'})); };
      timer = setTimer(stop,options.timeoutMs || this.config.requestTimeoutMs);
      listener = stop;
      options.signal?.addEventListener('abort',listener);
    });
    try { return await Promise.race([job(),stopped]); }
    finally {
      clearTimer(timer); options.signal?.removeEventListener('abort',listener);
      if (metrics) metrics.networkMs += Date.now()-started;
    }
  }
}
module.exports = { HttpClient, HttpError, USER_AGENT };
