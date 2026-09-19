// Local UI demo. No live Notion calls or credential storage; synthetic content only.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const base=new URL('../dist/safari/',import.meta.url);
const fixture={title:'把網頁收藏變成可回溯的知識筆記',summary:'將貼文整理成清楚標題、摘要與來源網址，完整原文另存於 Notion 頁面，讓日後整理與查證更容易。',url:'https://example.com/articles/clear-notes',text:'值得保留的內容，不該只剩下一個連結。\n\n先確定文章的主題，再寫下忠實摘要，最後保留原文與來源。這樣下次看到這則收藏，就能知道當初為什麼保存它。',source:'article',author:'範例作者',siteName:'示範文章',keywords:['知識管理','網頁收藏'],images:[],warnings:['這是本機介面示範；所有內容皆為範例，不會寫入 Notion。'],aiUsed:false,capturedAt:'2026-09-20T00:00:00Z'};
const demo=`const fixture=${JSON.stringify(fixture)};
const storage={};let settings={hasNotionToken:true,hasAiKey:false,aiEnabled:false,includeImages:false,dataSourceId:'00000000-0000-0000-0000-000000000001',mapping:{title:'標題',summary:'摘要',url:'URL'},aiModel:'claude-haiku-4-5'};
globalThis.browser={permissions:{request:async()=>true},storage:{local:{get:async(key)=>typeof key==='string'?{[key]:storage[key]}:storage,set:async(value)=>Object.assign(storage,value),remove:async(key)=>delete storage[key]}},runtime:{sendMessage:async(m)=>{
 if(m.type==='SETTINGS_GET')return{ok:true,settings};
 if(m.type==='SETTINGS_SAVE'){settings={...settings,...m.settings};return{ok:true};}
 if(m.type==='CAPTURE')return{ok:true,clip:fixture};
 if(m.type==='SAVE')return{ok:false,error:'這是示範模式，沒有呼叫 Notion API。請安裝擴充套件後連接自己的資料庫。'};
 if(m.type==='OPEN_OPTIONS'){location.href='/options.html';return{ok:true};}
 if(m.type==='NOTION_LIST')return{ok:true,sources:[{id:settings.dataSourceId,name:'示範收藏庫'}]};
 if(m.type==='NOTION_SCHEMA')return{ok:true,schema:{id:settings.dataSourceId,properties:{'標題':{type:'title'},'摘要':{type:'rich_text'},'AI 摘要':{type:'rich_text'},'AI 關鍵字':{type:'rich_text'},'URL':{type:'url'},'圖檔':{type:'files'}}},mapping:settings.mapping};
 return{ok:false,error:'示範模式不支援此操作。'};
}}};`;
const allowed=new Set(['popup.html','options.html','popup.js','options.js','styles.css']);
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/demo.js'){res.setHeader('content-type','text/javascript');res.end(demo);return;}
  const file=pathname==='/'?'popup.html':pathname.slice(1);
  if(!allowed.has(file)){res.writeHead(404);res.end();return;}
  try{
    let body=await readFile(new URL(file,base),'utf8');
    if(file.endsWith('.html')) body=body.replace('</head>','<script src="/demo.js"></script></head>');
    res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');
    res.setHeader('cache-control','no-store');res.end(body);
  }catch{res.writeHead(500);res.end('Run npm run build first.');}
});
server.listen(4173,'127.0.0.1',()=>console.log('Synthetic UI preview: http://127.0.0.1:4173 — no Notion writes.'));
