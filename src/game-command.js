'use strict';
const ARENA_ID='995439183650889888';
const games={roulette:'roulette',chairs:'chairs'};
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);

// Keep only command identity, never interaction tokens or user payloads.
function interactionFields(value) {
  if(!value)return null;
  return {id:value.id,type:value.type,name:value.name||value.commandName};
}
function commandFields(m) {
  return {
    interaction:interactionFields(own(m,'arenaInteraction')?m.arenaInteraction:m.interaction),
    interactionMetadata:interactionFields(own(m,'arenaInteractionMetadata')?m.arenaInteractionMetadata:m.interactionMetadata??m.interaction_metadata)
  };
}
function slashCommand(m,bot=ARENA_ID) {
  if(m.author?.id!==bot)return null;
  const fields=commandFields(m);
  for(const value of [fields.interactionMetadata,fields.interaction]) {
    if(!value||![2,'APPLICATION_COMMAND'].includes(value.type)||typeof value.name!=='string')continue;
    const name=value.name.trim().replace(/^\//,'').split(/\s+/)[0].toLowerCase();
    if(name)return {name,id:value.id||m.id};
  }
  return null;
}
function gameStart(m,now=Date.now(),bot=ARENA_ID) {
  // An edited old lobby is not a new game. Use creation time, not edit time.
  if(!Number.isFinite(m.createdTimestamp)||now-m.createdTimestamp>30000)return null;
  const slash=slashCommand(m,bot);
  if(slash)return games[slash.name]?{game:games[slash.name],key:`slash:${slash.id}`,id:slash.id,at:m.createdTimestamp,slash:true}:null;
  if(!m.author||m.author.bot||m.author.id===bot||m.editedTimestamp)return null;
  const game={'+r':'roulette','+c':'chairs'}[m.content?.trim()];
  return game?{game,key:`message:${m.id}`,at:m.createdTimestamp,slash:false}:null;
}
class GameStarts {
  constructor(){this.seen=new Set();this.latest=-Infinity;}
  inspect(m,now) {
    const start=gameStart(m,now);
    if(!start||start.at<this.latest)return null;
    if(start.slash) {
      if(this.seen.has(start.key))return null;
      this.seen.add(start.key);
      if(this.seen.size>1000)this.seen.delete(this.seen.values().next().value);
    }
    this.latest=start.at;
    return start;
  }
}
// v13 may discard modern interaction_metadata. Preserve it at the parser entry
// point, including partial edits, before either engine takes a plain snapshot.
function preserveCommandMetadata(Message) {
  const original=Message.prototype._patch;
  if(original.arenaGameCommands)return;
  function patch(data,...args) {
    const result=original.call(this,data,...args);
    if(own(data,'interaction'))this.arenaInteraction=interactionFields(data.interaction);
    if(own(data,'interaction_metadata'))this.arenaInteractionMetadata=interactionFields(data.interaction_metadata);
    return result;
  }
  patch.arenaGameCommands=true;
  Message.prototype._patch=patch;
}
module.exports={commandFields,slashCommand,gameStart,GameStarts,preserveCommandMetadata};
