import { createRoot } from 'react-dom/client';
import { App, ConnectedApp } from '../../../../packages/ui/App.tsx';
import type { DesktopApi } from '../shared/desktop-api.ts';
declare const __BIGHELP_FIXTURES__: boolean;
import { EMPTY_DATA } from '../../../../packages/ui/view-model.ts';
import { parseShellInfo } from '../shared/shell-info.ts';

// The preload's frozen description is the only outside input. Validate it.
const info = parseShellInfo((globalThis as { bighelpShell?: unknown }).bighelpShell);
const host = document.getElementById('root');
if (!host) throw new Error('Missing root element');
document.documentElement.dataset.platform = info.platform;
if (info.fixturePreview) document.title = 'bighelp (sample data)';
const root = createRoot(host);
if (__BIGHELP_FIXTURES__ && info.fixturePreview) {
  void import('../../../../packages/ui/fixtures.ts').then(({ SAMPLE_DATA }) => root.render(<App data={SAMPLE_DATA} platform={info.platform} shell={info} />));
} else {
  const api = (globalThis as { bighelpDesktop?: DesktopApi }).bighelpDesktop;
  root.render(api ? <ConnectedApp api={api} platform={info.platform} shell={info} /> : <App data={EMPTY_DATA} platform={info.platform} shell={info} />);
}
