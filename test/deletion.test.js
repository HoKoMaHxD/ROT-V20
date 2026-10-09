const {test}=require('node:test');const assert=require('node:assert/strict');const {Deletions}=require('../src/deletion');
test('confirmation bound to owner, nonce, record; consume once',()=>{
 const d=new Deletions(),record={},panel={};const n=d.create('owner',record,panel);
 assert.equal(d.take('other',n,record),null);assert.equal(d.take('owner','wrong',record),null);
 assert.equal(d.take('owner',n,record).panel,panel);assert.equal(d.take('owner',n,record),null);
});
test('relink, expiry and a newer confirmation invalidate stale deletion',()=>{
 let now=0;const d=new Deletions({now:()=>now}),record={};let n=d.create('a',record,{});
 assert.equal(d.take('a',n,{}),null);n=d.create('a',record,{});now=120001;assert.equal(d.take('a',n,record),null);
 n=d.create('a',record,{});d.create('a',record,{});assert.equal(d.take('a',n,record),null);
});
