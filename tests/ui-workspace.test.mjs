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
    useCallback(fn,deps) { const i=cursor++, old=slots[i]; if (old && deps.every((dep,j)=>Object.is(dep,old.deps[j]))) return old.fn; slots[i]={fn,deps}; return fn; },
    useId() { const i=cursor++; return slots[i] ??= `:r${i}:`; },
    createContext(value) { return { Provider: 'Provider', value }; },
    // Feature pages read the host connection from context; tests pass it as props.
    useContext() { return props?.api ? { api: props.api, snapshot: props.snapshot ?? snapshot(), act: async () => true } : null; },
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
function ipc() { const calls=[],hostCalls=[];return {calls,hostCalls,api:{workspace(...args){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});calls.push({args,resolve,reject});return promise;},
  call(connection,name,input){let resolve;const promise=new Promise(a=>{resolve=a;});hostCalls.push({connection,name,input,resolve});return promise;}}}; }
const answer=(call,value)=>call.resolve({ok:true,value});
const refuse=(call,code,message)=>call.resolve({ok:false,code,message});
const sent=(io,name)=>io.hostCalls.filter(call=>call.name===name);
function resolve(call,page='projects',payload=projects(),overrides={}) {call.resolve({ok:true,snapshot:snapshot({profile:call.args[1],page,status:'loaded',data:payload},overrides)});}
const hook='packages/ui/workspace-load.ts';
const pageEntry='packages/ui/components/WorkspaceFunctionPage.tsx';
const projectsEntry='packages/ui/components/Projects.tsx';
const scheduledEntry='packages/ui/components/ScheduledTasks.tsx';
const projectList=(name='Project',extra={})=>({profile:'one',projects:[{id:'p',name,description:'Description',archived:false,primaryPath:'/synthetic/folder',folders:[{path:'/synthetic/folder',primary:true}]}],activeId:'p',...extra});
const taskRow=(extra={})=>({id:'t',name:'Task',prompt:'Synthetic instructions',schedule:{kind:'cron',expr:'0 9 * * 1-5'},scheduleText:'0 9 * * 1-5',state:'scheduled',enabled:true,running:false,
  nextRunAt:'2026-10-19T14:00:00.000Z',lastRunAt:null,createdAt:null,hostOffsetMinutes:null,lastStatus:null,lastError:null,deliver:'local',model:null,workdir:null,hostManaged:false,repeat:null,stores:{model:true,workdir:true},...extra});
const taskList=(tasks=[taskRow()])=>({profile:'one',tasks});
const request=(overrides={})=>({api:undefined,snapshot:snapshot(),profile:'one',page:'projects',days:30,...overrides});
function nodes(root,predicate) { const found=[];function walk(node){if(!node || typeof node!=='object')return;if(typeof node.type==='function'){walk(node.type(node.props));return;}if(predicate(node))found.push(node);for(const child of Object.values(node.props??{})){for(const item of [child].flat(Infinity))walk(item);}}walk(root);return found; }
function control(h,label){const found=nodes(h.value,n=>n.props?.['aria-label']===label);assert.equal(found.length,1,`Missing/duplicate ${label}`);return found[0].props;}
function textContent(root){if(root==null||typeof root==='boolean')return '';if(typeof root!=='object')return String(root);if(Array.isArray(root))return root.map(textContent).join(' ');if(typeof root.type==='function')return textContent(root.type(root.props));return textContent(root.props?.children);}
function pageProps(api,extra={}){return {api,snapshot:snapshot(),data,page:'projects',narrow:false,panes:{list:true,detail:true},onOpenDetail(){},...extra};}
// The native input inside a labelled form field (controls.tsx FieldLabel).
function field(h,label){const found=nodes(h.value,n=>n.type==='div'&&Array.isArray(n.props?.children)&&n.props.children[0]?.type==='label'&&n.props.children[0].props.children===label);assert.equal(found.length,1,`Missing field ${label}`);return found[0].props.children[1].props;}

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
 const io=ipc(),two={...data,agents:[...data.agents,{id:'two',name:'Two'}]};const props=pageProps(io.api,{data:two});const h=await harness(projectsEntry,'ProjectsPage',props);h.render();assert.equal(io.hostCalls.length,0);
 control(h,'Agent').onChange({target:{value:'one'}});h.render();assert.equal(io.hostCalls.length,1);assert.deepEqual(io.hostCalls[0].input,{profile:'one'});
 h.render({...props,data:{...data,agents:[{id:'two',name:'Two'}]}});assert.equal(io.hostCalls.length,1);assert.equal(control(h,'Agent').value,'');h.unmount();
});
test('project search and explicit selection; refresh hides old rows and retains a row only while it exists',async()=>{
 const io=ipc(),h=await harness(projectsEntry,'ProjectsPage',pageProps(io.api));h.render();assert.equal(io.hostCalls[0].name,'projects.list');answer(io.hostCalls[0],projectList());await h.settle();assert.match(textContent(h.value),/Pick a project/);
 control(h,'Project').onPress();h.render();assert.match(textContent(h.value),/Description/);assert.match(textContent(h.value),/Current project/);assert.match(textContent(h.value),/\/synthetic\/folder/);
 assert.match(textContent(h.value),/Folders are on the computer running Hermes/);assert.doesNotMatch(textContent(h.value),/Project ID/,'IDs only in Nerd Mode');
 control(h,'Search projects').onChangeText('absent');h.render();assert.equal(nodes(h.value,n=>n.props?.['aria-label']==='Project').length,0);control(h,'Search projects').onChangeText('');
 control(h,'Refresh projects').onPress();h.render();assert.doesNotMatch(textContent(h.value),/Description/);answer(io.hostCalls[1],projectList());await h.settle();assert.match(textContent(h.value),/Description/);
 control(h,'Refresh projects').onPress();h.render();answer(io.hostCalls[2],{profile:'one',projects:[],activeId:null});await h.settle();assert.match(textContent(h.value),/No projects yet/);assert.doesNotMatch(textContent(h.value),/Description/);h.unmount();
});
test('project actions: make current, archive after confirming, and restore',async()=>{
 const io=ipc(),h=await harness(projectsEntry,'ProjectsPage',pageProps(io.api,{snapshot:snapshot(null,{preferences:{nerdMode:true}})}));h.render();answer(io.hostCalls[0],projectList('Project',{activeId:null}));await h.settle();
 control(h,'Project').onPress();h.render();assert.match(textContent(h.value),/Not current/);assert.match(textContent(h.value),/Project ID/);
 control(h,'Make Project the current project').onPress();h.render();assert.deepEqual(sent(io,'projects.makeCurrent')[0].input,{profile:'one',id:'p'});
 answer(sent(io,'projects.makeCurrent')[0],{profile:'one',activeId:'p'});await h.settle();assert.match(textContent(h.value),/is now the current project/);
 answer(sent(io,'projects.list')[1],projectList());await h.settle();
 control(h,'Archive Project').onPress();h.render();assert.match(textContent(h.value),/Archive “Project”\?/);assert.match(textContent(h.value),/chats and folders stay on your computer/);assert.equal(sent(io,'projects.archive').length,0);
 control(h,'Archive project').onPress();h.render();assert.deepEqual(sent(io,'projects.archive')[0].input,{profile:'one',id:'p',archived:true});
 answer(sent(io,'projects.archive')[0],projectList('Project',{projects:[{...projectList().projects[0],archived:true}]}));await h.settle();
 assert.match(textContent(h.value),/Archived/);control(h,'Restore Project').onPress();h.render();assert.deepEqual(sent(io,'projects.archive')[1].input,{profile:'one',id:'p',archived:false});
 refuse(sent(io,'projects.archive')[1],'unknown','Not sure the project was restored. Check the list before trying again.');await h.settle();
 assert.match(textContent(h.value),/Not sure the project was restored/);assert.equal(sent(io,'projects.archive').length,2,'never retried');h.unmount();
});
test('new project needs a name and a host folder; a lost reply keeps the draft and never resends by itself',async()=>{
 const io=ipc();let saved=[],uncertain=0;
 const h=await harness(projectsEntry,'ProjectEditor',{editing:{mode:'new'},profile:'one',agentName:'One',api:io.api,snapshot:snapshot(),
  onClose(){},onSaved(value){saved.push(value);},onUncertain(){uncertain++;},onUnchanged(){}});h.render();
 assert.equal(control(h,'Create').disabled,true);assert.match(textContent(h.value),/computer running Hermes, which may not be this one/);
 field(h,'Name').onChange({target:{value:' Trip '}});field(h,'Folder on the Hermes computer').onChange({target:{value:'projects/app'}});h.render();
 assert.match(textContent(h.value),/Start with \/ or ~\//);assert.equal(control(h,'Create').disabled,true);
 field(h,'Folder on the Hermes computer').onChange({target:{value:'~/projects/app'}});h.render();assert.equal(control(h,'Create').disabled,false);
 control(h,'Create').onPress();h.render();assert.deepEqual(sent(io,'projects.create')[0].input,{profile:'one',name:'Trip',folder:'~/projects/app'});
 refuse(sent(io,'projects.create')[0],'unknown','Not sure the project was created. Check the list before creating it again.');await h.settle();
 assert.equal(uncertain,1);assert.equal(sent(io,'projects.create').length,1);assert.equal(field(h,'Name').value,' Trip ');
 control(h,'Create anyway').onPress();h.render();answer(sent(io,'projects.create')[1],{profile:'one',project:projectList().projects[0],current:true,notes:[]});await h.settle();
 assert.equal(saved.length,1);h.unmount();
});
test('scheduled shows plain state and inert host text, with run controls and the credit notice',async()=>{
 const io=ipc(),h=await harness(scheduledEntry,'ScheduledTasksPage',pageProps(io.api,{page:'scheduled'}));h.render();assert.deepEqual([io.hostCalls[0].name,io.hostCalls[0].input],['schedules.list',{profile:'one'}]);
 answer(io.hostCalls[0],taskList([taskRow({state:'error',enabled:false,nextRunAt:null,lastStatus:'<script>throw new Error()</script>'})]));await h.settle();control(h,'Task').onPress();h.render();
 assert.deepEqual(io.hostCalls.slice(1).map(call=>[call.name,call.input]),[['schedules.runs',{profile:'one',id:'t'}],['schedules.targets',{profile:'one'}]]);
 assert.match(textContent(h.value),/Needs a look/);assert.match(textContent(h.value),/Next run.*Paused/s);assert.match(textContent(h.value),/<script>throw new Error\(\)<\/script>/);
 assert.equal(nodes(h.value,n=>n.type==='script'||n.props?.dangerouslySetInnerHTML).length,0);
 assert.match(textContent(h.value),/Runs use AI credits on your computer's model provider each time\./);assert.ok(control(h,'Run Task now'));assert.doesNotMatch(textContent(h.value),/Task ID/);
 answer(sent(io,'schedules.runs')[0],{profile:'one',id:'t',runs:[]});await h.settle();assert.match(textContent(h.value),/No runs yet/);
 control(h,'Refresh scheduled').onPress();h.render();answer(sent(io,'schedules.list')[1],taskList());await h.settle();control(h,'Task').onPress();h.render();
 answer(sent(io,'schedules.runs').at(-1),{profile:'one',id:'t',runs:[{id:'local-synthetic',kind:'agent',startedAt:'2026-10-16T21:47:13.735Z',endedAt:'2026-10-16T21:47:43.361Z',
  active:false,summary:null,model:'synthetic-model',inputTokens:12629,outputTokens:213,estimatedCost:0,actualCost:null}]});await h.settle();
 assert.match(textContent(h.value),/Finished · 12,629 tokens in, 213 out/);assert.doesNotMatch(textContent(h.value),/local-synthetic/,'run IDs only in Nerd Mode');h.unmount();
});
test('Run now asks first, sends one run, waits as still text and reloads; a lost reply is not sure and never retried',async()=>{
 const io=ipc(),h=await harness(scheduledEntry,'ScheduledTasksPage',pageProps(io.api,{page:'scheduled'}));h.render();answer(io.hostCalls[0],taskList());await h.settle();control(h,'Task').onPress();h.render();
 control(h,'Run Task now').onPress();h.render();assert.equal(sent(io,'schedules.run').length,0);
 assert.match(textContent(h.value),/Run “Task” now\?/);assert.match(textContent(h.value),/uses AI credits on your computer's model provider/);assert.match(textContent(h.value),/up to 15 minutes/);
 control(h,'Run now').onPress();h.render();assert.deepEqual(sent(io,'schedules.run')[0].input,{profile:'one',id:'t',resume:false});
 assert.match(textContent(h.value),/Running now/);assert.equal(control(h,'Pause Task').disabled,true);
 answer(sent(io,'schedules.run')[0],{profile:'one',task:taskRow({lastRunAt:'2026-10-16T21:58:46.844Z',lastStatus:'ok'}),ran:true});await h.settle();
 assert.match(textContent(h.value),/The run finished\. Finished without errors\./);assert.equal(sent(io,'schedules.list').length,2);assert.equal(sent(io,'schedules.runs').length,2);
 answer(sent(io,'schedules.list')[1],taskList());await h.settle();
 control(h,'Run Task now').onPress();h.render();control(h,'Run now').onPress();h.render();
 refuse(sent(io,'schedules.run')[1],'unknown','Not sure the run finished. It may still be running. Check Recent runs before running it again.');await h.settle();
 assert.match(textContent(h.value),/Not sure the run finished/);assert.equal(sent(io,'schedules.run').length,2,'no automatic retry');h.unmount();
});
test('paused tasks run only with resume agreed; pause and delete send their own calls',async()=>{
 const io=ipc(),h=await harness(scheduledEntry,'ScheduledTasksPage',pageProps(io.api,{page:'scheduled'}));h.render();answer(io.hostCalls[0],taskList([taskRow({state:'paused',enabled:false,nextRunAt:null})]));await h.settle();
 control(h,'Task').onPress();h.render();assert.match(textContent(h.value),/may run once soon after you resume/);
 control(h,'Run Task now').onPress();h.render();assert.match(textContent(h.value),/Run and resume “Task”\?/);assert.match(textContent(h.value),/turns a paused task back on/);
 control(h,'Run and resume').onPress();h.render();assert.deepEqual(sent(io,'schedules.run')[0].input,{profile:'one',id:'t',resume:true});
 answer(sent(io,'schedules.run')[0],{profile:'one',task:taskRow({lastRunAt:'2026-10-16T21:58:46.844Z',lastStatus:'error'}),ran:true});await h.settle();
 assert.match(textContent(h.value),/The run finished\. Had a problem\./);answer(sent(io,'schedules.list')[1],taskList());await h.settle();
 control(h,'Pause Task').onPress();h.render();assert.deepEqual(sent(io,'schedules.setPaused')[0].input,{profile:'one',id:'t',paused:true});
 answer(sent(io,'schedules.setPaused')[0],{profile:'one',task:taskRow({state:'paused',enabled:false}),notes:[]});await h.settle();assert.match(textContent(h.value),/Paused\. It won't run until you resume it\./);
 answer(sent(io,'schedules.list')[2],taskList());await h.settle();
 control(h,'Delete Task').onPress();h.render();assert.match(textContent(h.value),/Delete “Task” for One\?/);assert.match(textContent(h.value),/can't be undone/);assert.equal(sent(io,'schedules.delete').length,0);
 control(h,'Delete').onPress();h.render();assert.deepEqual(sent(io,'schedules.delete')[0].input,{profile:'one',id:'t'});
 answer(sent(io,'schedules.delete')[0],{profile:'one',id:'t'});await h.settle();answer(sent(io,'schedules.list')[3],taskList([]));await h.settle();
 assert.match(textContent(h.value),/Deleted “Task”\./);assert.match(textContent(h.value),/Nothing scheduled yet/);h.unmount();
});
test('an old host hides New task and explains once',async()=>{
 const io=ipc(),h=await harness(scheduledEntry,'ScheduledTasksPage',pageProps(io.api,{page:'scheduled'}));h.render();assert.equal(control(h,'New task').disabled,true);
 refuse(io.hostCalls[0],'unsupported',"This computer's Hermes can't manage scheduled tasks. A Hermes update may be needed.");await h.settle();
 assert.match(textContent(h.value),/can't manage scheduled tasks/);assert.equal(nodes(h.value,n=>n.props?.['aria-label']==='New task').length,0);h.unmount();
});
test('task editor discloses credits, builds exact schedules, and keeps the draft when a save is not sure',async()=>{
 const io=ipc();let saved=[],uncertain=0;
 const h=await harness(scheduledEntry,'TaskEditor',{editing:{mode:'new'},profile:'one',agents:data.agents,supports:null,hostOffset:null,api:io.api,snapshot:snapshot(),
  onClose(){},onSaved(value){saved.push(value);},onUncertain(){uncertain++;},onUnchanged(){}});h.render();
 assert.deepEqual([io.hostCalls[0].name,io.hostCalls[0].input],['schedules.targets',{profile:'one'}]);
 answer(io.hostCalls[0],{profile:'one',targets:[{id:'local',name:'Local (save only)',ready:true},{id:'telegram',name:'Telegram',ready:false}]});await h.settle();
 assert.match(textContent(h.value),/It runs on its own on this schedule\. Runs use AI credits on your computer's model provider each time\./);
 assert.match(textContent(h.value),/Times use the clock on the computer running Hermes/);assert.doesNotMatch(textContent(h.value),/Telegram/,'targets without a home channel are not offered');
 control(h,'Create').onPress();h.render();assert.match(textContent(h.value),/Add what it should do and a short name/);assert.equal(sent(io,'schedules.create').length,0);
 field(h,'What should it do?').onChange({target:{value:' Reply with OK '}});field(h,'Short name').onChange({target:{value:'Check'}});field(h,'When?').onChange({target:{value:'hours'}});h.render();
 field(h,'How often?').onChange({target:{value:'4'}});h.render();control(h,'Create').onPress();h.render();
 assert.deepEqual(sent(io,'schedules.create')[0].input,{profile:'one',name:'Check',prompt:'Reply with OK',schedule:'every 240m',deliver:'local'});assert.match(textContent(h.value),/Saving…/);
 refuse(sent(io,'schedules.create')[0],'unknown','Not sure this was saved. Check the list before creating it again.');await h.settle();
 assert.equal(uncertain,1);assert.match(textContent(h.value),/Not sure this was saved/);assert.equal(field(h,'Short name').value,'Check');assert.equal(sent(io,'schedules.create').length,1);
 control(h,'Create anyway').onPress();h.render();answer(sent(io,'schedules.create')[1],{profile:'one',task:taskRow(),notes:[]});await h.settle();assert.equal(saved.length,1);h.unmount();
});
test('editing sends only what changed',async()=>{
 const io=ipc();let saved=[],unchanged=0;const task=taskRow({schedule:{kind:'interval',minutes:120},scheduleText:'every 120m'});
 const h=await harness(scheduledEntry,'TaskEditor',{editing:{mode:'edit',task},profile:'one',agents:data.agents,supports:null,hostOffset:null,api:io.api,snapshot:snapshot(),
  onClose(){},onSaved(value){saved.push(value);},onUncertain(){},onUnchanged(){unchanged++;}});h.render();answer(io.hostCalls[0],{profile:'one',targets:[]});await h.settle();
 assert.equal(field(h,'How often?').value,'2');control(h,'Save').onPress();h.render();assert.equal(unchanged,1);assert.equal(sent(io,'schedules.update').length,0);
 field(h,'Short name').onChange({target:{value:'Renamed'}});h.render();control(h,'Save').onPress();h.render();
 assert.deepEqual(sent(io,'schedules.update')[0].input,{profile:'one',id:'t',changes:{name:'Renamed'}});h.unmount();
});
test('usage summary and daily/model selection keep missing values unavailable and cost labels distinct',async()=>{
 const io=ipc(),h=await harness(pageEntry,'UsagePage',pageProps(io.api,{page:'usage'}));h.render();resolve(io.calls[0],'usage',{days:30,totals:{inputTokens:0,estimatedCost:0.2,actualCost:0},daily:[{day:'2026-10-01',sessions:0}],models:[{name:'Synthetic model',apiCalls:2}]});await h.settle();
 control(h,'Summary').onPress();h.render();assert.match(textContent(h.value),/Input tokens.*0.*Output tokens.*Unavailable/s);assert.match(textContent(h.value),/Estimated cost.*0.2.*Actual cost.*0/s);assert.doesNotMatch(textContent(h.value),/\$/);
 control(h,'2026-10-01').onPress();h.render();assert.match(textContent(h.value),/Sessions.*0/s);control(h,'Synthetic model').onPress();h.render();assert.match(textContent(h.value),/API calls.*2/s);
 for(const days of [7,90,30]){control(h,'Usage period').onChange({target:{value:String(days)}});h.render();assert.equal(io.calls.at(-1).args[3],days);assert.doesNotMatch(textContent(h.value),/API calls/);resolve(io.calls.at(-1),'usage',{days,totals:{},daily:[],models:[]});await h.settle();}h.unmount();
});
test('empty catalog and offline list offer reachable honest states with no saved-copy claim',async()=>{
 const io=ipc(),props=pageProps(io.api,{data:{...data,agents:[]}});const h=await harness(projectsEntry,'ProjectsPage',props);h.render();assert.equal(io.hostCalls.length,0);assert.match(textContent(h.value),/No agents/);
 h.render({...props,data,snapshot:snapshot(null,{status:'disconnected'})});assert.match(textContent(h.value),/unavailable/i);assert.doesNotMatch(textContent(h.value),/saved on this device/);h.unmount();
});
test('usage model removal clears selection instead of reassigning an index to another model',async()=>{
 const io=ipc(),h=await harness(pageEntry,'UsagePage',pageProps(io.api,{page:'usage'}));h.render();
 resolve(io.calls[0],'usage',{days:30,totals:{},daily:[],models:[{name:'Removed model',apiCalls:11},{name:'Remaining model',apiCalls:22}]});await h.settle();control(h,'Removed model').onPress();h.render();
 control(h,'Refresh usage').onPress();h.render();resolve(io.calls[1],'usage',{days:30,totals:{},daily:[],models:[{name:'Remaining model',apiCalls:22}]});await h.settle();
 assert.match(textContent(h.value),/Pick a usage row/);assert.doesNotMatch(textContent(h.value),/API calls/);h.unmount();
});
test('narrow list/detail/Back changes panes without new reads and leaves list controls reachable',async()=>{
 const io=ipc();let opened=0,back=0;const props=pageProps(io.api,{narrow:true,panes:{list:true,detail:false},onOpenDetail(){opened++;},onBack(){back++;}});
 const h=await harness(projectsEntry,'ProjectsPage',props);h.render();answer(io.hostCalls[0],projectList());await h.settle();control(h,'Project').onPress();h.render();assert.equal(opened,1);
 h.render({...props,panes:{list:false,detail:true}});assert.equal(nodes(h.value,n=>n.props?.['aria-label']==='Agent').length,0);control(h,'Back').onPress();assert.equal(back,1);
 h.render(props);assert.equal(control(h,'Agent').value,'one');assert.equal(io.hostCalls.length,1);h.unmount();
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
 const io=ipc(),props=pageProps(io.api);const h=await harness(projectsEntry,'ProjectsPage',props);h.render();answer(io.hostCalls[0],projectList());await h.settle();
 for(let revision=2;revision<12;revision++)h.render({...props,snapshot:snapshot(null,{revision}),onOpenDetail(){},onBack(){}});
 assert.equal(io.hostCalls.length,1);assert.equal(control(h,'Project')['aria-current'],false);h.unmount();
});
test('ambiguous duplicate model names clear selection after refresh instead of identifying another supplied row',async()=>{
 const io=ipc(),h=await harness(pageEntry,'UsagePage',pageProps(io.api,{page:'usage'}));h.render();
 resolve(io.calls[0],'usage',{days:30,totals:{},daily:[],models:[{name:'Duplicate',sessions:1},{name:'Duplicate',sessions:2}]});await h.settle();
 nodes(h.value,n=>n.props?.['aria-label']==='Duplicate')[0].props.onPress();h.render();
 control(h,'Refresh usage').onPress();h.render();resolve(io.calls[1],'usage',{days:30,totals:{},daily:[],models:[{name:'Duplicate',sessions:2}]});await h.settle();
 assert.match(textContent(h.value),/Pick a usage row/);h.unmount();
});

for (const page of ['projects','scheduled','usage']) test(`narrow ${page} detail exposes the complete selected long title as selectable wrapping text`,async()=>{
 const title='<script>doNotExecute()</script> '+ 'Long supplied name '.repeat(6);
 const io=ipc();let back=0;
 const props=pageProps(io.api,{page,narrow:true,panes:{list:true,detail:false},onBack(){back++;}});
 const [entry,name]=page==='projects'?[projectsEntry,'ProjectsPage']:page==='scheduled'?[scheduledEntry,'ScheduledTasksPage']:[pageEntry,'UsagePage'];
 const h=await harness(entry,name,props);h.render();
 if(page==='projects')answer(io.hostCalls[0],projectList(title));else if(page==='scheduled')answer(io.hostCalls[0],taskList([taskRow({name:title,state:'paused',enabled:false})]));
 else resolve(io.calls[0],page,{days:30,totals:{},daily:[],models:[{name:title,sessions:0}]});
 await h.settle();control(h,title).onPress();h.render();
 h.render({...props,panes:{list:false,detail:true}});
 assert.equal(nodes(h.value,n=>n.props?.['aria-label']==='Agent').length,0,'the context list must be absent');
 const fullTitle=nodes(h.value,n=>n.type==='Text' && n.props?.children===title && n.props?.selectable===true && n.props?.numberOfLines===0);
 assert.equal(fullTitle.length,1,'detail must expose the full supplied title as selectable, unrestricted text');
 assert.equal(nodes(h.value,n=>n.type==='script'||n.props?.dangerouslySetInnerHTML).length,0);
 control(h,'Back').onPress();assert.equal(back,1);assert.equal(page==='usage'?io.calls.length:sent(io,page==='projects'?'projects.list':'schedules.list').length,1);h.unmount();
});
