'use strict';
const {randomInt}=require('node:crypto');
const {Gate}=require('./core');
const {GameStarts}=require('./game-command');
const {ARENA_ID,messageText,normalize,firstMention,accountEvents,components,turn,viewSignature,jump,confirmedJoin,chooseTarget}=require('./game-data');
const {RoulettePages,mergePages}=require('./roulette-pages');
async function deadline(promise,ms) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Operation timed out')),ms);})]);}
  finally{clearTimeout(timer);}
}
class GameEngine {
  constructor({accountId,channel,fetchMessage,click,readRelations,notify,status=()=>{},now=Date.now,randomIndex=randomInt,joinDelayMs=0,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
    Object.assign(this,{accountId,channel,fetchMessage,click,readRelations,notify,status,now,randomIndex});
    this.joinDelayMs=joinDelayMs;this.wait=wait;
    this.gate=new Gate({channel,now});this.autoJoin=false;this.autoPlay=false;
    this.starts=new GameStarts();
    this.closed=false;this.joinVersion=0;this.playVersion=0;this.round=0;
    this.roundId=null;this.roundStart=0;this.manual=false;this.joined=false;
    this.collector=new RoulettePages();this.revival=false;this.otherGame=false;this.views=new Map();this.attempts=new Set();this.joinIds=new Set();
    this.eliminated=false;this.life=0;this.resumeAfter=0;this.lifecycleSeen=new Map();this.lastLifecycleTime=0;this.pendingTurn=null;
  }
  get pages(){return this.collector.group;}
  cancelTurn(){this.pendingTurn?.controller.abort();this.pendingTurn=null;}
  setModes({autoJoin=this.autoJoin,autoPlay=this.autoPlay}) {
    if(autoJoin!==this.autoJoin){this.joinVersion++;this.gate.reset();}
    if(autoPlay!==this.autoPlay){this.playVersion++;this.cancelTurn();}
    this.autoJoin=autoJoin;this.autoPlay=autoPlay;
  }
  close(){this.closed=true;this.setModes({autoJoin:false,autoPlay:false});}
  disconnect(){this.gate.reset();this.cancelTurn();this.collector.reset();this.playVersion++;this.joinVersion++;this.manual=true;this.eliminated=false;this.status('انقطع اتصال الحساب؛ اللعب ينتظر تسجيلاً جديداً بعد /roulette أو +r.');}
  onDelete(id){this.collector.remove(id);if(this.pendingTurn?.pages!==this.pages)this.cancelTurn();}
  applyAccountEvent(m,event) {
    const stamp=m.editedTimestamp||m.createdTimestamp,previous=this.lifecycleSeen.get(m.id);
    if(!Number.isFinite(stamp)||stamp<this.lastLifecycleTime||previous?.kind===event.kind)return;
    this.lifecycleSeen.set(m.id,{stamp,kind:event.kind});
    if(this.lifecycleSeen.size>1000)this.lifecycleSeen.delete(this.lifecycleSeen.keys().next().value);
    this.lastLifecycleTime=stamp;
    if(event.kind==='eliminated') {
      this.cancelTurn();this.playVersion++;this.collector.reset();this.manual=true;this.eliminated=true;
      this.status('تم طرد الحساب؛ انتظار إنعاشه أو تسجيل روليت جديد.');
    } else if(this.eliminated) {
      this.cancelTurn();this.playVersion++;this.life++;this.collector.reset();this.manual=false;this.eliminated=false;
      this.revival=false;this.resumeAfter=stamp;
      this.status(this.autoPlay?'تم إنعاش الحساب؛ اللعب التلقائي ينتظر دوراً جديداً بأزرار الطرد.':'تم إنعاش الحساب؛ خيار اللعب التلقائي ما زال متوقفاً.');
    }
  }
  noteView(m) {
    const view=turn(m), previous=this.views.get(m.id);
    const owner=view?.owner||firstMention(m)||null;
    // Only a switch to another identified owner re-arms an edited message.
    const generation=(previous?.generation||0)+(owner&&previous?.owner&&owner!==previous.owner?1:0);
    const item={owner:owner||previous?.owner||null,generation,signature:viewSignature(m),view};
    this.views.set(m.id,item);
    if(this.views.size>1000)this.views.delete(this.views.keys().next().value);
    return item;
  }
  onMessage(m) {
    if(this.closed||m.channelId!==this.channel||!m.guildId)return Promise.resolve();
    const start=this.starts.inspect(m,this.now());
    if(start?.game==='chairs'){this.otherGame=true;this.cancelTurn();this.playVersion++;this.joinVersion++;this.gate.reset();this.collector.reset();return Promise.resolve();}
    if(start?.game==='roulette'){this.otherGame=false;this.cancelTurn();this.joinVersion++;this.collector.reset();}
    if(this.otherGame)return Promise.resolve();
    const joinButton=this.gate.inspect(m);
    if(joinButton && !this.joinIds.has(m.id)) {
      this.joinIds.add(m.id);if(this.joinIds.size>1000)this.joinIds.delete(this.joinIds.values().next().value);
      this.round++;this.roundId=m.id;this.roundStart=m.createdTimestamp||this.now();
      this.cancelTurn();this.manual=false;this.eliminated=false;this.resumeAfter=0;this.lastLifecycleTime=0;this.lifecycleSeen.clear();
      this.joined=false;this.collector.clear();this.revival=false;this.views.clear();this.attempts.clear();
      if(this.autoJoin)return this.attemptJoin(m,joinButton);
      return Promise.resolve();
    }
    if(m.author?.id!==ARENA_ID)return Promise.resolve();
    if(this.roundStart && m.createdTimestamp<this.roundStart)return Promise.resolve();
    const text=normalize(messageText(m)).replace(/[\u064B-\u065F\u0670]/g,'');
    const events=accountEvents(m);
    if(events.length){
      const event=events.findLast(e=>e.accountId===this.accountId);
      if(event)this.applyAccountEvent(m,event);
      if(this.pages?.messages.has(m.id)){this.cancelTurn();this.collector.reset();}
      return Promise.resolve(); // A result mention is not a fresh turn, even with leftover buttons.
    }
    if(/الجولة القادمة ستكون جولة [إا]نعاش/.test(text))this.revival=true;
    if(this.revival&&firstMention(m)===this.accountId&&components(m).length&&this.autoPlay&&!this.manual)
      return this.pause('هذا دور إنعاش؛ اختر بنفسك.',m,this.round,this.playVersion);
    if(this.eliminated)return Promise.resolve();
    const time=m.editedTimestamp||m.createdTimestamp;
    if(this.resumeAfter&&time<=this.resumeAfter)return Promise.resolve();
    const merged=this.collector.inspect(m);
    if(this.pendingTurn&&(this.pendingTurn.pages!==this.pages||!this.pages?.complete||merged&&viewSignature(merged)!==this.pendingTurn.signature))this.cancelTurn();
    if(!merged){
      if(this.pages)this.noteView(mergePages([...this.pages.messages.values()]));
      return Promise.resolve();
    }
    m=merged;
    const item=this.noteView(m);item.pages=this.pages;
    if(!this.autoPlay||this.manual||item.view?.owner!==this.accountId)return Promise.resolve();
    // With play-only, allow the current manually joined game, but not stale replays.
    const anchorTime=m.editedTimestamp||m.createdTimestamp;
    if(!Number.isFinite(anchorTime)||this.now()-anchorTime>30000)return Promise.resolve();
    const key=`${this.round}:${this.life}:${m.id}:${item.generation}`;
    if(this.attempts.has(key))return Promise.resolve();
    this.attempts.add(key);
    return this.attemptTurn(m,item,key);
  }
  async attemptJoin(m,buttonId) {
    const round=this.round,version=this.joinVersion;
    const valid=()=>!this.closed&&this.autoJoin&&round===this.round&&version===this.joinVersion;
    try {
      // Zero retains the immediate Gateway path; delayed attempts recheck the button.
      const delay=this.joinDelayMs;
      let candidate=m;
      if(delay>0) {
        await this.wait(delay);
        if(!valid())return;
        candidate=await this.fetchMessage(m.id);
      }
      if(!valid())return;
      const button=components(candidate).find(b=>b.customId===buttonId&&!b.disabled&&b.label.trim()==='دخول');
      if(!button){await this.notify('تعذر الدخول: زر التسجيل لم يعد متاحاً.',{url:jump(m)});return;}
      const reply=await this.click(m.id,buttonId);
      if(!valid())return;
      if(confirmedJoin(reply,m)) {
        this.joined=true;this.status('تم تأكيد تسجيل الحساب في الروليت بنجاح.');
        await this.notify('✅ تم تسجيل الحساب في الروليت بنجاح.',{url:jump(m)});
      } else {
        this.status('أُرسلت محاولة الدخول، لكن لم يصل تأكيد التسجيل.');
        await this.notify('أُرسلت محاولة الدخول، لكن لم يصل تأكيد «تم تسجيل دخولك بنجاح». تحقق من التسجيل.',{url:jump(m)});
      }
    } catch {
      if(!valid())return;
      this.status('تعذر تأكيد محاولة الدخول؛ لا إعادة تلقائية لهذه الجولة.');
      await this.notify('تعذر إتمام أو تأكيد محاولة الدخول. تحقق يدويًا؛ لن تتكرر المحاولة لهذه الجولة.',{url:jump(m)});
    }
  }
  async pause(reason,m,round,version) {
    if(this.closed||round!==this.round||version!==this.playVersion||!this.autoPlay)return;
    this.cancelTurn();this.manual=true;this.status('تحكم يدوي حتى الروليت الجديد: '+reason);
    await this.notify(`${reason}\nيرجى التحكم بنفسك حتى نهاية الجولة. سيتوقف اللعب التلقائي حتى تسجيل روليت جديد بعد /roulette أو +r.`,{url:jump(m),mentionOwner:true});
  }
  async attemptTurn(m,item) {
    const round=this.round,version=this.playVersion,started=this.now();
    const pending={controller:new AbortController(),pages:item.pages,signature:item.signature};
    this.cancelTurn();this.pendingTurn=pending;
    const valid=()=>!this.closed&&this.autoPlay&&!this.manual&&!pending.controller.signal.aborted&&round===this.round&&version===this.playVersion;
    const sameTurn=()=>{
      const current=this.views.get(m.id);
      return this.pages===item.pages&&current?.generation===item.generation&&current?.owner===this.accountId;
    };
    try {
      const relations=await deadline(this.readRelations(item.view,m),6000);
      if(!valid()||!sameTurn())return;
      const fetched=await deadline(Promise.all((m.pageIds||[m.id]).map(id=>this.fetchMessage(id))),3000);
      if(!valid()||!sameTurn())return;
      if(fetched.some((x,n)=>!x||x.id!==m.pageIds[n]||x.author?.id!==ARENA_ID||x.channelId!==this.channel||x.guildId!==m.guildId||accountEvents(x).length||firstMention(x)&&firstMention(x)!==this.accountId))
        return this.pause('تغير صاحب الدور أو تعذر التحقق من إحدى صفحات اللاعبين؛ تحكم بنفسك.',m,round,version);
      const fresh=mergePages(fetched);
      const view=turn(fresh);
      if(view?.owner!==this.accountId){await this.pause('لم تعد خيارات الطرد مكتملة لهذا الدور؛ تحكم بنفسك.',m,round,version);return;}
      if(viewSignature(fresh)!==item.signature||this.now()-started>10000) {
        await this.pause('تغيرت خيارات الدور أثناء الفحص؛ لم يتم إرسال طرد.',m,round,version);return;
      }
      if(!view.players.length){await this.pause('لم تصل قائمة لاعبين مكتملة لهذا الدور؛ تحكم بنفسك.',m,round,version);return;}
      const choice=chooseTarget(view,relations,this.accountId,this.randomIndex);
      if(choice.kind==='manual'){await this.pause(choice.reason,m,round,version);return;}
      if(!valid()||!sameTurn())return;
      await this.click(choice.messageId||m.id,choice.customId,{signal:pending.controller.signal});
      if(!valid())return;
      this.status(choice.kind==='enemy'?`أُرسل اختيار طرد ${choice.source==='clan'?'عضو الكلان المعادي':'عداوة السولو'} رقم ${choice.number}.`:'أُرسل اختيار الطرد العشوائي من أرينا.');
    } catch {
      if(!valid()||!sameTurn())return;
      await this.pause('تعذر إتمام فحص العداوات أو التحقق من تنفيذ الطرد؛ لن تتكرر المحاولة تلقائياً.',m,round,version);
    } finally {if(this.pendingTurn===pending)this.pendingTurn=null;}
  }
}
module.exports={GameEngine,deadline};
