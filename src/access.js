'use strict';
async function isControlMember(interaction, bot, guildId) {
  if (interaction.guildId) return interaction.guildId === guildId && !!interaction.member;
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const guild = await bot.guilds.fetch(guildId);
        const member = await guild.members.fetch({user:interaction.user.id,force:true});
        return member.id === interaction.user.id;
      })(),
      new Promise(resolve => { timer = setTimeout(()=>resolve(false),1500); })
    ]);
  } catch { return false; }
  finally { clearTimeout(timer); }
}
module.exports={isControlMember};
