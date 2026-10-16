// Executes real renderer components with deterministic hooks and held IPC, as in
// ui-agent-board.test.mjs. No DOM, keyboard, screen reader or platform rendering
// is claimed: elements are plain {type, props} objects.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundles = new Map();
async function compiled(entry) {
  if (!bundles.has(entry)) {
    const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
      plugins: [{ name: 'fixture-theme', setup(builder) {
        builder.onLoad({ filter: /packages[\\/]ui[\\/]theme\.tsx$/ }, () => ({ loader: 'js', contents: `export const useTheme = () => ({palette:{page:'#fff',card:'#eee',ink:'#111',muted:'#555',line:'#ddd',incoming:'#eee',action:'#75e',actionSoft:'#edf',hover:'#eee'},font:'sans-serif'});` }));
      } }] });
    bundles.set(entry, result.outputFiles[0].text);
  }
  return bundles.get(entry);
}
export async function harness(entry, name, initial) {
  const slots = []; let cursor = 0, changed = true, effects = [], props = initial, ids = 0;
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) {
      const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], next => { const result = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(result, slots[i])) { slots[i] = result; changed = true; } }];
    },
    useEffect(effect, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((dep, j) => !Object.is(dep, old.deps[j]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
    },
    useId() { const i = cursor++; return slots[i] ??= `:r${++ids}:`; },
  };
  const element = (type, elementProps) => ({ type, props: elementProps }); const module = { exports: {} };
  new Function('require', 'module', 'exports', await compiled(entry))(dependency => {
    if (dependency === 'react') return hooks;
    if (dependency === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (dependency === 'react-native-web') return new Proxy({}, { get: (_, key) => key });
    throw Error(`Unexpected import ${dependency}`);
  }, module, module.exports);
  function render(next) {
    if (next) props = next;
    let runs = 0, value;
    do {
      assert.ok(++runs < 40, 'render/request loop'); changed = false; cursor = 0; effects = [];
      value = module.exports[name](props); for (const effect of effects) effect();
    } while (changed);
    return value;
  }
  return { render, get value() { return render(); }, async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } },
    unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
// Function components are expanded with props only; their hooks never mutate the page's slots.
export function nodes(root, predicate) {
  const found = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    if (typeof node.type === 'function') { walk(expand(node)); return; }
    if (predicate(node)) found.push(node);
    for (const child of Object.values(node.props ?? {})) for (const item of [child].flat(Infinity)) walk(item);
  }
  walk(root); return found;
}
// Shared controls (Button, Banner, Dialog) are rendered as their props: a stub
// keeps their own hooks out of the page under test.
function expand(node) {
  const name = node.type.name;
  if (name === 'Button') return { type: 'Button', props: { ...node.props, 'aria-label': node.props.accessibleLabel ?? node.props.label, children: node.props.label } };
  if (name === 'Dialog') return node.props.open ? { type: 'Dialog', props: { ...node.props, 'aria-label': node.props.title, children: [node.props.title, node.props.children, node.props.actions] } } : null;
  if (name === 'Banner') return { type: 'Banner', props: { ...node.props, children: [node.props.title, node.props.text, node.props.children] } };
  return node.type(node.props);
}
export function control(h, label) {
  const found = nodes(h.value, node => node.props?.['aria-label'] === label);
  assert.equal(found.length, 1, `Missing/duplicate ${label}`);
  return found[0].props;
}
export function has(h, label) { return nodes(h.value, node => node.props?.['aria-label'] === label).length > 0; }
export function textContent(root) {
  if (root == null || typeof root === 'boolean') return '';
  if (typeof root !== 'object') return String(root);
  if (Array.isArray(root)) return root.map(textContent).join(' ');
  if (typeof root.type === 'function') return textContent(expand(root));
  return textContent(root.props?.children);
}
