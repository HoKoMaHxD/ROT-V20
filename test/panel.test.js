'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {modeAction,applyModeAction,panelMessage,refreshPanel,modeSummary}=require('../src/panel');
const buttons=payload=>payload.components.flatMap(row=>row.toJSON().components);
function session(){const engine={autoJoin:false,autoPlay:false,setModes(m){Object.assign(this,m);}},chairs={...engine};return {engine,chairs};}
test('four independent controls carry requested labels and flip to stop for their own mode',()=>{
 const s=session();const p=panelMessage('owner',s);const bs=buttons(p);
 assert.deepEqual(bs.slice(0,4).map(b=>b.label),['تفعيل الدخول التلقائي للروليت','تفعيل الدخول التلقائي للكراسي','تفعيل اللعب التلقائي للروليت','تفعيل اللعب التلقائي للكراسي']);
 assert.ok(bs.some(b=>b.custom_id==='refresh:owner'&&b.label==='تحديث'));
 assert.ok(p.components.length<=5);for(const row of p.components)assert.ok(row.toJSON().components.length<=5);
 applyModeAction(s,'chairs_join_on');const updated=buttons(panelMessage('owner',s));
 assert.equal(updated[1].label,'إيقاف الدخول التلقائي للكراسي');assert.equal(updated[1].custom_id,'chairs_join_off:owner');assert.equal(updated[3].label,'تفعيل اللعب التلقائي للكراسي');
});
test('mode actions isolate all four flags, stop-all clears them, legacy chairs controls play only',()=>{
 const s=session();applyModeAction(s,'chairs_on');assert.equal(s.chairs.autoPlay,true);assert.equal(s.chairs.autoJoin,false);
 applyModeAction(s,'chairs_join_on');applyModeAction(s,'join_on');applyModeAction(s,'play_on');
 applyModeAction(s,'chairs_play_off');assert.equal(s.chairs.autoPlay,false);assert.equal(s.chairs.autoJoin,true);assert.equal(s.engine.autoPlay,true);
 applyModeAction(s,'off');assert.equal(s.engine.autoJoin,false);assert.equal(s.engine.autoPlay,false);assert.equal(s.chairs.autoJoin,false);assert.equal(s.chairs.autoPlay,false);
 assert.equal(modeAction('__proto__'),null);assert.equal(applyModeAction(s,'unknown'),false);
});
test('refresh acknowledges update and edits the source panel with current state, without sending a new message',async()=>{
 const s=session(),events=[];let payload;
 await refreshPanel({deferUpdate:async()=>{events.push('deferUpdate');s.chairs.autoJoin=true;},editReply:async p=>{events.push('editReply');payload=p;},reply:()=>assert.fail('No new reply'),followUp:()=>assert.fail('No followup')},()=>panelMessage('owner',s));
 assert.deepEqual(events,['deferUpdate','editReply']);assert.equal(buttons(payload)[1].label,'إيقاف الدخول التلقائي للكراسي');assert.match(modeSummary(s),/الدخول التلقائي للكراسي: مفعّل/);
});
