'use strict';
/**
 * ضع هذا الملف في جذر مشروع البوت (بجوار package.json).
 * يعتمد على mongodb الموجود أصلاً في المشروع، ويقرأ MONGO_URI من Environment.
 * فحص فقط: node mongo-recovery.cjs
 * فحص قاعدة محددة: node mongo-recovery.cjs --db test
 * تصدير clans وsolos إلى ملفات محلية: node mongo-recovery.cjs --db test --export
 * لا يعدل قاعدة البيانات. لا يتضمن رابطاً أو كلمة مرور، ولا يطبع الأخطاء الخام.
 */
const fs=require('node:fs/promises');
const path=require('node:path');
let MongoClient,BSON;
try {({MongoClient,BSON}=require(require.resolve('mongodb',{paths:[process.cwd(),__dirname]})));}
catch {console.error('شغّل الملف من مشروع البوت بعد npm ci. مكتبة mongodb غير موجودة.');process.exit(1);}
const systemDatabases=new Set(['admin','config','local']);
function redact(text,env=process.env){
 let value=String(text||'');
 const secrets=new Set();
 for(const key of ['MONGO_URI','MONGODB_URI','BOT_TOKEN','ENCRYPTION_KEY'])if(env[key])secrets.add(env[key]);
 for(const uri of [env.MONGO_URI,env.MONGODB_URI].filter(Boolean)){
  try{const u=new URL(uri);for(const part of [u.username,u.password])if(part){secrets.add(part);try{secrets.add(decodeURIComponent(part));}catch{}}}catch{}
 }
 // Replace complete values before truncating so partial credentials cannot leak.
 for(const secret of [...secrets].sort((a,b)=>b.length-a.length))value=value.split(secret).join('[REDACTED]');
 return value.replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,'[REDACTED_URI]').replace(/(password|authorization|token)\s*[:=]\s*[^,;\s]+/gi,'$1=[REDACTED]').slice(0,700);
}
function safeError(error,env=process.env){
 const chain=[error,error?.cause,...(error?.reason?.servers?.values?.()||[])].map(e=>e?.error||e).filter(Boolean);
 let category='READ';
 if(chain.some(e=>e.code===18||e.codeName==='AuthenticationFailed'))category='AUTH';
 else if(chain.some(e=>e.code===13))category='PERMISSION';
 else if(chain.some(e=>e.syscall==='querySrv'||e.syscall==='queryTxt'))category='DNS';
 else if(chain.some(e=>e.code===50||/Timeout/.test(e.name||'')))category='TIMEOUT';
 else if(chain.some(e=>['ECONNREFUSED','ENOTFOUND','ETIMEOUT','ETIMEDOUT'].includes(e.code))||error?.name==='MongoServerSelectionError')category='NETWORK';
 else if(error?.name==='MongoParseError')category='URI';
 return category+': '+JSON.stringify({name:redact(error?.name,env),code:redact(error?.code,env),codeName:redact(error?.codeName,env),message:redact(error?.message,env)});
}
async function inspectCollections(db,wanted,log=console.log){
 try{
  // No server-side name expression; filter the returned permitted names locally.
  const list=await db.listCollections({},{nameOnly:true,authorizedCollections:true,maxTimeMS:10000}).toArray();
  const existing=list.map(c=>c.name);
  log(JSON.stringify({availableCollections:existing}));
  return {names:wanted.filter(n=>existing.includes(n)),uncertain:[]};
 }catch(error){
  log('مرحلة listCollections: '+safeError(error));
  log('محاولة قراءة المجموعات المعروفة مباشرة؛ كل طلب يخضع لصلاحيات مستخدم القاعدة.');
  const names=[],uncertain=[];
  for(const name of wanted){
   try{
    const first=await db.collection(name).findOne({},{projection:{_id:1},maxTimeMS:10000});
    if(first!==null)names.push(name);
    else{uncertain.push(name);log(JSON.stringify({collection:name,status:'EMPTY_OR_MISSING_UNCONFIRMED'}));}
   }catch(error){log('مرحلة findOne '+JSON.stringify(name)+': '+safeError(error));}
  }
  return {names,uncertain};
 }
}
async function exportCollection(collection,target){
 const temporary=target+'.partial';let handle,first=true,count=0,bytes=0;
 const cursor=collection.find({},{maxTimeMS:30000,batchSize:100});
 try {
  handle=await fs.open(temporary,'wx',0o600);await handle.write('[\n');
  for await(const document of cursor){
   const text=(first?'':',\n')+BSON.EJSON.stringify(document,null,0,{relaxed:false});
   bytes+=Buffer.byteLength(text);
   if(bytes>100*1024*1024)throw new Error('Export exceeds 100 MiB');
   await handle.write(text);first=false;count++;
  }
  await handle.write('\n]\n');await handle.close();handle=null;await fs.rename(temporary,target);return count;
 } catch(error){await handle?.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{});throw error;}
 finally{await cursor.close().catch(()=>{});}
}
async function main(){
 const uri=process.env.MONGO_URI||process.env.MONGODB_URI;
 if(!uri){console.log('CONFIG: أضف MONGO_URI في Environment. لا تضع الرابط في هذا الملف أو في GitHub.');return;}
 const args=process.argv.slice(2),dbIndex=args.indexOf('--db');
 if(dbIndex>=0&&(!args[dbIndex+1]||args[dbIndex+1].startsWith('--'))){console.log('حدد الاسم بعد --db');return;}
 const explicit=dbIndex>=0?args[dbIndex+1]:null;
 const clanName=process.env.CLAN_COLLECTION||'clans',soloName=process.env.SOLO_COLLECTION||'solos';
 const client=new MongoClient(uri,{serverSelectionTimeoutMS:10000,connectTimeoutMS:5000,socketTimeoutMS:10000,retryReads:false,maxPoolSize:2});
 let candidates=[];
 try{
  await client.connect();console.log('CONNECTED: نجح الاتصال والتحقق من بيانات مستخدم قاعدة البيانات.');
  console.log('RECOVERY_VERSION: 3');
  console.log('MONGO_DB الحالي: '+JSON.stringify(process.env.MONGO_DB||'(غير محدد)'));
  if(explicit)candidates=[explicit];
  else{
   try{const result=await client.db('admin').admin().listDatabases({nameOnly:true,authorizedDatabases:true,maxTimeMS:5000});candidates=result.databases.map(d=>d.name).filter(n=>!systemDatabases.has(n));}
   catch(error){console.log(safeError(error));console.log('سأفحص الاسم المضبوط وقاعدة test فقط؛ قد توجد قواعد أخرى لا يمكن استعراضها.');candidates=[...new Set([process.env.MONGO_DB,'test'].filter(Boolean))];}
  }
  const found=[];let backupRoot;
  for(const name of candidates){
   try{
    const db=client.db(name);
    const {names,uncertain}=await inspectCollections(db,[...new Set([clanName,soloName])]);
    console.log(JSON.stringify({database:name,matchingCollections:names}));
    if(!names.length)continue;
    const summary={database:name,collections:{},issues:uncertain.map(n=>'غير مؤكد إن كانت المجموعة فارغة أو غير موجودة: '+n)};
    for(const [collectionName,type] of [[clanName,'clan'],[soloName,'solo']]){
     if(!names.includes(collectionName)){summary.issues.push('لم يتم تأكيد وجود المجموعة: '+collectionName);continue;}
     const limit=type==='clan'?2001:501;
     const docs=await db.collection(collectionName).find({},{projection:type==='clan'?{name:1,symbol:1,status:1}:{name:1,type:1},maxTimeMS:5000}).limit(limit).toArray();
     const count=await db.collection(collectionName).countDocuments({},{maxTimeMS:5000});
     summary.collections[collectionName]=count;
     if(docs.length>=limit)summary.issues.push('تتجاوز المجموعة حد البوت: '+collectionName);
     const invalid=docs.filter(d=>type==='clan'?typeof d.symbol!=='string'||!d.symbol.trim()||!['none','ally','enemy','truce','main'].includes(d.status):typeof d.name!=='string'||!d.name.trim()||!['ally','enemy'].includes(d.type||'enemy')).length;
     if(invalid)summary.issues.push('سجلات غير مطابقة ضمن العينة في '+collectionName+': '+invalid);
    }
    if(!Object.values(summary.collections).some(n=>n>0))summary.issues.push('لا توجد بيانات عداوات في المجموعات الموجودة.');
    console.log(JSON.stringify(summary));
    if(names.includes(clanName)&&names.includes(soloName)&&!summary.issues.length)found.push(name);
    if(args.includes('--export')){
     if(!backupRoot){backupRoot=await fs.mkdtemp(path.join(path.resolve(process.env.DATA_DIR||process.cwd()),'mongo-recovery-'));await fs.chmod(backupRoot,0o700);await fs.writeFile(path.join(backupRoot,'.gitignore'),'*\n',{mode:0o600});}
     const folder=path.join(backupRoot,Buffer.from(name).toString('hex'));await fs.mkdir(folder,{mode:0o700});
     const manifest={database:name,exportedAt:new Date().toISOString(),collections:[],note:'قراءة حية متتابعة؛ ليست لقطة ذرية. الملفات لا تحتوي بيانات الاتصال.'};
     for(let i=0;i<names.length;i++){
      const filename='collection-'+i+'.json';const count=await exportCollection(db.collection(names[i]),path.join(folder,filename));
      manifest.collections.push({name:names[i],file:filename,count});
     }
     await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
     console.log('EXPORTED: '+folder);
    }
   }catch(error){console.log('قاعدة '+JSON.stringify(name)+'؛ فحص البيانات أو التصدير: '+safeError(error));}
  }
  if(found.length===1)console.log('RECOMMENDED: MONGO_DB='+found[0]+' | CLAN_COLLECTION='+clanName+' | SOLO_COLLECTION='+soloName);
  else if(found.length>1)console.log('توجد أكثر من قاعدة صالحة؛ اختر قاعدة مشروعك: '+JSON.stringify(found));
  else console.log('لم يتم تأكيد قاعدة صالحة للبوت. راجع نتائج الفحص أعلاه.');
 }catch(error){console.log(safeError(error));process.exitCode=1;}
 finally{await client.close();}
}
if(require.main===module)main().catch(()=>{console.error('تعذر إكمال الفحص؛ لم تُطبع بيانات الدخول.');process.exitCode=1;});
module.exports={redact,safeError,inspectCollections,exportCollection};
