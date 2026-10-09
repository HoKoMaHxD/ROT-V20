'use strict';
const {ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
// Existing accounts and newly linked accounts both start with alerts enabled.
function notificationsEnabled(account){return account?.notificationsEnabled!==false;}
function notificationSummary(account){return `التنبيهات: ${notificationsEnabled(account)?'مفعّلة':'متوقفة'}`;}
function setNotifications({ownerId,enabled,store}) {
  if(typeof enabled!=='boolean')throw new Error('اختر تفعيل التنبيهات أو إيقافها من اللوحة.');
  const account=store.data[ownerId];
  if(!account?.token)throw new Error('اربط حسابك أولاً ثم اضبط التنبيهات.');
  store.put(ownerId,{...account,notificationsEnabled:enabled});
}
function notificationMessage(ownerId,text,{url,mentionOwner=false}={}) {
  return {
    content:mentionOwner?`<@${ownerId}>\n${text}`:text,
    allowedMentions:mentionOwner?{parse:[],users:[ownerId]}:{parse:[]},
    components:url?[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('فتح رسالة اللعبة').setURL(url))]:[]
  };
}
async function sendNotification({ownerId,text,options={},getAccount,fetchUser}) {
  const canSend=()=>{const account=getAccount();return !!account?.token&&notificationsEnabled(account);};
  if(!canSend())return null;
  const user=await fetchUser(ownerId);
  // A user can mute or delete the account while the recipient fetch is pending.
  if(!canSend())return null;
  return user.send(notificationMessage(ownerId,text,options));
}
module.exports={notificationsEnabled,notificationSummary,setNotifications,notificationMessage,sendNotification};
