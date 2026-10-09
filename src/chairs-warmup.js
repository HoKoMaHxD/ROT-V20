'use strict';
// One bounded preparatory read shared by all accounts using the priority pool.
// No interval, no button interactions, and no repeated requests while waiting.
class ChairsWarmup {
  constructor({now=Date.now,minimumGapMs=2000}={}) {
    Object.assign(this,{now,minimumGapMs});this.seen=new Map();this.lastStart=-Infinity;this.pending=null;
  }
  prepare(client,message) {
    const now=this.now(),key=`${message.id}:${message.editedTimestamp||message.createdTimestamp}`;
    for(const [id,at] of this.seen)if(now-at>60000)this.seen.delete(id);
    if(this.seen.has(key))return;
    this.seen.set(key,now);
    if(this.seen.size>100)this.seen.delete(this.seen.keys().next().value);
    if(this.pending||now-this.lastStart<this.minimumGapMs)return;
    this.lastStart=now;
    try {
      const signal=AbortSignal.timeout(1500);
      const task=client.api.gateway.get({auth:false,arenaSignal:signal});
      this.pending=Promise.resolve(task).catch(()=>{}).finally(()=>{this.pending=null;});
    }catch{this.pending=null;}
  }
}
module.exports={ChairsWarmup};
