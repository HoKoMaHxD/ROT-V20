const {test}=require('node:test');const assert=require('node:assert/strict');const {isControlMember}=require('../src/access');
test('all control guild members allowed; other servers rejected',async()=>{
 const bot={};assert.equal(await isControlMember({guildId:'control',member:{},user:{id:'anyone'}},bot,'control'),true);
 assert.equal(await isControlMember({guildId:'other',member:{}},bot,'control'),false);
});
test('private controls verify membership freshly using panel owner',async()=>{
 const i={guildId:null,user:{id:'owner'}};
 const bot={guilds:{fetch:async id=>{assert.equal(id,'control');return {members:{fetch:async options=>{assert.deepEqual(options,{user:'owner',force:true});return {id:'owner'};}}};}}};
 assert.equal(await isControlMember(i,bot,'control'),true);
 bot.guilds.fetch=async()=>{throw Error('not a member');};
 assert.equal(await isControlMember(i,bot,'control'),false);
});
