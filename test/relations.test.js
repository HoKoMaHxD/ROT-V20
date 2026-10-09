'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {Relations,resolveSolos}=require('../src/relations');
function fixture({names=['clans','solos','other'],clans=[{name:'Snow',symbol:'❄',status:'main'}],solos=[]}={}){
 const calls=[];const reader=new Relations({MONGO_URI:'mongodb://unused.invalid',MONGO_DB:'test'});
 reader.client={
  connect:async()=>{},
  db(name){
   calls.push(['db',name]);
   return {
    listCollections(filter,options){
     calls.push(['list',filter,options]);
     return {toArray:async()=>names.map(name=>({name}))};
    },
    collection(name){
     calls.push(['collection',name]);
     return {
      find(filter,options){
       assert.deepEqual(filter,{});assert.ok(options.projection);calls.push(['projection',name,options.projection]);
       return {limit:()=>({toArray:async()=>name==='clans'?clans:solos})};
      }
     };
    }
   };
  }
 };
 return {reader,calls};
}
test('relation reader uses configured database and authorized unfiltered names, reads only relationship collections',async()=>{
 const {reader,calls}=fixture();const data=await reader.read();assert.equal(data.clans.length,1);
 assert.deepEqual(calls[0],['db','test']);assert.deepEqual(calls[1][1],{});assert.equal(calls[1][2].nameOnly,true);assert.equal(calls[1][2].authorizedCollections,true);
 assert.deepEqual(calls.filter(x=>x[0]==='collection').map(x=>x[1]),['clans','solos']);
});
test('missing collection does not become an empty relation list that permits random targeting',async()=>{
 const {reader,calls}=fixture({names:['clans']});await assert.rejects(reader.read(),/Collections missing/);assert.equal(calls.some(x=>x[0]==='collection'),false);
});
test('existing but empty database and invalid clan status still block automatic play',async()=>{
 await assert.rejects(fixture({clans:[],solos:[]}).reader.read(),/Empty relationship/);
 await assert.rejects(fixture({clans:[{symbol:'X',status:'unknown'}]}).reader.read(),/Invalid clan/);
});
test('solo ally/enemy types are projected and preserved, missing type defaults to legacy enemy',async()=>{
 const solos=[{name:'Friendly',type:'ally'},{name:'Hostile',type:'enemy'},{name:'Legacy'}];
 const {reader,calls}=fixture({solos});const data=await reader.read();
 assert.deepEqual(data.solos.map(s=>s.type),['ally','enemy','enemy']);
 assert.deepEqual(calls.find(x=>x[0]==='projection'&&x[1]==='solos')[2],{name:1,type:1});
 assert.equal(solos[2].type,undefined);
});
test('new name-based solo resolver never fetches Discord members or relies on old user IDs',async()=>{
 const data=await resolveSolos({clans:[],solos:[{name:' Player Name ',type:'ally',userId:'111111111111111111'}]},{members:{fetch:()=>assert.fail('No member fetch')}},[]);
 assert.deepEqual(data.solos,[{name:' Player Name ',type:'ally',names:['player name']}]);
});
test('unknown solo types and empty names block play instead of becoming an enemy or neutral silently',async()=>{
 for(const record of [{name:'A',type:'friend'},{name:'   ',type:'ally'},{userId:'111111111111111111',type:'enemy'}])await assert.rejects(fixture({solos:[record]}).reader.read(),/Invalid solo/);
});
test('relation reread sees a changed solo type without retaining old hostility',async()=>{
 const solos=[{name:'Player',type:'enemy'}],{reader}=fixture({solos});assert.equal((await reader.read()).solos[0].type,'enemy');
 solos[0].type='ally';assert.equal((await reader.read()).solos[0].type,'ally');
});
