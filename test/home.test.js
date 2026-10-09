const {test}=require('node:test');const assert=require('node:assert/strict');const {homeMessage,publishHome,statusMessage}=require('../src/home');
test('setup publishes standalone channel message and removes private acknowledgement',async()=>{
 const events=[];let payload;
 await publishHome({deferReply:async o=>events.push(['defer',o.ephemeral]),channel:{send:async p=>{payload=p;events.push(['send']);}},deleteReply:async()=>events.push(['delete']),editReply:async()=>{throw Error('unexpected');}});
 assert.deepEqual(events,[['defer',true],['send'],['delete']]);assert.equal(payload.reply,undefined);assert.deepEqual(payload.components[0].toJSON().components.map(b=>b.label),['دخول','لوحتي','الحالة']);
});
test('status includes active features, connection and manual state but no tokens',()=>{
 const sessions=new Map([['owner',{client:{user:{id:'account',username:'Test'},isReady:()=>true,token:'SECRET'},engine:{autoJoin:true,autoPlay:false,manual:true}}]]);
 const payload=statusMessage(sessions,'viewer');const text=JSON.stringify(payload);
 assert.ok(text.includes('account'));assert.ok(text.includes('owner'));assert.ok(text.includes('الدخول التلقائي'));assert.ok(text.includes('مفعّل'));assert.ok(text.includes('روليت جديداً'));assert.equal(text.includes('SECRET'),false);assert.equal(payload.components[0].toJSON().components[1].custom_id,'home_status:viewer:0');
});
test('status paginates without dropping sessions, including reconnecting accounts',()=>{
 const sessions=new Map(Array.from({length:17},(_,n)=>['o'+n,{client:{user:{id:'a'+n,username:'n'+n},isReady:()=>false},engine:{}}]));
 assert.equal(statusMessage(sessions,'v',0).embeds[0].toJSON().fields.length,8);
 assert.equal(statusMessage(sessions,'v',1).embeds[0].toJSON().fields.length,8);
 assert.equal(statusMessage(sessions,'v',2).embeds[0].toJSON().fields.length,1);
 assert.match(statusMessage(new Map(),'v').embeds[0].toJSON().description,/لا توجد/);
});
test('status shows muted alerts and mentions while gameplay stays enabled, without exposing account secrets',()=>{
 const sessions=new Map([['owner',{client:{user:{id:'linked'},isReady:()=>true},engine:{autoPlay:true}}]]);
 const accounts={owner:{notificationsEnabled:false,token:'SECRET'}};
 const payload=statusMessage(sessions,'viewer',0,accounts),text=JSON.stringify(payload);
 assert.match(text,/التنبيهات: متوقفة/);assert.match(text,/تنبيه المنشن: ⏹ متوقف/);
 assert.match(text,/اللعب التلقائي للروليت: ✅ مفعّل/);assert.equal(text.includes('SECRET'),false);
});
