'use strict';
const {randomInt}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {Gate}=require('./core');
const {GameStarts}=require('./game-command');
const {bookingDelay}=require('./booking-speed');
const {ARENA_ID,messageText,components,jump,confirmedJoin}=require('./game-data');
const isSeat=b=>b.customId&&/^[\s.•●·]*$/.test(b.label||'');
// Match whole Arabic result words: the final-round forecast "يفوز" is not "فوز".
// JavaScript \b does not provide Arabic word boundaries.
const endAnnouncement=/(?:^|[^\p{L}\p{N}_])(?:فاز|الفائز|فوز|انتهت اللعبة|انتهى القيم)(?=$|[^\p{L}\p{N}_])/u;
class ChairsEngine {
  constructor({channel,click,notify,status=()=>{},now=Date.now,randomIndex=randomInt,prepare=()=>{},seatDelayMs=0,wait=(ms,signal)=>delay(ms,undefined,{signal})}) {
    Object.assign(this,{channel,click,notify,status,now,randomIndex,prepare});
    this.seatDelayMs=bookingDelay({seatDelayMs});this.wait=wait;
    this.gate=new Gate({channel,now,command:'+c'});this.autoJoin=false;this.autoPlay=false;this.active=false;this.states=new Map();this.version=0;this.joinVersion=0;
    this.starts=new GameStarts();
  }
  get enabled(){return this.autoJoin||this.autoPlay;}
  cancelSeat(){this.pendingSeat?.controller.abort();this.pendingSeat=null;}
  cancelJoin(){this.pendingJoin?.controller.abort();this.pendingJoin=null;}
  setModes({autoJoin=this.autoJoin,autoPlay=this.autoPlay}={}){
    if(autoJoin!==this.autoJoin){this.joinVersion++;this.cancelJoin();this.gate.reset();}
    if(autoPlay!==this.autoPlay){this.version++;this.cancelSeat();}
    this.autoJoin=autoJoin;this.autoPlay=autoPlay;
    if(!this.enabled)this.disconnect();
  }
  setEnabled(value){this.setModes({autoJoin:value,autoPlay:value});}
  close(){this.setModes({autoJoin:false,autoPlay:false});}
  disconnect(){this.cancelSeat();this.cancelJoin();this.version++;this.joinVersion++;this.active=false;this.states.clear();this.gate.reset();}
  async onMessage(m){
    if(!this.enabled||m.channelId!==this.channel||!m.guildId)return;
    const time=m.editedTimestamp||m.createdTimestamp;
    if(!Number.isFinite(time)||this.now()-time>30000)return;
    const start=this.starts.inspect(m,this.now());
    if(start?.game==='roulette'){this.disconnect();return;}
    if(start?.game==='chairs'){this.cancelSeat();this.cancelJoin();this.active=true;this.version++;this.joinVersion++;this.states.clear();this.started=start.at;}
    const joinButton=this.gate.inspect(m),join=this.autoJoin?joinButton:null;
    const text=messageText(m).normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'');
    if(!m.author?.bot)return;
    if(!this.active||m.author.id!==ARENA_ID||m.createdTimestamp<this.started)return;
    // Read components only once per event, including a final single-seat update.
    let bs;
    const buttons=()=>bs??=components(m);
    const forbidden=/لا تضغط/.test(text),ready=/كن جاهز|استعد/.test(text);
    const reserve=!forbidden&&!ready&&/احجز مقعدك/.test(text);
    const ended=endAnnouncement.test(text);
    const old=this.states.get(m.id)||{phase:'unknown',attempted:false};
    const current=this.pendingSeat;
    if(current&&(m.id===current.messageId||m.createdTimestamp>=current.createdTimestamp&&(forbidden||ready||reserve||ended))) {
      const sameSeat=m.id===current.messageId&&reserve
        &&buttons().some(b=>b.customId===current.customId&&!b.disabled&&isSeat(b));
      if(!sameSeat){
        // A configured delay has not called the transport; queued requests are
        // replaceable only when the transport confirms they have NEVER dispatched.
        // Once dispatch starts, a missing acknowledgement is not proof of failure.
        if(m.id===current.messageId&&reserve&&old===current.state&&(current.dispatchState==='waiting'||current.dispatchState==='queued')){
          old.attempted=false;old.retired.add(current.customId);
        }
        this.cancelSeat();
      }
    }
    if(join){
      const version=this.joinVersion,pending={controller:new AbortController()};
      this.pendingJoin=pending;
      const valid=()=>this.autoJoin&&version===this.joinVersion&&!pending.controller.signal.aborted;
      try{
        const reply=await this.click(m.id,join,{signal:pending.controller.signal});
        if(valid())await this.notify(confirmedJoin(reply,m)?'✅ تم تسجيل الحساب في الكراسي بنجاح.':'أُرسلت محاولة دخول الكراسي؛ تحقق من التسجيل.',{url:jump(m)});
      }catch{if(valid())await this.notify('تعذر تأكيد دخول الكراسي؛ تحقق يدوياً.',{url:jump(m)});}
      finally{if(this.pendingJoin===pending)this.pendingJoin=null;}
      return;
    }
    if(forbidden) {this.states.set(m.id,{phase:'forbidden',attempted:true});return;}
    if(ready) {
      // Prepare the random preference while waiting, never click a ready button.
      const candidates=buttons().filter(isSeat);
      const preferred=old.phase==='ready'&&candidates.some(b=>b.customId===old.preferred)
        ?old.preferred:candidates.length?candidates[candidates.length===1?0:this.randomIndex(candidates.length)].customId:null;
      this.states.set(m.id,{phase:'ready',attempted:old.phase==='ready'?old.attempted:false,preferred});
      if(this.autoPlay&&old.phase!=='ready'){try{this.prepare(m);}catch{}}
      return;
    }
    if(ended&&!buttons().some(b=>b.customId&&!b.disabled)) {this.disconnect();this.status('انتهى قيم الكراسي؛ انتظار /chairs أو +c القادم.');return;}
    if(!reserve)return;
    if(!this.autoPlay||old.attempted)return;
    // Only anonymous seat buttons in the explicitly positive phase are eligible.
    // One pass handles the prepared choice and the last remaining available seat.
    let seat;
    for(const b of buttons()){
      if(b.disabled||!isSeat(b)||old.retired?.has(b.customId))continue;
      seat??=b;
      if(!old.preferred||b.customId===old.preferred){seat=b;break;}
    }
    if(!seat)return;
    // Keep the original deadline if an unsent seat is replaced during the wait.
    // With the default 0, there is no timer, extra await or network preflight.
    const reserveUntil=old.reserveUntil??(this.seatDelayMs>0?this.now()+this.seatDelayMs:0);
    const state={phase:'reserve',attempted:true,retired:old.retired||new Set(),reserveUntil};
    this.states.set(m.id,state);
    if(this.states.size>500)this.states.delete(this.states.keys().next().value);
    const version=this.version;
    const remaining=reserveUntil?Math.max(0,reserveUntil-this.now()):0;
    const pending={controller:new AbortController(),messageId:m.id,customId:seat.customId,createdTimestamp:m.createdTimestamp,state,dispatchState:remaining>0?'waiting':'unknown'};
    this.pendingSeat=pending;
    try {
      if(remaining>0){
        await this.wait(remaining,pending.controller.signal);
        if(pending.controller.signal.aborted||version!==this.version||!this.autoPlay||!this.active)return;
        pending.dispatchState='unknown';
      }
      await this.click(m.id,seat.customId,{
        signal:pending.controller.signal,
        onQueued:()=>{if(pending.dispatchState==='unknown')pending.dispatchState='queued';},
        onDispatch:()=>{pending.dispatchState='dispatched';}
      });
      if(version===this.version&&this.autoPlay&&!pending.controller.signal.aborted)this.status('أُرسلت محاولة حجز مقعد في الكراسي.');
    } catch {
      if(pending.controller.signal.aborted||version!==this.version||!this.autoPlay)return;
      this.disconnect();this.status('تعذر تأكيد المقعد؛ تحكم يدوياً حتى /chairs أو +c القادم.');
      await this.notify('تعذر تأكيد حجز المقعد. تحكم بنفسك؛ الكراسي التلقائية تنتظر /chairs أو +c جديداً.',{url:jump(m)});
    } finally {if(this.pendingSeat===pending)this.pendingSeat=null;}
  }
}
module.exports={ChairsEngine};
