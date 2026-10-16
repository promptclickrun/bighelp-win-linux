// Automatic reconnect for the saved computer after an unexpected disconnect.
// It only reconnects: reopening a chat uses session.resume, and nothing a person
// sent is ever resent (send journals keep unknown outcomes unknown).
export const RECONNECT_DELAYS_MS: readonly number[] = Object.freeze([1000, 2000, 5000, 10000, 30000, 60000]);

export type ReconnectState = Readonly<{
  // idle: not reconnecting. waiting: the next try is scheduled. trying: a try is
  // running. signIn: stopped because the sign-in no longer works.
  state: 'idle' | 'waiting' | 'trying' | 'signIn'; delaySeconds: number;
}>;
// retry: try again later. signIn: stop and ask the person. connected/stop: done.
export type ReconnectResult = 'connected' | 'retry' | 'signIn' | 'stop';
export type ReconnectTimers = Readonly<{ set(callback: () => void, milliseconds: number): unknown; clear(handle: unknown): void }>;

const IDLE: ReconnectState = Object.freeze({ state: 'idle', delaySeconds: 0 });
// Unreferenced: a pending retry never keeps a process alive on its own.
const SYSTEM_TIMERS: ReconnectTimers = Object.freeze({
  set(callback: () => void, milliseconds: number) {
    const handle = setTimeout(callback, milliseconds);
    handle.unref?.();
    return handle;
  },
  clear(handle: unknown) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
});

export function createReconnector(options: Readonly<{
  attempt(): Promise<ReconnectResult>;
  onChange(state: ReconnectState): void;
  timers?: ReconnectTimers | undefined;
}>) {
  const timers = options.timers ?? SYSTEM_TIMERS;
  let state: ReconnectState = IDLE, epoch = 0, index = 0, timer: unknown = null;
  function set(next: ReconnectState): void {
    state = next;
    try { options.onChange(next); } catch { /* A view update cannot stop reconnecting. */ }
  }
  function cancelTimer(): void { if (timer !== null) { timers.clear(timer); timer = null; } }
  function schedule(captured: number): void {
    const delay = RECONNECT_DELAYS_MS[Math.min(index, RECONNECT_DELAYS_MS.length - 1)] ?? 60000;
    index++;
    timer = timers.set(() => { timer = null; if (captured === epoch) void run(captured); }, delay);
    set(Object.freeze({ state: 'waiting', delaySeconds: Math.round(delay / 1000) }));
  }
  async function run(captured: number): Promise<void> {
    if (captured !== epoch) return;
    set(Object.freeze({ state: 'trying', delaySeconds: 0 }));
    let result: ReconnectResult;
    try { result = await options.attempt(); } catch { result = 'retry'; }
    if (captured !== epoch) return;
    if (result === 'retry') schedule(captured);
    else if (result === 'signIn') { epoch++; index = 0; set(Object.freeze({ state: 'signIn', delaySeconds: 0 })); }
    else { epoch++; index = 0; set(IDLE); }
  }
  return Object.freeze({
    get state(): ReconnectState { return state; },
    // Begin after an unexpected disconnect or a failed automatic connect.
    start(): void {
      if (state.state === 'waiting' || state.state === 'trying') return;
      epoch++; index = 0; cancelTimer(); schedule(epoch);
    },
    // The person disconnected, forgot the computer, or connected another way.
    stop(): void {
      epoch++; index = 0; cancelTimer();
      if (state.state !== 'idle') set(IDLE);
    },
    // Stop retrying until the person signs in again.
    requireSignIn(): void {
      epoch++; index = 0; cancelTimer();
      set(Object.freeze({ state: 'signIn', delaySeconds: 0 }));
    },
    // "Try now", waking from sleep, or the network coming back. Only while waiting:
    // never after the person pressed Disconnect.
    now(): boolean {
      if (state.state !== 'waiting') return false;
      cancelTimer(); void run(epoch); return true;
    },
  });
}
