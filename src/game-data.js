'use strict';
const {commandFields}=require('./game-command');
const ARENA_ID='995439183650889888';
function normalize(s='') { return String(s).normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFE0F\u20E3]/g,'').replace(/\s+/g,' ').trim(); }
function digits(s) { return s.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)); }
function messageText(m) {return [m.content,...(m.embeds||[]).flatMap(e=>[e.title,e.description,...(e.fields||[]).flatMap(f=>[f.name,f.value])])].filter(Boolean).join('\n');}
function components(m) {
  const out=[];
  function walk(items) { for(const c of items||[]) {if(c.type===2||c.type==='BUTTON') out.push(c);if(c.components)walk(c.components);} }
  walk(m.components);return out;
}
function snapshot(m) {
  return {id:m.id,channelId:m.channelId,guildId:m.guildId,author:m.author?{id:m.author.id,bot:m.author.bot}:null,
    content:m.content||'',createdTimestamp:m.createdTimestamp,editedTimestamp:m.editedTimestamp,
    reference:m.reference?{messageId:m.reference.messageId}:null,...commandFields(m),
    embeds:(m.embeds||[]).map(e=>({title:e.title,description:e.description,fields:(e.fields||[]).map(f=>({name:f.name,value:f.value}))})),
    components:[{components:components(m).map(b=>({type:2,customId:b.customId,label:b.label||'',disabled:!!b.disabled,emoji:b.emoji?{name:b.emoji.name,id:b.emoji.id}:null}))}]};
}
function firstMention(m) {return messageText(m).match(/<@!?(\d{17,20})>/)?.[1]||null;}
function accountEvents(m) {
  // Bind a result to the mention immediately following it, not a later turn owner.
  const text=normalize(messageText(m)).replace(/[\u064B-\u065F\u0670]/g,'').replace(/[*_`]/g,'');
  return [...text.matchAll(/(?:^|[^\p{L}\p{N}])تم\s+(طرد|[إاأآ]نعاش)[\s\p{P}\p{S}]*(?:(?:اللاعب|العضو|الحساب)\s+)?<@!?(\d{17,20})>/gu)]
    .map(match=>({kind:match[1]==='طرد'?'eliminated':'revived',accountId:match[2]}));
}
function registration(m) {return /المشاركين/.test(messageText(m)) && components(m).some(b=>normalize(b.label)==='دخول');}
function turn(m, partial=false) {
  if(registration(m)) return null;
  const bs=components(m);
  const random=bs.find(b=>normalize(b.label)==='طرد عشوائي');
  const exit=bs.find(b=>normalize(b.label)==='إنسحاب'||normalize(b.label)==='انسحاب');
  const players=[];let malformed=false;
  for(const b of bs) {
    if(b===random||b===exit) continue;
    const label=normalize(b.label), emoji=digits(normalize(b.emoji?.name||''));
    const match=digits(label).match(/^(\d{1,4})\s*(?:[|:：.\-–—]\s*)?(.+)$/u);
    let number,name;
    if(/^\d{1,4}$/.test(emoji)&&label) {number=emoji;name=label;}
    else if(match) {number=match[1];name=match[2].trim();}
    else {if(!b.disabled)malformed=true;continue;}
    if(!b.customId||!name) {malformed=true;continue;}
    players.push({number,name,messageId:b.messageId||m.id,customId:b.customId,disabled:!!b.disabled,userId:name.match(/<@!?(\d{17,20})>/)?.[1]||null});
  }
  if(!partial&&!random&&!exit) return null; // Require the known Arena elimination controls.
  if(!partial&&!firstMention(m)) return null;
  const ids=players.map(p=>`${p.messageId}:${p.customId}`), nums=players.map(p=>p.number);
  if(new Set(ids).size!==ids.length||new Set(nums).size!==nums.length)malformed=true;
  return {owner:firstMention(m),players,random:random?{...random,messageId:random.messageId||m.id}:null,exit:!!exit,malformed};
}
function viewSignature(m) {return JSON.stringify([firstMention(m),m.pageOwners||null,components(m).map(b=>[b.messageId||m.id,b.customId,normalize(b.label),b.emoji?.name,!!b.disabled])]);}
function jump(m) {return `https://discord.com/channels/${m.guildId||'@me'}/${m.channelId}/${m.id}`;}
function confirmedJoin(reply,source) {
  return reply?.author?.id===ARENA_ID && reply.id!==source.id && normalize(messageText(reply)).includes('تم تسجيل دخولك بنجاح');
}
function chooseTarget(view,relations,accountId,randomIndex) {
  if(view.malformed) return {kind:'manual',reason:'تعذر قراءة جميع خيارات الطرد بثقة.'};
  const clanEnemies=[],soloEnemies=[];
  for(const p of view.players.filter(p=>!p.disabled)) {
    if(p.userId===accountId) continue;
    const name=normalize(p.name).toLowerCase();
    // Solo allies remain protected. Rank eligible clan enemies before solo enemies.
    const soloMatches=relations.solos.filter(s=>(s.names||[s.name]).some(n=>typeof n==='string'&&normalize(n)&&name.includes(normalize(n).toLowerCase())));
    let soloEnemy=false;
    if(soloMatches.length){
      const types=new Set(soloMatches.map(s=>s.type||'enemy'));
      if([...types].some(t=>!['enemy','ally'].includes(t))||types.size>1)
        return {kind:'manual',reason:'تعارض عداوة وتحالف السولو في الاسم نفسه؛ يرجى تحديد الاختيار يدوياً.'};
      if(types.has('ally'))continue;
      if(view.players.filter(x=>!x.disabled&&normalize(x.name).toLowerCase()===name).length>1)
        return {kind:'manual',reason:'أسماء السولو متشابهة؛ تعذر تحديد اللاعب بثقة.'};
      soloEnemy=true;
    }
    const matching=relations.clans.filter(c=>normalize(c.symbol)&&normalize(p.name).includes(normalize(c.symbol)));
    const protectedClan=matching.some(c=>['main','ally','truce'].includes(c.status));
    if(!protectedClan&&matching.some(c=>c.status==='enemy'))clanEnemies.push(p);
    else if(soloEnemy)soloEnemies.push(p);
  }
  const enemies=clanEnemies.length?clanEnemies:soloEnemies;
  if(enemies.length) {const p=enemies[randomIndex(enemies.length)];return {kind:'enemy',source:clanEnemies.length?'clan':'solo',customId:p.customId,messageId:p.messageId,name:p.name,number:p.number};}
  if(view.random?.customId&&!view.random.disabled)return {kind:'random',customId:view.random.customId,messageId:view.random.messageId};
  return {kind:'manual',reason:'ما فيه أعضاء من الكلانات المعادية أو السولو المتاح طردهم، وزر الطرد العشوائي غير متاح.'};
}
module.exports={ARENA_ID,normalize,messageText,components,snapshot,firstMention,accountEvents,registration,turn,viewSignature,jump,confirmedJoin,chooseTarget};
