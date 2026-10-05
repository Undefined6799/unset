// Must pass: plain (non-async) functions and callbacks, called the ways the product code calls them.
const parse = (text: string): string[] => {
  return text.split(",");
};
const twice = (n: number): number => n * 2;
declare const tail: string | undefined;
declare const items: number[];

parse("a,b");
twice(1);
const right = tail === undefined ? [] : parse(tail);
items.forEach((n) => {
  twice(n);
});
export const kept = [right];
