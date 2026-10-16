// Opt-in synthetic React/DOM interactions, after the packaged no-host checks.
// The compiler writes nothing; neither this module nor its fixture is a product entry.
import { build } from 'esbuild';
import { join } from 'node:path';

export async function runWorkspaceFixture({ root, evaluate, send, check, capture, sleep }) {
  const bundle = await build({ absWorkingDir: root, entryPoints: [join(root, 'scripts/qualification/workspace-ui-fixture.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome140', jsx: 'automatic', minify: true,
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const q = 'window.workspaceQualification';
  const scope = 'document.getElementById("workspace-qualification")';
  const el = label => `${scope}.querySelector('[aria-label='+CSS.escape(${JSON.stringify(label)})+']')`;
  const wait = async (predicate, label) => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await sleep(30); }
    throw new Error(`Synthetic interaction timed out: ${label}`);
  };
  const assert = async (label, predicate) => { const ok = await predicate(); check(`synthetic UI: ${label}`, ok); if (!ok) throw new Error(`Synthetic interaction assertion: ${label}`); };
  const has = text => evaluate(`${scope}.innerText.includes(${JSON.stringify(text)})`);
  const click = async label => {
    await wait(() => evaluate(`Boolean(${el(label)})`), `control ${label}`);
    await evaluate(`${el(label)}.click(), true`); await sleep(60);
  };
  const select = async (label, value) => { await evaluate(`(() => { const e=${el(label)}; e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`); await sleep(60); };
  const input = async (label, value) => { await evaluate(`${el(label)}.focus(), ${el(label)}.select(), true`); await send('Input.insertText', { text: value }); await sleep(60); };
  const count = () => evaluate(`${q}.reads().length`);
  const read = async action => { const before = await count(); await action(); await wait(async () => await count() > before, 'one workspace request'); await sleep(80); await assert('one request per intentional load', async () => await count() === before + 1); return before; };
  const resolve = async (index, marker, mode = 'loaded') => { await evaluate(`${q}.resolve(${index},${JSON.stringify(marker)},${JSON.stringify(mode)}),true`); await sleep(80); };
  const quiet = async () => { const before = await count(); for (let i = 0; i < 4; i++) await evaluate(`${q}.churn(),true`); await sleep(200); await assert('snapshot revisions and callback churn do not reload', async () => await count() === before); };
  const key = async (key, code, windowsVirtualKeyCode) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode }); };
  const originalState = await evaluate(`JSON.stringify((() => { const e=document.getElementById('root'); return e ? [e.getAttribute('hidden'),e.getAttribute('inert')] : null; })())`);
  try {
    const injected = await send('Runtime.evaluate', { expression: bundle.outputFiles[0].text, returnByValue: true });
    if (injected.result?.exceptionDetails || injected.error) throw new Error('Synthetic fixture injection failed');
    await wait(() => evaluate(`Boolean(${el('Chats')})`), 'fixture mounted');
    await click('Projects');
    await assert('multiple profiles require explicit choice', () => has('Choose an agent to load this page.'));
    const oldProfile = await read(() => select('Agent', 'alpha'));
    const newProfile = await read(() => select('Agent', 'beta'));
    await resolve(newProfile, 'NewProfile'); await click('NewProfile project'); await resolve(oldProfile, 'RetiredProfile');
    await assert('held old profile cannot change new result or selection', async () => (await has('NewProfile project')) && !(await has('RetiredProfile')) && await evaluate(`${el('NewProfile project')}.getAttribute('aria-current')==='true'`));
    await input('Search projects', 'no matching synthetic row');
    await assert('project search filters actual rows', () => has('No matching rows.'));
    await input('Search projects', 'NewProfile'); await quiet(); await input('Search projects', '');
    await assert('server markup and URL text stay inert', async () => await has(await evaluate(`${q}.hostile`)) && await evaluate(`${scope}.querySelectorAll('a,img,script,iframe').length===0 && !globalThis.fixtureExecuted`));
    await assert('loaded function retains one rail and approved 76/300 geometry', () => evaluate(`${scope}.querySelectorAll('[aria-label="Places"]').length===1 && ${scope}.querySelectorAll('[role=tablist]').length===0 && ${el('Places')}.getBoundingClientRect().width===76 && ${scope}.querySelector('[role=region][aria-label="Projects"]').getBoundingClientRect().width===300`));
    await capture('synthetic-wide-projects');
    const oldPage = await read(() => click('Refresh projects'));
    await assert('refresh immediately hides old result', async () => await has('Loading projects…') && !(await has('NewProfile project')));
    await click('Scheduled');
    const scheduled = await read(() => select('Agent', 'alpha')); await resolve(scheduled, 'CurrentScheduled'); await click('CurrentScheduled task'); await resolve(oldPage, 'RetiredPage');
    await assert('held old page stays retired', async () => !(await has('RetiredPage')) && await has('CurrentScheduled task'));
    await assert('scheduled error and missing next run remain supplied/unavailable', async () => await has('error') && await has('Disabled') && await has('Unavailable') && await has('Device calendars and reminders are unavailable.'));
    await click('Synthetic missing result');
    await assert('missing scheduled result remains unavailable', () => has('Unavailable'));
    await capture('synthetic-wide-scheduled');
    await click('Usage');
    const old30 = await read(() => select('Agent', 'alpha'));
    const old7 = await read(() => select('Usage period', '7'));
    const current90 = await read(() => select('Usage period', '90'));
    await resolve(current90, 'Current90'); await click('Summary'); await resolve(old7, 'Retired7'); await resolve(old30, 'Retired30');
    await assert('held old periods cannot replace 90 days', async () => await has('90 days') && !(await has('Retired7')) && !(await has('Retired30')));
    await assert('usage missing zero estimated and actual stay distinct', async () => await evaluate(`(() => { const t=${scope}.innerText; return t.includes('Input tokens\\n0') && t.includes('Output tokens\\nUnavailable') && t.includes('Estimated cost\\n1.25') && t.includes('Actual cost\\n0'); })()`));
    const current7 = await read(() => select('Usage period', '7')); await resolve(current7, 'Current7');
    await assert('7/30/90 periods use exact finite request values', async () => { const values = await evaluate(`${q}.reads().filter(r=>r.page==='usage').map(r=>r.days)`); return [7,30,90].every(value => values.includes(value)); });
    const oldGeneration = await read(() => click('Refresh usage'));
    const newGeneration = await read(() => evaluate(`${q}.generation(),true`));
    await resolve(newGeneration, 'CurrentGeneration'); await resolve(oldGeneration, 'RetiredGeneration');
    await assert('held old generation cannot reappear', async () => await has('CurrentGeneration model') && !(await has('RetiredGeneration')));
    await capture('synthetic-wide-usage');
    await click('Projects'); const retiredEntry = await read(() => select('Agent', 'alpha'));
    await click('Scheduled'); await click('Projects'); const currentEntry = await read(() => select('Agent', 'alpha'));
    await resolve(currentEntry, 'Reentered'); await click('Reentered project'); await resolve(retiredEntry, 'RetiredSameKey');
    await assert('same-key page re-entry owns only its own promise', async () => await has('Reentered project') && !(await has('RetiredSameKey')));
    await quiet();
    const removed = await read(() => click('Refresh projects')); await resolve(removed, 'Removed', 'removed');
    await assert('removed selection clears with honest empty projects', async () => await has('No projects supplied.') && !(await has('Reentered project')));
    await evaluate(`${q}.catalog('empty'),true`); await sleep(80);
    await assert('empty catalog is reachable and refresh disabled', async () => await has('No agents are available on this computer.') && await evaluate(`${el('Refresh projects')}.getAttribute('aria-disabled')==='true'`));
    await evaluate(`${q}.catalog('both'),true`); await sleep(80);
    await assert('restored catalog does not silently restore removed profile', () => evaluate(`${el('Agent')}.value===''`));
    const unsupported = await read(() => select('Agent', 'alpha')); await resolve(unsupported, '', 'unsupported');
    await assert('unsupported reads are honest', () => has('This computer does not support this page.'));
    const failed = await read(() => click('Refresh projects')); await resolve(failed, '', 'failed');
    await assert('failed reads offer reachable refresh', async () => await has('This page is unavailable.') && await evaluate(`${el('Refresh projects')}.getAttribute('aria-disabled')!=='true'`));
    const beforeOffline = await read(() => click('Refresh projects')); await evaluate(`${q}.offline(),true`); await sleep(80); await resolve(beforeOffline, 'OfflineRetired');
    await assert('offline pending response cannot restore data', async () => await has('Connect to Hermes') && !(await has('OfflineRetired')) && await evaluate(`${el('Refresh projects')}.getAttribute('aria-disabled')==='true'`));
    const reconnect = await read(() => evaluate(`${q}.online(),true`)); await resolve(reconnect, 'Narrow');
    await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 780, deviceScaleFactor: 1, mobile: false }); await sleep(150);
    if (await evaluate(`Boolean(${el('Back')})`)) await click('Back');
    const beforeBack = await count();
    await evaluate(`${scope}.querySelector('[aria-label='+CSS.escape(${q}.longTitle)+']').click(),true`); await sleep(80);
    await assert('narrow function title is complete selectable text', () => evaluate(`Array.from(${scope}.querySelectorAll('[role=heading]')).some(e=>e.textContent===${q}.longTitle && getComputedStyle(e).userSelect==='text' && getComputedStyle(e).whiteSpace!=='nowrap')`));
    await capture('synthetic-narrow-project-detail'); await click('Back');
    await assert('narrow Back retains selection without a read', async () => await count() === beforeBack && await evaluate(`Boolean(${scope}.querySelector('[aria-current=true]'))`));
    await evaluate(`${el('Agent')}.focus(),true`); await key('Tab', 'Tab', 9);
    await assert('narrow function search is keyboard reachable after Back', () => evaluate(`document.activeElement===${el('Search projects')}`));
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(100);
    await click('Chats');
    await input('Message Synthetic Alpha', 'Synthetic protected draft');
    await evaluate(`globalThis.qualificationComposer=${el('Message Synthetic Alpha')},true`);
    for (const tab of ['Feed', 'Ideas', 'Goals', 'Files']) {
      const page = tab.toLowerCase();
      const index = tab === 'Files' ? null : await read(() => click(tab));
      if (index === null) await click(tab); else { await resolve(index, `Synthetic${tab}`); await click(`Synthetic${tab} ${page}`); }
      await assert(`${tab} retains hidden composer DOM and draft`, () => evaluate(`(() => { const e=${el('Message Synthetic Alpha')}; const p=e.closest('[hidden]'); return e===globalThis.qualificationComposer && e.value==='Synthetic protected draft' && p?.inert && p.getAttribute('aria-hidden')==='true' && getComputedStyle(p).display==='none'; })()`));
      await evaluate(`${el('Message Synthetic Alpha')}.focus(),true`);
      await assert(`${tab} hidden composer refuses focus`, () => evaluate(`document.activeElement!==globalThis.qualificationComposer`));
      const tree = await send('Accessibility.getFullAXTree');
      const nodes = tree.result?.nodes ?? [];
      await assert(`${tab} accessibility omits hidden editor`, async () => !nodes.some(node => !node.ignored && node.role?.value === 'textbox' && node.name?.value === 'Message Synthetic Alpha'));
      if (index !== null) {
        await assert(`${tab} exposes active board controls to accessibility`, async () => nodes.some(node => !node.ignored && node.name?.value === `Search ${page}`));
        await evaluate(`${el(`Refresh ${page}`)}.focus(),true`); await key('Tab', 'Tab', 9);
        await assert(`${tab} search is keyboard reachable`, () => evaluate(`document.activeElement===${el(`Search ${page}`)}`));
        await assert(`${tab} supplied adversarial text is inert and selectable`, () => evaluate(`(() => { const heading=${scope}.querySelector('[role=heading][aria-level="3"]'); return ${scope}.innerText.includes(${q}.hostile) && ${scope}.querySelectorAll('a,img,script,iframe').length===0 && !globalThis.fixtureExecuted && heading && getComputedStyle(heading).userSelect==='text'; })()`));
        await assert(`${tab} supplied unknown state unread and missing dates stay honest`, async () => await has('supplied unknown status') && await has('Unread') && await has('Unavailable'));
        await click('Synthetic missing metadata'); await assert(`${tab} missing fields stay unavailable`, () => has('Unavailable'));
        await click(`Synthetic${tab} ${page}`);
        await input(`Search ${page}`, 'no matching board item'); await assert(`${tab} actual search filters rows`, () => has('No matching items.')); await input(`Search ${page}`, '');
        await quiet(); await capture(`synthetic-wide-${page}`);
      } else await assert('Files remains honest unavailable', () => has('Files unavailable'));
      await click('Chat');
      await assert(`${tab} returns identical editor and draft`, () => evaluate(`${el('Message Synthetic Alpha')}===globalThis.qualificationComposer && globalThis.qualificationComposer.value==='Synthetic protected draft' && !globalThis.qualificationComposer.closest('[hidden]')`));
    }
    const retiredBoard = await read(() => click('Feed'));
    const otherBoard = await read(() => click('Ideas'));
    const currentBoard = await read(() => click('Feed'));
    await resolve(currentBoard, 'CurrentBoard'); await resolve(retiredBoard, 'RetiredBoard'); await resolve(otherBoard, 'RetiredIdeas');
    await assert('held board tab and same-key responses stay retired', async () => await has('CurrentBoard feed') && !(await has('RetiredBoard')) && !(await has('RetiredIdeas')));
    const oldBoardGeneration = await read(() => click('Refresh feed'));
    const newBoardGeneration = await read(() => evaluate(`${q}.generation(),true`));
    await resolve(newBoardGeneration, 'NewBoardGeneration'); await resolve(oldBoardGeneration, 'OldBoardGeneration');
    await assert('held board generation response stays retired', async () => await has('NewBoardGeneration feed') && !(await has('OldBoardGeneration')));
    await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 780, deviceScaleFactor: 1, mobile: false }); await sleep(100);
    const previousChatGeneration = await evaluate(`${q}.reads().at(-1).generation`);
    const reopenedBoard = await read(() => click('Synthetic chat, with Synthetic Alpha'));
    await resolve(reopenedBoard, 'NarrowBoard');
    await assert('narrow same-selected chat advances generation and opens detail', () => evaluate(`Boolean(${el('Feed board')}) && ${q}.calls().openChat===1 && ${q}.reads().at(-1).generation===${previousChatGeneration + 1}`));
    await evaluate(`${scope}.querySelector('[aria-label='+CSS.escape(${q}.longTitle)+']').click(),true`); await sleep(100);
    await assert('narrow board title is complete selectable text', () => evaluate(`Array.from(${scope}.querySelectorAll('[role=heading]')).some(e=>e.textContent===${q}.longTitle && getComputedStyle(e).userSelect==='text' && getComputedStyle(e).whiteSpace!=='nowrap')`));
    await capture('synthetic-narrow-feed-detail'); const boardCount = await count(); await click('Back to feed list');
    await assert('board local Back keeps selection without reloading', async () => await count() === boardCount && await evaluate(`Boolean(${scope}.querySelector('[aria-current=true]'))`));
    await evaluate(`${el('Refresh feed')}.focus(),true`); await key('Tab', 'Tab', 9);
    await assert('narrow board search is keyboard reachable after local Back', () => evaluate(`document.activeElement===${el('Search feed')}`));
    const narrowTree = await send('Accessibility.getFullAXTree');
    await assert('narrow board accessibility excludes hidden composer and exposes search', async () => {
      const nodes = narrowTree.result?.nodes ?? [];
      return !nodes.some(node => !node.ignored && node.role?.value==='textbox' && node.name?.value==='Message Synthetic Alpha') && nodes.some(node => !node.ignored && node.name?.value==='Search feed');
    });
    const boardEmpty = await read(() => click('Refresh feed')); await resolve(boardEmpty, '', 'empty'); await assert('board empty state is honest', () => has('No feed items supplied.'));
    const boardUnsupported = await read(() => click('Refresh feed')); await resolve(boardUnsupported, '', 'unsupported'); await assert('board unsupported state is honest', () => has('This computer does not support this page.'));
    const boardFailed = await read(() => click('Refresh feed')); await resolve(boardFailed, '', 'failed'); await assert('board failure offers retry', () => has('Refresh to try again.'));
    await evaluate(`${q}.offline(),true`); await sleep(80); await assert('board offline refresh is disabled', () => evaluate(`${el('Refresh feed')}.getAttribute('aria-disabled')==='true'`));
    await assert('browsing sends no new/canonical/send/board mutation or other operations', () => evaluate(`(() => { const c=${q}.calls(); return c.send===0 && c.newChat===0 && c.canonicalChat===0 && c.boardMutation===0 && c.other===0 && c.draft>0; })()`));
    check('synthetic UI evidence only (no host or physical input qualification)', true, `${await count()} explicitly controlled finite workspace reads`);
  } finally {
    await evaluate(`(() => { try { (window.workspaceQualificationCleanup ?? ${q}?.cleanup)?.(); } finally { delete globalThis.qualificationComposer; } return true; })()`);
    check('synthetic UI root and controller removed', await evaluate(`!document.getElementById('workspace-qualification') && !window.workspaceQualification && !window.workspaceQualificationCleanup && JSON.stringify((() => { const e=document.getElementById('root'); return e ? [e.getAttribute('hidden'),e.getAttribute('inert')] : null; })())===${JSON.stringify(originalState)}`));
  }
}
