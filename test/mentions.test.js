const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MentionAlerts}=require('../src/mentions');
const account='111111111111111111';
const base={id:'333333333333333333',channelId:'222222222222222222',guildId:'444444444444444444',author:{id:'995439183650889888'},content:`دورك <@${account}>`};
test('linked account mention includes text and message link once',()=>{
 const alerts=new MentionAlerts(account); const text=alerts.inspect(base);
 assert.ok(text.includes(base.content));assert.ok(text.includes(`https://discord.com/channels/${base.guildId}/${base.channelId}/${base.id}`));
 assert.equal(alerts.inspect({...base,content:base.content+' edited'}),null);
});
test('ignores other accounts, bots and mass mentions; accepts later edit',()=>{
 const alerts=new MentionAlerts(account);
 assert.equal(alerts.inspect({...base,author:{id:'other'}}),null);
 assert.equal(alerts.inspect({...base,content:'<@999999999999999999>'}),null);
 assert.equal(alerts.inspect({...base,content:`@everyone <@&${account}>`}),null);
 assert.ok(alerts.inspect({...base,content:`<@!${account}>`}));
});
test('metadata mention without content, embed content and long messages',()=>{
 const metadata={...base,content:'',mentions:{users:new Set([account])}};
 assert.ok(new MentionAlerts(account).inspect(metadata).includes('لا يوجد نص'));
 assert.ok(new MentionAlerts(account).inspect({...metadata,embeds:[{title:'الفائز',description:'مبروك',fields:[{name:'النقاط',value:'10'}]}]}).includes('مبروك'));
 const long=new MentionAlerts(account).inspect({...base,content:base.content+'x'.repeat(5000)});
 assert.ok(long.length<2000);assert.ok(long.includes('بقية النص'));assert.ok(long.includes(base.id));
});
test('different channels supported; independent linked-account alert state',()=>{
 const first=new MentionAlerts(account),second=new MentionAlerts('999999999999999999');
 assert.ok(first.inspect({...base,channelId:'555555555555555555'}));assert.equal(second.inspect(base),null);
});
