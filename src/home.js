'use strict';
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,escapeMarkdown}=require('discord.js');
const {rouletteWait}=require('./panel');
const {notificationsEnabled,notificationSummary}=require('./notifications');
function homeMessage(){
 return {embeds:[new EmbedBuilder().setColor(0x8057f5).setTitle('لوحة التحكم بالحسابات والروليت').setDescription('اضغط **دخول** لربط حساب Discord، ثم تصلك لوحة التحكم بالخاص.\nلكل مستخدم حساب مرتبط وخيارات مستقلة للدخول واللعب التلقائي.\n\n**لوحتي:** استلام لوحة التحكم بالخاص.\n**الحالة:** عرض الحسابات المتصلة والخصائص المفعّلة.')],components:[new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('setup_enter').setLabel('دخول').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('setup_panel').setLabel('لوحتي').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('setup_status').setLabel('الحالة').setStyle(ButtonStyle.Secondary)
 )],allowedMentions:{parse:[]}};
}
async function publishHome(i){
 await i.deferReply({ephemeral:true});
 try {await i.channel.send(homeMessage());await i.deleteReply().catch(()=>{});}
 catch {await i.editReply('تعذر نشر لوحة البداية. تأكد من صلاحيات عرض القناة وإرسال الرسائل وتضمين الروابط (Embed Links).');}
}
function statusMessage(sessions,requester,page=0,accounts={}){
 const entries=Array.from(sessions.entries());
 const pages=Math.max(1,Math.ceil(entries.length/8));
 page=Math.max(0,Math.min(Number.isFinite(page)?Math.trunc(page):0,pages-1));
 const connected=entries.filter(([,s])=>s.client.isReady()).length;
 const embed=new EmbedBuilder().setColor(0x8057f5).setTitle('حالة الحسابات والخصائص').setDescription(`المتصل الآن: **${connected}** | الجلسات: **${entries.length}**\nالحالة لقطة وقت الطلب؛ اضغط تحديث لعرض آخر تغيير.`).setFooter({text:`صفحة ${page+1} من ${pages}`});
 for(const [owner,s] of entries.slice(page*8,(page+1)*8)){
  const name=escapeMarkdown(String(s.client.user?.globalName||s.client.user?.username||'حساب').replace(/\n/g,' ')).slice(0,150);
  const e=s.engine;
  embed.addFields({name, value:`الحساب: ${s.client.user?.id?`<@${s.client.user.id}>`:'غير متاح'}\nصاحب اللوحة: <@${owner}>\nالاتصال: ${s.client.isReady()?'🟢 متصل':'🟠 غير جاهز / يعيد الاتصال'}\nالدخول التلقائي للروليت: ${e.autoJoin?'✅ مفعّل':'⏹ متوقف'}\nاللعب التلقائي للروليت: ${e.autoPlay?'✅ مفعّل':'⏹ متوقف'}\nالدخول التلقائي للكراسي: ${s.chairs?.autoJoin?'✅ مفعّل':'⏹ متوقف'}\nاللعب التلقائي للكراسي: ${s.chairs?.autoPlay?'✅ مفعّل':'⏹ متوقف'}\n${notificationSummary(accounts[owner])}\nتنبيه المنشن: ${notificationsEnabled(accounts[owner])&&(e.autoJoin||e.autoPlay||s.chairs?.enabled)?'✅ مفعّل':'⏹ متوقف'}${rouletteWait(e)}`});
 }
 if(!entries.length)embed.setDescription('لا توجد جلسات حسابات متصلة حاليًا. ربط التوكن وحده لا يفتح جلسة مستمرة؛ فعّل الدخول أو اللعب من لوحتك.');
 const btn=(label,target,disabled=false)=>new ButtonBuilder().setCustomId(`home_status:${requester}:${target}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
 return {embeds:[embed],components:[new ActionRowBuilder().addComponents(btn('السابق',page-1,page===0),btn('تحديث',page),btn('التالي',page+1,page===pages-1))],allowedMentions:{parse:[]}};
}
module.exports={homeMessage,publishHome,statusMessage};
