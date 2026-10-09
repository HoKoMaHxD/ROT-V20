const {test}=require('node:test');const assert=require('node:assert/strict');
const {GameEngine}=require('../src/engine');
const {ARENA_ID,turn,chooseTarget,confirmedJoin,snapshot,accountEvents}=require('../src/game-data');
const SELF='111111111111111111',OTHER='222222222222222222';
const b=(customId,label,disabled=false,emoji)=>({type:2,customId,label,disabled,emoji});
function message(id,content,buttons=[],time=1500){return {id,channelId:'room',guildId:'guild',author:{id:ARENA_ID,bot:true},content,createdTimestamp:time,components:[{components:buttons}]};}
const command=(id='cmd',time=1000)=>({...message(id,'+r',[],time),author:{id:OTHER,bot:false}});
const registration=(id='reg',time=1100)=>message(id,'المشاركين : 5',[b('join','دخول')],time);
const ownTurn=(id='turn',buttons=[b('p1','1 ☠ Enemy'),b('p2','2 ❄ Friend'),b('random','طرد عشوائي'),b('exit','إنسحاب')])=>message(id,`<@${SELF}>`,buttons);
const data=()=>({clans:[{symbol:'☠',status:'enemy'},{symbol:'❄',status:'main'}],solos:[]});
function fixture(opts={}){
 const messages=new Map(),clicks=[],notices=[];
 const engine=new GameEngine({accountId:SELF,channel:'room',now:()=>2000,randomIndex:()=>0,
  fetchMessage:async id=>messages.get(id),click:async(id,button)=>{clicks.push([id,button]);return opts.reply||message('confirm','تم تسجيل دخولك بنجاح');},
  readRelations:opts.readRelations|| (async()=>data()),notify:async(text,options)=>notices.push({text,...options}),...opts});
 return {engine,messages,clicks,notices,emit(m){messages.set(m.id,snapshot(m));return engine.onMessage(snapshot(m));}};
}
test('join-only confirms correlated success, links public registration and never plays',async()=>{
 const f=fixture();f.engine.setModes({autoJoin:true});await f.emit(command());await f.emit(registration());await f.emit(registration());await f.emit(ownTurn());
 assert.deepEqual(f.clicks,[['reg','join']]);assert.match(f.notices[0].text,/✅/);assert.equal(f.notices[0].url,'https://discord.com/channels/guild/room/reg');
 await f.emit(command('cmd2',1600));await f.emit(registration('reg2',1700));assert.equal(f.clicks.length,2);
});
test('unknown response is not success and wrong author cannot confirm',async()=>{
 const f=fixture({reply:message('unknown','انتظر')});f.engine.setModes({autoJoin:true});await f.emit(command());await f.emit(registration());assert.match(f.notices[0].text,/لم يصل تأكيد/);assert.equal(f.engine.joined,false);
 assert.equal(confirmedJoin({...message('reply','تم تسجيل دخولك بنجاح'),author:{id:OTHER}},registration()),false);
});
test('play-only handles manually joined game and picks enemy direct button',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});await f.emit(command());await f.emit(registration());await f.emit(ownTurn());assert.deepEqual(f.clicks,[['turn','p1']]);
});
test('both modes join then play and a repeated edit cannot double-click',async()=>{
 const f=fixture();f.engine.setModes({autoJoin:true,autoPlay:true});await f.emit(command());await f.emit(registration());await f.emit(ownTurn());await f.emit({...ownTurn(),editedTimestamp:1900});assert.deepEqual(f.clicks,[['reg','join'],['turn','p1']]);
});
test('uses FIRST mention only and ignores wrong room or bot',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});await f.emit({...ownTurn(),content:`<@${OTHER}> <@${SELF}>`});await f.emit({...ownTurn(),channelId:'other'});await f.emit({...ownTurn(),author:{id:OTHER}});assert.equal(f.clicks.length,0);
});
test('next owner transition on reused message permits a later own turn',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});await f.emit(ownTurn());await f.emit({...ownTurn(),content:`<@${OTHER}>`});await f.emit(ownTurn());assert.equal(f.clicks.length,2);
});
test('no enemies -> Arena random button, even when candidates are friendly',async()=>{
 const f=fixture({readRelations:async()=>({clans:[{symbol:'☠',status:'ally'}],solos:[]})});f.engine.setModes({autoPlay:true});await f.emit(ownTurn());assert.deepEqual(f.clicks,[['turn','random']]);
});
test('random disabled -> manual once; +r alone does not release; new registration does',async()=>{
 const f=fixture({readRelations:async()=>({clans:[],solos:[]})});f.engine.setModes({autoPlay:true});
 const locked=ownTurn('t1',[b('p','1 Person'),b('random','طرد عشوائي',true),b('exit','انسحاب')]);
 await f.emit(locked);await f.emit(locked);assert.equal(f.notices.length,1);assert.equal(f.engine.manual,true);
 await f.emit(command());await f.emit(ownTurn('t2'));assert.equal(f.clicks.length,0);
 await f.emit(registration());await f.emit(ownTurn('t3'));assert.deepEqual(f.clicks,[['t3','random']]);
});
test('Mongo failure pauses without a random kick',async()=>{
 const f=fixture({readRelations:async()=>{throw Error('db');}});f.engine.setModes({autoPlay:true});await f.emit(ownTurn());assert.equal(f.clicks.length,0);assert.equal(f.engine.manual,true);assert.equal(f.notices.length,1);
});
test('stop-play during database read cancels pending action',async()=>{
 let release;const f=fixture({readRelations:()=>new Promise(r=>release=r)});f.engine.setModes({autoPlay:true,autoJoin:true});const pending=f.emit(ownTurn());f.engine.setModes({autoPlay:false});release(data());await pending;assert.equal(f.clicks.length,0);assert.equal(f.engine.autoJoin,true);
});
test('new owner observed during database read cancels old turn',async()=>{
 let release;const f=fixture({readRelations:()=>new Promise(r=>release=r)});f.engine.setModes({autoPlay:true});const pending=f.emit(ownTurn());await f.emit({...ownTurn(),content:`<@${OTHER}>`});release(data());await pending;assert.equal(f.clicks.length,0);
});
test('new round cancels previous pending turn',async()=>{
 let release;const f=fixture({readRelations:()=>new Promise(r=>release=r)});f.engine.setModes({autoPlay:true});const pending=f.emit(ownTurn());await f.emit(command());await f.emit(registration());release(data());await pending;assert.equal(f.clicks.length,0);assert.equal(f.engine.manual,false);
});
test('changed player buttons between read and click go manual',async()=>{
 let release;const f=fixture({readRelations:()=>new Promise(r=>release=r)});f.engine.setModes({autoPlay:true});const pending=f.emit(ownTurn());f.messages.set('turn',ownTurn('turn',[b('p1','1 Changed'),b('random','طرد عشوائي')]));release(data());await pending;assert.equal(f.clicks.length,0);assert.equal(f.engine.manual,true);
});
test('click failure pauses and is never retried on update',async()=>{
 let calls=0;const f=fixture({click:async()=>{calls++;throw Error('timeout');}});f.engine.setModes({autoPlay:true});await f.emit(ownTurn());await f.emit(ownTurn());assert.equal(calls,1);assert.equal(f.engine.manual,true);
});
test('emoji numbers and Arabic digits supported; emoji number wins over name digits',()=>{
 const view=turn(ownTurn('t',[b('a','C-zar',false,{name:'1'}),b('b','٢ — ☠ Enemy'),b('c','7mad',false,{name:'24'}),b('random','طرد عشوائي')]));
 assert.deepEqual(view.players.map(p=>p.number),['1','2','24']);assert.equal(view.players[2].name,'7mad');
});
test('updated solo reference uses contained names instead of legacy user IDs',()=>{
 const view=turn(ownTurn('t',[b('a','1 ☠ Decorated NAME ✨'),b('random','طرد عشوائي')]));
 assert.equal(chooseTarget(view,{clans:[],solos:[{name:'name',type:'enemy'}]},SELF,()=>0).customId,'a');
 assert.equal(chooseTarget(view,{clans:[],solos:[{userId:OTHER,names:[]}]},SELF,()=>0).kind,'random');
});
test('protected clans not directly targeted; duplicate solo names require manual',()=>{
 const view=turn(ownTurn());assert.equal(chooseTarget(view,{clans:[{symbol:'☠',status:'enemy'},{symbol:'☠',status:'truce'}],solos:[]},SELF,()=>0).kind,'random');
 const dup=turn(ownTurn('t',[b('a','1 Name'),b('b','2 Name'),b('random','طرد عشوائي')]));assert.equal(chooseTarget(dup,{clans:[],solos:[{userId:'3',names:['Name']}]},SELF,()=>0).kind,'manual');
});
test('empty turn labels or unknown controls never guessed',()=>{
 const view=turn(ownTurn('t',[b('unknown','Mystery'),b('random','طرد عشوائي')]));assert.equal(chooseTarget(view,data(),SELF,()=>0).kind,'manual');
});
test('disabled enemy skipped and stop-all does not rearm manual round',async()=>{
 const f=fixture({readRelations:async()=>({clans:[],solos:[]})});f.engine.setModes({autoPlay:true});await f.emit(ownTurn('t',[b('p','1 ☠ Enemy',true),b('random','طرد عشوائي',true)]));
 f.engine.setModes({autoJoin:false,autoPlay:false});f.engine.setModes({autoPlay:true});await f.emit(ownTurn('new'));assert.equal(f.clicks.length,0);
});
test('fast join submits immediately without fetching message or reading MongoDB',async()=>{
 let submitted=0;
 const f=fixture({fetchMessage:async()=>{throw Error('Unexpected preflight fetch');},readRelations:async()=>{throw Error('Unexpected DB read');},click:()=>{submitted++;return Promise.resolve(message('confirmation','تم تسجيل دخولك بنجاح'));}});
 f.engine.setModes({autoJoin:true});await f.emit(command());
 const pending=f.emit(registration());
 assert.equal(submitted,1); // Submission is started before yielding to the caller.
 await pending;assert.equal(f.engine.joined,true);
 await f.emit(registration());assert.equal(submitted,1);
});
test('custom delay waits then joins; zero remains default',async()=>{
 let release,delayValue;
 const f=fixture({joinDelayMs:500,wait:ms=>{delayValue=ms;return new Promise(r=>release=r);}});
 f.engine.setModes({autoJoin:true});await f.emit(command());const pending=f.emit(registration());
 assert.equal(delayValue,500);assert.equal(f.clicks.length,0);release();await pending;assert.deepEqual(f.clicks,[['reg','join']]);assert.equal(fixture().engine.joinDelayMs,0);
});
test('stop during join delay cancels click and disabled fresh registration is not clicked',async()=>{
 let release;const f=fixture({joinDelayMs:1000,wait:()=>new Promise(r=>release=r)});f.engine.setModes({autoJoin:true});await f.emit(command());const pending=f.emit(registration());f.engine.setModes({autoJoin:false});release();await pending;assert.equal(f.clicks.length,0);
 const g=fixture({joinDelayMs:100,wait:async()=>{},fetchMessage:async()=>message('reg','المشاركين',[b('join','دخول',true)])});g.engine.setModes({autoJoin:true});await g.emit(command());await g.emit(registration());assert.equal(g.clicks.length,0);
});
test('collects more than 25 players and selects enemy from second message, not random tail',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});
 await f.emit(ownTurn('page1',Array.from({length:25},(_,n)=>b(`p${n}`,`${n+1} Friend`))));
 assert.equal(f.clicks.length,0);
 await f.emit(message('page2','',[b('p26','26 ☠ Enemy')]));
 assert.equal(f.clicks.length,0);
 await f.emit(message('controls',`<@${SELF}>`,[b('random','طرد عشوائي'),b('exit','انسحاب')]));
 assert.deepEqual(f.clicks,[['page2','p26']]);
});
test('separate random controls used only after player pages inspected',async()=>{
 const f=fixture({readRelations:async()=>({clans:[],solos:[]})});f.engine.setModes({autoPlay:true});
 await f.emit(ownTurn('page1',[b('p','1 Friend')]));
 await f.emit(message('tail','',[b('r','طرد عشوائي'),b('exit','انسحاب')]));
 assert.deepEqual(f.clicks,[['tail','r']]);
});
test('elimination cancels pending decision and waits for next registration',async()=>{
 let release;const f=fixture({readRelations:()=>new Promise(r=>release=r)});f.engine.setModes({autoPlay:true});
 const task=f.emit(ownTurn());await f.emit(message('out',`تم طرد <@${SELF}>`));release(data());await task;
 assert.equal(f.clicks.length,0);assert.equal(f.engine.manual,true);
 await f.emit(ownTurn('later'));assert.equal(f.clicks.length,0);
 await f.emit(command());await f.emit(registration());assert.equal(f.engine.manual,false);
});
test('revival announcement waits for own mention then pauses without click',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});
 await f.emit(message('revival','الجولة القادمة ستكون جولة إنعاش'));
 await f.emit({...ownTurn('other'),content:`<@${OTHER}>`});assert.equal(f.engine.manual,false);
 await f.emit(ownTurn());assert.equal(f.clicks.length,0);assert.equal(f.engine.manual,true);assert.match(f.notices[0].text,/إنعاش/);
});
test('changing owner on incomplete split turn cancels in-flight previous turn',async()=>{
 let release;const f=fixture({readRelations:()=>new Promise(r=>release=r)});f.engine.setModes({autoPlay:true});
 const task=f.emit(ownTurn());await f.emit({...ownTurn('next',[b('new','1 Other')]),content:`<@${OTHER}>`});
 release(data());await task;assert.equal(f.clicks.length,0);
});
test('solo ally takes priority over enemy clan and is never picked directly',()=>{
 const view=turn(ownTurn('t',[b('ally','1 ☠ Friendly'),b('enemy','2 ☠ Hostile'),b('random','طرد عشوائي')]));
 const relations={clans:[{symbol:'☠',status:'enemy'}],solos:[{name:'friendly',type:'ally'}]};
 assert.equal(chooseTarget(view,relations,SELF,()=>0).customId,'enemy');
});
test('explicit solo enemy takes priority over clan protection as in the new reference',()=>{
 const view=turn(ownTurn('t',[b('a','1 ❄ Named Enemy'),b('random','طرد عشوائي')]));
 for(const status of ['main','ally','truce'])assert.equal(chooseTarget(view,{clans:[{symbol:'❄',status}],solos:[{name:'named enemy',type:'enemy'}]},SELF,()=>0).customId,'a');
});
test('conflicting matching solo ally/enemy rows pause instead of depending on database order',async()=>{
 for(const solos of [[{name:'Name',type:'enemy'},{name:'Name',type:'ally'}],[{name:'Name',type:'ally'},{name:'Name',type:'enemy'}]]){
  const f=fixture({readRelations:async()=>({clans:[],solos})});f.engine.setModes({autoPlay:true});
  await f.emit(ownTurn('t',[b('a','1 Decorated NAME'),b('random','طرد عشوائي')]));
  assert.equal(f.clicks.length,0);assert.equal(f.engine.manual,true);assert.match(f.notices[0].text,/تعارض/);
 }
});
test('random fallback remains available when every matching solo is allied; legacy solo rows stay enemies',()=>{
 const view=turn(ownTurn('t',[b('a','1 Clan Name'),b('random','طرد عشوائي')]));
 assert.equal(chooseTarget(view,{clans:[],solos:[{name:'name',type:'ally'}]},SELF,()=>0).kind,'random');
 assert.equal(chooseTarget(view,{clans:[],solos:[{name:'name'}]},SELF,()=>0).customId,'a');
});
test('clan enemies are the entire first-priority pool even when solo enemies appear first',()=>{
 const view=turn(ownTurn('t',[b('solo','1 Named Enemy'),b('clan1','2 ☠ First'),b('clan2','3 ☠ Second'),b('random','طرد عشوائي')]));
 const relations={...data(),solos:[{name:'Named Enemy',type:'enemy'}]};let pool;
 const choice=chooseTarget(view,relations,SELF,n=>{pool=n;return n-1;});
 assert.equal(pool,2);assert.equal(choice.customId,'clan2');assert.equal(choice.source,'clan');
 view.players[1].disabled=true;view.players[2].disabled=true;
 const fallback=chooseTarget(view,relations,SELF,()=>0);
 assert.equal(fallback.customId,'solo');assert.equal(fallback.source,'solo');
});
for(const enemyNumber of [1,27,51])test(`all three player pages are retained with repeated owner mentions; enemy ${enemyNumber}`,async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});
 for(let page=0;page<3;page++){
  const buttons=Array.from({length:page<2?25:5},(_,i)=>{const n=page*25+i+1;return b(`button${i}`,`${n} ${n===enemyNumber?'☠ Enemy':'Friend'}`);});
  await f.emit(ownTurn(`page${page+1}`,buttons));assert.equal(f.clicks.length,0);
 }
 const tail=message('controls',`<@${SELF}>`,[b('random','طرد عشوائي'),b('exit','انسحاب')]);
 await f.emit(tail);await f.emit({...tail,editedTimestamp:1800});
 assert.deepEqual(f.clicks,[[`page${Math.floor((enemyNumber-1)/25)+1}`,`button${(enemyNumber-1)%25}`]]);
 assert.equal(f.engine.pages.messages.size,4);
});
test('solo on the first page does not outrank an enemy clan on the second page',async()=>{
 const f=fixture({readRelations:async()=>({...data(),solos:[{name:'Solo',type:'enemy'}]})});f.engine.setModes({autoPlay:true});
 await f.emit(ownTurn('p1',[b('solo','1 Solo')]));
 await f.emit(ownTurn('p2',[b('clan','26 ☠ Enemy')]));
 await f.emit(message('p3','',[b('random','طرد عشوائي'),b('exit','انسحاب')]));
 assert.deepEqual(f.clicks,[['p2','clan']]);
});
test('missing or disabled random control requests panel-owner mention and links turn once',async()=>{
 for(const controls of [[b('exit','انسحاب')],[b('random','طرد عشوائي',true),b('exit','انسحاب')]]){
  const f=fixture({readRelations:async()=>({clans:[],solos:[]})});f.engine.setModes({autoPlay:true});
  await f.emit(ownTurn('players',[b('p','1 Neutral')]));await f.emit(message('tail','',controls));await f.emit(message('tail','',controls));
  assert.equal(f.clicks.length,0);assert.equal(f.notices.length,1);assert.equal(f.notices[0].mentionOwner,true);
  assert.equal(f.notices[0].url,'https://discord.com/channels/guild/room/players');assert.equal(f.engine.manual,true);
 }
});
test('a plain mention alone never reads the database or plays; real turn buttons do',async()=>{
 let reads=0;const f=fixture({readRelations:async()=>{reads++;return data();}});f.engine.setModes({autoPlay:true});
 await f.emit(message('notice',`<@${SELF}> دورك`));assert.equal(reads,0);assert.equal(f.clicks.length,0);
 await f.emit({...ownTurn('notice'),editedTimestamp:1700});assert.equal(reads,1);assert.deepEqual(f.clicks,[['notice','p1']]);
});
test('result parser binds each action to its target, including markdown, diacritics and embeds',()=>{
 assert.deepEqual(accountEvents(message('out',`✅ **تم طرد** : <@!${OTHER}>\nالدور التالي <@${SELF}>`)),[{kind:'eliminated',accountId:OTHER}]);
 assert.deepEqual(accountEvents({...message('revive',''),embeds:[{description:`تَمَّ إِنْعاشُ اللاعب <@!${SELF}>`}]}),[{kind:'revived',accountId:SELF}]);
 assert.deepEqual(accountEvents(message('text',`تم طرد شخص آخر ثم جاء دور <@${SELF}>`)),[]);
});
test('eliminated account resumes only after actual revival and a newer turn, not result buttons',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});await f.emit(ownTurn());
 const out=message('out',`تم طرد <@${SELF}>`,[],1600);await f.emit(out);
 assert.equal(f.engine.eliminated,true);await f.emit({...ownTurn('blocked'),editedTimestamp:1650});assert.equal(f.clicks.length,1);
 const revived={...ownTurn('result'),content:`تم إنعاش <@${SELF}>`,createdTimestamp:1700};await f.emit(revived);
 assert.equal(f.engine.eliminated,false);assert.equal(f.engine.manual,false);assert.equal(f.clicks.length,1);
 await f.emit(out);await f.emit({...out,editedTimestamp:1750});await f.emit(ownTurn());assert.equal(f.engine.eliminated,false);assert.equal(f.clicks.length,1);
 await f.emit({...ownTurn(),editedTimestamp:1800});assert.equal(f.clicks.length,2);
 await f.emit(revived);await f.emit({...ownTurn(),editedTimestamp:1900});assert.equal(f.clicks.length,2);
});
test('result for another account cannot eliminate or revive the linked account',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});
 await f.emit(message('otherOut',`تم طرد <@${OTHER}>\nالدور التالي <@${SELF}>`,[],1500));assert.equal(f.engine.eliminated,false);
 await f.emit(message('selfOut',`تم طرد <@${SELF}>`,[],1600));
 await f.emit(message('otherRevived',`تم إنعاش <@${OTHER}>\n<@${SELF}>`,[],1700));
 await f.emit({...ownTurn('late'),editedTimestamp:1800});assert.equal(f.engine.eliminated,true);assert.equal(f.clicks.length,0);
});
test('revival respects a disabled play toggle and does not release a manual fallback by itself',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});await f.emit(message('out',`تم طرد <@${SELF}>`,[],1500));
 f.engine.setModes({autoPlay:false});await f.emit(message('revived',`تم انعاش <@${SELF}>`,[],1600));
 await f.emit({...ownTurn(),editedTimestamp:1700});assert.equal(f.engine.autoPlay,false);assert.equal(f.clicks.length,0);
 const g=fixture({readRelations:async()=>({clans:[],solos:[]})});g.engine.setModes({autoPlay:true});
 await g.emit(ownTurn('manual',[b('n','1 Neutral'),b('exit','انسحاب')]));
 await g.emit(message('revived',`تم إنعاش <@${SELF}>`,[],1700));
 await g.emit({...ownTurn('next'),editedTimestamp:1800});assert.equal(g.engine.manual,true);assert.equal(g.clicks.length,0);
});
test('revival-selection announcement is distinct from the linked account being revived',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});
 await f.emit(message('out',`تم طرد <@${SELF}>`,[],1500));
 await f.emit(message('revivalRound','الجولة القادمة ستكون جولة إنعاش',[],1600));
 await f.emit(message('actualRevival',`تم إنعاش <@${SELF}>`,[],1700));
 await f.emit({...ownTurn('next'),editedTimestamp:1800});assert.deepEqual(f.clicks,[['next','p1']]);assert.equal(f.notices.length,0);
});
test('reviving cannot resurrect a database decision started before elimination',async()=>{
 let release,reads=0;const f=fixture({readRelations:()=>++reads===1?new Promise(r=>release=r):Promise.resolve(data())});f.engine.setModes({autoPlay:true});
 const old=f.emit(ownTurn('old'));await f.emit(message('out',`تم طرد <@${SELF}>`,[],1600));
 await f.emit(message('revived',`تم إنعاش <@${SELF}>`,[],1700));await f.emit({...ownTurn('next'),editedTimestamp:1800});
 release(data());await old;assert.deepEqual(f.clicks,[['next','p1']]);assert.equal(f.engine.manual,false);
});
test('unrelated Arena text does not cancel a valid pending database decision',async()=>{
 let release;const f=fixture({readRelations:()=>new Promise(r=>release=r)});f.engine.setModes({autoPlay:true});
 const pending=f.emit(ownTurn());await f.emit(message('info','معلومة عامة'));release(data());await pending;
 assert.deepEqual(f.clicks,[['turn','p1']]);
});
test('changed owner on the second page during REST verification blocks the entire decision',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});
 await f.emit(ownTurn('p1',[b('p','1 ☠ Enemy')]));await f.emit(ownTurn('p2',[b('p2','26 Friend')]));
 f.messages.set('p2',{...f.messages.get('p2'),content:`<@${OTHER}>`});
 await f.emit(message('tail','',[b('random','طرد عشوائي'),b('exit','انسحاب')]));
 assert.equal(f.clicks.length,0);assert.equal(f.engine.manual,true);assert.equal(f.notices[0].mentionOwner,true);
});
test('an incomplete observed owner transition rearms an edited multipage turn',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});await f.emit(ownTurn());
 await f.emit({...ownTurn('turn',[b('p','1 Another')]),content:`<@${OTHER}>`,editedTimestamp:1600});
 await f.emit({...ownTurn(),editedTimestamp:1700});assert.equal(f.clicks.length,2);
});
test('orphan random controls never assume that missing player pages contain no enemies',async()=>{
 const f=fixture();f.engine.setModes({autoPlay:true});await f.emit(ownTurn('tail',[b('random','طرد عشوائي'),b('exit','انسحاب')]));
 assert.equal(f.clicks.length,0);assert.equal(f.engine.manual,true);assert.match(f.notices[0].text,/قائمة لاعبين/);
});
test('removed final controls during fresh verification request manual control',async()=>{
 let release;const f=fixture({readRelations:()=>new Promise(r=>release=r)});f.engine.setModes({autoPlay:true});
 const pending=f.emit(ownTurn());f.messages.set('turn',ownTurn('turn',[b('p1','1 ☠ Enemy')]));release(data());await pending;
 assert.equal(f.clicks.length,0);assert.equal(f.engine.manual,true);assert.equal(f.notices[0].mentionOwner,true);
});
for(const cause of ['elimination','delete','owner','stop','newGame'])test(`queued roulette press is cancelled on ${cause}`,async()=>{
 let reached;const ready=new Promise(r=>reached=r);let signal;
 const f=fixture({click:async(id,button,options)=>{
  signal=options.signal;reached();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
 }});f.engine.setModes({autoPlay:true});const pending=f.emit(ownTurn());await ready;
 if(cause==='elimination')await f.emit(message('out',`تم طرد <@${SELF}>`,[],1600));
 else if(cause==='delete')f.engine.onDelete('turn');
 else if(cause==='owner')await f.emit({...ownTurn('next',[b('p','1 Person')]),content:`<@${OTHER}>`});
 else if(cause==='stop')f.engine.setModes({autoPlay:false});
 else await f.emit(command());
 await pending;assert.equal(signal.aborted,true);assert.equal(f.notices.length,0);
});
