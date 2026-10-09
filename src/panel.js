'use strict';
const {ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {bookingDelay}=require('./booking-speed');
const {notificationsEnabled,notificationSummary}=require('./notifications');
const actions=Object.freeze({
  join_on:{target:'engine',mode:'autoJoin',value:true},join_off:{target:'engine',mode:'autoJoin',value:false},
  play_on:{target:'engine',mode:'autoPlay',value:true},play_off:{target:'engine',mode:'autoPlay',value:false},
  chairs_join_on:{target:'chairs',mode:'autoJoin',value:true},chairs_join_off:{target:'chairs',mode:'autoJoin',value:false},
  chairs_play_on:{target:'chairs',mode:'autoPlay',value:true},chairs_play_off:{target:'chairs',mode:'autoPlay',value:false},
  // Existing messages remain usable; the old chairs button now controls play only.
  chairs_on:{target:'chairs',mode:'autoPlay',value:true},chairs_off:{target:'chairs',mode:'autoPlay',value:false},
  on:{target:'engine',mode:'autoJoin',value:true},off:{allOff:true}
});
function modeAction(action){return Object.hasOwn(actions,action)?actions[action]:null;}
function applyModeAction(session,action){
 const change=modeAction(action);if(!change)return false;
 if(change.allOff){session?.engine?.setModes({autoJoin:false,autoPlay:false});session?.chairs?.setModes({autoJoin:false,autoPlay:false});}
 else session?.[change.target]?.setModes({[change.mode]:change.value});
 return true;
}
function modeSummary(session){
 const state=value=>value?'مفعّل':'متوقف';
 return [
  `الدخول التلقائي للروليت: ${state(session?.engine?.autoJoin)}`,
  `الدخول التلقائي للكراسي: ${state(session?.chairs?.autoJoin)}`,
  `اللعب التلقائي للروليت: ${state(session?.engine?.autoPlay)}`,
  `اللعب التلقائي للكراسي: ${state(session?.chairs?.autoPlay)}`
 ].join('\n');
}
function rouletteWait(engine){
 if(engine?.eliminated)return '\nتم طرد الحساب؛ ينتظر إنعاشه أو تسجيل روليت جديد. بعد الإنعاش يلعب فقط إذا خيار اللعب مفعّل.';
 return engine?.manual?'\nاللعب التلقائي للروليت ينتظر روليت جديداً بعد طلب التحكم اليدوي.':'';
}
function panelMessage(id,session,account){
 const toggle=(prefix,label,active)=>[`${prefix}_${active?'off':'on'}`,`${active?'إيقاف':'تفعيل'} ${label}`,active?ButtonStyle.Success:ButtonStyle.Secondary];
 const groups=[
  [toggle('join','الدخول التلقائي للروليت',session?.engine?.autoJoin),toggle('chairs_join','الدخول التلقائي للكراسي',session?.chairs?.autoJoin)],
  [toggle('play','اللعب التلقائي للروليت',session?.engine?.autoPlay),toggle('chairs_play','اللعب التلقائي للكراسي',session?.chairs?.autoPlay)],
  [['refresh','تحديث',ButtonStyle.Primary],['status','الحالة'],['speed','سرعة الدخول'],['seat_speed','سرعة الحجز'],['off','إيقاف الكل']],
  [toggle('notifications','التنبيهات',notificationsEnabled(account)),['link','ربط / تحديث التوكن'],['delete','فصل وحذف الحساب',ButtonStyle.Danger]]
 ];
 return {content:`لوحة التحكم الخاصة بك\n${modeSummary(session)}\n${notificationSummary(account)}\nسرعة الحجز: ${bookingDelay(account)} مللي ثانية تأخير (0 = السرعة الحالية الافتراضية)\n\nالدخول واللعب مستقلان لكل لعبة. اضغط «تحديث» لعرض الحالة الحالية هنا.${rouletteWait(session?.engine)}`,
  components:groups.map(group=>new ActionRowBuilder().addComponents(group.map(([action,label,style])=>new ButtonBuilder().setCustomId(`${action}:${id}`).setLabel(label).setStyle(style||ButtonStyle.Secondary)))),
  allowedMentions:{parse:[]}};
}
async function refreshPanel(interaction,getPanel){
 await interaction.deferUpdate();
 await interaction.editReply(getPanel());
}
module.exports={modeAction,applyModeAction,modeSummary,rouletteWait,panelMessage,refreshPanel};
