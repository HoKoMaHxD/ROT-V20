'use strict';
const {components,firstMention,turn,viewSignature}=require('./game-data');

function mergePages(messages) {
  return {...messages[0],
    components:[{components:messages.flatMap(m=>components(m).map(b=>({...b,messageId:m.id})))}],
    pageIds:messages.map(m=>m.id),pageOwners:messages.map(m=>[m.id,firstMention(m)])};
}

class RoulettePages {
  constructor(){this.group=null;this.seen=new Map();}
  reset(){this.group=null;}
  clear(){this.reset();this.seen.clear();}
  remove(id){if(this.group?.messages.has(id))this.reset();}
  inspect(m) {
    const part=turn(m,true),known=this.group?.messages.has(m.id);
    if(!part||!(part.players.length||part.random||part.exit||part.malformed)) {
      if(known)this.reset();
      return null;
    }
    const stamp=m.editedTimestamp||m.createdTimestamp,signature=viewSignature(m),previous=this.seen.get(m.id);
    // Do not attach a delayed duplicate of an old page to the current owner's turn.
    if(previous&&(stamp<previous.stamp||(!known&&stamp===previous.stamp&&signature===previous.signature)))return null;
    this.seen.set(m.id,{stamp,signature});
    if(this.seen.size>1000)this.seen.delete(this.seen.keys().next().value);
    let group=this.group;
    if(group&&!known&&m.createdTimestamp<group.messages.get(group.anchor).createdTimestamp)return null;
    const existingNumbers=group?new Set([...group.messages.values()].flatMap(x=>turn(x,true)?.players.map(p=>Number(p.number))||[])):new Set();
    const overlaps=!known&&part.players.some(p=>existingNumbers.has(Number(p.number)));
    const newOwner=part.owner&&part.owner!==group?.owner;
    const newPlayerTurn=!known&&part.players.length&&(group?.complete||overlaps);
    if(!group||newOwner||newPlayerTurn) {
      if(!part.owner){if(overlaps)this.reset();return null;}
      group={anchor:m.id,owner:part.owner,messages:new Map(),complete:false};
      this.group=group;
    } else if(!known&&group.complete) {
      // A second control message is not proof of a second turn.
      return null;
    }
    group.messages.set(m.id,m);
    if(group.messages.size>30){this.reset();return null;}
    const parts=[...group.messages.values()];
    group.complete=parts.some(x=>{const v=turn(x,true);return v?.random||v?.exit;});
    return group.complete?mergePages(parts):null;
  }
}
module.exports={RoulettePages,mergePages};
