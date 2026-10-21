import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";

const repo = join(import.meta.dirname, "../..");
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function put(root: string, path: string, data: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), data);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pds-config-")),
    inputs = join(root, "inputs"),
    source = join(root, "source");
  const registry: { files: string[]; roots: string[] } = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures/local-inputs.json"), "utf8"),
  );
  for (const path of registry.files) put(inputs, path, readFileSync(join(repo, path), "utf8"));
  for (const path of registry.roots)
    cpSync(join(repo, path), join(inputs, path), {
      recursive: true,
      filter: (p) => lstatSync(p).isDirectory() || (/\.(?:tsx?|css)$/.test(p) && !/\.test\.tsx?$/.test(p)),
    });
  put(source, "package.json", "{}\n");
  put(source, "packages/oauth/oauth-provider-ui/package.json", '{"type":"module"}\n');
  const digest = () => {
    const rows: [string, string][] = [];
    const visit = (path: string) => {
      for (const name of readdirSync(join(inputs, path))) {
        const child = path ? `${path}/${name}` : name;
        if (lstatSync(join(inputs, child)).isDirectory()) visit(child);
        else rows.push([child, hash(readFileSync(join(inputs, child)))]);
      }
    };
    visit("");
    return hash(
      `${JSON.stringify(
        rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        null,
        2,
      )}\n`,
    );
  };
  const run = (command = "prepare", expected = digest(), extra: string[] = []) =>
    spawnSync(
      process.execPath,
      [
        join(inputs, "deployment/pds/build-ui.mjs"),
        "--",
        command,
        inputs,
        expected,
        source,
        join(root, "state.json"),
        ...extra,
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, NODE_OPTIONS: "" } },
    );
  return { root, inputs, source, digest, run };
}
test("supplemental_graph_accepts_scoped_baseui_and_rejects_foreign_react_ids", () => {
  const f = fixture(),
    config = join(f.root, "config/pds-vite.mjs");
  try {
    put(
      f.source,
      "packages/oauth/oauth-provider-ui/vite.config.js",
      `export default { base: '/native/', resolve: { alias: {'#':'native-src'}, conditions:['browser','import'] }, plugins:[{name:'original-native'}], build:{rolldownOptions:{input:['one','two','three','four']}} };\n`,
    );
    put(f.source, "packages/oauth/oauth-provider-ui/tsconfig.json", "{}\n");
    expect(f.run().status).toBe(0);
    for (const [name, version] of [
      ["react", "19.3.0"],
      ["react-dom", "19.3.0"],
      ["vite", "8.3.1"],
    ]) {
      put(f.source, `node_modules/${name}/package.json`, JSON.stringify({ name, version, main: "index.js" }));
      for (const file of name === "react"
        ? ["index.js", "jsx-runtime.js", "jsx-dev-runtime.js"]
        : ["index.js", "client.js"])
        put(f.source, `node_modules/${name}/${file}`, "module.exports = {};\n");
    }
    put(f.source, "node_modules/@base-ui/react/index.js", "module.exports = {};\n");
    put(f.source, "node_modules/foreign/node_modules/react/index.js", "module.exports = {};\n");
    const generated = f.run("configure", f.digest(), [config]);
    expect(generated.stderr).toBe("");
    expect(generated.status).toBe(0);
    const script = `
    const {default:config}=await import(process.argv[1]);
    const plugin=config.plugins.at(-1);
    const {realpathSync,readFileSync}=await import('node:fs');
    const root=realpathSync(process.argv[2]),local=realpathSync(process.argv[3]);
    const modules=['react/index.js','react-dom/client.js','@base-ui/react/index.js'].map(p=>root+'/node_modules/'+p);
    plugin.generateBundle.call({getModuleIds:()=>modules});
    let refused=false;try{plugin.generateBundle.call({getModuleIds:()=>[...modules,root+'/node_modules/foreign/node_modules/react/index.js']});}catch{refused=true;}
    let toolingRefused=false;try{plugin.generateBundle.call({getModuleIds:()=>[...modules,local+'/deployment/pds/build-ui.mjs']});}catch{toolingRefused=true;}
    process.stdout.write(JSON.stringify({refused,toolingRefused,nativeTsconfig:config.tsconfig===root+'/packages/oauth/oauth-provider-ui/tsconfig.json'}));
  `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, config, f.source, f.inputs], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: f.root, NODE_OPTIONS: "" },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const actual = JSON.parse(result.stdout);
    expect(actual.refused).toBe(true);
    expect(actual.toolingRefused).toBe(true);
    expect(actual.nativeTsconfig).toBe(true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("oversized_selected_input_fails_before_source_preparation", () => {
  const f = fixture();
  try {
    const before = readFileSync(join(f.source, "package.json"));
    put(f.inputs, "apps/pds/index.ts", "x".repeat(1024 * 1024 + 1));
    expect(f.run().status).not.toBe(0);
    expect(readFileSync(join(f.source, "package.json"))).toEqual(before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
