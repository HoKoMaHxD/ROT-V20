'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');const http=require('node:http');const {EventEmitter,once}=require('node:events');
const undici=require('undici');
function loadApi(origin,requestTimeout=2000){
 const pools=[],module={exports:{}};
 const source=fs.readFileSync(require.resolve('discord.js-selfbot-v13/src/rest/APIRequest'),'utf8');
 vm.runInNewContext(source,{module,Buffer,AbortController,AbortSignal,URLSearchParams,Intl,clearTimeout,
  require(name){
   if(name==='undici')return {...undici,Pool:class extends undici.Pool{constructor(_,opts){super(origin,opts);pools.push(this);}}};
   if(name==='../util/Util')return {checkUndiciProxyAgent:()=>null};
   if(name==='../util/Constants')return {ciphers:[]};
   return require(name);
  }
 });
 const client={options:{http:{api:origin,version:10,headers:{}},ws:{properties:{}},restRequestTimeout:requestTimeout}};
 const rest={client,getAuth:()=>'',fetch:undici.fetch};
 return {pools,request:(path,options={})=>new module.exports(rest,'get',path,{auth:false,...options}).make()};
}
test('a held HTTP request does not block another request on the shared bounded pool',async()=>{
 let release,arrived;const arrival=new Promise(r=>arrived=r),held=new Promise(r=>release=r);
 const server=http.createServer(async(req,res)=>{if(req.url.endsWith('/slow')){arrived();await held;}res.end('ok');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const api=loadApi(`http://127.0.0.1:${server.address().port}`);let slow;
 try{
  slow=api.request('/slow').then(r=>r.text());await arrival;
  assert.equal(await (await api.request('/fast')).text(),'ok');
  assert.equal(api.pools.length,1);release();assert.equal(await slow,'ok');
 }finally{release();await slow?.catch(()=>{});await Promise.all(api.pools.map(p=>p.close()));await new Promise(r=>server.close(r));}
});
test('aborted seat request never reaches HTTP server',async()=>{
 let received=0;const server=http.createServer((req,res)=>{received++;res.end('ok');});server.listen(0,'127.0.0.1');await once(server,'listening');
 const api=loadApi(`http://127.0.0.1:${server.address().port}`),controller=new AbortController();controller.abort();
 try{await assert.rejects(api.request('/seat',{arenaSignal:controller.signal}));assert.equal(received,0);}
 finally{await Promise.all(api.pools.map(p=>p.close()));await new Promise(r=>server.close(r));}
});
test('REST queue rechecks cancellation before network dispatch and never retries cancellation',async()=>{
 const Handler=require('discord.js-selfbot-v13/src/rest/RequestHandler');
 const client=new EventEmitter();client.options={retryLimit:3,restTimeOffset:0};
 const manager={client,globalRemaining:50,globalReset:Date.now()+1000,globalLimit:50};
 const handler=new Handler(manager),controller=new AbortController();let makeCalls=0,release;
 await handler.queue.wait();
 const waiting=handler.push({options:{arenaSignal:controller.signal},make:async()=>{makeCalls++;}});
 controller.abort();handler.queue.shift();await assert.rejects(waiting,{code:'ARENA_CHAIRS_CANCELLED'});assert.equal(makeCalls,0);
 const active=new AbortController();
 const sent=handler.push({options:{arenaSignal:active.signal},make:()=>{makeCalls++;return new Promise((_,reject)=>release=reject);}});
 await new Promise(setImmediate);active.abort();release(new Error('aborted'));
 await assert.rejects(sent,{code:'ARENA_CHAIRS_CANCELLED'});assert.equal(makeCalls,1);
});
test('a guarded seat reaches the server while all four general HTTP connections are busy',async()=>{
 let release,allArrived,heldCount=0;
 const held=new Promise(r=>release=r),ready=new Promise(r=>allArrived=r);
 const server=http.createServer(async(req,res)=>{
  if(req.url.includes('/held/')){if(++heldCount===4)allArrived();await held;}
  res.end('ok');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const api=loadApi(`http://127.0.0.1:${server.address().port}`,10_000),controller=new AbortController();let deadline;
 const pending=Array.from({length:4},(_,i)=>api.request(`/held/${i}`).then(r=>r.text()));
 // Always handle rejection while the first four responses are deliberately held.
 const settled=Promise.allSettled(pending);
 try{
  await ready;
  deadline=setTimeout(()=>controller.abort(),2000);
  assert.equal(await (await api.request('/seat',{arenaSignal:controller.signal})).text(),'ok');
  assert.equal(heldCount,4);
 }finally{clearTimeout(deadline);release();await settled;await Promise.all(api.pools.map(p=>p.close()));await new Promise(r=>server.close(r));}
});
test('a seat reuses its connection after a wait longer than the old four-second idle timeout',async()=>{
 let connections=0;
 const server=http.createServer((_req,res)=>{
  // Supply no server Keep-Alive timeout: exercise the client's own idle policy.
  res.setHeader('Connection','keep-alive');res.end('ok');
 });
 server.keepAliveTimeout=0;server.on('connection',()=>connections++);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const api=loadApi(`http://127.0.0.1:${server.address().port}`);
 try{
  await (await api.request('/seat-1',{arenaSignal:new AbortController().signal})).text();
  await new Promise(r=>setTimeout(r,5500));
  await (await api.request('/seat-2',{arenaSignal:new AbortController().signal})).text();
  assert.equal(connections,1);
 }finally{await Promise.all(api.pools.map(p=>p.close()));await new Promise(r=>server.close(r));}
});
test('guarded seats still wait for the existing route rate limit before dispatch',async()=>{
 const Handler=require('discord.js-selfbot-v13/src/rest/RequestHandler');
 const client=new EventEmitter();client.options={retryLimit:0,restTimeOffset:0};
 const handler=new Handler({client,globalRemaining:50,globalReset:Date.now()+1000,globalLimit:50});
 const resetAt=Date.now()+75;handler.remaining=0;handler.limit=1;handler.reset=resetAt;
 let dispatchedAt=null;
 await handler.push({route:'/interactions',path:'/interactions',method:'post',retries:0,
  options:{arenaSignal:new AbortController().signal,arenaOnDispatch:()=>{dispatchedAt=Date.now();}},
  make:async()=>new Response(null,{status:204})});
 assert.ok(dispatchedAt>=resetAt,'The dedicated HTTP pool must not bypass the REST rate-limit gate');
});
test('ready-phase preparatory read and later seat reuse the same priority connection',async()=>{
 const {ChairsWarmup}=require('../src/chairs-warmup');let connections=0;const paths=[];
 const server=http.createServer((req,res)=>{paths.push(req.url);res.end('ok');});server.on('connection',()=>connections++);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const api=loadApi(`http://127.0.0.1:${server.address().port}`),warm=new ChairsWarmup();
 try{
  warm.prepare({api:{gateway:{get:options=>api.request('/gateway',options).then(r=>r.text())}}},{id:'ready',createdTimestamp:Date.now()});
  await warm.pending;await new Promise(setImmediate);
  await (await api.request('/seat',{arenaSignal:new AbortController().signal})).text();
  assert.equal(connections,1);assert.deepEqual(paths,['/v10/gateway','/v10/seat']);
 }finally{await Promise.all(api.pools.map(p=>p.close()));await new Promise(r=>server.close(r));}
});
