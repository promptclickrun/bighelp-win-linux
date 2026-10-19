// A finite host call the renderer may request. Each feature declares its calls in
// shared/calls/<feature>.ts: a parser that main runs again on every request, and
// the result type main promises to return. Results are validated plain data.

export type CallDefinition<Input, Output> = Readonly<{
  parse: (input: unknown) => Input;
  // Type-only marker; never set at runtime.
  output?: Output;
}>;

export function defineCall<Output>() {
  return <Input>(parse: (input: unknown) => Input): CallDefinition<Input, Output> => Object.freeze({ parse });
}

// What a person can act on. Messages are plain words, never raw host errors.
export type CallFailure = Readonly<{
  ok: false;
  code: 'unsupported' | 'invalid' | 'conflict' | 'unknown' | 'unavailable' | 'denied' | 'stale';
  message: string;
}>;
