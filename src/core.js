'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {gameStart,slashCommand}=require('./game-command');
const {components,messageText,normalize}=require('./game-data');
function vault(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '')) throw new Error('ENCRYPTION_KEY must be 64 hex characters');
  const key = Buffer.from(secret, 'hex');
  return {
    seal(value, owner) {
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(owner));
      const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
      return [iv, c.getAuthTag(), body].map(b => b.toString('base64')).join('.');
    },
    open(value, owner) {
      const [iv, tag, body] = value.split('.').map(x => Buffer.from(x, 'base64'));
      const c = crypto.createDecipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(owner)); c.setAuthTag(tag);
      return Buffer.concat([c.update(body), c.final()]).toString('utf8');
    }
  };
}
class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'accounts.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  put(id, value) { this.data[id] = value; this.save(); }
  remove(id) { delete this.data[id]; this.save(); }
}
class Gate {
  constructor({channel, bot = '995439183650889888', now = Date.now, command = '+r'}) {
    Object.assign(this, {channel, bot, now, command}); this.pending = null; this.attempted = new Set();
    this.game=command==='+c'?'chairs':'roulette';this.slashStarts=new Set();this.latestStart=-Infinity;
  }
  reset() { this.pending = null; }
  inspect(m) {
    const now = this.now();
    if (m.channelId !== this.channel || !m.guildId || !m.author) return null;
    const start=gameStart(m,now,this.bot),slash=slashCommand(m,this.bot);
    if(slash&&slash.name!==this.game)return null;
    if(start) {
      if(start.at<this.latestStart)return null;
      this.latestStart=start.at;
      if(start.game!==this.game){this.pending=null;return null;}
      if(start.slash) {
        if(!this.slashStarts.has(start.key)) {
          this.slashStarts.add(start.key);
          if(this.slashStarts.size>1000)this.slashStarts.delete(this.slashStarts.values().next().value);
          this.pending={command:m.id,interaction:start.id,slash:true,at:start.at,until:start.at+30000};
        }
      } else {
        if(this.lastCommand===m.id)return null;
        this.lastCommand=m.id;
        this.pending={command:m.id,at:start.at,until:now+15000};
        return null;
      }
    }
    const p = this.pending;
    if (!p || now > p.until || m.author.id !== this.bot || m.createdTimestamp < p.at) return null;
    if(p.slash) {
      if(m.id!==p.command&&slash?.id!==p.interaction)return null;
    } else if (m.reference?.messageId && m.reference.messageId !== p.command) return null;
    const text = messageText(m);
    if (!/المشاركين/.test(text) || this.attempted.has(m.id)) return null;
    const button = components(m).find(b=>normalize(b.label)==='دخول'&&!b.disabled&&b.customId);
    if (!button) return null;
    this.attempted.add(m.id);
    if (this.attempted.size > 1000) this.attempted.delete(this.attempted.values().next().value);
    this.pending = null; // Consume before awaiting network: no duplicate or automatic retry.
    return button.customId;
  }
}
module.exports = {vault, Store, Gate};
