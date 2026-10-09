const {test}=require('node:test');const assert=require('node:assert/strict');
const {ChairsEngine}=require('../src/chairs');const {ARENA_ID}=require('../src/game-data');
const button=(id,disabled=false,label='•')=>({type:2,customId:id,label,disabled});
const msg=(id,content,buttons=[])=>({id,content,author:{id:ARENA_ID,bot:true},channelId:'room',guildId:'guild',createdTimestamp:1000,components:[{components:buttons}]});
function fixture(){const clicks=[];const e=new ChairsEngine({channel:'room',now:()=>2000,randomIndex:()=>0,click:async(id,b)=>clicks.push([id,b]),notify:async()=>{}});e.setEnabled(true);return {e,clicks,start:()=>e.onMessage({...msg('command','+c'),author:{id:'human',bot:false}})};}
test('ready -> reserve -> duplicate -> forbidden -> new round; only positive phases click',async()=>{
 const {e,clicks,start}=fixture();await start();
 await e.onMessage(msg('one','كن جاهزاً',[button('a')]));assert.equal(clicks.length,0);
 await e.onMessage(msg('one','احجز مقعدك في أسرع وقت (0/5)',[button('locked',true),button('a')]));
 await e.onMessage(msg('one','احجز مقعدك في أسرع وقت (1/5)',[button('a')]));
 await e.onMessage(msg('two','استعد',[button('red')]));
 await e.onMessage(msg('two','لا تضغط الزر',[button('red')]));
 await e.onMessage(msg('three','احجز مقعدك في اسرع وقت',[button('b')]));
 assert.deepEqual(clicks,[['one','a'],['three','b']]);
});
test('forbidden text overrides reserve and unknown/non-seat/disabled buttons never clicked',async()=>{
 const {e,clicks,start}=fixture();await start();
 for(const [id,text,bs] of [['a','احجز مقعدك لا تضغط الزر',[button('x')]],['b','اضغط',[button('x')]],['c','احجز مقعدك',[button('x',true)]],['d','احجز مقعدك',[button('x',false,'انسحاب')]]])await e.onMessage(msg(id,text,bs));
 assert.equal(clicks.length,0);
});
test('requires enabled mode, configured room, Arena author and +c; stops on terminal',async()=>{
 const {e,clicks,start}=fixture();const reserve=msg('a','احجز مقعدك',[button('x')]);
 await e.onMessage(reserve);await start();await e.onMessage({...reserve,channelId:'wrong'});await e.onMessage({...reserve,author:{id:'other',bot:true}});
 await e.onMessage(msg('win','الفائز أحمد'));await e.onMessage(reserve);assert.equal(clicks.length,0);
 await start();await e.onMessage(reserve);assert.equal(clicks.length,1);
 e.setEnabled(false);await e.onMessage({...reserve,id:'b'});assert.equal(clicks.length,1);
});
test('chairs registration after +c clicks once independently of roulette modes',async()=>{
 const {e,clicks,start}=fixture();await start();const registration=msg('registration','المشاركين: 0',[button('join',false,'دخول')]);
 await e.onMessage(registration);await e.onMessage(registration);assert.deepEqual(clicks,[['registration','join']]);
});
test('prepares selection while ready, validates fresh availability, submits synchronously',async()=>{
 const {e,clicks,start}=fixture();let randomCalls=0;e.randomIndex=()=>{randomCalls++;return 1;};await start();
 await e.onMessage(msg('ready','كن جاهزاً',[button('a',true),button('b',true)]));
 assert.equal(randomCalls,1);assert.equal(clicks.length,0);
 const task=e.onMessage(msg('ready','احجز مقعدك',[button('a'),button('b')]));
 assert.deepEqual(clicks,[['ready','b']]);assert.equal(randomCalls,1);await task;
 await e.onMessage(msg('next','استعد',[button('a'),button('b')]));
 await e.onMessage(msg('next','احجز مقعدك',[button('a'),button('b',true)]));
 assert.deepEqual(clicks[1],['next','a']);
});
test('a pending previous acknowledgement never blocks the next seat or permits forbidden clicks',async()=>{
 const {e,start}=fixture();await start();const calls=[],releases=[];
 e.click=(id)=>{calls.push(id);return new Promise(resolve=>releases.push(resolve));};
 const first=e.onMessage(msg('first','احجز مقعدك',[button('a')]));
 await e.onMessage(msg('trap','لا تضغط الزر',[button('red')]));
 const second=e.onMessage(msg('second','احجز مقعدك',[button('b')]));
 assert.deepEqual(calls,['first','second']);for(const release of releases)release();await Promise.all([first,second]);
});
test('chairs submit before snapshot preparation, roulette handling and downstream work',async()=>{
 const {dispatchGameMessage}=require('../src/dispatch');const {e,start}=fixture();await start();
 const order=[];e.click=async()=>{order.push('seat');};
 const task=dispatchGameMessage(msg('fast','احجز مقعدك',[button('a')]),{
  chairs:e,toSnapshot:m=>{order.push('snapshot');return m;},engine:{onMessage:()=>{order.push('roulette');return Promise.resolve();}}
 });
 order.push('notifications');assert.deepEqual(order,['seat','snapshot','roulette','notifications']);await task;
});
test('queued seat is cancelled on forbidden phase, disabled button, stop, or next game',async()=>{
 for(const change of ['forbidden','disabled','stop','next']){
  const {e,start}=fixture();await start();let signal,release;
  e.click=(_id,_button,options)=>{signal=options.signal;return new Promise((_,reject)=>release=reject);};
  const task=e.onMessage(msg('one','احجز مقعدك',[button('a')]));
  if(change==='forbidden')await e.onMessage(msg('trap','لا تضغط الزر',[button('red')]));
  if(change==='disabled')await e.onMessage(msg('one','احجز مقعدك',[button('a',true)]));
  if(change==='stop')e.setEnabled(false);
  if(change==='next')await start();
  assert.equal(signal.aborted,true,change);release(new Error('cancelled'));await task;
  if(change!=='stop')assert.equal(e.enabled,true);
 }
});
test('seat count edit keeps queued eligible seat and does not duplicate it',async()=>{
 const {e,start}=fixture();await start();let signal,release,calls=0;
 e.click=(_id,_button,options)=>{calls++;signal=options.signal;return new Promise(r=>release=r);};
 const task=e.onMessage(msg('one','احجز مقعدك (0/5)',[button('a')]));
 await e.onMessage(msg('one','احجز مقعدك (1/5)',[button('a')]));assert.equal(signal.aborted,false);assert.equal(calls,1);release();await task;
});
test('chairs join-only registers once and does not reserve any seat',async()=>{
 const {e,clicks,start}=fixture();e.setModes({autoPlay:false});await start();
 const registration=msg('registration','المشاركين: 0',[button('join',false,'دخول')]);
 await e.onMessage(registration);await e.onMessage(registration);
 await e.onMessage(msg('seat','كن جاهزاً',[button('a')]));await e.onMessage(msg('seat','احجز مقعدك',[button('a')]));
 assert.deepEqual(clicks,[['registration','join']]);assert.equal(e.autoJoin,true);assert.equal(e.autoPlay,false);
});
test('chairs play-only skips registration and handles seats after manual entry',async()=>{
 const {e,clicks,start}=fixture();e.setModes({autoJoin:false});await start();
 await e.onMessage(msg('registration','المشاركين: 0',[button('join',false,'دخول')]));
 await e.onMessage(msg('seat','احجز مقعدك',[button('a')]));assert.deepEqual(clicks,[['seat','a']]);
});
test('enabling play after join-only uses the observed game without repeating registration',async()=>{
 const {e,clicks,start}=fixture();e.setModes({autoPlay:false});await start();
 await e.onMessage(msg('registration','المشاركين: 0',[button('join',false,'دخول')]));
 await e.onMessage(msg('seat','كن جاهزاً',[button('a',true)]));e.setModes({autoPlay:true});
 await e.onMessage(msg('seat','احجز مقعدك',[button('a')]));
 assert.deepEqual(clicks,[['registration','join'],['seat','a']]);
});
test('stopping chairs join cancels only queued registration while play stays active',async()=>{
 const {e,clicks,start}=fixture();await start();let signal,release;
 e.click=(id,b,options)=>{if(id==='registration'){signal=options.signal;return new Promise((_,reject)=>release=reject);}clicks.push([id,b]);return Promise.resolve();};
 const pending=e.onMessage(msg('registration','المشاركين: 0',[button('join',false,'دخول')]));
 e.setModes({autoJoin:false});assert.equal(signal.aborted,true);assert.equal(e.autoPlay,true);release(new Error('cancelled'));await pending;
 await e.onMessage(msg('seat','احجز مقعدك',[button('a')]));assert.deepEqual(clicks,[['seat','a']]);
});
test('stopping play does not cancel pending registration or suppress its confirmation',async()=>{
 const {e,start}=fixture();await start();let signal,release;const notices=[];e.notify=async(text)=>notices.push(text);
 e.click=(_id,_b,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve);};
 const pending=e.onMessage(msg('registration','المشاركين: 0',[button('join',false,'دخول')]));
 e.setModes({autoPlay:false});assert.equal(signal.aborted,false);assert.equal(e.autoJoin,true);
 release(msg('confirmation','تم تسجيل دخولك بنجاح'));await pending;assert.equal(notices.length,1);assert.match(notices[0],/✅/);
});
test('stopping join does not abort an in-flight seat when play remains enabled',async()=>{
 const {e,start}=fixture();await start();let signal,release;e.click=(_id,_b,options)=>{signal=options.signal;return new Promise(r=>release=r);};
 const pending=e.onMessage(msg('seat','احجز مقعدك',[button('a')]));e.setModes({autoJoin:false});assert.equal(signal.aborted,false);release();await pending;
});
test('replaces an unsent unavailable choice with the last open seat immediately',async()=>{
 const {e,start}=fixture();await start();const calls=[];
 e.click=(id,customId,options)=>{options.onQueued?.();return new Promise(resolve=>calls.push({id,customId,...options,resolve}));};
 const first=e.onMessage(msg('round','احجز مقعدك (0/2)',[button('a'),button('last')]));
 const last=e.onMessage(msg('round','احجز مقعدك (1/2)',[button('a',true),button('last')]));
 try{
  assert.deepEqual(calls.map(c=>c.customId),['a','last']);
  assert.equal(calls[0].signal.aborted,true);assert.equal(calls[1].signal.aborted,false);
  await e.onMessage(msg('round','احجز مقعدك (1/2)',[button('a',true),button('last')]));
  assert.equal(calls.length,2);
 }finally{for(const c of calls)c.resolve();await Promise.all([first,last]);}
});
test('final single chair submits on the reserve edit without random selection or prior acknowledgement',async()=>{
 const {e,start}=fixture();await start();const calls=[];
 e.randomIndex=()=>{throw new Error('A sole chair needs no random choice');};
 e.click=(id,customId,options)=>new Promise(resolve=>calls.push({id,customId,...options,resolve}));
 const previous=e.onMessage(msg('reused','احجز مقعدك (0/2)',[button('a'),button('b')]));
 await e.onMessage(msg('reused','كن جاهزاً',[button('final',true)]));
 const final=e.onMessage(msg('reused','احجز مقعدك في أسرع وقت (0/1)',[button('final')]));
 try{
  assert.deepEqual(calls.map(c=>c.customId),['a','final']);
  assert.equal(calls[0].signal.aborted,true);assert.equal(calls[1].signal.aborted,false);
  await e.onMessage(msg('reused','احجز مقعدك (1/1)',[button('final')]));assert.equal(calls.length,2);
 }finally{for(const c of calls)c.resolve();await Promise.all([previous,final]);}
});
test('does not replace a seat after dispatch starts or if transport tracking is unavailable',async()=>{
 for(const tracked of [true,false]){
  const {e,start}=fixture();await start();const calls=[];
  e.click=(id,customId,options)=>{if(tracked){options.onQueued();options.onDispatch();}return new Promise(resolve=>calls.push({customId,resolve}));};
  const first=e.onMessage(msg('round','احجز مقعدك (0/2)',[button('a'),button('last')]));
  try{
   await e.onMessage(msg('round','احجز مقعدك (1/2)',[button('a',true),button('last')]));
   assert.deepEqual(calls.map(c=>c.customId),['a']);
  }finally{for(const c of calls)c.resolve();await first;}
 }
});
test('forbidden phase cancels the last-seat replacement and blocks further count edits',async()=>{
 const {e,start}=fixture();await start();const calls=[];
 e.click=(id,customId,options)=>{options.onQueued();return new Promise(resolve=>calls.push({customId,...options,resolve}));};
 const first=e.onMessage(msg('round','احجز مقعدك',[button('a'),button('last')]));
 const last=e.onMessage(msg('round','احجز مقعدك',[button('a',true),button('last')]));
 try{
  await e.onMessage(msg('round','احجز مقعدك — لا تضغط الزر',[button('last')]));
  await e.onMessage(msg('round','احجز مقعدك (0/1)',[button('last')]));
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c.signal.aborted));
 }finally{for(const c of calls)c.resolve();await Promise.all([first,last]);}
});
// Transcribed from the supplied final-chair clip. The future verb يفوز is not a result.
const finalForecast='الجولة القادمة هي الأخيرة من يحجز الكرسي أولا يفوز باللعبة | 🪑';
test('clip final-round forecast stays active while its text and single button arrive separately',async()=>{
 for(const inEmbed of [false,true])for(const announceFirst of [false,true]){
  const {e,clicks,start}=fixture();await start();
  const finalMessage=(phase,bs)=>{
   const text=`تم طرد <@111111111111111111> من اللعبة | 🪑\n${finalForecast}\n${phase}`;
   const m=msg('final-round',text,bs);
   if(inEmbed){m.content='';m.embeds=[{description:text}];}
   return m;
  };
  if(announceFirst){
   await e.onMessage(finalMessage('',[]));assert.equal(e.active,true,'A future-win announcement must not end the game');
  }
  await e.onMessage(finalMessage('⏰ | كن جاهزاً',[button('only',true)]));
  await e.onMessage(finalMessage('احجز مقعدك في اسرع وقت (0/1)',[button('only',true)]));
  assert.equal(e.active,true,'A disabled button during the edit must not turn يفوز into a completed win');
  assert.equal(clicks.length,0);
  const reserve=finalMessage('احجز مقعدك في اسرع وقت (0/1)',[button('only')]);
  const task=e.onMessage(reserve);
  assert.deepEqual(clicks,[['final-round','only']]);await task;
  await e.onMessage(reserve);assert.equal(clicks.length,1);
 }
});
test('whole-word end announcements still end the game when seats are unavailable',async()=>{
 for(const text of ['🏆 **الفائز:** <@111111111111111111>','فاز <@111111111111111111>','🎉 فوز <@111111111111111111>','انتهت اللعبة!','انتهى القيم.']){
  const {e,clicks,start}=fixture();await start();
  await e.onMessage(msg('result',text,[button('only',true)]));assert.equal(e.active,false,text);
  await e.onMessage(msg('old-seat','احجز مقعدك (0/1)',[button('only')]));assert.equal(clicks.length,0);
 }
});
test('the clip final-round forecast never overrides ready or forbidden instructions',async()=>{
 const {e,clicks,start}=fixture();await start();
 for(const phase of ['كن جاهزاً','استعد','لا تضغط الزر','احجز مقعدك (0/1) — لا تضغط الزر']){
  await e.onMessage(msg('final-round',`${finalForecast}\n${phase}`,[button('only')]));
  assert.equal(e.active,true);assert.equal(clicks.length,0);
 }
});
