const {setTimer,clearTimer,flushTimers} = require('./timers');
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)}, async () => {
    while (next < items.length) { flushTimers();const i = next++; out[i] = await fn(items[i],i); }
  }));
  return out;
}
function abortError() { const e = new Error('Request canceled.'); e.code = 'ABORTED'; return e; }
function deadline(ms, parent) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (parent?.aborted) cancel();
  else parent?.addEventListener('abort', cancel);
  const timer = setTimer(cancel,ms);
  return {signal:controller.signal, cancel, close() { clearTimer(timer); parent?.removeEventListener('abort',cancel); }};
}
module.exports = { mapLimit, deadline, abortError };
