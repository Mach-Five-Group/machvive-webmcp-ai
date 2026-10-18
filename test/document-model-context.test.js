import {test} from 'node:test';
import assert from 'node:assert/strict';
const registered=new Map();let calls=0;
const native={registerTool(tool,{signal}){calls++;if(registered.has(tool.name))throw new Error('duplicate native tool');registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name),{once:true});return Promise.resolve();}};
Object.defineProperty(document,'modelContext',{value:native,configurable:true});
const {installWebmcpPolyfill}=await import('../src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js');
await import('../src/wc/machvive-m5t-magnet/machvive-m5t-magnet.js');
test('real components register in document context, revoke through abort, and preserve unrelated native tools',async()=>{
 assert.equal(installWebmcpPolyfill(),false);assert.equal(document.modelContext,native);
 // 7.0 installs at document only. Leaving a navigator copy behind would give
 // a page two registries that disagree about what is published.
 assert.equal(navigator.modelContext,undefined,'the polyfill must not touch navigator');
 const foreign=new AbortController();await native.registerTool({name:'host_tool',execute:()=>''},{signal:foreign.signal});
 let opened;window.machfivemagnet={magnets:[{mag_id:'native',mag_agent_tools:'all',mag_macro_steps:[{id:'email',step_type:'email',step_columns:['email'],step_prompts:['Email?']}]}]};window.MachFiveMagnet={instances:[{id:'native',open:o=>opened=o}],on(){}};
 const el=document.createElement('machvive-m5t-magnet');document.body.append(el);
 for(let i=0;i<40&&!registered.has('magnet_start');i++)await new Promise(r=>setTimeout(r,10));
 assert.ok(registered.has('magnet_start'));await registered.get('magnet_start').execute({email:'native@example.test'});assert.equal(opened.prefill.email,'native@example.test');
 el.setAttribute('tools','read');assert.ok(!registered.has('magnet_start'));assert.ok(registered.has('magnet_describe'));
 el.setAttribute('tools','none');assert.deepEqual([...registered.keys()],['host_tool']);
 el.setAttribute('tools','all');assert.ok(registered.has('magnet_start'));el.remove();assert.deepEqual([...registered.keys()],['host_tool']);assert.ok(calls>3);
});
