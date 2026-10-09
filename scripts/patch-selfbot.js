// The upstream clickButton does not await POST errors. Await them so failures
// reach our redacted handler instead of an unhandled rejection with request data.
const fs=require('node:fs');
const file=require.resolve('discord.js-selfbot-v13/src/structures/Message');
let s=fs.readFileSync(file,'utf8');
const start=s.indexOf('  clickButton(buttonid) {');
if(start<0 && !s.includes('  async clickButton(buttonid) {') && !s.includes('  async clickButton(buttonid, arenaOptions = {}) {')) throw Error('Unexpected dependency: clickButton missing');
if(start>=0) {
const end=s.indexOf('\n  /**',start);
let block=s.slice(start,end).replace('  clickButton(buttonid) {','  async clickButton(buttonid) {');
if(!block.includes('    this.client.api.interactions.post({')) throw Error('Unexpected clickButton implementation');
// Register listener before POST, and immediately attach rejection handling.
block=block.replace('    this.client.api.interactions.post({', '    const result = Util.createPromiseInteraction(this.client, nonce, 5_000, true, this);\n    result.catch(() => {});\n    await this.client.api.interactions.post({');
block=block.replace('return Util.createPromiseInteraction(this.client, nonce, 5_000, true, this);','return result;');
fs.writeFileSync(file,s.slice(0,start)+block+s.slice(end));

}
// Keep listening after INTERACTION_SUCCESS so a correlated ephemeral response
// can still arrive. Always remove listeners and restore max-listener accounting.
const utilFile=require.resolve('discord.js-selfbot-v13/src/util/Util');
let util=fs.readFileSync(utilFile,'utf8');
const begin=util.indexOf('  static createPromiseInteraction(');
const finish=util.indexOf('\n  static clearNullOrUndefinedObject(',begin);
if(begin<0||finish<0)throw Error('Unexpected interaction helper');
const replacement=`  static createPromiseInteraction(client, nonce, timeoutMs = 5_000, isHandlerDeferUpdate = false, parent, signal) {
    return new Promise((resolve, reject) => {
      const cancelled = () => {
        const error = new Error('Chairs phase changed; pending interaction cancelled.');
        error.code = 'ARENA_CHAIRS_CANCELLED';
        return error;
      };
      if (signal?.aborted) { reject(cancelled()); return; }
      let acknowledged = false;
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        client.removeListener(Events.MESSAGE_CREATE, handler);
        client.removeListener(Events.INTERACTION_MODAL_CREATE, handler);
        if (isHandlerDeferUpdate) client.removeListener(Events.UNHANDLED_PACKET, handler);
        client.decrementMaxListeners();
      };
      const handler = data => {
        if (isHandlerDeferUpdate && data.t === 'INTERACTION_SUCCESS' && data.d?.nonce == nonce) {
          acknowledged = true;
          return;
        }
        if (data.nonce != nonce) return;
        cleanup();
        resolve(data);
      };
      const onAbort = () => { cleanup(); reject(cancelled()); };
      const timeout = setTimeout(() => {
        cleanup();
        if (acknowledged) resolve(parent);
        else reject(new DiscordError('INTERACTION_FAILED'));
      }, timeoutMs).unref();
      client.incrementMaxListeners();
      client.on(Events.MESSAGE_CREATE, handler);
      client.on(Events.INTERACTION_MODAL_CREATE, handler);
      if (isHandlerDeferUpdate) client.on(Events.UNHANDLED_PACKET, handler);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
`;
fs.writeFileSync(utilFile,util.slice(0,begin)+replacement+util.slice(finish));

// A bounded pool prevents unrelated requests/accounts sharing one HTTP socket.
// RequestHandler still owns every route/global rate limit and retry decision.
const apiFile=require.resolve('discord.js-selfbot-v13/src/rest/APIRequest');
let api=fs.readFileSync(apiFile,'utf8');
if(!api.includes('// Arena bounded connection pool')) {
  if(!api.includes("new Client('https://discord.com', {"))throw Error('Unexpected transport implementation');
  api=api.replace('FormData, buildConnector, Client, ProxyAgent','FormData, buildConnector, Pool, ProxyAgent')
    .replace("agent = new Client('https://discord.com', {", "// Arena bounded connection pool\n        agent = new Pool('https://discord.com', {\n          connections: 4,");
}
if(!api.includes('this.options.arenaSignal')) {
  if(!api.includes('signal: controller.signal,'))throw Error('Unexpected request cancellation implementation');
  api=api.replace('signal: controller.signal,','signal: this.options.arenaSignal ? AbortSignal.any([controller.signal, this.options.arenaSignal]) : controller.signal,');
}
if(!api.includes('// Arena priority transport')) {
  const a=api.indexOf('    if (!agent) {',api.indexOf('  make(captchaKey, captchaRqToken) {'));
  const b=api.indexOf('\n    const API =',a);
  if(a<0||b<0||!api.includes('let agent = null;')||!api.includes('dispatcher: agent,'))throw Error('Unexpected pool selection implementation');
  const oldPool=api.slice(a,b);
  const priorityPool=`    // Arena priority transport: independent capacity for guarded game interactions.
    const arenaPriority = Boolean(this.options.arenaSignal);
    let requestAgent = arenaPriority ? arenaAgent : agent;
    if (!requestAgent) {
      const r_ = Util.checkUndiciProxyAgent(this.client.options.http.agent);
      if (!r_) {
        // Arena bounded connection pool
        requestAgent = new Pool('https://discord.com', {
          connections: arenaPriority ? 8 : 4,
          keepAliveTimeout: 30_000,
          connect: buildConnector({ ciphers: ciphers.join(':') }),
        });
      } else {
        requestAgent = new ProxyAgent({ ...r_, ciphers: ciphers.join(':') });
      }
      if (arenaPriority) arenaAgent = requestAgent;
      else agent = requestAgent;
    }
`;
  api=api.replace(oldPool,priorityPool)
    .replace('let agent = null;','let agent = null;\nlet arenaAgent = null;\nconst arenaTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;')
    .replace("'x-discord-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,","'x-discord-timezone': arenaTimeZone,")
    .replace('dispatcher: agent,','dispatcher: requestAgent,');
}
fs.writeFileSync(apiFile,api);

// Pass a cancellation signal only for guarded seat attempts.
s=fs.readFileSync(file,'utf8');
if(!s.includes('async clickButton(buttonid, arenaOptions = {})')) {
  const a=s.indexOf('  async clickButton(buttonid) {'),b=s.indexOf('\n  /**',a);
  if(a<0||b<0)throw Error('Unexpected patched clickButton');
  let block=s.slice(a,b).replace('async clickButton(buttonid)', 'async clickButton(buttonid, arenaOptions = {})')
    .replace('await this.client.api.interactions.post({\n      data,', 'await this.client.api.interactions.post({\n      arenaSignal: arenaOptions.signal,\n      data,');
  if(!block.includes('arenaSignal:'))throw Error('Missing interaction cancellation hook');
  s=s.slice(0,a)+block+s.slice(b);fs.writeFileSync(file,s);
}
// Only the patched transport can confirm that a seat is still queued, not sent.
s=fs.readFileSync(file,'utf8');
if(!s.includes('arenaOnQueued: arenaOptions.onQueued')) {
  const a=s.indexOf('  async clickButton(buttonid, arenaOptions = {}) {'),b=s.indexOf('\n  /**',a);
  if(a<0||b<0)throw Error('Unexpected guarded clickButton');
  let block=s.slice(a,b);
  if(!block.includes('arenaSignal: arenaOptions.signal,')||!block.includes('nonce, 5_000, true, this);'))throw Error('Missing seat lifecycle hook');
  block=block.replace('arenaSignal: arenaOptions.signal,','arenaSignal: arenaOptions.signal,\n      arenaOnQueued: arenaOptions.onQueued,\n      arenaOnDispatch: arenaOptions.onDispatch,')
    .replace('nonce, 5_000, true, this);','nonce, 5_000, true, this, arenaOptions.signal);');
  s=s.slice(0,a)+block+s.slice(b);fs.writeFileSync(file,s);
}
const handlerFile=require.resolve('discord.js-selfbot-v13/src/rest/RequestHandler');
let handler=fs.readFileSync(handlerFile,'utf8');
if(!handler.includes('function assertArenaRequestActive')) {
  handler=handler.replace('class RequestHandler {',`function assertArenaRequestActive(request) {
  if (request.options.arenaSignal?.aborted) {
    const error = new Error('Chairs phase changed; pending request cancelled.');
    error.code = 'ARENA_CHAIRS_CANCELLED';
    throw error;
  }
}

class RequestHandler {`);
  handler=handler.replace('async execute(request, captchaKey, captchaToken) {', 'async execute(request, captchaKey, captchaToken) {\n    assertArenaRequestActive(request);');
  handler=handler.replace('// As the request goes out, update the global usage information', 'assertArenaRequestActive(request);\n\n    // As the request goes out, update the global usage information');
  handler=handler.replace('} catch (error) {\n      // Retry the specified', '} catch (error) {\n      assertArenaRequestActive(request);\n      // Retry the specified');
  if((handler.match(/assertArenaRequestActive\(request\);/g)||[]).length!==3)throw Error('Missing queued request cancellation hooks');
  fs.writeFileSync(handlerFile,handler);
}
if(!handler.includes('request.options.arenaOnQueued?.();')) {
  const queue='async push(request) {\n    await this.queue.wait();';
  const dispatch='res = await request.make(captchaKey, captchaToken);';
  if(!handler.includes(queue)||!handler.includes(dispatch))throw Error('Unexpected seat dispatch lifecycle');
  handler=handler.replace(queue,'async push(request) {\n    request.options.arenaOnQueued?.();\n    await this.queue.wait();')
    .replace(dispatch,'assertArenaRequestActive(request);\n      request.options.arenaOnDispatch?.();\n      '+dispatch);
  fs.writeFileSync(handlerFile,handler);
}

// An idle queue already owns its first entry synchronously. Guarded requests can
// enter execute immediately; occupied queues and all rate limits still wait.
handler=fs.readFileSync(handlerFile,'utf8');
if(!handler.includes('const arenaImmediate =')) {
  const old='    request.options.arenaOnQueued?.();\n    await this.queue.wait();';
  if(!handler.includes(old))throw Error('Unexpected queue implementation');
  handler=handler.replace(old,`    request.options.arenaOnQueued?.();
    const arenaImmediate = Boolean(request.options.arenaSignal) && this.queue.remaining === 0;
    const arenaTurn = this.queue.wait();
    if (!arenaImmediate) await arenaTurn;`);
}
if(!handler.includes('arenaOnResponse')) {
  const old='      res = await request.make(captchaKey, captchaToken);';
  if(!handler.includes(old))throw Error('Unexpected response timing implementation');
  handler=handler.replace(old,old+'\n      request.options.arenaOnResponse?.(res.status);');
}
fs.writeFileSync(handlerFile,handler);
s=fs.readFileSync(file,'utf8');
if(!s.includes('arenaOnResponse: arenaOptions.onResponse')) {
  const old='      arenaOnDispatch: arenaOptions.onDispatch,';
  if(!s.includes(old))throw Error('Unexpected button timing implementation');
  s=s.replace(old,old+'\n      arenaOnResponse: arenaOptions.onResponse,');fs.writeFileSync(file,s);
}

// The default in-memory cookie jar can read synchronously. Avoid yielding before
// the guarded request reaches undici, keeping normal cookie and redirect logic.
api=fs.readFileSync(apiFile,'utf8');
if(!api.includes('arenaImmediateCookies: arenaPriority')) {
  const old="        credentials: 'include',";
  if(!api.includes(old))throw Error('Unexpected fetch options implementation');
  api=api.replace(old,old+'\n        arenaImmediateCookies: arenaPriority,');fs.writeFileSync(apiFile,api);
}
const cookieFile=require.resolve('fetch-cookie');
let cookie=fs.readFileSync(cookieFile,'utf8');
if(!cookie.includes('init.arenaImmediateCookies')) {
  const old='    const cookie = await actualJar.getCookieString(requestUrl);';
  if(!cookie.includes(old))throw Error('Unexpected cookie wrapper implementation');
  cookie=cookie.replace(old,`    const cookie = init.arenaImmediateCookies && actualJar.store?.synchronous === true && typeof actualJar.getCookieStringSync === "function"
      ? actualJar.getCookieStringSync(requestUrl)
      : await actualJar.getCookieString(requestUrl);`);
  fs.writeFileSync(cookieFile,cookie);
}
