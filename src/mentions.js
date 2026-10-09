'use strict';
// Notifications follow the linked account, while the recipient is the panel owner.
class MentionAlerts {
  constructor(accountId, botId = '995439183650889888') {
    this.accountId = accountId;
    this.botId = botId;
    this.seen = new Set();
  }
  inspect(message) {
    if (!message.id || !message.channelId || message.author?.id !== this.botId || this.seen.has(message.id)) return null;
    const content = message.content || '';
    const direct = message.mentions?.users?.has(this.accountId) ||
      content.includes(`<@${this.accountId}>`) || content.includes(`<@!${this.accountId}>`);
    if (!direct) return null; // Role mentions and @everyone are not personal mentions.
    const text = [content, ...(message.embeds || []).flatMap(e => [
      e.title, e.description, ...(e.fields || []).map(f => `${f.name}\n${f.value}`), e.footer?.text
    ])].filter(x => typeof x === 'string' && x.trim()).join('\n\n');
    const excerpt = text.length > 1500 ? text.slice(0,1500) + '\n… بقية النص في رابط الرسالة.' : text;
    const url = `https://discord.com/channels/${message.guildId || '@me'}/${message.channelId}/${message.id}`;
    this.seen.add(message.id); // Reserve before sending, including concurrent edit events.
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    return `🔔 بوت Arena Games منشن الحساب المرتبط (${this.accountId}).\n\n${excerpt || 'لا يوجد نص متاح للرسالة.'}\n\nرابط الرسالة:\n${url}`;
  }
}
module.exports = {MentionAlerts};
