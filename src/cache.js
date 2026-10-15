const { abortError } = require('./concurrency');
class Cache {
  constructor(limit = 200, now = Date.now) { this.limit = limit; this.now = now; this.entries = new Map(); this.pending = new Map(); }
  get(key, ttl, loader, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    const old = this.entries.get(key);
    if (ttl > 0 && old && old.until > this.now()) { this.entries.delete(key); this.entries.set(key,old); return Promise.resolve(old.value); }
    let job = this.pending.get(key);
    if (!job) {
      job = {controller:new AbortController(),waiters:0};
      job.promise = Promise.resolve().then(() => loader(job.controller.signal)).then(value => {
        if (ttl > 0 && value != null && !job.controller.signal.aborted) {
          this.entries.delete(key);
          this.entries.set(key,{until:this.now()+ttl, value});
          while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
        }
        return value;
      }).finally(() => { if (this.pending.get(key) === job) this.pending.delete(key); });
      this.pending.set(key,job);
    }
    job.waiters++;
    return new Promise((resolve,reject) => {
      let settled = false;
      const finish = (fn,value) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort',cancel);
        if (--job.waiters === 0) {
          job.controller.abort();
          if (this.pending.get(key) === job) this.pending.delete(key);
        }
        fn(value);
      };
      const cancel = () => finish(reject,abortError());
      signal?.addEventListener('abort',cancel);
      job.promise.then(value => finish(resolve,value),error => finish(reject,error));
    });
  }
}
module.exports = { Cache };
