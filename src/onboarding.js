'use strict';
async function connectAccount({ownerId,token,login,crypt,store,stop,sendPanel}) {
  const client = await login(token);
  let accountId;
  try { accountId = client.user.id; } finally { client.destroy(); }
  stop(ownerId);
  store.put(ownerId,{...store.data[ownerId],token:crypt.seal(token,ownerId),accountId});
  try { await sendPanel(); return true; } catch { return false; }
}
module.exports={connectAccount};
