'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {ChairsWarmup}=require('../src/chairs-warmup');const {ChairsEngine}=require('../src/chairs');
const {ARENA_ID}=require('../src/game-data');
test('shared warmup makes one public read for multiple accounts and never loops on duplicate ready updates',async()=>{
  let now=10000,calls=0,finish;
  const warm=new ChairsWarmup({now:()=>now});
  const client={api:{gateway:{get:options=>{calls++;assert.equal(options.auth,false);assert.ok(options.arenaSignal);return new Promise(r=>finish=r);}}}};
  const m={id:'round',createdTimestamp:10000};
  warm.prepare(client,m);warm.prepare(client,m);assert.equal(calls,1);
  now+=3000;warm.prepare(client,{id:'second',createdTimestamp:now});assert.equal(calls,1,'Only one warmup may be in flight');
  finish();await warm.pending;
  warm.prepare(client,m);assert.equal(calls,1,'The same ready stage stays deduplicated after completion');
  warm.prepare(client,{id:'next',createdTimestamp:now});assert.equal(calls,2);finish();await warm.pending;
});
test('warmup failure is contained and a later ready phase may prepare again after cooldown',async()=>{
  let now=10000,calls=0;const warm=new ChairsWarmup({now:()=>now});
  const client={api:{gateway:{get:()=>{calls++;return Promise.reject(Error('synthetic'));}}}};
  warm.prepare(client,{id:'a',createdTimestamp:now});await warm.pending;
  warm.prepare(client,{id:'b',createdTimestamp:now});assert.equal(calls,1);
  now+=2500;warm.prepare(client,{id:'c',createdTimestamp:now});await warm.pending;assert.equal(calls,2);
});
test('preparation occurs on eligible ready transition only, never during forbidden, disabled or unknown game phases',async()=>{
  const calls=[],clicks=[];const e=new ChairsEngine({channel:'room',now:()=>2000,randomIndex:()=>0,
    prepare:m=>calls.push(m.id),click:async id=>clicks.push(id),notify:async()=>{}});
  const m=(id,content,bot=true)=>({id,channelId:'room',guildId:'guild',author:{id:bot?ARENA_ID:'human',bot},content,
    createdTimestamp:1000,components:[{components:[{type:2,customId:'seat',label:'•',disabled:false}]}]});
  await e.onMessage(m('off','كن جاهزاً'));assert.equal(calls.length,0);
  e.setModes({autoPlay:true});await e.onMessage(m('unknown','كن جاهزاً'));assert.equal(calls.length,0);
  await e.onMessage(m('command','+c',false));await e.onMessage(m('forbidden','استعد لا تضغط الزر'));assert.equal(calls.length,0);
  await e.onMessage(m('ready','كن جاهزاً'));await e.onMessage(m('ready','كن جاهزاً'));assert.deepEqual(calls,['ready']);assert.equal(clicks.length,0);
  await e.onMessage(m('ready','احجز مقعدك'));assert.deepEqual(clicks,['ready']);
  await e.onMessage(m('ready','استعد'));assert.deepEqual(calls,['ready','ready']);
});
