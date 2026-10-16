import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundles = new Map();
async function compiled(entry) {
  if (!bundles.has(entry)) {
    const result = await build({entryPoints:[entry], bundle:true, write:false, platform:'node', format:'cjs', jsx:'automatic', packages:'external',
      plugins:[{name:'fixture-theme', setup(builder) {
        builder.onLoad({filter:/packages[\\/]ui[\\/]theme\.tsx$/}, () => ({loader:'js', contents:`export const useTheme = () => ({palette:{page:'#fff',card:'#eee',ink:'#111',muted:'#555',line:'#ddd',incoming:'#eee',action:'#75e',actionSoft:'#edf',hover:'#eee'},font:'sans-serif'});`}));
      }}]});
    bundles.set(entry, result.outputFiles[0].text);
  }
  return bundles.get(entry);
}
// Execute real component/controller hooks with deterministic lifecycle and held IPC.
// No DOM, physical keyboard, screen-reader or platform rendering is claimed.
async function harness(entry, name, initial) {
  const slots=[]; let cursor=0, changed=true, effects=[], value, props=initial;
  const hooks={
    useRef(initial) { const i=cursor++; return slots[i] ??= {current:initial}; },
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial;
      return [slots[i], next => { const result=typeof next==='function'?next(slots[i]):next; if (!Object.is(result,slots[i])) {slots[i]=result;changed=true;} }]; },
    useEffect(effect,deps) { const i=cursor++, old=slots[i]; if (!old || deps.some((dep,j)=>!Object.is(dep,old.deps[j]))) effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:effect()};}); },
  };
  const element=(type,props)=>({type,props}); const module={exports:{}};
  new Function('require','module','exports',await compiled(entry))(name=>{
    if(name==='react')return hooks;
    if(name==='react/jsx-runtime')return {jsx:element,jsxs:element};
    if(name==='react-native-web')return new Proxy({}, {get:(_,key)=>key});
    throw Error(`Unexpected import ${name}`);
  },module,module.exports);
  function render(next) { if(next)props=next; let runs=0; do { assert.ok(++runs<40,'render/request loop'); changed=false;cursor=0;effects=[];value=module.exports[name](props);for(const effect of effects)effect(); } while(changed);return value; }
  return {render, get value(){return render();},async settle(){for(let i=0;i<12;i++){await Promise.resolve();render();}}, unmount(){for(const slot of slots)slot?.cleanup?.();}};
}
const data={sample:false,host:{label:'Synthetic',state:'connected'},chats:[],workflows:[],agents:[{id:'one',name:'One',summary:'',color:'blue'}]};
const snapshot=(workspace=null,overrides={})=>({generation:1,revision:1,status:'connected',data,selectedChatId:null,running:false,canSend:false,notice:'',storageAvailable:true,prompts:[],drafts:{},workspace,...overrides});
const projects=(name='Project')=>({projects:[{id:'p',name,description:'Description',archived:false,folders:[{path:'/synthetic/folder',primary:true}]}],activeId:'p'});
function ipc() { const calls=[];return {calls,api:{workspace(...args){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});calls.push({args,resolve,reject});return promise;}}}; }
function resolve(call,page='projects',payload=projects(),overrides={}) {call.resolve({ok:true,snapshot:snapshot({profile:call.args[1],page,status:'loaded',data:payload},overrides)});}
const hook='packages/ui/workspace-load.ts';
const pageEntry='packages/ui/components/WorkspaceFunctionPage.tsx';
const request=(overrides={})=>({api:undefined,snapshot:snapshot(),profile:'one',page:'projects',days:30,...overrides});
function nodes(root,predicate) { const found=[];function walk(node){if(!node || typeof node!=='object')return;if(typeof node.type==='function'){walk(node.type(node.props));return;}if(predicate(node))found.push(node);for(const child of Object.values(node.props??{})){for(const item of [child].flat(Infinity))walk(item);}}walk(root);return found; }
function control(h,label){const found=nodes(h.value,n=>n.props?.['aria-label']===label);assert.equal(found.length,1,`Missing/duplicate ${label}`);return found[0].props;}
function textContent(root){if(root==null||typeof root==='boolean')return '';if(typeof root!=='object')return String(root);if(Array.isArray(root))return root.map(textContent).join(' ');if(typeof root.type==='function')return textContent(root.type(root.props));return textContent(root.props?.children);}
function pageProps(api,extra={}){return {api,snapshot:snapshot(),data,page:'projects',narrow:false,panes:{list:true,detail:true},onOpenDetail(){},...extra};}

test('controller loads once and accepts only its own invocation, ignoring snapshot and callback churn',async()=>{
 const io=ipc(), props=request({api:io.api}); const h=await harness(hook,'useWorkspaceLoad',props);h.render();assert.equal(h.value.status,'loading');assert.equal(io.calls.length,1);
 h.render({...props,snapshot:snapshot({profile:'one',page:'projects',status:'loaded',data:projects('Unrelated')},{revision:9}),onChange(){}});assert.equal(io.calls.length,1);assert.equal(h.value.status,'loading');
 resolve(io.calls[0]);await h.settle();assert.equal(h.value.status,'loaded');assert.equal(h.value.workspace.data.projects[0].name,'Project');
 h.value.refresh();assert.equal(h.value.status,'loading');assert.equal(io.calls.length,2);resolve(io.calls[1]);await h.settle();assert.equal(h.value.status,'loaded');h.unmount();
});
for(const change of [{page:'scheduled'},{profile:'two'},{page:'usage',days:7},{snapshot:snapshot(null,{generation:2})}])test(`held response retired by ${JSON.stringify(change)}`,async()=>{
 const io=ipc(),props=request({api:io.api});const h=await harness(hook,'useWorkspaceLoad',props);h.render();h.render({...props,...change});assert.equal(io.calls.length,2);resolve(io.calls[0]);await h.settle();assert.equal(h.value.status,'loading');h.unmount();
});
test('same-key re-entry rejects retired promise and old matching snapshot',async()=>{
 const io=ipc(),props=request({api:io.api});const h=await harness(hook,'useWorkspaceLoad',props);h.render();h.render({...props,page:null});h.render({...props,snapshot:snapshot({profile:'one',page:'projects',status:'loaded',data:projects('Old')})});
 assert.equal(io.calls.length,2);resolve(io.calls[0],'projects',projects('Retired'));await h.settle();assert.equal(h.value.status,'loading');resolve(io.calls[1],'projects',projects('Current'));await h.settle();assert.equal(h.value.workspace.data.projects[0].name,'Current');h.unmount();
});
test('offline, failed, unsupported and mismatched reads are honest and do not retry',async()=>{
 const io=ipc(),props=request({api:io.api});const h=await harness(hook,'useWorkspaceLoad',props);h.render();io.calls[0].reject(Error('private server error'));await h.settle();assert.equal(h.value.status,'unavailable');assert.equal(io.calls.length,1);
 h.value.refresh();h.render();io.calls[1].resolve({ok:true,snapshot:snapshot({profile:'one',page:'projects',status:'unsupported'})});await h.settle();assert.equal(h.value.status,'unsupported');
 h.value.refresh();h.render();resolve(io.calls[2],'usage',{days:7,totals:{},daily:[],models:[]});await h.settle();assert.equal(h.value.status,'unavailable');
 h.render({...props,snapshot:snapshot(null,{status:'disconnected'})});assert.equal(h.value.status,'unavailable');assert.equal(io.calls.length,3);h.unmount();
});
test('usage period mismatch is refused and offline completion never reappears',async()=>{
 const io=ipc(),props=request({api:io.api,page:'usage',days:90});const h=await harness(hook,'useWorkspaceLoad',props);h.render();resolve(io.calls[0],'usage',{days:7,totals:{},daily:[],models:[]});await h.settle();assert.equal(h.value.status,'unavailable');
 h.value.refresh();h.render();h.render({...props,snapshot:snapshot(null,{status:'disconnected'})});resolve(io.calls[1],'usage',{days:90,totals:{},daily:[],models:[]});await h.settle();assert.equal(h.value.status,'unavailable');h.unmount();
});
test('multiple agents require explicit choice; a removed profile never chooses another',async()=>{
 const io=ipc(),two={...data,agents:[...data.agents,{id:'two',name:'Two'}]};const props=pageProps(io.api,{data:two});const h=await harness(pageEntry,'WorkspaceFunctionPage',props);h.render();assert.equal(io.calls.length,0);
 control(h,'Agent').onChange({target:{value:'one'}});h.render();assert.equal(io.calls.length,1);
 h.render({...props,data:{...data,agents:[{id:'two',name:'Two'}]}});assert.equal(io.calls.length,1);assert.equal(control(h,'Agent').value,'');h.unmount();
});
test('project search and explicit selection; refresh retains a row only while it exists',async()=>{
 const io=ipc(),h=await harness(pageEntry,'WorkspaceFunctionPage',pageProps(io.api));h.render();resolve(io.calls[0]);await h.settle();assert.match(textContent(h.value),/Pick a project/);
 control(h,'Project').onPress();h.render();assert.match(textContent(h.value),/Description/);assert.match(textContent(h.value),/Active/);assert.match(textContent(h.value),/\/synthetic\/folder/);
 control(h,'Search projects').onChangeText('absent');h.render();assert.equal(nodes(h.value,n=>n.props?.['aria-label']==='Project').length,0);control(h,'Search projects').onChangeText('');
 control(h,'Refresh projects').onPress();h.render();assert.doesNotMatch(textContent(h.value),/Description/);resolve(io.calls[1]);await h.settle();assert.match(textContent(h.value),/Description/);
 control(h,'Refresh projects').onPress();h.render();resolve(io.calls[2],'projects',{projects:[],activeId:null});await h.settle();assert.match(textContent(h.value),/No projects/);assert.doesNotMatch(textContent(h.value),/Description/);h.unmount();
});
test('scheduled displays supplied error, next run and inert result without run controls',async()=>{
 const io=ipc(),h=await harness(pageEntry,'WorkspaceFunctionPage',pageProps(io.api,{page:'scheduled'}));h.render();resolve(io.calls[0],'scheduled',{tasks:[{id:'t',name:'Task',schedule:'0 9 * * 1',state:'error',enabled:false,lastResult:'<script>throw new Error()</script>'}]});await h.settle();control(h,'Task').onPress();h.render();
 assert.match(textContent(h.value),/error/);assert.match(textContent(h.value),/Disabled/);assert.match(textContent(h.value),/Next run.*Unavailable/s);assert.match(textContent(h.value),/<script>throw new Error\(\)<\/script>/);assert.equal(nodes(h.value,n=>n.type==='script'||n.props?.dangerouslySetInnerHTML).length,0);assert.equal(nodes(h.value,n=>/^(Run|Edit|New) /.test(n.props?.['aria-label']??'')).length,0);h.unmount();
});
test('usage summary and daily/model selection keep missing values unavailable and cost labels distinct',async()=>{
 const io=ipc(),h=await harness(pageEntry,'WorkspaceFunctionPage',pageProps(io.api,{page:'usage'}));h.render();resolve(io.calls[0],'usage',{days:30,totals:{inputTokens:0,estimatedCost:0.2,actualCost:0},daily:[{day:'2026-10-01',sessions:0}],models:[{name:'Synthetic model',apiCalls:2}]});await h.settle();
 control(h,'Summary').onPress();h.render();assert.match(textContent(h.value),/Input tokens.*0.*Output tokens.*Unavailable/s);assert.match(textContent(h.value),/Estimated cost.*0.2.*Actual cost.*0/s);assert.doesNotMatch(textContent(h.value),/\$/);
 control(h,'2026-10-01').onPress();h.render();assert.match(textContent(h.value),/Sessions.*0/s);control(h,'Synthetic model').onPress();h.render();assert.match(textContent(h.value),/API calls.*2/s);
 for(const days of [7,90,30]){control(h,'Usage period').onChange({target:{value:String(days)}});h.render();assert.equal(io.calls.at(-1).args[3],days);assert.doesNotMatch(textContent(h.value),/API calls/);resolve(io.calls.at(-1),'usage',{days,totals:{},daily:[],models:[]});await h.settle();}h.unmount();
});
test('empty catalog and offline list offer reachable honest states with no saved-copy claim',async()=>{
 const io=ipc(),props=pageProps(io.api,{data:{...data,agents:[]}});const h=await harness(pageEntry,'WorkspaceFunctionPage',props);h.render();assert.equal(io.calls.length,0);assert.match(textContent(h.value),/No agents/);
 h.render({...props,data,snapshot:snapshot(null,{status:'disconnected'})});assert.match(textContent(h.value),/unavailable/i);assert.doesNotMatch(textContent(h.value),/saved on this device/);h.unmount();
});

test('usage model removal clears selection instead of reassigning an index to another model',async()=>{
 const io=ipc(),h=await harness(pageEntry,'WorkspaceFunctionPage',pageProps(io.api,{page:'usage'}));h.render();
 resolve(io.calls[0],'usage',{days:30,totals:{},daily:[],models:[{name:'Removed model',apiCalls:11},{name:'Remaining model',apiCalls:22}]});await h.settle();control(h,'Removed model').onPress();h.render();
 control(h,'Refresh usage').onPress();h.render();resolve(io.calls[1],'usage',{days:30,totals:{},daily:[],models:[{name:'Remaining model',apiCalls:22}]});await h.settle();
 assert.match(textContent(h.value),/Pick a usage row/);assert.doesNotMatch(textContent(h.value),/API calls/);h.unmount();
});
test('narrow list/detail/Back changes panes without new reads and leaves list controls reachable',async()=>{
 const io=ipc();let opened=0,back=0;const props=pageProps(io.api,{narrow:true,panes:{list:true,detail:false},onOpenDetail(){opened++;},onBack(){back++;}});
 const h=await harness(pageEntry,'WorkspaceFunctionPage',props);h.render();resolve(io.calls[0]);await h.settle();control(h,'Project').onPress();h.render();assert.equal(opened,1);
 h.render({...props,panes:{list:false,detail:true}});assert.equal(nodes(h.value,n=>n.props?.['aria-label']==='Agent').length,0);control(h,'Back').onPress();assert.equal(back,1);
 h.render(props);assert.equal(control(h,'Agent').value,'one');assert.equal(io.calls.length,1);h.unmount();
});

test('held usage period change hides prior data and ignores its eventual response',async()=>{
 const io=ipc(),props=request({api:io.api,page:'usage',days:30});const h=await harness(hook,'useWorkspaceLoad',props);h.render();h.render({...props,days:7});
 assert.equal(h.value.status,'loading');assert.deepEqual(io.calls.map(call=>call.args[3]),[30,7]);
 resolve(io.calls[0],'usage',{days:30,totals:{sessions:30},daily:[],models:[]});await h.settle();assert.equal(h.value.status,'loading');
 resolve(io.calls[1],'usage',{days:7,totals:{sessions:7},daily:[],models:[]});await h.settle();assert.equal(h.value.workspace.data.totals.sessions,7);h.unmount();
});
test('refresh fences the old invocation before React renders and cleanup rejects held completion',async()=>{
 const io=ipc(),h=await harness(hook,'useWorkspaceLoad',request({api:io.api}));h.render();h.value.refresh();
 resolve(io.calls[0]);await Promise.resolve();assert.equal(h.value.status,'loading');assert.equal(io.calls.length,2);
 h.unmount();resolve(io.calls[1]);await Promise.resolve();assert.equal(h.value.status,'loading');
});
test('page parent callback and snapshot revisions do not repeat a read',async()=>{
 const io=ipc(),props=pageProps(io.api);const h=await harness(pageEntry,'WorkspaceFunctionPage',props);h.render();resolve(io.calls[0]);await h.settle();
 for(let revision=2;revision<12;revision++)h.render({...props,snapshot:snapshot(null,{revision}),onOpenDetail(){},onBack(){}});
 assert.equal(io.calls.length,1);assert.equal(control(h,'Project')['aria-current'],false);h.unmount();
});

test('ambiguous duplicate model names clear selection after refresh instead of identifying another supplied row',async()=>{
 const io=ipc(),h=await harness(pageEntry,'WorkspaceFunctionPage',pageProps(io.api,{page:'usage'}));h.render();
 resolve(io.calls[0],'usage',{days:30,totals:{},daily:[],models:[{name:'Duplicate',sessions:1},{name:'Duplicate',sessions:2}]});await h.settle();
 nodes(h.value,n=>n.props?.['aria-label']==='Duplicate')[0].props.onPress();h.render();
 control(h,'Refresh usage').onPress();h.render();resolve(io.calls[1],'usage',{days:30,totals:{},daily:[],models:[{name:'Duplicate',sessions:2}]});await h.settle();
 assert.match(textContent(h.value),/Pick a usage row/);h.unmount();
});
