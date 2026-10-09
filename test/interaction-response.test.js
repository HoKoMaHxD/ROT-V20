const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const Util=require('discord.js-selfbot-v13/src/util/Util');const {Events}=require('discord.js-selfbot-v13/src/util/Constants');
function client(){const c=new EventEmitter();c.balance=0;c.incrementMaxListeners=()=>c.balance++;c.decrementMaxListeners=()=>c.balance--;return c;}
test('ack followed by nonce-matched private message returns actual reply',async()=>{
 const c=client(),parent={id:'registration'},reply={id:'private',nonce:'123',content:'تم تسجيل دخولك بنجاح'};
 const p=Util.createPromiseInteraction(c,'123',100,true,parent);
 c.emit(Events.UNHANDLED_PACKET,{t:'INTERACTION_SUCCESS',d:{nonce:'123'}});
 c.emit(Events.MESSAGE_CREATE,{nonce:'wrong'});c.emit(Events.MESSAGE_CREATE,reply);
 assert.equal(await p,reply);assert.equal(c.balance,0);assert.equal(c.listenerCount(Events.MESSAGE_CREATE),0);
});
test('ack without text returns parent, never invented confirmation; cleanup runs',async()=>{
 const c=client(),parent={id:'registration'};const keeper=setTimeout(()=>{},100);
 try {const p=Util.createPromiseInteraction(c,'123',5,true,parent);c.emit(Events.UNHANDLED_PACKET,{t:'INTERACTION_SUCCESS',d:{nonce:'123'}});assert.equal(await p,parent);assert.equal(c.balance,0);assert.equal(c.listenerCount(Events.MESSAGE_CREATE),0);}finally{clearTimeout(keeper);}
});
test('seat cancellation immediately releases interaction listeners before the response timeout',async()=>{
 for(const preAborted of [false,true]){
  const c=client(),controller=new AbortController();if(preAborted)controller.abort();
  const p=Util.createPromiseInteraction(c,'123',5000,true,{id:'seat'},controller.signal);
  controller.abort();await assert.rejects(p,{code:'ARENA_CHAIRS_CANCELLED'});
  assert.equal(c.balance,0);assert.equal(c.listenerCount(Events.MESSAGE_CREATE),0);
  assert.equal(c.listenerCount(Events.UNHANDLED_PACKET),0);assert.equal(c.listenerCount(Events.INTERACTION_MODAL_CREATE),0);
 }
});
