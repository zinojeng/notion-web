import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
test('a token without a data source keeps setup available and Save disabled',async()=>{
  const dom=new JSDOM(await readFile(new URL('../src/popup.html',import.meta.url),'utf8'));
  const old={document:globalThis.document,browser:globalThis.browser};
  const messages=[];
  globalThis.document=dom.window.document;
  globalThis.browser={runtime:{sendMessage:async message=>{
    messages.push(message);
    if(message.type==='SETTINGS_GET')return{ok:true,settings:{hasNotionToken:true,dataSourceId:''}};
    if(message.type==='CAPTURE')return{ok:true,clip:{title:'測試文章',text:'內文',url:'https://example.com',summary:'摘要',images:[],keywords:[],warnings:[],source:'article'}};
    return{ok:true};
  }}};
  try{
    await import('../src/popup.js?setup-incomplete');
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(document.getElementById('setupBanner').hidden,false);
    assert.equal(document.getElementById('saveButton').disabled,true);
    document.getElementById('settingsButton').click();
    assert(messages.some(message=>message.type==='OPEN_OPTIONS'));
  }finally{
    globalThis.document=old.document;globalThis.browser=old.browser;dom.window.close();
  }
});
