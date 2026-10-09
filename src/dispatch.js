'use strict';
const {snapshot}=require('./game-data');
function dispatchGameMessage(message,{chairs,engine,toSnapshot=snapshot,chairsHandled=false}) {
  // onMessage runs synchronously up to click(): no queued tick or snapshot ahead of seats.
  const chairsTask=chairsHandled?undefined:chairs.onMessage(message);
  try {return Promise.all([chairsTask,engine.onMessage(toSnapshot(message))]);}
  catch(error){return Promise.all([chairsTask,Promise.reject(error)]);}
}
module.exports={dispatchGameMessage};
