'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {bookingDelay,parseBookingDelay,saveBookingDelay}=require('../src/booking-speed');
const {ChairsEngine}=require('../src/chairs');const {ARENA_ID}=require('../src/game-data');
const {Store}=require('../src/core');const {connectAccount}=require('../src/onboarding');const {panelMessage}=require('../src/panel');
const seat=(customId,disabled=false)=>({type:2,customId,label:'•',disabled});
const message=(id,content,buttons=[])=>({id,content,author:{id:ARENA_ID,bot:true},channelId:'room',guildId:'guild',createdTimestamp:1000,components:[{components:buttons}]});
const command=id=>({...message(id,'+c'),author:{id:'human',bot:false}});
function fixture(t,seatDelayMs=500) {
 const clicks=[],waits=[],notices=[];let now=2000;
 const wait=(ms,signal)=>new Promise((resolve,reject)=>{
  const clean=()=>signal.removeEventListener('abort',abort);
  const abort=()=>{clean();reject(new Error('cancelled'));};
  waits.push({ms,signal,release(){clean();resolve();}});
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
 });
 const e=new ChairsEngine({channel:'room',seatDelayMs,now:()=>now,wait,click:async(id,button)=>clicks.push([id,button]),notify:async text=>notices.push(text)});
 e.setModes({autoPlay:true});t.after(()=>e.close());
 return {e,clicks,waits,notices,setNow:value=>{now=value;},start:()=>e.onMessage(command('start'))};
}
test('booking speed accepts milliseconds in Arabic or Latin digits and keeps legacy default at zero',()=>{
 for(const [input,expected] of [['0',0],[' ١٠٠ ',100],['۵۰۰',500],['10000',10000]])assert.equal(parseBookingDelay(input),expected);
 for(const invalid of ['', '-1','0.5','10001','NaN','1e3','Infinity','100 ms'])assert.throws(()=>parseBookingDelay(invalid));
 for(const seatDelayMs of [undefined,null,'500',-1,10001,NaN])assert.equal(bookingDelay({seatDelayMs}),0);
 assert.equal(bookingDelay({seatDelayMs:500}),500);
});
test('booking setting persists per owner, updates the live engine, survives relinking and leaves join speed intact',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-booking-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir);store.put('owner',{token:'encrypted-old',accountId:'linked',joinDelayMs:200});store.put('other',{token:'encrypted-other',seatDelayMs:700});
 const session={chairs:{seatDelayMs:0},engine:{joinDelayMs:200}};
 assert.equal(saveBookingDelay({ownerId:'owner',input:'٥٠٠',store,session}),500);assert.equal(session.chairs.seatDelayMs,500);
 assert.equal(session.engine.joinDelayMs,200);assert.equal(store.data.owner.token,'encrypted-old');assert.equal(store.data.other.seatDelayMs,700);
 const restored=new Store(dir);assert.equal(bookingDelay(restored.data.owner),500);assert.equal(restored.data.owner.joinDelayMs,200);
 await connectAccount({ownerId:'owner',token:'replacement',store:restored,login:async()=>({user:{id:'new-linked'},destroy(){}}),crypt:{seal:()=> 'encrypted-new'},stop(){},sendPanel:async()=>{}});
 assert.equal(new Store(dir).data.owner.seatDelayMs,500);assert.equal(new Store(dir).data.owner.joinDelayMs,200);
 assert.throws(()=>saveBookingDelay({ownerId:'owner',input:'-5',store:restored,session}));assert.equal(session.chairs.seatDelayMs,500);
 assert.throws(()=>saveBookingDelay({ownerId:'deleted',input:'0',store:restored,session}));assert.equal(restored.data.deleted,undefined);
 saveBookingDelay({ownerId:'owner',input:'0',store:restored,session});assert.equal(new Store(dir).data.owner.seatDelayMs,0);
});
test('panel exposes separate booking and join buttons and displays a saved delay without a running session',()=>{
 const panel=panelMessage('owner',undefined,{seatDelayMs:500});const rows=panel.components.map(row=>row.toJSON().components);
 assert.ok(rows.flat().some(b=>b.label==='سرعة الحجز'&&b.custom_id==='seat_speed:owner'));
 assert.ok(rows.flat().some(b=>b.label==='سرعة الدخول'&&b.custom_id==='speed:owner'));
 assert.ok(rows.length<=5&&rows.every(row=>row.length<=5));assert.match(panel.content,/سرعة الحجز: 500/);
 assert.match(panelMessage('owner').content,/سرعة الحجز: 0/);
});
test('default final-chair reservation still calls the transport synchronously without invoking a wait',async t=>{
 const f=fixture(t,0);f.e.wait=()=>assert.fail('Default speed must not create a timer');await f.start();
 await f.e.onMessage(message('final','كن جاهزاً',[seat('last',true)]));
 const pending=f.e.onMessage(message('final','احجز مقعدك في أسرع وقت (0/1)',[seat('last')]));
 assert.deepEqual(f.clicks,[['final','last']]);await pending;
});
test('configured delay starts only on reserve, ignores count edits, then sends exactly one press',async t=>{
 const f=fixture(t,500);await f.start();await f.e.onMessage(message('round','كن جاهزاً',[seat('a',true)]));assert.equal(f.waits.length,0);
 const pending=f.e.onMessage(message('round','احجز مقعدك (0/2)',[seat('a'),seat('b')]));
 assert.equal(f.waits[0].ms,500);assert.equal(f.clicks.length,0);
 await f.e.onMessage(message('round','احجز مقعدك (1/2)',[seat('a'),seat('b',true)]));assert.equal(f.waits.length,1);
 f.setNow(2500);f.waits[0].release();await pending;assert.deepEqual(f.clicks,[['round','a']]);
 await f.e.onMessage(message('round','احجز مقعدك (1/2)',[seat('a')]));assert.equal(f.clicks.length,1);
});
test('replacing a chair during configured wait keeps the original deadline and chooses the remaining final chair',async t=>{
 const f=fixture(t,1000);await f.start();
 const first=f.e.onMessage(message('round','احجز مقعدك (0/2)',[seat('a'),seat('last')]));
 f.setNow(2300);f.e.seatDelayMs=2000;
 const replacement=f.e.onMessage(message('round','احجز مقعدك (1/2)',[seat('a',true),seat('last')]));
 assert.equal(f.waits[0].signal.aborted,true);assert.equal(f.waits[1].ms,700);assert.equal(f.clicks.length,0);
 f.setNow(3000);f.waits[1].release();await Promise.all([first,replacement]);assert.deepEqual(f.clicks,[['round','last']]);
});
test('changing the setting applies to the next reserve phase and cannot accelerate an already waiting press',async t=>{
 const f=fixture(t,500);await f.start();const pending=f.e.onMessage(message('one','احجز مقعدك',[seat('a')]));
 f.e.seatDelayMs=0;assert.equal(f.clicks.length,0);assert.equal(f.waits[0].signal.aborted,false);
 f.setNow(2500);f.waits[0].release();await pending;
 const next=f.e.onMessage(message('two','احجز مقعدك',[seat('b')]));assert.deepEqual(f.clicks,[['one','a'],['two','b']]);await next;
 assert.equal(f.waits.length,1);
});
for(const cause of ['forbidden','ready','disabled','stop','disconnect','nextGame','end','delete'])test(`configured wait never clicks after ${cause}`,async t=>{
 const f=fixture(t);await f.start();const pending=f.e.onMessage(message('round','احجز مقعدك',[seat('a')]));
 if(cause==='forbidden')await f.e.onMessage(message('round','لا تضغط الزر',[seat('a')]));
 if(cause==='ready')await f.e.onMessage(message('next','استعد',[seat('b')]));
 if(cause==='disabled')await f.e.onMessage(message('round','احجز مقعدك',[seat('a',true)]));
 if(cause==='stop')f.e.setModes({autoPlay:false});
 if(cause==='disconnect')f.e.disconnect();
 if(cause==='nextGame')await f.e.onMessage(command('next'));
 if(cause==='end')await f.e.onMessage(message('win','الفائز أحمد'));
 if(cause==='delete')f.e.cancelSeat(); // The Gateway delete handler calls this for the pending message.
 await pending;assert.equal(f.waits[0].signal.aborted,true);assert.deepEqual(f.clicks,[]);assert.deepEqual(f.notices,[]);
});
test('production delay is abortable and cancelled promptly without waiting its full duration',async()=>{
 const e=new ChairsEngine({channel:'room',seatDelayMs:10000,now:()=>2000,click:()=>assert.fail('Cancelled delay must not dispatch'),notify:async()=>{}});
 e.setModes({autoPlay:true});await e.onMessage(command('start'));
 const pending=e.onMessage(message('round','احجز مقعدك',[seat('a')]));e.close();await pending;
 assert.equal(e.pendingSeat,null);
});
test('booking delay never delays chairs registration',async t=>{
 const f=fixture(t,10000);f.e.setModes({autoJoin:true});await f.start();
 const pending=f.e.onMessage(message('join','المشاركين: 0',[{type:2,customId:'join',label:'دخول'}]));
 assert.deepEqual(f.clicks,[['join','join']]);assert.equal(f.waits.length,0);await pending;
});
