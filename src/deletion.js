'use strict';
const {randomBytes}=require('node:crypto');
class Deletions {
  constructor({now=Date.now}={}){this.now=now;this.pending=new Map();}
  create(owner,record,panel){const nonce=randomBytes(12).toString('hex');this.pending.set(owner,{nonce,record,panel,until:this.now()+120000});return nonce;}
  take(owner,nonce,record){const p=this.pending.get(owner);if(!p||p.nonce!==nonce)return null;this.pending.delete(owner);return p.until>=this.now()&&p.record===record?p:null;}
}
module.exports={Deletions};
