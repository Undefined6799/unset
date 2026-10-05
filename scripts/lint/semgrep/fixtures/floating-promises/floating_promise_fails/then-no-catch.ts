// Must fail: .then(f) with no rejection handler.
declare const p: Promise<number>;
declare const f: (n: number) => void;

p.then(f);
