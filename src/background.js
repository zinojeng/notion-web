import { createController } from './controller.js';
const api = globalThis.browser || globalThis.chrome;
// Where supported, disallow extension storage access from content-script contexts.
api.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
const handle = createController(api);
api.runtime.onMessage.addListener((message,sender,respond)=>{
  handle(message,sender).then(respond,()=>respond({ok:false,error:'擴充套件處理失敗，請重新開啟。'}));
  return true;
});
