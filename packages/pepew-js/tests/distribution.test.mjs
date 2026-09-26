import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

test("pepew-js package metadata is public-release ready", async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "@pepepow/pepew-js");
  assert.match(manifest.version, /^0\.\d+\.\d+$/);
  assert.equal(manifest.private, false);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.publishConfig?.access, "public");
  assert.equal(manifest.publishConfig?.registry, "https://registry.npmjs.org/");
  assert.equal(manifest.engines.node, ">=20");
  assert.deepEqual(manifest.files, ["dist"]);
  assert.equal(manifest.repository?.directory, "packages/pepew-js");
});

test("packed pepew-js installs and imports in a clean Node consumer", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "pepew-js-pack-"));
  t.after(async () => rm(scratch, { recursive: true, force: true }));

  const [packed] = JSON.parse(run(
    npmCommand,
    ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch],
    { cwd: packageRoot },
  ));
  const paths = new Set(packed.files.map((entry) => entry.path));
  for (const required of ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts"]) {
    assert.ok(paths.has(required), required);
  }
  assert.equal([...paths].some((path) => path.startsWith("src/")), false);
  assert.equal([...paths].some((path) => path.startsWith("tests/")), false);

  const consumer = join(scratch, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run(npmCommand, [
    "install", "--ignore-scripts", "--no-audit", "--no-fund",
    "--package-lock=false", join(scratch, packed.filename),
  ], { cwd: consumer });

  const smoke = [
    'import { formatPaymentUri } from "@pepepow/pepew-js";',
    'const value = formatPaymentUri({ address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb", amount: "1" });',
    'if (!value.includes("amount=1")) process.exit(1);',
  ].join("\n");
  run(process.execPath, ["--input-type=module", "--eval", smoke], { cwd: consumer });
});
