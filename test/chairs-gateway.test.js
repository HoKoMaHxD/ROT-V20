'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Message}=require('discord.js-selfbot-v13');
const SnowflakeUtil=require('discord.js-selfbot-v13/src/util/SnowflakeUtil');
const Handler=require('discord.js-selfbot-v13/src/rest/RequestHandler');
const {Events}=require('discord.js-selfbot-v13/src/util/Constants');
const {ChairsEngine}=require('../src/chairs');const {ChairsGateway}=require('../src/chairs-gateway');
const {SeatLatency}=require('../src/seat-latency');const {dispatchGameMessage}=require('../src/dispatch');
const {ARENA_ID}=require('../src/game-data');
const time=Date.parse('2026-09-24T08:00:00.000Z');
const seat=(id,disabled=false)=>({type:2,style:2,custom_id:id,label:'•',disabled});
const rows=(...buttons)=>[{type:1,components:buttons}];
const make=(text,components=[],bot=true)=>({id:SnowflakeUtil.generate(time),channel_id:'room',guild_id:'guild',
  author:{id:bot?ARENA_ID:'human',bot},content:text,embeds:[],components,timestamp:new Date(time).toISOString(),flags:0});
function fixture({real=false}={}) {
  const client=new EventEmitter(),clicks=[],errors=[],notices=[];let feed,sequence=0;
  client.options={retryLimit:0,restTimeOffset:0};client.sessionId='local';
  client.incrementMaxListeners=()=>{};client.decrementMaxListeners=()=>{};
  const handler=new Handler({client,globalRemaining:50,globalReset:Date.now()+1000,globalLimit:50});
  client.api={interactions:{post:options=>handler.push({options,retries:0,route:'/interactions',path:'/interactions',method:'post',make:()=>{
    clicks.push(options.data);client.emit(Events.MESSAGE_CREATE,{nonce:options.data.nonce});return Promise.resolve(new Response(null,{status:204}));
  }})}};
  const chairs=new ChairsEngine({channel:'room',now:()=>time+1000,randomIndex:()=>0,status:()=>{},notify:async s=>notices.push(s),
    click:(id,button,options)=>real?feed.click(feed.get(id),button,options):(clicks.push([id,button,options]),Promise.resolve(null))});
  feed=new ChairsGateway({client,chairs,channel:'room',onError:e=>errors.push(e),clock:()=>123});
  chairs.setModes({autoPlay:true});
  const send=(d,t='MESSAGE_CREATE')=>feed.onPacket({op:0,t,d,s:++sequence});
  const start=make('+c',[],false);send(start);
  return {feed,chairs,clicks,errors,notices,handler,client,send,start};
}
test('raw positive update submits through real clickButton and idle REST route before parsed Message event',async()=>{
  const f=fixture({real:true}),m=make('كن جاهزاً',rows(seat('last',true)));
  f.send(m);f.send({id:m.id,channel_id:'room',content:'احجز مقعدك في اسرع وقت (0/1)',components:rows(seat('last'))},'MESSAGE_UPDATE');
  assert.equal(f.clicks.length,1,'No resolved queue promise is awaited on the idle guarded route');
  assert.equal(f.clicks[0].message_id,m.id);assert.equal(f.clicks[0].application_id,ARENA_ID);
  assert.equal(f.clicks[0].data.custom_id,'last');assert.equal(f.chairs.pendingSeat.dispatchState,'dispatched');
  const parsed=f.feed.get(m.id);const handled=f.feed.onParsed(parsed);
  assert.equal(handled,true);
  await dispatchGameMessage(parsed,{chairs:f.chairs,engine:{onMessage:async()=>{}},chairsHandled:handled});
  assert.equal(f.clicks.length,1);await new Promise(setImmediate);assert.deepEqual(f.errors,[]);
});
test('raw partial updates retain earlier fields and wait for positive text plus an enabled seat',async()=>{
  const f=fixture(),m=make('كن جاهزاً',rows(seat('one',true)));f.send(m);
  f.send({id:m.id,channel_id:'room',content:'احجز مقعدك (0/1)'},'MESSAGE_UPDATE');assert.equal(f.clicks.length,0);
  f.send({id:m.id,channel_id:'room',components:rows(seat('one'))},'MESSAGE_UPDATE');assert.equal(f.clicks.length,1);
  assert.equal(f.feed.get(m.id).author.id,ARENA_ID);assert.equal(f.feed.get(m.id).content,'احجز مقعدك (0/1)');
  f.send({id:m.id,channel_id:'room',content:'احجز مقعدك (1/1)'},'MESSAGE_UPDATE');assert.equal(f.clicks.length,1);
});
test('forbidden, ready and closed final chair do not click; end forecast does not disable the final round',()=>{
  const f=fixture(),forecast='الجولة القادمة هي الأخيرة من يحجز الكرسي أولا يفوز باللعبة';
  const m=make(forecast+'\nاستعد',rows(seat('one')));f.send(m);
  f.send({id:m.id,channel_id:'room',content:'احجز مقعدك لا تضغط الزر'},'MESSAGE_UPDATE');
  assert.equal(f.clicks.length,0);
  f.send({id:m.id,channel_id:'room',content:'كن جاهزاً',components:rows(seat('one',true))},'MESSAGE_UPDATE');
  f.send({id:m.id,channel_id:'room',content:forecast+'\nاحجز مقعدك'},'MESSAGE_UPDATE');
  assert.equal(f.clicks.length,0);assert.equal(f.chairs.active,true);
  f.send({id:m.id,channel_id:'room',components:rows(seat('one'))},'MESSAGE_UPDATE');assert.equal(f.clicks.length,1);
});
test('queued raw seat is cancelled by forbidden packet before any HTTP dispatch',async()=>{
  const f=fixture({real:true});await f.handler.queue.wait();
  const m=make('احجز مقعدك',rows(seat('one')));f.send(m);
  const pending=f.chairs.pendingSeat;assert.equal(pending.dispatchState,'queued');
  f.send({id:m.id,channel_id:'room',content:'لا تضغط الزر'},'MESSAGE_UPDATE');
  assert.equal(pending.controller.signal.aborted,true);f.handler.queue.shift();await new Promise(setImmediate);
  assert.equal(f.clicks.length,0);assert.deepEqual(f.notices,[]);
});
test('raw last-chair replacement only replaces a known unsent queue entry',async()=>{
  const f=fixture({real:true});await f.handler.queue.wait();
  const m=make('احجز مقعدك (0/2)',rows(seat('first'),seat('last')));f.send(m);
  f.send({id:m.id,channel_id:'room',components:rows(seat('first',true),seat('last'))},'MESSAGE_UPDATE');
  assert.equal(f.chairs.pendingSeat.customId,'last');f.handler.queue.shift();await new Promise(setImmediate);
  assert.deepEqual(f.clicks.map(d=>d.data.custom_id),['last']);assert.deepEqual(f.errors,[]);
});
test('raw pipeline rejects wrong source, stale messages, other room, unknown partials and disabled modes',()=>{
  const f=fixture();
  f.send({...make('احجز مقعدك',rows(seat('x'))),channel_id:'other'});
  f.send({...make('احجز مقعدك',rows(seat('x'))),author:{id:'otherbot',bot:true}});
  f.send({id:SnowflakeUtil.generate(time-60000),channel_id:'room',content:'احجز مقعدك',components:rows(seat('x'))},'MESSAGE_UPDATE');
  f.send({...make('احجز مقعدك',rows(seat('x'))),id:SnowflakeUtil.generate(time-60000)});
  assert.equal(f.clicks.length,0);
  f.chairs.setModes({autoPlay:false});f.send(make('احجز مقعدك',rows(seat('x'))));assert.equal(f.clicks.length,0);
});
test('raw and parsed duplicate commands do not reset a running round; older sequence is ignored',async()=>{
  const f=fixture(),version=f.chairs.version;
  assert.equal(f.feed.onParsed(f.feed.get(f.start.id)),true);assert.equal(f.chairs.version,version);
  f.send(f.start);assert.equal(f.chairs.version,version);
  const m=make('لا تضغط الزر',rows(seat('one')));f.send(m);
  f.feed.onPacket({op:0,t:'MESSAGE_UPDATE',s:1,d:{id:m.id,channel_id:'room',content:'احجز مقعدك'}});
  assert.equal(f.clicks.length,0);assert.equal(f.feed.onParsed(f.feed.get(m.id)),true);
});
test('fallback parsed event seeds missing message context for future raw updates',async()=>{
  const f=fixture();
  const parsed={id:SnowflakeUtil.generate(time),channelId:'room',guildId:'guild',author:{id:ARENA_ID,bot:true},
    content:'كن جاهزاً',embeds:[],createdTimestamp:time,components:[{components:[{type:'BUTTON',customId:'one',label:'•',disabled:true}]}],flags:{bitfield:0}};
  assert.equal(f.feed.onParsed(parsed),false);await f.chairs.onMessage(parsed);
  f.send({id:parsed.id,channel_id:'room',content:'احجز مقعدك',components:rows(seat('one'))},'MESSAGE_UPDATE');
  assert.equal(f.clicks.length,1);
});
test('unknown partial edit falls back to the complete cached message instead of assuming omitted text is empty',async()=>{
  const f=fixture(),id=SnowflakeUtil.generate(time);
  f.send({id,channel_id:'room',guild_id:'guild',author:{id:ARENA_ID,bot:true},content:'احجز مقعدك',components:rows(seat('one'))},'MESSAGE_UPDATE');
  assert.equal(f.clicks.length,0);assert.equal(f.feed.get(id),undefined);
  const parsed={id,channelId:'room',guildId:'guild',author:{id:ARENA_ID,bot:true},createdTimestamp:time,
    content:'احجز مقعدك',embeds:[{description:'لا تضغط الزر'}],components:[{components:[{type:'BUTTON',customId:'one',label:'•'}]}],flags:{bitfield:0}};
  const handled=f.feed.onParsed(parsed);assert.equal(handled,false);
  await dispatchGameMessage(parsed,{chairs:f.chairs,engine:{onMessage:async()=>{}},chairsHandled:handled});
  assert.equal(f.clicks.length,0);
});
test('message deletion aborts a queued attempt; disconnect clears cached phase data',async()=>{
  const f=fixture({real:true});await f.handler.queue.wait();
  const m=make('احجز مقعدك',rows(seat('one')));f.send(m);const pending=f.chairs.pendingSeat;
  f.send({id:m.id,channel_id:'room'},'MESSAGE_DELETE');assert.equal(pending.controller.signal.aborted,true);
  f.handler.queue.shift();await new Promise(setImmediate);assert.equal(f.clicks.length,0);
  f.chairs.disconnect();f.feed.clear();assert.equal(f.feed.messages.size,0);
  f.send(make('احجز مقعدك',rows(seat('one'))));assert.equal(f.clicks.length,0);
});
test('raw registration still waits for the correlated actual confirmation and uses independent join toggle',async()=>{
  const f=fixture();f.chairs.setModes({autoJoin:true,autoPlay:false});f.send(make('+c',[],false));
  f.send(make('المشاركين: 1',rows({...seat('join'),label:'دخول'})));
  f.send(make('احجز مقعدك',rows(seat('one'))));
  assert.equal(f.clicks.length,1);assert.equal(f.clicks[0][1],'join');await new Promise(setImmediate);
  assert.match(f.notices[0],/تحقق من التسجيل/);
});
test('latency separates preparation, queue and HTTP response and does not claim a win',()=>{
  let clock=10;const timings=new SeatLatency(()=>clock),events=[];
  const options=timings.wrap(9,{onQueued:()=>events.push('queued'),onDispatch:()=>events.push('dispatch')});
  options.onQueued();clock=12;options.onDispatch();clock=52;options.onResponse(204);
  assert.deepEqual(events,['queued','dispatch']);assert.match(timings.summary(),/3.00 ms/);
  assert.match(timings.summary(),/2.00 ms/);assert.match(timings.summary(),/40.00 ms/);
  assert.match(timings.summary(),/لا تعني نجاح/);
  const join={signal:new AbortController().signal};assert.equal(timings.wrap(50,join),join);
});
