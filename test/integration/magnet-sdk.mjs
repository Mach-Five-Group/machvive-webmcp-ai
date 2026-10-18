// Run against a candidate SDK before publishing the component. This deliberately
// requires the real consumer artifact, rather than a copied SDK or mocked open().
// MAGNET_SDK_SOURCE=/path/to/shared/machfivemagnet.js node --test --import ./test/setup.js test/integration/magnet-sdk.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
assert.ok(process.env.MAGNET_SDK_SOURCE,'Set MAGNET_SDK_SOURCE to the candidate SDK');
const sdk=readFileSync(process.env.MAGNET_SDK_SOURCE,'utf8');
for(const key of ['location','sessionStorage','localStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:window[key]});
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);window.requestAnimationFrame=globalThis.requestAnimationFrame;
const requests=[];window.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options?.body||'{}')});return {ok:true,json:async()=>({ok:true})};};
await import('../../src/wc/machvive-m5t-magnet/machvive-m5t-magnet.js');
const waitFor=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}assert.fail('Expected UI did not appear');};
test('actual component opens actual SDK, preserves hub answers, and waits for shopper submission',async()=>{
 document.body.innerHTML='<div data-m5m-inline></div><machvive-m5t-magnet tools="all" magnet-id="inline"></machvive-m5t-magnet>';
 const definition={mag_id:'inline',mag_agent_tools:'all',mag_display_mode:'inline',mag_home:true,mag_summary:false,mag_actions:[{type:'chat',label:'Contact us'}],mag_macro_steps:[{id:'email',step_type:'email',step_columns:['email'],step_prompts:['Your email?'],step_config:{skip_if_prefilled:true},step_options:[]}]};
 // Existing component avoids the CDN import; its real source is loaded above.
 new Function(sdk.replaceAll('##APPGUID##','integration-fixture').replace(/["']##MAGNET_DEFINITIONS##["']/g,()=>JSON.stringify([definition])))();
 await waitFor(()=>navigator.modelContext.tools.some(t=>t.name==='magnet_start'));
 const result=await navigator.modelContext.callTool('magnet_start',{email:'visitor@example.test'});assert.notEqual(result.isError,true);
 const shadow=document.getElementById('m5m-magnet-inline').shadowRoot;await waitFor(()=>shadow.querySelector('.m5m-action'));shadow.querySelector('.m5m-action').click();
 await waitFor(()=>shadow.querySelector('.m5m-sum-confirm'));assert.equal(requests.filter(r=>r.url.endsWith('/capture')).length,0);
 assert.match(shadow.querySelector('.m5m-summary').textContent,/visitor@example.test/);shadow.querySelector('.m5m-sum-confirm').click();
 await waitFor(()=>requests.some(r=>r.url.endsWith('/capture')));assert.equal(requests.find(r=>r.url.endsWith('/capture')).body.source,'agent');
 document.body.replaceChildren();
});
