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
    // Layout effects and memoization behave like their plain forms here.
    useLayoutEffect(effect,deps) { return hooks.useEffect(effect,deps ?? [Symbol()]); },
    useMemo(compute) { cursor++; return compute(); }, useCallback(callback) { cursor++; return callback; },
    useId() { return `id-${cursor++}`; }, memo(component) { return component; },
    useContext() { cursor++; return null; }, createContext(value) { return { Provider: 'Provider', value }; },
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
function ipc() { const calls=[];return {calls,api:{workspace(...args){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});calls.push({args,resolve,reject});return promise;}}}; }
function resolve(call,page,payload,overrides={}) {call.resolve({ok:true,snapshot:snapshot({profile:call.args[1],page,status:'loaded',data:payload},overrides)});}
const pageEntry='packages/ui/components/AgentBoard.tsx';
function nodes(root,predicate) { const found=[];function walk(node){if(!node || typeof node!=='object')return;if(typeof node.type==='function'){walk(node.type(node.props));return;}if(predicate(node))found.push(node);for(const child of Object.values(node.props??{})){for(const item of [child].flat(Infinity))walk(item);}}walk(root);return found; }
function control(h,label){const found=nodes(h.value,n=>n.props?.['aria-label']===label);assert.equal(found.length,1,`Missing/duplicate ${label}`);return found[0].props;}
function textContent(root){if(root==null||typeof root==='boolean')return '';if(typeof root!=='object')return String(root);if(Array.isArray(root))return root.map(textContent).join(' ');if(typeof root.type==='function')return textContent(root.type(root.props));return textContent(root.props?.children);}
function pageProps(api,extra={}){return {api,snapshot:snapshot(),data,profile:'one',page:'feed',narrow:false,...extra};}


const board=(page='feed',title='Supplied title',extra={})=>({tab:page,items:[{id:'item',kind:page==='ideas'?'idea':page==='goals'?'goal':'feed',title,body:'Full body',...extra}]});
for(const page of ['feed','ideas','goals']) test(`${page} reads only exact opened profile, searches all supplied text, selects full inert details and refreshes`,async()=>{
 const io=ipc(),title='<script>bad()</script> '+ 'Long supplied title '.repeat(8);
 const h=await harness(pageEntry,'AgentBoard',pageProps(io.api,{page}));h.render();assert.equal(io.calls.length,1,'one initial board read');assert.deepEqual(io.calls[0].args,[1,'one',page,30]);
 resolve(io.calls[0],page,board(page,title,{body:'javascript:alert(1) https://synthetic.invalid',note:'A note',category:'Category',status:'unknown supplied state',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-02T00:00:00Z',read:false}));await h.settle();
 control(h,`Search ${page}`).onChangeText('no matching row');h.render();assert.match(textContent(h.value),/No matching items/);
 control(h,`Search ${page}`).onChangeText('A note');h.render();control(h,title).onPress();h.render();
 const text=textContent(h.value);for(const value of [title,'javascript:alert(1) https://synthetic.invalid','A note','Category','unknown supplied state','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','Unread'])assert.ok(text.includes(value),value);
 assert.ok(nodes(h.value,n=>n.type==='Text'&&n.props.children===title&&n.props.selectable===true&&n.props.numberOfLines===0).length>0);
 assert.equal(nodes(h.value,n=>n.type==='a'||n.type==='script'||n.props?.href||n.props?.dangerouslySetInnerHTML).length,0);
 control(h,`Refresh ${page}`).onPress();h.render();assert.doesNotMatch(textContent(h.value),/javascript:alert/);resolve(io.calls[1],page,board(page,title));await h.settle();assert.match(textContent(h.value),/Full body/);
 control(h,`Refresh ${page}`).onPress();h.render();resolve(io.calls[2],page,{tab:page,items:[]});await h.settle();assert.match(textContent(h.value),/No .* supplied/);assert.doesNotMatch(textContent(h.value),/Full body/);assert.equal(io.calls.length,3);h.unmount();
});
test('board does no extra identity filtering and leaves missing metadata unavailable',async()=>{
 const io=ipc(),h=await harness(pageEntry,'AgentBoard',pageProps(io.api));h.render();resolve(io.calls[0],'feed',{tab:'feed',items:[{id:'other',kind:'goal',title:'Already projected item',dismissed:true}]});await h.settle();control(h,'Already projected item').onPress();h.render();assert.match(textContent(h.value),/Read.*Unavailable/s);assert.match(textContent(h.value),/Body.*Unavailable/s);h.unmount();
});
for(const change of [{page:'ideas'},{profile:'two',data:{...data,agents:[...data.agents,{id:'two',name:'Two'}]}},{snapshot:snapshot(null,{generation:2})}])test(`board retires held reads on ${JSON.stringify(change)}`,async()=>{
 const io=ipc(),props=pageProps(io.api),h=await harness(pageEntry,'AgentBoard',props);h.render();h.render({...props,...change});assert.equal(io.calls.length,2);resolve(io.calls[0],'feed',board('feed','Retired'));await h.settle();assert.doesNotMatch(textContent(h.value),/Retired/);h.unmount();
});
test('inactive reentry ignores retired result and snapshot publications; unrelated props never reload',async()=>{
 const io=ipc(),props=pageProps(io.api),h=await harness(pageEntry,'AgentBoard',props);h.render();h.render({...props,page:null});h.render({...props,snapshot:snapshot({profile:'one',page:'feed',status:'loaded',data:board('feed','Snapshot stale')})});assert.equal(io.calls.length,2);
 resolve(io.calls[0],'feed',board('feed','Retired'));await h.settle();assert.doesNotMatch(textContent(h.value),/Retired|Snapshot stale/);resolve(io.calls[1],'feed',board('feed','Current'));await h.settle();
 for(let revision=2;revision<10;revision++)h.render({...props,snapshot:snapshot(null,{revision}),onChange(){}});assert.equal(io.calls.length,2);control(h,'Current').onPress();h.render();assert.match(textContent(h.value),/Full body/);h.unmount();
});
test('removed exact profile retires data without fallback or old selection on reappearance',async()=>{
 const io=ipc(),props=pageProps(io.api),h=await harness(pageEntry,'AgentBoard',props);h.render();resolve(io.calls[0],'feed',board());await h.settle();control(h,'Supplied title').onPress();h.render();
 h.render({...props,data:{...data,agents:[{id:'two',name:'Two'}]}});assert.match(textContent(h.value),/agent is no longer available/);assert.equal(io.calls.length,1);
 h.render(props);assert.equal(io.calls.length,2);resolve(io.calls[1],'feed',board());await h.settle();assert.match(textContent(h.value),/Pick an item/);h.unmount();
});
test('offline, errors, unsupported and empty boards offer honest reachable states',async()=>{
 const io=ipc(),props=pageProps(io.api),h=await harness(pageEntry,'AgentBoard',props);h.render();io.calls[0].reject(Error('private message'));await h.settle();assert.match(textContent(h.value),/unavailable/i);assert.doesNotMatch(textContent(h.value),/private message/);assert.equal(control(h,'Refresh feed').disabled,false);
 control(h,'Refresh feed').onPress();h.render();io.calls[1].resolve({ok:true,snapshot:snapshot({profile:'one',page:'feed',status:'unsupported'})});await h.settle();assert.match(textContent(h.value),/does not support/);
 control(h,'Refresh feed').onPress();h.render();h.render({...props,snapshot:snapshot(null,{status:'disconnected'})});resolve(io.calls[2],'feed',board('feed','Offline stale'));await h.settle();assert.match(textContent(h.value),/Connect to Hermes/);assert.doesNotMatch(textContent(h.value),/Offline stale|saved on this device/);assert.equal(control(h,'Refresh feed').disabled,true);h.unmount();
});
test('narrow selection and Back keep search and refresh reachable without another read',async()=>{
 const io=ipc(),h=await harness(pageEntry,'AgentBoard',pageProps(io.api,{narrow:true}));h.render();resolve(io.calls[0],'feed',board());await h.settle();control(h,'Supplied title').onPress();h.render();assert.match(textContent(h.value),/Full body/);control(h,'Back to feed list').onPress();h.render();assert.equal(control(h,'Search feed').value,'');assert.equal(control(h,'Refresh feed').disabled,false);assert.equal(io.calls.length,1);h.unmount();
});

test('Conversation keeps composer at a stable sibling position, hidden and inert on every non-chat tab',async()=>{
 const props={agent:data.agents[0],chat:null,host:data.host,tab:'chat',draft:'Protected draft',hint:'Ready',sample:false,onDraft(){},onTab(){},board:{type:'board',props:{children:'Board body'}}};
 const h=await harness('packages/ui/components/Conversation.tsx','Conversation',props);h.render();
 function composerPath(root,path=[]){if(!root||typeof root!=='object')return null;if(root.type?.name==='Composer')return path;for(const [index,node]of [root.props?.children].flat(Infinity).entries()){const found=composerPath(node,[...path,index]);if(found)return found;}return null;}
 const path=composerPath(h.value);assert.ok(path);
 for(const tab of ['feed','ideas','goals','files']){h.render({...props,tab});assert.deepEqual(composerPath(h.value),path,'composer component stays at the same tree path');
 const hidden=nodes(h.value,n=>n.type==='div'&&n.props.hidden===true&&n.props.inert===true);assert.equal(hidden.length,1);assert.equal(hidden[0].props.style.display,'none');
 assert.equal(nodes(h.value,n=>n.props?.role==='tablist').length,1);}
 h.render({...props,tab:'feed'});assert.match(textContent(h.value),/Board body/);assert.doesNotMatch(textContent(h.value),/Not built yet/);h.unmount();
});


test('loaded selection is retired on leaving and same-key return before a fresh read',async()=>{
 const io=ipc(),props=pageProps(io.api),h=await harness(pageEntry,'AgentBoard',props);h.render();resolve(io.calls[0],'feed',board());await h.settle();control(h,'Supplied title').onPress();h.render();assert.match(textContent(h.value),/Full body/);
 h.render({...props,page:null});h.render(props);assert.doesNotMatch(textContent(h.value),/Full body/);resolve(io.calls[1],'feed',board('feed','Supplied title',{read:true}));await h.settle();assert.match(textContent(h.value),/Pick an item/);control(h,'Supplied title').onPress();h.render();assert.match(textContent(h.value),/Read.*Read/s);h.unmount();
});
