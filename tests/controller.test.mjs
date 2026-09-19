import test from 'node:test';
import assert from 'node:assert/strict';
import {createController,trustedSender} from '../src/controller.js';

const source='00000000-0000-0000-0000-000000000001';
const clip={title:'清楚的主題',summary:'摘要',text:'完整原文值得保存',url:'https://example.com/post?utm_source=test',warnings:[],images:[]};
function harness(overrides={}){
  const store={settings:{notionToken:'secret-notion',aiKey:'secret-ai',dataSourceId:source,mapping:{title:'標題',url:'URL'},...overrides}};
  const calls=[];
  class Client{
    async getSchema(){return {properties:{標題:{type:'title'},URL:{type:'url'}}};}
    async findByUrl(...args){calls.push(['find',...args]);return null;}
    async createClip(args){calls.push(['create',args]);return {id:'page',url:'https://www.notion.so/page'};}
  }
  const api={runtime:{id:'test',getURL:p=>'safari-web-extension://test/'+p,openOptionsPage:async()=>{}},storage:{local:{get:async()=>store,set:async(v)=>Object.assign(store,v)}},tabs:{query:async()=>[{id:7,url:'https://example.com/post'}]},scripting:{executeScript:async()=>[{result:{...clip,siteName:'Example',source:'article'}}]}};
  const sender={id:'test',url:api.runtime.getURL('popup.html')};
  return {store,calls,api,sender,Client,handle:createController(api,{Client})};
}
test('privileged endpoints reject page/content-script senders before storage or writes',async()=>{
  const h=harness();
  assert.equal(trustedSender({id:'test',url:'https://evil.example'},h.api),false);
  assert.equal(trustedSender({id:'other',url:h.sender.url},h.api),false);
  for(const type of ['SAVE','SETTINGS_GET','SETTINGS_SAVE','REWRITE'])assert.equal((await h.handle({type,clip}, {id:'test',url:'https://evil.example'})).ok,false);
  assert.equal(h.calls.length,0);
});
test('settings redact keys and preserve them when input omits credentials',async()=>{
  const h=harness();
  const result=await h.handle({type:'SETTINGS_GET'},h.sender);
  assert.equal(result.settings.hasNotionToken,true);
  assert.equal(JSON.stringify(result).includes('secret'),false);
  await h.handle({type:'SETTINGS_SAVE',settings:{aiEnabled:true}},h.sender);
  assert.equal(h.store.settings.notionToken,'secret-notion');
  await h.handle({type:'SETTINGS_SAVE',settings:{notionToken:''}},h.sender);
  assert.equal(h.store.settings.notionToken,'');
});
test('concurrent save clicks coalesce and normalize tracking URLs',async()=>{
  const h=harness();
  const result=await Promise.all([h.handle({type:'SAVE',clip},h.sender),h.handle({type:'SAVE',clip},h.sender)]);
  assert(result.every(r=>r.ok));
  assert.equal(h.calls.filter(c=>c[0]==='create').length,1);
  assert.equal(h.calls.find(c=>c[0]==='create')[1].clip.url,'https://example.com/post');
});
test('concurrent partial settings writes preserve updated credentials',async()=>{
  const h=harness();
  await Promise.all([
    h.handle({type:'SETTINGS_SAVE',settings:{notionToken:'new-token'}},h.sender),
    h.handle({type:'SETTINGS_SAVE',settings:{aiEnabled:true}},h.sender)
  ]);
  assert.equal(h.store.settings.notionToken,'new-token');
  assert.equal(h.store.settings.aiEnabled,true);
});
test('empty extraction, raw URL title and javascript URL cannot be saved',async()=>{
  const h=harness();
  for(const patch of [{text:''},{title:'https://example.com'},{url:'javascript:alert(1)'}])assert.equal((await h.handle({type:'SAVE',clip:{...clip,...patch}},h.sender)).ok,false);
  assert.equal(h.calls.length,0);
});
test('oversized user edits and encoded URLs are rejected without silently truncating',async()=>{
  const h=harness();
  for(const patch of [{title:'字'.repeat(81)},{summary:'字'.repeat(601)},{text:'字'.repeat(80001)},{url:'https://example.com/'+ 'a'.repeat(2000)},{url:'https://example.com/'+ '字'.repeat(300)}]){
    const result=await h.handle({type:'SAVE',clip:{...clip,...patch}},h.sender);
    assert.equal(result.ok,false);assert.match(result.error,/超過/);
  }
  assert.equal(h.calls.length,0);
});
test('duplicate is returned without creating a second page',async()=>{
  const h=harness();h.Client.prototype.findByUrl=async()=>({id:'existing',url:'https://www.notion.so/existing'});
  const result=await h.handle({type:'SAVE',clip},h.sender);
  assert.equal(result.duplicate,true);assert.equal(result.page.id,'existing');assert.equal(h.calls.length,0);
});
test('AI requires explicit enable; capturing never invokes remote rewrite',async()=>{
  const h=harness();let invoked=0;
  const handle=createController(h.api,{Client:h.Client,rewrite:async()=>{invoked++;return clip;}});
  assert.equal((await handle({type:'REWRITE',clip},h.sender)).ok,false);
  assert.equal((await handle({type:'CAPTURE'},h.sender)).ok,true);assert.equal(invoked,0);
});
test('permission denial becomes actionable capture message',async()=>{
  const h=harness();h.api.scripting.executeScript=async()=>{throw new Error('permission denied');};
  const result=await h.handle({type:'CAPTURE'},h.sender);
  assert.equal(result.ok,false);assert.match(result.error,/允許/);
});
