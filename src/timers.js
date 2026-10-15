// Nuvio's clearTimeout cancels the JS callback, but its Kotlin sleep keeps the
// plugin evaluation alive. Share short sleeps so canceled deadlines cannot add
// six or eleven seconds after streams have already been found.
function pollingTimers(set = setTimeout, clear = clearTimeout, now = Date.now, interval = 100) {
  const pending = new Map();
  let serial = 0, timer, wakeAt;
  function arm() {
    if (!pending.size) return;
    const due = Math.min(...Array.from(pending.values(), t => t.at));
    const next = Math.min(due,now()+interval);
    if (timer != null && wakeAt <= next) return;
    if (timer != null) clear(timer);
    wakeAt = next;
    timer = set(() => {
      timer = undefined;
      try {
        for (const [id,task] of [...pending]) {
          if (task.at <= now() && pending.delete(id)) task.callback();
        }
      } finally { arm(); }
    },Math.max(0,next-now()));
  }
  return {
    setTimer(callback,ms) {
      const id = ++serial;
      pending.set(id,{callback,at:now()+Math.max(0,ms)});
      arm();
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
      if (!pending.size && timer != null) { clear(timer); timer = undefined; }
    }
  };
}
// Older NuvioTV has synchronous native HTTP and no timer/sleep host functions.
// Check deadlines between network stages instead of referencing missing globals
// or spinning the JS thread. A blocking native call remains app-timeout-bound.
function cooperativeTimers(now = Date.now) {
  const pending = new Map();
  let serial = 0;
  return {
    setTimer(callback,ms) { const id=++serial;pending.set(id,{callback,at:now()+Math.max(0,ms)});return id; },
    clearTimer(id) { pending.delete(id); },
    flushTimers() {
      for (const [id,task] of [...pending]) if (task.at <= now() && pending.delete(id)) task.callback();
    }
  };
}
const timerless = typeof setTimeout !== 'function' || typeof clearTimeout !== 'function';
const timers = timerless ? cooperativeTimers() : typeof __plugin_sleep === 'function' ? pollingTimers()
  : {setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:id=>clearTimeout(id)};
module.exports = {...timers,flushTimers:timers.flushTimers || (()=>{}),timerless,pollingTimers,cooperativeTimers};
