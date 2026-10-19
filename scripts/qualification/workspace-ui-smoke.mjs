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
  const exists = label => evaluate(`Boolean(${el(label)})`);
  const disabled = label => evaluate(`${el(label)}?.getAttribute('aria-disabled')==='true'`);
  const click = async label => {
    await wait(() => exists(label), `control ${label}`);
    await evaluate(`${el(label)}.click(), true`); await sleep(60);
  };
  const select = async (label, value) => { await evaluate(`(() => { const e=${el(label)}; e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`); await sleep(60); };
  const input = async (label, value) => { await evaluate(`${el(label)}.focus(), ${el(label)}.select(), true`); await send('Input.insertText', { text: value }); await sleep(60); };
  const count = () => evaluate(`${q}.reads().length`);
  // Exactly these held reads (any order) for one intentional load; their indices by label.
  const reads = async (action, expected) => {
    const before = await count(); await action();
    await wait(async () => await count() >= before + expected.length, expected.join(' + '));
    await sleep(80);
    const added = await evaluate(`${q}.reads().slice(${before}).map(r => r.label)`);
    await assert(`one request per intentional load (${expected.join(' + ')})`, async () => added.length === expected.length
      && [...added].sort().join() === [...expected].sort().join());
    return Object.fromEntries(added.map((label, offset) => [label, before + offset]));
  };
  const read = async (action, label) => (await reads(action, [label]))[label];
  const resolve = async (index, marker, mode = 'loaded') => { await evaluate(`${q}.resolve(${index},${JSON.stringify(marker)},${JSON.stringify(mode)}),true`); await sleep(80); };
  const quiet = async () => { const before = await count(); for (let i = 0; i < 4; i++) await evaluate(`${q}.churn(),true`); await sleep(200); await assert('snapshot revisions and callback churn do not reload', async () => await count() === before); };
  const key = async (key, code, windowsVirtualKeyCode) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode }); };
  // Host strings render as text only: no element or handler comes from them.
  const inert = () => evaluate(`${scope}.querySelectorAll('a,img,script,iframe,object,embed').length===0 && !globalThis.fixtureExecuted`);
  const unchanged = () => evaluate(`(() => { const c=${q}.calls(); return c.write===0 && c.send===0 && c.newChat===0 && c.canonicalChat===0 && c.other===0; })()`);
  const selectableHeading = text => evaluate(`Array.from(${scope}.querySelectorAll('[role=heading]')).some(e=>e.textContent===${text} && getComputedStyle(e).userSelect==='text' && getComputedStyle(e).whiteSpace!=='nowrap')`);
  const originalState = await evaluate(`JSON.stringify((() => { const e=document.getElementById('root'); return e ? [e.getAttribute('hidden'),e.getAttribute('inert')] : null; })())`);
  try {
    const injected = await send('Runtime.evaluate', { expression: bundle.outputFiles[0].text, returnByValue: true });
    if (injected.result?.exceptionDetails || injected.error) throw new Error('Synthetic fixture injection failed');
    await wait(() => evaluate(`Boolean(${el('Chats')})`), 'fixture mounted');
    const hostile = await evaluate(`${q}.hostile`);
    const longTitle = await evaluate(`${q}.longTitle`);

    // Projects: one finite projects.list call per agent choice or Refresh.
    await click('Projects');
    await assert('multiple profiles require explicit choice', () => has('Choose an agent to load this page.'));
    const oldProfile = await read(() => select('Agent', 'alpha'), 'projects.list');
    const newProfile = await read(() => select('Agent', 'beta'), 'projects.list');
    await assert('project reads name only the chosen agent', async () => await evaluate(`${q}.reads().slice(${oldProfile}).map(r=>r.profile).join()`) === 'alpha,beta');
    await resolve(newProfile, 'NewProfile'); await click('NewProfile project'); await resolve(oldProfile, 'RetiredProfile');
    await assert('held old profile cannot change new result or selection', async () => (await has('NewProfile project')) && !(await has('RetiredProfile')) && await evaluate(`${el('NewProfile project')}.getAttribute('aria-current')==='true'`));
    await assert('project detail stays plain, with no raw ID outside Nerd Mode', async () => await has('Current project') && await has('/synthetic/inert/path')
      && await has('Folders are on the computer running Hermes.') && !(await has('Project ID')));
    await input('Search projects', 'no matching synthetic row');
    await assert('project search filters actual rows', () => has('No matching rows.'));
    await input('Search projects', 'NewProfile');
    await assert('project search keeps only matching rows', async () => await exists('NewProfile project') && !(await exists(longTitle)));
    await quiet(); await input('Search projects', '');
    await assert('server markup and URL text stay inert', async () => await has(hostile) && await inert());
    await assert('loaded function retains one rail and approved 76/300 geometry', () => evaluate(`${scope}.querySelectorAll('[aria-label="Places"]').length===1 && ${scope}.querySelectorAll('[role=tablist]').length===0 && ${el('Places')}.getBoundingClientRect().width===76 && ${scope}.querySelector('[role=region][aria-label="Projects"]').getBoundingClientRect().width===300`));
    await capture('synthetic-wide-projects');
    const oldPage = await read(() => click('Refresh projects'), 'projects.list');
    await assert('refresh immediately hides old result', async () => await has('Loading projects…') && !(await has('NewProfile project')));

    // Scheduled: schedules.list, then the chosen task's runs and delivery places.
    await click('Scheduled');
    const scheduled = await read(() => select('Agent', 'alpha'), 'schedules.list');
    await resolve(scheduled, 'CurrentScheduled');
    const first = await reads(() => click('CurrentScheduled task'), ['schedules.runs', 'schedules.targets']);
    await resolve(oldPage, 'RetiredPage');
    await assert('held old page stays retired', async () => !(await has('RetiredPage')) && await has('CurrentScheduled task'));
    await assert('scheduled error, pause and last result stay as supplied', async () => await has('Needs a look') && await has('Paused')
      && await has('Had a problem') && await has('supplied <b>schedule</b> words') && await has('Loading recent runs…'));
    await assert('scheduled page says runs use AI credits', () => has("Runs use AI credits on your computer's model provider each time."));
    await assert('scheduled instructions stay inert', async () => await has(hostile) && await inert());
    const second = await read(() => click('Synthetic missing result'), 'schedules.runs');
    await resolve(second, 'CurrentRuns'); await resolve(first['schedules.runs'], 'RetiredRuns'); await resolve(first['schedules.targets'], '');
    await assert('held runs of the previous task cannot appear under the current task', async () => await has('CurrentRuns run summary') && !(await has('RetiredRuns')));
    await assert('missing scheduled facts stay unknown, not invented', async () => await has('Unknown state') && await has('Not set yet') && await has('No runs yet')
      && await has('Time not recorded') && await has('Set up on the Hermes computer.') && await has('Saved on the Hermes computer'));
    await assert('host-managed task offers no Edit', async () => !(await exists('Edit Synthetic missing result')) && await exists('Delete Synthetic missing result'));
    await click('Run Synthetic missing result now');
    await assert('Run now asks first and names the AI credits', async () => await has('Run “Synthetic missing result” now?') && await has('uses AI credits'));
    await click('Cancel');
    await assert('cancelling Run now sends nothing', async () => !(await has('Run “Synthetic missing result” now?')) && await unchanged());
    await capture('synthetic-wide-scheduled');

    // Usage: the workspace action, one read per agent, period or Refresh.
    await click('Usage');
    const old30 = await read(() => select('Agent', 'alpha'), 'workspace:usage');
    const old7 = await read(() => select('Usage period', '7'), 'workspace:usage');
    const current90 = await read(() => select('Usage period', '90'), 'workspace:usage');
    await resolve(current90, 'Current90'); await click('Summary'); await resolve(old7, 'Retired7'); await resolve(old30, 'Retired30');
    await assert('held old periods cannot replace 90 days', async () => await has('90 days') && !(await has('Retired7')) && !(await has('Retired30')));
    await assert('usage missing zero estimated and actual stay distinct', async () => await evaluate(`(() => { const t=${scope}.innerText; return t.includes('Input tokens\\n0') && t.includes('Output tokens\\nUnavailable') && t.includes('Estimated cost\\n1.25') && t.includes('Actual cost\\n0'); })()`));
    const current7 = await read(() => select('Usage period', '7'), 'workspace:usage'); await resolve(current7, 'Current7');
    await assert('7/30/90 periods use exact finite request values', async () => { const values = await evaluate(`${q}.reads().filter(r=>r.page==='usage').map(r=>r.days)`); return [7,30,90].every(value => values.includes(value)); });
    const oldGeneration = await read(() => click('Refresh usage'), 'workspace:usage');
    const newGeneration = await read(() => evaluate(`${q}.generation(),true`), 'workspace:usage');
    await resolve(newGeneration, 'CurrentGeneration'); await resolve(oldGeneration, 'RetiredGeneration');
    await assert('held old generation cannot reappear', async () => await has('CurrentGeneration model') && !(await has('RetiredGeneration')));
    await capture('synthetic-wide-usage');

    // Projects again: re-entry, removal, catalog changes, honest failure states.
    await click('Projects'); const retiredEntry = await read(() => select('Agent', 'alpha'), 'projects.list');
    await click('Scheduled'); await click('Projects'); const currentEntry = await read(() => select('Agent', 'alpha'), 'projects.list');
    await resolve(currentEntry, 'Reentered'); await click('Reentered project'); await resolve(retiredEntry, 'RetiredSameKey');
    await assert('same-key page re-entry owns only its own promise', async () => await has('Reentered project') && !(await has('RetiredSameKey')));
    await quiet();
    const removed = await read(() => click('Refresh projects'), 'projects.list'); await resolve(removed, 'Removed', 'removed');
    await assert('removed selection clears with honest empty projects', async () => await has('No projects yet.') && !(await has('Reentered project')));
    await evaluate(`${q}.catalog('empty'),true`); await sleep(80);
    await assert('empty catalog is reachable and refresh disabled', async () => await has('No agents are available on this computer.') && await disabled('Refresh projects'));
    await evaluate(`${q}.catalog('both'),true`); await sleep(80);
    await assert('restored catalog does not silently restore removed profile', () => evaluate(`${el('Agent')}.value===''`));
    const unsupported = await read(() => select('Agent', 'alpha'), 'projects.list'); await resolve(unsupported, '', 'unsupported');
    await assert('unsupported reads are honest and hide New project', async () => await has("This computer's Hermes doesn't support projects.") && !(await exists('New project')));
    const failed = await read(() => click('Refresh projects'), 'projects.list'); await resolve(failed, '', 'failed');
    await assert('failed reads offer reachable refresh', async () => await has('Could not reach Hermes.') && await has('Refresh to try again.') && !(await disabled('Refresh projects')));
    const beforeOffline = await read(() => click('Refresh projects'), 'projects.list'); await evaluate(`${q}.offline(),true`); await sleep(80); await resolve(beforeOffline, 'OfflineRetired');
    await assert('offline pending response cannot restore data', async () => await has('Connect to Hermes') && !(await has('OfflineRetired')) && await disabled('Refresh projects'));
    const reconnect = await read(() => evaluate(`${q}.online(),true`), 'projects.list'); await resolve(reconnect, 'Online');
    await assert('connecting again reloads the chosen agent', () => has('Online project'));
    const oldLease = await read(() => click('Refresh projects'), 'projects.list');
    const newLease = await read(() => evaluate(`${q}.reconnect(),true`), 'projects.list');
    await resolve(newLease, 'Narrow'); await resolve(oldLease, 'OldLease');
    await assert('held reply from an old connection lease stays retired', async () => await has('Narrow project') && !(await has('OldLease'))
      && await evaluate(`(() => { const r=${q}.reads(); return r[${newLease}].connection===r[${oldLease}].connection+1; })()`));
    await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 780, deviceScaleFactor: 1, mobile: false }); await sleep(150);
    if (await exists('Back')) await click('Back');
    const beforeBack = await count();
    await click(longTitle);
    await assert('narrow function title is complete selectable text', () => selectableHeading(`${q}.longTitle`));
    await assert('archived project detail is honest about missing description and folder', async () => await has('Archived') && await has('No description')
      && await has('No folder.') && await exists(`Restore ${longTitle}`) && !(await exists(`Make ${longTitle} the current project`)));
    await capture('synthetic-narrow-project-detail'); await click('Back');
    await assert('narrow Back retains selection without a read', async () => await count() === beforeBack && await evaluate(`Boolean(${scope}.querySelector('[aria-current=true]'))`));
    await evaluate(`${el('Agent')}.focus(),true`); await key('Tab', 'Tab', 9);
    await assert('narrow function search is keyboard reachable after Back', () => evaluate(`document.activeElement===${el('Search projects')}`));
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(100);

    // Agent tabs keep the one composer node, hidden and inert, with its draft.
    await click('Chats');
    await input('Message Synthetic Alpha', 'Synthetic protected draft');
    await evaluate(`globalThis.qualificationComposer=${el('Message Synthetic Alpha')},true`);
    const hiddenComposer = async tab => {
      await assert(`${tab} retains hidden composer DOM and draft`, () => evaluate(`(() => { const e=${el('Message Synthetic Alpha')}; const p=e.closest('[hidden]'); return e===globalThis.qualificationComposer && e.value==='Synthetic protected draft' && p?.inert && p.getAttribute('aria-hidden')==='true' && getComputedStyle(p).display==='none'; })()`));
      await evaluate(`${el('Message Synthetic Alpha')}.focus(),true`);
      await assert(`${tab} hidden composer refuses focus`, () => evaluate(`document.activeElement!==globalThis.qualificationComposer`));
      const tree = await send('Accessibility.getFullAXTree');
      const nodes = tree.result?.nodes ?? [];
      await assert(`${tab} accessibility omits hidden editor`, async () => !nodes.some(node => !node.ignored && node.name?.value === 'Message Synthetic Alpha'));
      return nodes;
    };
    const backToChat = async tab => {
      await click('Chat');
      await assert(`${tab} returns identical editor and draft`, () => evaluate(`${el('Message Synthetic Alpha')}===globalThis.qualificationComposer && globalThis.qualificationComposer.value==='Synthetic protected draft' && !globalThis.qualificationComposer.closest('[hidden]')`));
      // The control for the hidden-editor checks: the shown editor is in the tree.
      const shown = (await send('Accessibility.getFullAXTree')).result?.nodes ?? [];
      await assert(`${tab} accessibility exposes the editor again on Chat`, async () => shown.some(node => !node.ignored && node.name?.value === 'Message Synthetic Alpha'));
    };
    for (const tab of ['Feed', 'Ideas', 'Goals']) {
      const page = tab.toLowerCase();
      const title = `Synthetic${tab} ${page}`;
      const index = await read(() => click(tab), `workspace:${page}`);
      await resolve(index, `Synthetic${tab}`); await click(title);
      const nodes = await hiddenComposer(tab);
      await assert(`${tab} exposes active board controls to accessibility`, async () => nodes.some(node => !node.ignored && node.name?.value === `Search ${page}`));
      await evaluate(`${el(`Refresh ${page}`)}.focus(),true`); await key('Tab', 'Tab', 9);
      await assert(`${tab} search is keyboard reachable`, () => evaluate(`document.activeElement===${el(`Search ${page}`)}`));
      await assert(`${tab} supplied adversarial text is inert and selectable`, async () => await has(hostile) && await inert() && await selectableHeading(JSON.stringify(title)));
      await assert(`${tab} supplied unknown state unread and missing dates stay honest`, async () => await has('supplied unknown status') && await has('Unread') && await has('Unavailable'));
      await assert(`${tab} opening an unread item writes nothing and hides feedback-only actions`, async () => await unchanged() && await exists(`Actions for ${title}`)
        && !(await exists('Thumbs down')) && !(await exists('Mark as read')) && !(await exists('Turn into a goal')));
      await click('Synthetic missing metadata'); await assert(`${tab} missing fields stay unavailable`, () => has('Unavailable'));
      await click(title);
      await input(`Search ${page}`, 'no matching board item'); await assert(`${tab} actual search filters rows`, () => has('No matching items.')); await input(`Search ${page}`, '');
      await quiet(); await capture(`synthetic-wide-${page}`);
      await backToChat(tab);
    }

    // Files: files.recent, files.preview and media.list, read-only.
    const recent = await read(() => click('Files'), 'files.recent');
    await assert('Files says it is looking, not empty', () => has('Finding the working folder…'));
    await hiddenComposer('Files');
    await resolve(recent, 'SyntheticFiles', 'foreign');
    await assert('Files says whose working folder it shows', async () => await has('Showing Synthetic Beta’s files') && await has('Made or changed lately'));
    await assert('Files lists supplied names as inert text with unknown dates unknown', async () => await has(await evaluate(`${q}.hostileFile`)) && await has('SyntheticFiles summary.txt')
      && await has('1.2 KB') && await has('Unknown size') && await has('in reports') && await inert());
    const preview = await read(() => click('notes.md'), 'files.preview');
    await assert('a file preview says it is opening', () => has('Opening file…'));
    await resolve(preview, 'SyntheticPreview');
    await assert('file preview text stays inert and says it is partial', async () => await has(`SyntheticPreview preview: ${hostile}`) && await inert()
      && await has('Showing the first part of this file.') && await exists('Save a copy of notes.md on this computer'));
    const held = await reads(() => click('Refresh files'), ['files.recent', 'files.preview']);
    const fresh = await reads(() => click('Refresh files'), ['files.recent', 'files.preview']);
    await resolve(fresh['files.recent'], 'FreshFiles', 'foreign'); await resolve(fresh['files.preview'], 'FreshPreview');
    await resolve(held['files.recent'], 'RetiredFiles'); await resolve(held['files.preview'], 'RetiredPreview');
    await assert('held file replies from before Refresh stay retired', async () => await has('FreshFiles summary.txt') && await has('FreshPreview preview')
      && !(await has('RetiredFiles')) && !(await has('RetiredPreview')));
    const media = await read(() => click('Media'), 'media.list');
    await assert('Media says it is loading', () => has('Loading media…'));
    await resolve(media, 'SyntheticMedia');
    const beforeVideo = await count(); await click('SyntheticMedia clip.mp4');
    await assert('a video opens without a preview read and says it cannot play here', async () => await has('Videos can be saved, but not played here yet.')
      && await count() === beforeVideo && await inert());
    await quiet(); await capture('synthetic-wide-files');
    await backToChat('Files');

    const retiredBoard = await read(() => click('Feed'), 'workspace:feed');
    const otherBoard = await read(() => click('Ideas'), 'workspace:ideas');
    const currentBoard = await read(() => click('Feed'), 'workspace:feed');
    await resolve(currentBoard, 'CurrentBoard'); await resolve(retiredBoard, 'RetiredBoard'); await resolve(otherBoard, 'RetiredIdeas');
    await assert('held board tab and same-key responses stay retired', async () => await has('CurrentBoard feed') && !(await has('RetiredBoard')) && !(await has('RetiredIdeas')));
    const oldBoardGeneration = await read(() => click('Refresh feed'), 'workspace:feed');
    const newBoardGeneration = await read(() => evaluate(`${q}.generation(),true`), 'workspace:feed');
    await resolve(newBoardGeneration, 'NewBoardGeneration'); await resolve(oldBoardGeneration, 'OldBoardGeneration');
    await assert('held board generation response stays retired', async () => await has('NewBoardGeneration feed') && !(await has('OldBoardGeneration')));
    await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 780, deviceScaleFactor: 1, mobile: false }); await sleep(100);
    const previousChatGeneration = await evaluate(`${q}.reads().at(-1).generation`);
    const reopenedBoard = await read(() => click('Synthetic chat, with Synthetic Alpha'), 'workspace:feed');
    await resolve(reopenedBoard, 'NarrowBoard');
    await assert('narrow same-selected chat advances generation and opens detail', () => evaluate(`Boolean(${el('Feed board')}) && ${q}.calls().openChat===1 && ${q}.reads().at(-1).generation===${previousChatGeneration + 1}`));
    await click(longTitle); await sleep(40);
    await assert('narrow board title is complete selectable text', () => selectableHeading(`${q}.longTitle`));
    await capture('synthetic-narrow-feed-detail'); const boardCount = await count(); await click('Back to feed list');
    await assert('board local Back keeps selection without reloading', async () => await count() === boardCount && await evaluate(`Boolean(${scope}.querySelector('[aria-current=true]'))`));
    await evaluate(`${el('Refresh feed')}.focus(),true`); await key('Tab', 'Tab', 9);
    await assert('narrow board search is keyboard reachable after local Back', () => evaluate(`document.activeElement===${el('Search feed')}`));
    const narrowTree = await send('Accessibility.getFullAXTree');
    await assert('narrow board accessibility excludes hidden composer and exposes search', async () => {
      const nodes = narrowTree.result?.nodes ?? [];
      return !nodes.some(node => !node.ignored && node.name?.value==='Message Synthetic Alpha') && nodes.some(node => !node.ignored && node.name?.value==='Search feed');
    });
    const boardEmpty = await read(() => click('Refresh feed'), 'workspace:feed'); await resolve(boardEmpty, '', 'empty'); await assert('board empty state is honest', () => has('No feed items supplied.'));
    const boardUnsupported = await read(() => click('Refresh feed'), 'workspace:feed'); await resolve(boardUnsupported, '', 'unsupported'); await assert('board unsupported state is honest', () => has('This computer does not support this page.'));
    const boardFailed = await read(() => click('Refresh feed'), 'workspace:feed'); await resolve(boardFailed, '', 'failed'); await assert('board failure offers retry', () => has('Refresh to try again.'));
    await evaluate(`${q}.offline(),true`); await sleep(80); await assert('board offline refresh is disabled', () => disabled('Refresh feed'));
    const calls = await evaluate(`${q}.calls()`);
    const writes = await evaluate(`${q}.writes()`);
    check('synthetic UI: browsing sends no message, new/canonical chat, write or other operation',
      calls.send === 0 && calls.newChat === 0 && calls.canonicalChat === 0 && calls.write === 0 && calls.other === 0 && calls.draft > 0,
      writes.length ? `refused writes: ${writes.join(', ')}` : '');
    if (writes.length || calls.send || calls.newChat || calls.canonicalChat || calls.other) throw new Error('Synthetic interaction assertion: browsing changed something');
    const incidental = await evaluate(`${q}.incidental()`);
    check('synthetic UI evidence only (no host or physical input qualification)', true,
      `${await count()} explicitly controlled finite reads; other shell reads answered as unsupported: ${incidental.join(', ') || 'none'}`);
  } finally {
    await evaluate(`(() => { try { (window.workspaceQualificationCleanup ?? ${q}?.cleanup)?.(); } finally { delete globalThis.qualificationComposer; } return true; })()`);
    check('synthetic UI root and controller removed', await evaluate(`!document.getElementById('workspace-qualification') && !window.workspaceQualification && !window.workspaceQualificationCleanup && JSON.stringify((() => { const e=document.getElementById('root'); return e ? [e.getAttribute('hidden'),e.getAttribute('inert')] : null; })())===${JSON.stringify(originalState)}`));
  }
}
