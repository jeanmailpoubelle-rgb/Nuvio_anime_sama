const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pollingTimers} = require('../src/timers');
function host() {
  let now=0,serial=0;
  const sleeps=new Map();
  const clock={
    set:(callback,ms)=>{const id=++serial;sleeps.set(id,{at:now+ms,callback});return id;},
    // Match Nuvio: cancellation removes the callback but not the native sleep.
    clear:id=>{const s=sleeps.get(id);if(s)s.callback=()=>{};},
    now:()=>now,
    advance:ms=>{now+=ms;},
    drain:()=>{let count=0;while(sleeps.size){assert.ok(++count<1000);const [id,task]=[...sleeps].sort((a,b)=>a[1].at-b[1].at)[0];sleeps.delete(id);now=Math.max(now,task.at);task.callback();}return now;}
  };
  return {...clock,timers:pollingTimers(clock.set,clock.clear,clock.now,100)};
}
test('canceled request and resolution deadlines leave at most one short native sleep',()=>{
  const h=host();let fired=false;
  const ids=[6000,8500,11000].map(ms=>h.timers.setTimer(()=>{fired=true;},ms));
  h.advance(40);for(const id of ids)h.timers.clearTimer(id);
  assert.equal(h.drain(),100);assert.equal(fired,false);
});
test('native polling preserves deadlines and handles callbacks scheduling/canceling other tasks',()=>{
  const h=host(),events=[];
  const canceled=h.timers.setTimer(()=>events.push('canceled'),400);
  h.timers.setTimer(()=>{events.push(h.now());h.timers.clearTimer(canceled);h.timers.setTimer(()=>events.push(h.now()),30);},250);
  h.drain();assert.deepEqual(events,[250,280]);
});
