import test from 'node:test';
import assert from 'node:assert/strict';
import {NotionClient} from '../src/notion.js';
const schema={properties:{標題:{type:'title'},分類:{type:'select',select:{options:[{name:'知識管理'}]}}}};
const mapping={title:'標題',category:'分類'};
const clip={title:'主題',text:'內容',url:'https://example.com/post',source:'article'};
test('source format never creates or assigns a topical category',async()=>{
  let body;
  const client=new NotionClient({token:'test',fetchImpl:async(url,request)=>{body=JSON.parse(request.body);return new Response(JSON.stringify({id:'page',url:'https://www.notion.so/page'}),{status:200});}});
  await client.createClip({dataSourceId:'source',schema,mapping,clip});
  assert.equal(body.properties.分類,undefined);
});
test('only explicitly chosen existing category can be assigned',async()=>{
  let body;
  const client=new NotionClient({token:'test',fetchImpl:async(url,request)=>{body=JSON.parse(request.body);return new Response(JSON.stringify({id:'page',url:'https://www.notion.so/page'}),{status:200});}});
  await client.createClip({dataSourceId:'source',schema,mapping,clip:{...clip,category:'知識管理'}});
  assert.deepEqual(body.properties.分類,{select:{name:'知識管理'}});
  await assert.rejects(client.createClip({dataSourceId:'source',schema,mapping,clip:{...clip,category:'article'}}),/既有分類/);
});
