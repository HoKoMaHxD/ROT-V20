'use strict';
const {MongoClient}=require('mongodb');
const {normalize}=require('./game-data');
class Relations {
  constructor(env=process.env) {
    this.uri=env.MONGO_URI||env.MONGODB_URI;
    this.dbName=env.MONGO_DB;
    this.clanCollection=env.CLAN_COLLECTION||'clans';
    this.soloCollection=env.SOLO_COLLECTION||'solos';
    this.client=null;this.connecting=null;
  }
  get configured() {return !!(this.uri&&this.dbName);}
  async read() {
    if(!this.configured)throw new Error('MongoDB configuration missing');
    if(!this.client)this.client=new MongoClient(this.uri,{serverSelectionTimeoutMS:2500,connectTimeoutMS:2500,socketTimeoutMS:4000,maxPoolSize:5,retryReads:false});
    if(!this.connecting)this.connecting=this.client.connect().catch(e=>{this.connecting=null;throw e;});
    await this.connecting;
    const db=this.client.db(this.dbName);
    // Same authorized name listing verified by the recovery tool; match names locally.
    const names=await db.listCollections({},{nameOnly:true,authorizedCollections:true,maxTimeMS:2000}).toArray();
    if(!names.some(c=>c.name===this.clanCollection)||!names.some(c=>c.name===this.soloCollection))throw new Error('Collections missing');
    const [clans,solos]=await Promise.all([
      db.collection(this.clanCollection).find({},{projection:{name:1,symbol:1,status:1},maxTimeMS:2000}).limit(2001).toArray(),
      db.collection(this.soloCollection).find({},{projection:{name:1,type:1},maxTimeMS:2000}).limit(501).toArray()
    ]);
    if(clans.length>2000||solos.length>500)throw new Error('Relationship data exceeds supported limits');
    for(const c of clans)if(typeof c.symbol!=='string'||!normalize(c.symbol)||!['none','ally','enemy','truce','main'].includes(c.status))throw new Error('Invalid clan record');
    for(const s of solos){
      if(typeof s.name!=='string'||!normalize(s.name)||!['ally','enemy'].includes(s.type||'enemy'))throw new Error('Invalid solo record');
    }
    if(!clans.length&&!solos.length)throw new Error('Empty relationship database; verify database name');
    return {clans,solos:solos.map(s=>({...s,type:s.type||'enemy'}))};
  }
  async close(){if(this.client)await this.client.close();}
}
// The updated reference stores solo relations by name, with ally/enemy type.
// A leftover userId on old records must not change the new name-based matching.
async function resolveSolos(data) {
  const solos=data.solos.map(s=>{
    if(typeof s.name!=='string'||!normalize(s.name)||!['ally','enemy'].includes(s.type||'enemy'))throw new Error('Invalid solo record');
    return {name:s.name,type:s.type||'enemy',names:[normalize(s.name).toLowerCase()]};
  });
  return {clans:data.clans,solos};
}
module.exports={Relations,resolveSolos};
