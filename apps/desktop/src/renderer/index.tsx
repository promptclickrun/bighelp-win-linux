import { createRoot } from 'react-dom/client';
import { App } from '../../../../packages/ui/App.tsx';
import { SAMPLE_DATA } from '../../../../packages/ui/fixtures.ts';
import { EMPTY_DATA } from '../../../../packages/ui/view-model.ts';
import { parseShellInfo } from '../shared/shell-info.ts';

// The preload's frozen description is the only outside input. Validate it.
const info = parseShellInfo((globalThis as { bighelpShell?: unknown }).bighelpShell);
const host = document.getElementById('root');
if (!host) throw new Error('Missing root element');
document.documentElement.dataset.platform = info.platform;
if (info.fixturePreview) document.title = 'bighelp (sample data)';
createRoot(host).render(<App data={info.fixturePreview ? SAMPLE_DATA : EMPTY_DATA} platform={info.platform} />);
