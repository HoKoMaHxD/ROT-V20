'use strict';
const {Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder} = require('discord.js');
const {Client: UserClient,Message: UserMessage} = require('discord.js-selfbot-v13');
const {preserveCommandMetadata}=require('./game-command');
preserveCommandMetadata(UserMessage);
const {vault, Store} = require('./core');
const {ChairsEngine}=require('./chairs');
const {ChairsGateway}=require('./chairs-gateway');
const {SeatLatency}=require('./seat-latency');
const {ChairsWarmup}=require('./chairs-warmup');
const chairsWarmup=new ChairsWarmup();
const {Deletions}=require('./deletion');
const deletions=new Deletions();
const {GameEngine,deadline} = require('./engine');
const {snapshot} = require('./game-data');
const {dispatchGameMessage}=require('./dispatch');
const {Relations,resolveSolos} = require('./relations');
const {MentionAlerts} = require('./mentions');
const {notificationSummary,setNotifications,sendNotification}=require('./notifications');
const {bookingDelay,saveBookingDelay}=require('./booking-speed');
const {connectAccount} = require('./onboarding');
const {isControlMember} = require('./access');
const {publishHome,statusMessage} = require('./home');
const {modeAction,applyModeAction,modeSummary,rouletteWait,panelMessage,refreshPanel}=require('./panel');
// Never dump raw dependency errors: they can include authenticated requests.
process.on('unhandledRejection',()=>{console.error('Unexpected asynchronous failure; restarting safely.');process.exit(1);});
process.on('uncaughtException',()=>{console.error('Unexpected runtime failure; check configuration.');process.exit(1);});
const store = new Store(process.env.DATA_DIR || './data');
const crypt = vault(process.env.ENCRYPTION_KEY);
const rouletteChannel = (process.env.ROULETTE_CHANNEL_ID || '').trim();
if (!/^\d{17,20}$/.test(rouletteChannel) || !process.env.BOT_TOKEN || !process.env.CONTROL_GUILD_ID) throw new Error('Missing required environment configuration');
const chairsChannel=(process.env.CHAIRS_CHANNEL_ID||rouletteChannel).trim();
if(!/^\d{17,20}$/.test(chairsChannel))throw new Error('Invalid chairs channel');
const bot = new Client({intents:[GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], partials:[Partials.Channel]});
const sessions = new Map(), busy = new Set();
const statuses = new Map();
const relations = new Relations();
function panel(id){return panelMessage(id,sessions.get(id),store.data[id]);}
function modal(action,id,title,fields) {
  return new ModalBuilder().setCustomId(`${action}:${id}`).setTitle(title).addComponents(fields.map(([key,label,value])=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(key==='token'?256:1000).setValue(value || ''))));
}
async function sendPanel(user) {
  return user.send(panel(user.id));
}
async function notify(id,text,{deleteAfterMs = 0,url,mentionOwner=false} = {}) {
  try {
    const sent = await sendNotification({ownerId:id,text,options:{url,mentionOwner},getAccount:()=>store.data[id],fetchUser:ownerId=>bot.users.fetch(ownerId)});
    if(!sent)return;
    if (deleteAfterMs > 0) {
      const timer = setTimeout(() => {
        sent.delete().catch(() => console.error('Unable to delete expiring DM notification.'));
      }, deleteAfterMs);
      timer.unref();
    }
  } catch {}
}
function stop(id) { const s=sessions.get(id); if(s) {s.engine?.close();s.chairs?.close(); s.client.destroy(); sessions.delete(id);} }
async function login(token) {
  const client = new UserClient({checkUpdate:false});
  client.on('error',()=>{});
  let timer;
  try { await Promise.race([client.login(token), new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error('timeout')),20000);})]); return client; }
  catch { client.destroy(); throw new Error('تعذر الاتصال بالحساب. تحقق من التوكن وحالة الحساب.'); }
  finally { clearTimeout(timer); }
}
async function ensureSession(id) {
  if(sessions.has(id))return sessions.get(id);
  const a=store.data[id];
  if(!a?.token) throw new Error('اربط الحساب أولاً.');
  const client=await login(crypt.open(a.token,id));
  let room;
  try { room=await client.channels.fetch(rouletteChannel); if(!room?.guild || !room.isText()) throw new Error(); }
  catch {client.destroy(); throw new Error('تعذر الوصول إلى روم نصي في السيرفر.');}
  for(const [owner,other] of sessions) {
    if(owner!==id&&other.client.user.id===client.user.id) {client.destroy();throw new Error('الحساب المرتبط لديه جلسة أخرى؛ افصله من اللوحة الأخرى قبل تشغيله هنا.');}
  }
  const originals=new Map();
  const engine=new GameEngine({accountId:client.user.id,channel:rouletteChannel,joinDelayMs:a.joinDelayMs||0,
    fetchMessage:async messageId=>{
      const m=await room.messages.fetch(messageId,{force:true});
      originals.set(messageId,m);if(originals.size>1000)originals.delete(originals.keys().next().value);
      return snapshot(m);
    },
    click:async (messageId,customId,options)=>{
      const m=originals.get(messageId);
      if(!m)throw new Error('Message unavailable');
      const result=await m.clickButton(customId,options);
      return result ? snapshot(result) : null;
    },
    readRelations:async()=>resolveSolos(await relations.read()),
    notify:(text,options)=>notify(id,text,options),
    status:text=>statuses.set(id,text)
  });
  const seatLatency=new SeatLatency();
  let chairsGateway;
  const chairs=new ChairsEngine({channel:chairsChannel,seatDelayMs:bookingDelay(a),click:async(messageId,customId,options)=>{
    const message=chairsGateway.get(messageId)||originals.get(messageId);if(!message)throw new Error('Message unavailable');
    const measured=seatLatency.wrap(message.receivedAt,options);
    const result=await chairsGateway.click(message,customId,measured);return result?snapshot(result):null;
  },prepare:message=>chairsWarmup.prepare(client,message),notify:(text,options)=>notify(id,text,options),status:text=>statuses.set(id,text)});
  chairsGateway=new ChairsGateway({client,chairs,channel:chairsChannel,onError:()=>console.error('Unable to process chairs event.')});
  const session={client,engine,chairs,seatLatency};sessions.set(id,session);
  const mentions=new MentionAlerts(client.user.id);
  function handle(message) {
    if(sessions.get(id)!==session)return;
    try {
      if(message.channelId===rouletteChannel||message.channelId===chairsChannel) {
        originals.set(message.id,message);
        if(originals.size>1000)originals.delete(originals.keys().next().value);
      }
      // Submit chairs first, from the current Gateway message, before snapshot/roulette/DM work.
      const gameTask=dispatchGameMessage(message,{chairs,engine,chairsHandled:chairsGateway.onParsed(message)});
      if(engine.autoJoin||engine.autoPlay||chairs.enabled) {
        const alert=mentions.inspect(message);
        if(alert)void notify(id,alert,{deleteAfterMs:20_000});
      }
      void gameTask.catch(()=>{
        statuses.set(id,'تعذر معالجة رسالة اللعبة.');
        console.error('Game event processing failed.');
      });
    } catch {console.error('Unable to read game message.');}
  }
  client.on('raw',packet=>{
    if(sessions.get(id)!==session||!client.isReady())return;
    try{chairsGateway.onPacket(packet);}catch{chairs.cancelSeat();console.error('Unable to read chairs packet.');}
  });
  client.on('messageCreate',handle);
  client.on('messageUpdate',(_,m)=>handle(m));
  client.on('messageDelete',m=>{if(m.channelId===rouletteChannel)engine.onDelete(m.id);});
  client.on('messageDeleteBulk',messages=>{for(const m of messages.values())if(m.channelId===rouletteChannel)engine.onDelete(m.id);});
  client.on('shardDisconnect',()=>{engine.disconnect();chairs.disconnect();chairsGateway.clear();});
  client.on('invalidated',()=>{stop(id);statuses.set(id,'انتهت جلسة الحساب؛ أعد الربط.');void notify(id,'توقفت المراقبة: جلسة الحساب غير صالحة.');});
  return session;
}
bot.once('ready',async()=>{
  try {
    const guild=await bot.guilds.fetch(process.env.CONTROL_GUILD_ID);
    await guild.commands.create(new SlashCommandBuilder().setName('setup').setDescription('نشر رسالة الدخول وربط الحساب').toJSON());
    await guild.commands.create(new SlashCommandBuilder().setName('panel').setDescription('إرسال لوحة التحكم الخاصة بك').toJSON());
    console.log('Control bot ready. Monitoring starts only when users enable it.');
  } catch {console.error('Unable to register /panel. Check CONTROL_GUILD_ID and bot invitation.'); process.exit(1);}
});
bot.on('error',()=>console.error('Control bot connection error.'));
bot.on('interactionCreate',async i=>{
  if(!await isControlMember(i,bot,process.env.CONTROL_GUILD_ID)) { if(i.isRepliable()) await i.reply({content:'استخدام البوت متاح لأعضاء سيرفر التحكم فقط. تعذر تأكيد عضويتك؛ انضم للسيرفر أو حاول مجدداً.',ephemeral:true}).catch(()=>{}); return; }
  if(i.isChatInputCommand() && i.commandName==='setup') {
    if(i.guildId!==process.env.CONTROL_GUILD_ID) {await i.reply({content:'استخدم الأمر في سيرفر التحكم.',ephemeral:true});return;}
    await publishHome(i);
    return;
  }
  if((i.isChatInputCommand() && i.commandName==='panel') || (i.isButton() && i.customId==='setup_panel')) {
    await i.deferReply({ephemeral:true});
    if(!store.data[i.user.id]?.token) {await i.editReply('اربط حسابك أولاً من زر دخول في رسالة /setup.');return;}
    try {await sendPanel(i.user);await i.editReply('أرسلت اللوحة بالخاص.');}
    catch {await i.editReply('افتح الرسائل الخاصة ثم أعد /panel.');} return;
  }
  if(i.isButton() && (i.customId==='setup_status'||i.customId.startsWith('home_status:'))) {
    if(i.guildId!==process.env.CONTROL_GUILD_ID) {await i.reply({content:'استخدم زر الحالة في سيرفر التحكم.',ephemeral:true});return;}
    if(i.customId==='setup_status') {
      await i.reply({...statusMessage(sessions,i.user.id,0,store.data),ephemeral:true});
    } else {
      const [,owner,page]=i.customId.split(':');
      if(owner!==i.user.id) {await i.reply({content:'هذه الصفحة خاصة بالمستخدم الذي فتحها.',ephemeral:true});return;}
      await i.update(statusMessage(sessions,owner,Number(page),store.data));
    }
    return;
  }
  if(i.isButton() && i.customId==='setup_enter') {
    if(i.guildId!==process.env.CONTROL_GUILD_ID) {await i.reply({content:'استخدم زر الدخول في سيرفر التحكم.',ephemeral:true});return;}
    if(busy.has(i.user.id)) {await i.reply({content:'انتظر اكتمال العملية الحالية.',ephemeral:true});return;}
    await i.showModal(modal('setup_link',i.user.id,'ربط الحساب — التوكن سرّي',[['token','توكن الحساب المراد ربطه','']]));
    return;
  }
  if(!i.isButton() && !i.isModalSubmit()) return;
  const [action,owner]=i.customId.split(':');
  const setupSubmit=i.isModalSubmit() && action==='setup_link' && i.guildId===process.env.CONTROL_GUILD_ID;
  if(owner!==i.user.id || (i.guildId && !setupSubmit)) {await i.reply({content:'هذه اللوحة خاصة بمالكها فقط.',ephemeral:true}).catch(()=>{}); return;}
  const id=i.user.id;
  if(busy.has(id)) {await i.reply({content:'انتظر اكتمال العملية الحالية.',ephemeral:true});return;}
  if(i.isButton()&&action==='refresh') {
    busy.add(id);
    try{await refreshPanel(i,()=>panel(id));}
    catch{await i.followUp({content:'تعذر تحديث اللوحة. حاول مجدداً.',ephemeral:true}).catch(()=>{});}
    finally{busy.delete(id);}
    return;
  }
  if(i.isButton() && action==='link') {await i.showModal(modal('link',id,'ربط حسابك — التوكن سرّي',[['token','توكن الحساب المراد ربطه','']]));return;}
  if(i.isButton() && action==='speed') {await i.showModal(modal('speed',id,'سرعة الدخول — 0 هو الافتراضي',[['delay','التأخير بالمللي ثانية: من 0 إلى 10000',String(store.data[id]?.joinDelayMs||0)]]));return;}
  if(i.isButton() && action==='seat_speed') {await i.showModal(modal('seat_speed',id,'سرعة الحجز — 0 هو الافتراضي',[['delay','التأخير بالمللي ثانية: 0 فوري، حتى 10000',String(bookingDelay(store.data[id]))]]));return;}
  if(i.isButton() && action==='delete') {
    if(!store.data[id]?.token){await i.reply({content:'الحساب محذوف بالفعل.',ephemeral:true});return;}
    const nonce=deletions.create(id,store.data[id],i.message);
    await i.reply({content:'هل تؤكد فصل الحساب وحذف بياناته ولوحة التحكم؟',ephemeral:true,components:[new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`delete_confirm:${id}:${nonce}`).setLabel('تأكيد الحذف').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`delete_cancel:${id}:${nonce}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary))]});return;
  }
  if(i.isButton()&&['delete_confirm','delete_cancel'].includes(action)) {
    busy.add(id);
    try {
      await i.deferUpdate();
      const request=deletions.take(id,i.customId.split(':')[2],store.data[id]);
      if(!request){await i.editReply({content:'انتهى التأكيد أو تغير الحساب. افتح تأكيد الحذف من جديد.',components:[]});return;}
      if(action==='delete_cancel'){await i.editReply({content:'تم إلغاء الحذف.',components:[]});return;}
      stop(id);store.remove(id);statuses.delete(id);
      let removed=true;try{await request.panel.delete();}catch{removed=false;await request.panel.edit({content:'تم حذف الحساب.',components:[]}).catch(()=>{});}
      await i.editReply({content:removed?'تم حذف الحساب ولوحة التحكم بنجاح.':'تم حذف الحساب. تعذر حذف رسالة اللوحة؛ يمكنك إغلاقها يدوياً.',components:[]});
    }catch{await i.editReply({content:'تعذر إتمام الحذف. حاول مجدداً.',components:[]}).catch(()=>{});}finally{busy.delete(id);}
    return;
  }
  busy.add(id);
  try {
    await i.deferReply({ephemeral:true});
    if((action==='link' || setupSubmit) && i.isModalSubmit()) {
      let token=i.fields.getTextInputValue('token').trim();
      const delivered=await connectAccount({ownerId:id,token,login,crypt,store,stop,sendPanel:()=>sendPanel(i.user)});
      token='';
      await i.editReply(delivered ? 'تم التحقق من التوكن وحفظه مشفّراً. أرسلت لوحة التحكم بالخاص.' : 'تم التحقق وحفظ الربط، لكن تعذر إرسال الخاص. افتح الرسائل الخاصة ثم استخدم /panel؛ لا تحتاج إدخال التوكن مجدداً.');
    } else if(action==='speed' && i.isModalSubmit()) {
      const raw=i.fields.getTextInputValue('delay').trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632));
      if(!/^\d{1,5}$/.test(raw)||Number(raw)>10000)throw new Error('أدخل رقماً صحيحاً من 0 إلى 10000 مللي ثانية. 0 يعني دخول فوري.');
      const joinDelayMs=Number(raw);
      store.put(id,{...store.data[id],joinDelayMs});
      const engine=sessions.get(id)?.engine;if(engine)engine.joinDelayMs=joinDelayMs;
      await i.editReply(joinDelayMs===0?'تم ضبط الدخول الفوري (الافتراضي)، بدون تأخير إضافي.':`تم ضبط تأخير الدخول على ${joinDelayMs} مللي ثانية (${joinDelayMs/1000} ثانية). يطبّق على محاولات التسجيل القادمة.`);
    } else if(action==='seat_speed' && i.isModalSubmit()) {
      const seatDelayMs=saveBookingDelay({ownerId:id,input:i.fields.getTextInputValue('delay'),store,session:sessions.get(id)});
      await i.editReply(seatDelayMs===0?'تم اعتماد سرعة الحجز الحالية (الافتراضية)، بدون تأخير إضافي.':`تم ضبط تأخير حجز الكراسي على ${seatDelayMs} مللي ثانية (${seatDelayMs/1000} ثانية). يطبق على مراحل الحجز القادمة؛ المرحلة التي بدأت تحتفظ بموعدها.`);
      if(i.message)await i.message.edit(panel(id)).catch(()=>{});
    } else if(i.isButton() && (action==='notifications_on'||action==='notifications_off')) {
      const enabled=action==='notifications_on';
      setNotifications({ownerId:id,enabled,store});
      await i.editReply(enabled?'تم تفعيل تنبيهات الخاص التلقائية.':'تم إيقاف تنبيهات الخاص التلقائية.');
      await i.message.edit(panel(id)).catch(()=>{});
    } else if(modeAction(action)) {
      const change=modeAction(action);
      if(change.value){
        if(change.target==='engine'&&change.mode==='autoPlay'){
          try{await deadline(relations.read(),6000);}
          catch{throw new Error('تعذر تفعيل اللعب: راجع MONGO_URI وMONGO_DB والاتصال ومجموعتي clans وsolos. الدخول التلقائي يعمل بشكل مستقل.');}
        }
        const session=await ensureSession(id);
        if(change.target==='chairs'){
          const ch=await session.client.channels.fetch(chairsChannel);
          if(!ch?.guild||!ch.isText())throw new Error('تعذر الوصول إلى روم الكراسي.');
        }
      }
      applyModeAction(sessions.get(id),action);
      const session=sessions.get(id);
      await i.editReply(modeSummary(session)+rouletteWait(session?.engine));
      if(i.isButton())await i.message.edit(panel(id)).catch(()=>{});
    }
    else if(action==='status') {
      const engine=sessions.get(id)?.engine;
      await i.editReply({content:`${modeSummary(sessions.get(id))}\n${notificationSummary(store.data[id])}${rouletteWait(engine)}\nالتحكم اليدوي لبقية الروليت: ${engine?.manual&&!engine?.eliminated?'نعم':'لا'}\nالحساب المرتبط: ${store.data[id]?.accountId||'أعد الربط لعرض المعرّف'}\nسرعة دخول الروليت: ${store.data[id]?.joinDelayMs||0} مللي ثانية (0 = فوري)\nسرعة الحجز: ${bookingDelay(store.data[id])} مللي ثانية تأخير (0 = الافتراضي الفوري)\nروم الروليت: ${rouletteChannel}\nروم الكراسي: ${chairsChannel}\nآخر حالة: ${statuses.get(id)||'لا توجد محاولة'}\n\n${sessions.get(id)?.seatLatency.summary()||'قياس السرعة: فعّل لعب الكراسي وانتظر محاولة حجز.'}`,components:[]});
    }
    else await i.editReply('أعد فتح اللوحة باستخدام /panel.');
  } catch(e) {const safe = /^[\u0600-\u06ff]/.test(e.message||'')?e.message:'تعذر إتمام العملية. تحقق من إعدادات الخدمة؛ لم تُطبع الأسرار في السجل.'; await i.editReply(safe).catch(()=>{});}
  finally {busy.delete(id);}
});
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{for(const id of sessions.keys()) stop(id);bot.destroy();void relations.close().finally(()=>process.exit(0));});
bot.login(process.env.BOT_TOKEN).catch(()=>{console.error('Bot login failed. Check BOT_TOKEN.');process.exit(1);});
