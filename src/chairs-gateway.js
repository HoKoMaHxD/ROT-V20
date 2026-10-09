'use strict';
const {performance}=require('node:perf_hooks');
const {Message}=require('discord.js-selfbot-v13');
const SnowflakeUtil=require('discord.js-selfbot-v13/src/util/SnowflakeUtil');
const {ARENA_ID}=require('./game-data');
const {commandFields}=require('./game-command');
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const resolveComponent=function(id){return this.buttonIndex.get(id);};

function mapComponents(rows) {
  const index=new Map();
  function walk(items) {return (items||[]).map(item=>{
    const b={type:item.type===2?'BUTTON':item.type};
    if(b.type==='BUTTON') {
      Object.assign(b,{customId:item.custom_id??item.customId,label:item.label||'',disabled:!!item.disabled,emoji:item.emoji||null});
      if(b.customId)index.set(b.customId,b);
    }
    if(item.components)b.components=walk(item.components);
    if(item.accessory)b.components=[...(b.components||[]),...walk([item.accessory])];
    return b;
  });}
  return {components:walk(rows),buttonIndex:index};
}

// This consumes only the existing account's Gateway packets. It sends no polling
// requests and never mutates the library's message cache or packet ordering.
class ChairsGateway {
  constructor({client,chairs,channel,onError=()=>{},clock=()=>performance.now()}) {
    Object.assign(this,{client,chairs,channel,onError,clock});
    this.messages=new Map();this.handled=new Set();this.sequence=-1;
  }
  clear(){this.messages.clear();this.handled.clear();this.sequence=-1;}
  remember(message) {
    this.messages.set(message.id,message);
    if(this.messages.size>256){const id=this.messages.keys().next().value;this.messages.delete(id);this.handled.delete(id);}
  }
  get(id){return this.messages.get(id);}
  fromPacket(data,previous) {
    const m={...previous,id:data.id,channelId:data.channel_id,client:this.client,resolveComponent};
    for(const key of ['content','embeds','author'])if(own(data,key))m[key]=data[key];
    if(own(data,'interaction'))m.interaction=commandFields(data).interaction;
    if(own(data,'interaction_metadata'))m.interactionMetadata=commandFields(data).interactionMetadata;
    m.guildId=data.guild_id??previous?.guildId??this.client.channels?.cache.get(data.channel_id)?.guildId;
    m.applicationId=data.application_id??previous?.applicationId;
    m.flags={bitfield:own(data,'flags')?data.flags:previous?.flags?.bitfield||0};
    if(!previous)m.createdTimestamp=/^\d{17,20}$/.test(m.id)?SnowflakeUtil.timestampFrom(m.id):Date.parse(data.timestamp);
    if(own(data,'edited_timestamp'))m.editedTimestamp=data.edited_timestamp?Date.parse(data.edited_timestamp):null;
    if(own(data,'message_reference'))m.reference=data.message_reference?{messageId:data.message_reference.message_id}:null;
    if(own(data,'components'))Object.assign(m,mapComponents(data.components));
    m.embeds??=[];m.content??='';
    return m;
  }
  onPacket(packet) {
    if(packet.op!==0||!['MESSAGE_CREATE','MESSAGE_UPDATE','MESSAGE_DELETE','MESSAGE_DELETE_BULK'].includes(packet.t))return;
    const data=packet.d;
    if(data?.channel_id!==this.channel)return;
    if(Number.isSafeInteger(packet.s)) {
      if(packet.s<=this.sequence){if(data.id)this.handled.add(data.id);return;}
      this.sequence=packet.s;
    }
    if(packet.t==='MESSAGE_DELETE'||packet.t==='MESSAGE_DELETE_BULK') {
      for(const id of data.ids||[data.id]) {
        this.messages.delete(id);this.handled.delete(id);
        if(this.chairs.pendingSeat?.messageId===id)this.chairs.cancelSeat();
      }
      return;
    }
    this.handled.delete(data.id);
    const previous=this.messages.get(data.id);
    if(packet.t==='MESSAGE_CREATE'&&previous){this.handled.add(data.id);return;}
    // An unknown partial edit must use the library's full cached Message first;
    // otherwise absent text/embeds could hide a previous ready or forbidden phase.
    if(packet.t==='MESSAGE_UPDATE'&&!previous)return;
    const author=data.author??previous?.author;
    if(!author||author.bot&&author.id!==ARENA_ID)return;
    if(!author.bot&&(packet.t!=='MESSAGE_CREATE'||!['+c','+r'].includes(data.content?.trim())))return;
    // Cosmetic partial edits cannot open another seat attempt.
    if(packet.t==='MESSAGE_UPDATE'&&!['content','embeds','components','interaction','interaction_metadata'].some(key=>own(data,key)))return;
    const receivedAt=this.clock();
    const m=this.fromPacket(data,previous);
    if(!m.guildId||!Number.isFinite(m.createdTimestamp))return;
    m.receivedAt=receivedAt;
    this.remember(m);this.handled.add(m.id);
    void this.chairs.onMessage(m).catch(this.onError);
  }
  // The ordinary Message event still serves roulette and notifications. Skip its
  // duplicate chairs processing only when this exact Gateway delivery was handled.
  onParsed(message) {
    if(message.channelId!==this.channel)return false;
    if(this.handled.delete(message.id))return true;
    if(message.author?.id===ARENA_ID) {
      const components=(message.components||[]).map(row=>typeof row.toJSON==='function'?row.toJSON():row);
      const m={id:message.id,channelId:message.channelId,guildId:message.guildId,author:message.author,
        content:message.content,embeds:message.embeds,createdTimestamp:message.createdTimestamp,
        editedTimestamp:message.editedTimestamp,applicationId:message.applicationId,flags:message.flags,
        reference:message.reference,...commandFields(message),client:this.client,resolveComponent,receivedAt:this.clock(),...mapComponents(components)};
      this.remember(m);
    }
    return false;
  }
  click(message,customId,options) {
    return Message.prototype.clickButton.call(message,customId,options);
  }
}
module.exports={ChairsGateway};
