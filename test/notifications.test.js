'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {notificationMessage,notificationsEnabled,setNotifications,sendNotification}=require('../src/notifications');
const {panelMessage}=require('../src/panel');
const {Store}=require('../src/core');const {connectAccount}=require('../src/onboarding');
test('manual DM explicitly mentions the panel owner only, even when the linked account differs',()=>{
 const owner='111111111111111111',account='222222222222222222';
 const payload=notificationMessage(owner,`تحكم بنفسك في حساب <@${account}> @everyone`,{mentionOwner:true,url:'https://discord.com/channels/1/2/3'});
 assert.ok(payload.content.startsWith(`<@${owner}>\n`));assert.deepEqual(payload.allowedMentions,{parse:[],users:[owner]});
 assert.equal(payload.components[0].toJSON().components[0].url,'https://discord.com/channels/1/2/3');
 assert.deepEqual(notificationMessage(owner,'تنبيه عادي').allowedMentions,{parse:[]});
});
test('panel distinguishes waiting for revival from waiting for a new game after manual fallback',()=>{
 assert.match(panelMessage('owner',{engine:{manual:true,eliminated:true}}).content,/ينتظر إنعاشه/);
 assert.match(panelMessage('owner',{engine:{manual:true,eliminated:false}}).content,/بعد طلب التحكم اليدوي/);
});
test('alerts default on, toggle per owner, survive restart and relinking, and retain speed settings',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-alerts-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir);store.put('owner',{token:'encrypted',accountId:'linked',seatDelayMs:500,joinDelayMs:100});store.put('other',{token:'encrypted-other'});
 const control=account=>panelMessage('owner',undefined,account).components.flatMap(row=>row.toJSON().components).find(b=>b.custom_id.startsWith('notifications_'));
 assert.equal(notificationsEnabled(store.data.owner),true);assert.equal(control(store.data.owner).label,'إيقاف التنبيهات');
 setNotifications({ownerId:'owner',enabled:false,store});
 assert.equal(control(store.data.owner).custom_id,'notifications_on:owner');assert.equal(control(store.data.owner).label,'تفعيل التنبيهات');
 assert.equal(notificationsEnabled(store.data.other),true);
 const restored=new Store(dir);assert.equal(notificationsEnabled(restored.data.owner),false);
 await connectAccount({ownerId:'owner',token:'replacement',store:restored,login:async()=>({user:{id:'new-linked'},destroy(){}}),crypt:{seal:()=> 'encrypted-new'},stop(){},sendPanel:async()=>{}});
 assert.equal(notificationsEnabled(new Store(dir).data.owner),false);assert.equal(restored.data.owner.seatDelayMs,500);assert.equal(restored.data.owner.joinDelayMs,100);
 setNotifications({ownerId:'owner',enabled:true,store:restored});assert.equal(notificationsEnabled(new Store(dir).data.owner),true);
 assert.equal(control(restored.data.owner).custom_id,'notifications_off:owner');
 assert.throws(()=>setNotifications({ownerId:'deleted',enabled:true,store:restored}));assert.equal(restored.data.deleted,undefined);
});
test('muted automatic DMs never fetch or send, and re-enabling sends only new notifications',async()=>{
 let account={token:'encrypted',notificationsEnabled:false},fetches=0;const sent=[];
 const deliver=(text,options)=>sendNotification({ownerId:'owner',text,options,getAccount:()=>account,fetchUser:async id=>{
  fetches++;assert.equal(id,'owner');return {send:async payload=>{sent.push(payload);return {id:'dm'};}};
 }});
 for(const text of ['منشن أرينا','تم الدخول','يرجى التحكم بنفسك','انتهت الجلسة'])assert.equal(await deliver(text,{mentionOwner:true}),null);
 assert.equal(fetches,0);assert.equal(sent.length,0);
 account={...account,notificationsEnabled:true};assert.deepEqual(await deliver('تنبيه جديد'),{id:'dm'});
 assert.equal(fetches,1);assert.deepEqual(sent.map(p=>p.content),['تنبيه جديد']);
 account={...account,notificationsEnabled:false};assert.equal(await deliver('مكتوم مجدداً'),null);assert.equal(sent.length,1);
});
test('notification delivery rechecks mute or account deletion after a pending recipient fetch',async()=>{
 for(const change of ['mute','delete']){
  let account={token:'encrypted'},release,sends=0;
  const pending=sendNotification({ownerId:'owner',text:'pending',getAccount:()=>account,fetchUser:()=>new Promise(resolve=>release=resolve)});
  account=change==='mute'?{...account,notificationsEnabled:false}:undefined;
  release({send:async()=>{sends++;}});assert.equal(await pending,null);assert.equal(sends,0);
 }
});
test('a legacy linked account with no preference still receives notifications by default',async()=>{
 const sent=[];
 await sendNotification({ownerId:'owner',text:'تم الدخول',getAccount:()=>({token:'encrypted'}),fetchUser:async()=>({send:async payload=>sent.push(payload)})});
 assert.equal(sent.length,1);assert.equal(sent[0].content,'تم الدخول');
});
