'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Client,Message}=require('discord.js-selfbot-v13');
const SnowflakeUtil=require('discord.js-selfbot-v13/src/util/SnowflakeUtil');
const {Gate}=require('../src/core');
const {GameEngine}=require('../src/engine');
const {ChairsEngine}=require('../src/chairs');
const {ChairsGateway}=require('../src/chairs-gateway');
const {ARENA_ID,snapshot}=require('../src/game-data');
const {slashCommand,preserveCommandMetadata}=require('../src/game-command');
const time=Date.parse('2026-10-09T12:00:00Z');
const button=(id='join',label='دخول',disabled=false)=>({type:2,customId:id,label,disabled});
function lobby(name='roulette',field='interactionMetadata',extra={}) {
  const id=SnowflakeUtil.generate(time);
  return {id,channelId:'room',guildId:'guild',author:{id:ARENA_ID,bot:true},createdTimestamp:time,
    content:'المشاركين: 14',components:[{components:[button()]}],
    [field]:{id:`command-${id}`,name,type:2},...extra};
}
function engines() {
  const clicks=[];let now=time+1000;
  const common={channel:'room',now:()=>now,notify:async()=>{}};
  const roulette=new GameEngine({...common,accountId:'me',fetchMessage:async()=>{throw Error('Unexpected fetch');},
    readRelations:async()=>({clans:[],solos:[]}),click:async(id,button)=>clicks.push(['roulette',id,button])});
  const chairs=new ChairsEngine({...common,click:async(id,button,options)=>clicks.push(['chairs',id,button,options])});
  roulette.setModes({autoJoin:true});chairs.setModes({autoJoin:true,autoPlay:true});
  return {roulette,chairs,clicks,setNow(value){now=value;},
    async emit(m){await Promise.all([chairs.onMessage(m),roulette.onMessage(snapshot(m))]);}};
}
test('both command metadata generations identify the right game, without a prefix message',async()=>{
  for(const field of ['interaction','interactionMetadata','interaction_metadata'])for(const name of ['roulette','chairs']) {
    const f=engines(),m=lobby(name,field);await f.emit(m);
    assert.equal(f.clicks.length,1);assert.deepEqual(f.clicks[0].slice(0,3),[name,m.id,'join']);
    const version=f.chairs.version,round=f.roulette.round;
    await f.emit({...m,content:'المشاركين: 26',editedTimestamp:time+1000});
    assert.equal(f.clicks.length,1);assert.equal(f.chairs.version,version);assert.equal(f.roulette.round,round);
  }
});
test('parsed v13 commandName and application-command enum survive a snapshot',()=>{
  const m=lobby('roulette','interaction');m.interaction={id:'cmd',commandName:'roulette',type:'APPLICATION_COMMAND'};
  const g=new Gate({channel:'room',now:()=>time+1000});
  assert.equal(g.inspect(snapshot(m)),'join');
});
test('loading response, disabled button and subsequent edit join once in the 30 second window',async()=>{
  for(const name of ['roulette','chairs']) {
    const f=engines(),m=lobby(name);await f.emit({...m,content:'',components:[]});
    f.setNow(time+20000);
    await f.emit({...m,components:[{components:[button('join','دخول',true)]}],editedTimestamp:time+20000});
    assert.equal(f.clicks.length,0);
    await f.emit({...m,editedTimestamp:time+20001});
    assert.equal(f.clicks.length,1);assert.equal(f.clicks[0][0],name);
  }
});
test('wrong author, room, command, component interaction and literal slash text never start a game',async()=>{
  const f=engines();
  for(const m of [lobby('other'),lobby('roulette','interactionMetadata',{channelId:'wrong'}),
    lobby('chairs','interactionMetadata',{author:{id:'other',bot:true}}),
    lobby('roulette','interactionMetadata',{interactionMetadata:{id:'click',name:'roulette',type:3}}),
    lobby('roulette','interactionMetadata',{interactionMetadata:null,author:{id:'human',bot:false},content:'/roulette'})])await f.emit(m);
  assert.equal(f.clicks.length,0);
});
test('old lobbies cannot become fresh starts through participant edits',async()=>{
  const f=engines();f.setNow(time+60000);
  await f.emit(lobby('roulette','interactionMetadata',{editedTimestamp:time+60000}));
  await f.emit(lobby('chairs','interactionMetadata',{editedTimestamp:time+60000}));
  assert.equal(f.clicks.length,0);assert.equal(f.chairs.active,false);
});
test('switching games in the same room cancels the other game and old updates cannot switch it back',async()=>{
  const f=engines(),r=lobby(),c=lobby('chairs','interactionMetadata',{createdTimestamp:time+100});
  await f.emit(r);await f.emit(c);await f.emit({...r,editedTimestamp:time+1000});
  assert.equal(f.roulette.otherGame,true);assert.equal(f.chairs.active,true);
  const next=lobby('roulette','interactionMetadata',{createdTimestamp:time+200});await f.emit(next);
  await f.emit({...c,editedTimestamp:time+1000});
  assert.equal(f.roulette.otherGame,false);assert.equal(f.chairs.active,false);
  assert.deepEqual(f.clicks.map(x=>x[0]),['roulette','chairs','roulette']);
});
test('slash chairs play-only activates seats without registering and respects forbidden phases',async()=>{
  const f=engines();f.chairs.setModes({autoJoin:false});await f.emit(lobby('chairs'));
  const seat=lobby('chairs','interactionMetadata',{interactionMetadata:null,content:'لا تضغط الزر',components:[{components:[button('seat','•')]}]});
  await f.emit(seat);assert.equal(f.clicks.length,0);
  await f.emit({...seat,id:'positive',content:'احجز مقعدك'});assert.equal(f.clicks.length,1);assert.equal(f.clicks[0][2],'seat');
});
test('join-only chairs does not enable automatic seats',async()=>{
  const f=engines();f.chairs.setModes({autoPlay:false});await f.emit(lobby('chairs'));
  await f.emit(lobby('chairs','interactionMetadata',{interactionMetadata:null,content:'احجز مقعدك',components:[{components:[button('seat','•')]}]}));
  assert.equal(f.clicks.length,1);assert.equal(f.clicks[0][2],'join');
});
test('participant updates do not cancel an in-flight chairs join or rearm after stop',async()=>{
  const f=engines();let signal,release,calls=0;
  f.chairs.click=async(_id,_button,options)=>{calls++;signal=options.signal;return new Promise(resolve=>release=resolve);};
  const m=lobby('chairs'),pending=f.emit(m);assert.equal(calls,1);
  await f.emit({...m,editedTimestamp:time+100});assert.equal(signal.aborted,false);assert.equal(calls,1);
  f.chairs.setModes({autoJoin:false});assert.equal(signal.aborted,true);
  release(null);await pending;f.chairs.setModes({autoJoin:true});await f.emit(m);assert.equal(calls,1);
});
test('slash identity cannot join another game through a pending legacy command',()=>{
  for(const [prefix,name,other] of [['+r','roulette','chairs'],['+c','chairs','roulette']]) {
    const g=new Gate({channel:'room',command:prefix,now:()=>time+1000});
    g.inspect({...lobby(name),id:'human',author:{id:'human',bot:false},content:prefix,interactionMetadata:null});
    assert.equal(g.inspect(lobby(other)),null);assert.equal(g.inspect(lobby('unrelated')),null);
  }
});
preserveCommandMetadata(Message);
test('real v13 Message parser retains modern command metadata across partial edits and snapshots',()=>{
  const client=new Client({checkUpdate:false});
  const data={id:SnowflakeUtil.generate(time),channel_id:'room',guild_id:'guild',author:{id:ARENA_ID,bot:true,username:'Arena'},
    content:'',embeds:[],components:[],timestamp:new Date(time).toISOString(),
    interaction_metadata:{id:'modern-command',type:2,name:'roulette',token:'not-retained'}};
  const m=new Message(client,data);
  preserveCommandMetadata(Message); // Installing twice must not stack wrappers.
  m._patch({id:m.id,content:'المشاركين: 26',components:[{type:1,components:[{type:2,style:1,label:'دخول',custom_id:'join'}]}]});
  assert.deepEqual(slashCommand(snapshot(m)),{name:'roulette',id:'modern-command'});
  assert.equal(JSON.stringify(m.arenaInteractionMetadata).includes('not-retained'),false);
  const g=new Gate({channel:'room',now:()=>time+1000});assert.equal(g.inspect(snapshot(m)),'join');
});
test('raw chairs path retains metadata over partial edits and does not double-process parsed delivery',async()=>{
  const f=engines(),feed=new ChairsGateway({client:{},chairs:f.chairs,channel:'room'});
  const id=SnowflakeUtil.generate(time),d={id,channel_id:'room',guild_id:'guild',author:{id:ARENA_ID,bot:true},
    timestamp:new Date(time).toISOString(),content:'',components:[],interaction_metadata:{id:'chairs-command',type:2,name:'chairs'}};
  feed.onPacket({op:0,t:'MESSAGE_CREATE',s:1,d});assert.equal(f.chairs.active,true);
  feed.onPacket({op:0,t:'MESSAGE_UPDATE',s:2,d:{id,channel_id:'room',content:'المشاركين: 14',
    components:[{type:1,components:[{type:2,style:1,label:'دخول',custom_id:'join'}]}]}});
  assert.equal(f.clicks.length,1);assert.equal(feed.onParsed(feed.get(id)),true);
  feed.onPacket({op:0,t:'MESSAGE_UPDATE',s:3,d:{id,channel_id:'room',content:'المشاركين: 15'}});
  assert.equal(f.clicks.length,1);
});
test('an old other-game lobby edit does not discard a new pending slash registration',async()=>{
  const f=engines(),old=lobby('chairs');await f.emit(old);
  const next=lobby('roulette','interactionMetadata',{createdTimestamp:time+100});
  await f.emit({...next,content:'',components:[]});
  await f.emit({...old,content:'المشاركين: 18',editedTimestamp:time+1000});
  await f.emit({...next,editedTimestamp:time+1001});
  assert.deepEqual(f.clicks.map(x=>x[0]),['chairs','roulette']);
});
