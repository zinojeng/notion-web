import { capturePage } from './capture.js';
import { composeClip, normalizeUrl } from './compose.js';
import { NotionClient, suggestMapping } from './notion.js';
import { rewriteClip } from './ai.js';

export const DEFAULTS = { dataSourceId:'', mapping:{}, includeImages:false, aiEnabled:false, aiModel:'claude-haiku-4-5' };
export function trustedSender(sender, api) {
  return sender?.id === api.runtime.id && ['popup.html','options.html'].some(path => sender.url === api.runtime.getURL(path));
}
function cleanClip(value) {
  if (!value || typeof value !== 'object') throw new Error('缺少擷取內容。');
  for(const [key,limit,label] of [['title',80,'標題'],['summary',600,'摘要'],['text',80000,'原文'],['url',2000,'來源 URL']]){
    if(typeof value[key] === 'string' && value[key].trim().length>limit) throw new Error(`${label}超過 ${limit.toLocaleString('en-US')} 字，請先縮短；尚未儲存。`);
  }
  const str = (key,max) => typeof value[key] === 'string' ? value[key].trim().slice(0,max) : '';
  const url = normalizeUrl(str('url',2000));
  if(url.length>2000) throw new Error('來源 URL 編碼後超過 Notion 的 2,000 字限制，請改用較短的原始連結。');
  const title = str('title',80), text = str('text',80000);
  if (!title || /^https?:\/\//i.test(title)) throw new Error('請輸入可辨識的主題標題，而非網址。');
  if (!text) throw new Error('沒有擷取到原文。請打開單篇貼文、選取文字，或在預覽貼上原文。');
  const strings = (key,max) => Array.isArray(value[key]) ? value[key].filter(x => typeof x === 'string').slice(0,max) : [];
  const date = str('capturedAt',50);
  return {title,text,url,summary:str('summary',600),author:str('author',200),siteName:str('siteName',200),source:['selection','facebook','article','metadata'].includes(value.source)?value.source:'metadata',
    capturedAt:Number.isFinite(Date.parse(date))?date:new Date().toISOString(),category:str('category',100),
    aiUsed:value.aiUsed === true,aiSummary:value.aiUsed === true?str('aiSummary',600):'',
    aiKeywords:value.aiUsed === true?strings('aiKeywords',8).map(x=>x.slice(0,60)):[],
    keywords:strings('keywords',12).map(x=>x.slice(0,60)),warnings:strings('warnings',15).map(x=>x.slice(0,500)),
    images:strings('images',8).filter(x=>{try{return new URL(x).protocol === 'https:' && x.length<=2000;}catch{return false;}})};
}
export function createController(api, { Client = NotionClient, rewrite = rewriteClip } = {}) {
  const saves = new Map();
  let settingsWrite = Promise.resolve();
  const settings = async () => ({ ...DEFAULTS,...(await api.storage.local.get('settings')).settings });
  const client = s => {if (!s.notionToken) throw new Error('請先在設定頁連接 Notion。'); return new Client({token:s.notionToken});};
  async function dispatch(message, sender) {
    if (!trustedSender(sender,api)) return {ok:false,error:'不允許此來源操作擴充套件。'};
    try {
      const s = await settings();
      switch (message?.type) {
        case 'SETTINGS_GET': {
          const {notionToken,aiKey,...safe} = s;
          return {ok:true,settings:{...safe,hasNotionToken:!!notionToken,hasAiKey:!!aiKey}};
        }
        case 'SETTINGS_SAVE': {
          const operation=settingsWrite.then(async()=>{
          const input=message.settings || {}, next={...await settings()};
          for(const key of ['notionToken','aiKey','dataSourceId','aiModel']) if (typeof input[key] === 'string') next[key]=input[key].trim().slice(0,1000);
          if(next.dataSourceId && !/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i.test(next.dataSourceId)) throw new Error('資料來源 ID 格式不正確，請重新選擇資料庫。');
          for(const key of ['includeImages','aiEnabled']) if(typeof input[key] === 'boolean') next[key]=input[key];
          if (input.mapping && typeof input.mapping === 'object') next.mapping=Object.fromEntries(['title','summary','url','aiSummary','keywords','category','images'].map(k=>[k,typeof input.mapping[k]==='string'?input.mapping[k].slice(0,200):'']));
          await api.storage.local.set({settings:next}); return {ok:true};
          });
          settingsWrite=operation.catch(()=>{});
          return await operation;
        }
        case 'NOTION_LIST': return {ok:true,sources:await client(s).listDataSources()};
        case 'NOTION_SCHEMA': {
          const schema=await client(s).getSchema(message.dataSourceId);
          return {ok:true,schema,mapping:suggestMapping(schema.properties)};
        }
        case 'OPEN_OPTIONS': await api.runtime.openOptionsPage(); return {ok:true};
        case 'CAPTURE': {
          const [tab]=await api.tabs.query({active:true,currentWindow:true});
          if(!tab?.id) throw new Error('找不到目前的分頁，請在網頁上開啟擴充套件。');
          if(tab.url && !/^https?:\/\//i.test(tab.url)) throw new Error('請在一般 http 或 https 網頁使用；Safari 內建頁面無法擷取。');
          let results;
          try {results=await api.scripting.executeScript({target:{tabId:tab.id},func:capturePage});}
          catch {throw new Error('無法讀取此頁面，請在 Safari 允許此擴充套件存取目前網站，重新載入後再試。');}
          if(!results?.[0]?.result) throw new Error('此頁面沒有可讀取的內容，請選取或貼上原文。');
          return {ok:true,clip:composeClip(results[0].result)};
        }
        case 'REWRITE': {
          if(!s.aiEnabled) throw new Error('AI 改寫尚未啟用，請先在設定頁啟用。');
          return {ok:true,clip:await rewrite(cleanClip(message.clip),s)};
        }
        case 'SAVE': {
          if(!s.dataSourceId) throw new Error('請先在設定頁選擇 Notion 資料庫。');
          const clip=cleanClip(message.clip), key=s.dataSourceId+':'+clip.url;
          if(saves.has(key)) return await saves.get(key);
          const operation=(async()=>{
            const notion=client(s), schema=await notion.getSchema(s.dataSourceId);
            const mapping=s.mapping?.title?s.mapping:suggestMapping(schema.properties);
            if(!message.force){
              const existing=await notion.findByUrl(s.dataSourceId,mapping.url,clip.url);
              if(existing) return {ok:true,page:existing,duplicate:true};
            }
            return {ok:true,page:await notion.createClip({dataSourceId:s.dataSourceId,schema,mapping,clip,includeImages:s.includeImages})};
          })();
          saves.set(key,operation);
          try{return await operation;}finally{saves.delete(key);}
        }
        default: throw new Error('不支援的操作。');
      }
    } catch(error) {
      const errorText=error?.name==='TimeoutError'||error?.name==='AbortError'?'連線逾時。若正在儲存，請先檢查 Notion 是否已有頁面，再重試。':(error?.message||'操作失敗，請稍後重試。');
      // Never reflect API credentials even if an upstream library includes them.
      const current=await settings();
      let safe=errorText;
      for(const secret of [current.notionToken,current.aiKey]) if(secret) safe=safe.split(secret).join('[redacted]');
      return {ok:false,error:safe,...(error.partialUrl?{partialUrl:error.partialUrl}:{})};
    }
  }
  return dispatch;
}
