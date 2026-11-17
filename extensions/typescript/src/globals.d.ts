// The embedded runtime provides console, but nothing else from browsers or Node.js.
declare const console: { log(...data: unknown[]): void; error(...data: unknown[]): void };
