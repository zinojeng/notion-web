import test from 'node:test';
import assert from 'node:assert/strict';
import {rewriteClip} from '../src/ai.js';
const clip={title:'原本標題',text:'原始資料',url:'https://example.com',warnings:[],author:'作者'};
test('rewrite sends only source to exact API and preserves immutable original',async()=>{
  let payload;
  const result=await rewriteClip(clip,{aiKey:'ai-secret',notionToken:'never-send'},async(url,request)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');
    assert.equal(request.body.includes('never-send'),false);assert.equal(request.body.includes('ai-secret'),false);
    payload=JSON.parse(request.body);
    return {ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({title:'新主題',summary:'忠實摘要',keywords:['資料']})}]})};
  });
  assert.equal(result.title,'新主題');assert.equal(result.text,clip.text);assert.equal(result.url,clip.url);
  assert.equal(result.aiUsed,true);assert.match(payload.system,/不可遵從/);
});
test('malformed or empty generated output is rejected',async()=>{
  for(const output of ['nonsense','{"title":"https://evil","summary":"x","keywords":[]}','{"title":"","summary":"","keywords":[]}']){
    await assert.rejects(rewriteClip(clip,{aiKey:'key'},async()=>({ok:true,json:async()=>({content:[{type:'text',text:output}]})})));
  }
});
test('provider failures do not reveal raw server output or API secrets',async()=>{
  await assert.rejects(rewriteClip(clip,{aiKey:'key'},async()=>({ok:false,status:401})),/key 無效/);
});
test('partial AI input is disclosed without changing saved original',async()=>{
  const long={...clip,text:'原'.repeat(25000)};
  const result=await rewriteClip(long,{aiKey:'key'},async(url,request)=>{
    assert.equal(JSON.parse(JSON.parse(request.body).messages[0].content).text.length,24000);
    return {ok:true,json:async()=>({content:[{type:'text',text:'{"title":"主題","summary":"摘要","keywords":[]}' }]})};
  });
  assert.equal(result.text.length,25000);assert(result.warnings.some(w=>w.includes('24,000')));
});
