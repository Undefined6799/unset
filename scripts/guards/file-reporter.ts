// node:test reporter that emits the source file of every real test result,
// so run-tests.ts can prove every discovered file actually executed tests.
// The runner also reports one synthetic result per file, named after the file
// itself; it passes even for a file that defines no tests, so it is skipped.
type TestEvent = { type: string; data: { file?: string; name?: string } };

export default async function* fileReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  for await (const { type, data } of source) {
    if (type !== "test:pass" && type !== "test:fail") continue;
    if (!data.file || !data.name || data.file.endsWith(data.name)) continue;
    yield `${data.file}\n`;
  }
}
