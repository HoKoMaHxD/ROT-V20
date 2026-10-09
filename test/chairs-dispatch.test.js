'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {Message}=require('discord.js-selfbot-v13');
const Handler=require('discord.js-selfbot-v13/src/rest/RequestHandler');
const {Events}=require('discord.js-selfbot-v13/src/util/Constants');
const {ChairsEngine}=require('../src/chairs');const {ARENA_ID}=require('../src/game-data');
const button=(customId,disabled=false)=>({type:'BUTTON',customId,label:'•',disabled});
test('real clickButton and REST queue dispatch only the replacement, preserving transport cancellation',async()=>{
 const client=new EventEmitter(),messages=new Map(),sent=[],notices=[],errors=[];
 client.balance=0;client.incrementMaxListeners=()=>client.balance++;client.decrementMaxListeners=()=>client.balance--;
 client.options={retryLimit:0,restTimeOffset:0};client.sessionId='local-test';
 const handler=new Handler({client,globalRemaining:50,globalReset:Date.now()+1000,globalLimit:50});
 client.api={interactions:{post:options=>handler.push({options,retries:0,method:'post',path:'/interactions',route:'/interactions',make:async()=>{
  sent.push(options.data.data.custom_id);
  client.emit(Events.MESSAGE_CREATE,{nonce:options.data.nonce});
  return new Response(null,{status:204});
 }})}};
 const e=new ChairsEngine({channel:'room',now:()=>2000,notify:async text=>notices.push(text),
  click:(id,customId,options)=>Message.prototype.clickButton.call(messages.get(id),customId,options).catch(error=>{
   if(!options.signal.aborted)errors.push(error.message);throw error;
  })});
 const event=(id,content,bs=[],bot=true)=>{
  const m={id,content,author:{id:bot?ARENA_ID:'human',bot},channelId:'room',guildId:'guild',createdTimestamp:1000,
   client,flags:{bitfield:0},components:[{components:bs}],resolveComponent:customId=>bs.find(b=>b.customId===customId)};
  messages.set(id,m);return m;
 };
 e.setModes({autoPlay:true});await e.onMessage(event('command','+c',[],false));
 await handler.queue.wait(); // Simulate an already busy REST route, with no network call.
 const first=e.onMessage(event('round','احجز مقعدك (0/2)',[button('a'),button('last')]));
 assert.equal(e.pendingSeat.dispatchState,'queued');
 const replacement=e.onMessage(event('round','احجز مقعدك (1/2)',[button('a',true),button('last')]));
 assert.equal(e.pendingSeat.customId,'last');assert.deepEqual(sent,[]);
 handler.queue.shift();
 await Promise.all([first,replacement]);
 assert.deepEqual(sent,['last']);assert.equal(client.balance,0);assert.deepEqual(errors,[]);assert.deepEqual(notices,[]);
 assert.equal(client.listenerCount(Events.MESSAGE_CREATE),0);assert.equal(e.active,true);
});
