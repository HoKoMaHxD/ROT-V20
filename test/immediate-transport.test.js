'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const makeFetchCookie=require('fetch-cookie').default;const {CookieJar}=require('tough-cookie');
const Handler=require('discord.js-selfbot-v13/src/rest/RequestHandler');
const response=(url,status=200,headers={})=>{const r=new Response(null,{status,headers});Object.defineProperty(r,'url',{value:url});return r;};
test('guarded in-memory cookie lookup reaches fetch synchronously and preserves stored response cookies',async()=>{
  const jar=new CookieJar();jar.setCookieSync('session=test; Secure; Path=/','https://example.test');
  const calls=[];const fetch=makeFetchCookie((url,init)=>{calls.push(init);return Promise.resolve(response(url,204,{'set-cookie':'updated=yes; Path=/; Secure'}));},jar);
  const task=fetch('https://example.test/interactions',{arenaImmediateCookies:true});
  assert.equal(calls.length,1);assert.match(calls[0].headers.cookie,/session=test/);await task;
  assert.match(jar.getCookieStringSync('https://example.test'),/updated=yes/);
});
test('custom asynchronous cookie store remains awaited before dispatch',async()=>{
  const calls=[];let release;
  const jar={store:{synchronous:false},getCookieString:()=>new Promise(r=>release=r),setCookie:async()=>{}};
  const fetch=makeFetchCookie((url,init)=>{calls.push(init);return Promise.resolve(response(url,204));},jar);
  const task=fetch('https://example.test',{arenaImmediateCookies:true});assert.equal(calls.length,0);
  release('custom=yes');await task;assert.equal(calls[0].headers.cookie,'custom=yes');
});
test('immediate cookie path still applies Set-Cookie on redirects and limits redirects',async()=>{
  const jar=new CookieJar(),calls=[];
  const fetch=makeFetchCookie((url,init)=>{calls.push(init);return Promise.resolve(calls.length===1?
    response(url,302,{location:'/done','set-cookie':'next=yes; Path=/; Secure'}):response(url,200));},jar);
  const result=await fetch('https://example.test/start',{arenaImmediateCookies:true});
  assert.equal(result.status,200);assert.match(calls[1].headers.cookie,/next=yes/);
  const loop=makeFetchCookie(url=>Promise.resolve(response(url,302,{location:'/again'})),jar);
  await assert.rejects(loop('https://example.test',{arenaImmediateCookies:true,maxRedirect:1}),/maximum redirect/);
});
test('idle guarded dispatch is immediate but the second request still respects queue ordering',async()=>{
  const client=new EventEmitter();client.options={retryLimit:0,restTimeOffset:0};
  const handler=new Handler({client,globalRemaining:50,globalReset:Date.now()+1000,globalLimit:50});
  const order=[];let release;
  const req=(name,hold=false)=>({options:{arenaSignal:new AbortController().signal},retries:0,route:'/interactions',path:'/interactions',method:'post',
    make:()=>{order.push(name);return hold?new Promise(r=>release=()=>r(new Response(null,{status:204}))):Promise.resolve(new Response(null,{status:204}));}});
  const first=handler.push(req('first',true));assert.deepEqual(order,['first']);
  const next=handler.push(req('second'));assert.deepEqual(order,['first']);release();await Promise.all([first,next]);
  assert.deepEqual(order,['first','second']);assert.equal(handler.queue.remaining,0);
});
