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

test("merchant package metadata keeps public release gated", async () => {
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );

  assert.equal(manifest.name, "@pepepow/pepewpay-merchant");
  assert.match(manifest.version, /^0\.\d+\.\d+$/);
  assert.equal(manifest.private, true);
  assert.equal(manifest.publishConfig?.access, "public");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.main, "./dist/index.js");
  assert.equal(manifest.types, "./dist/index.d.ts");
  assert.deepEqual(manifest.files, ["dist"]);
  assert.equal(manifest.engines.node, ">=20");
  assert.equal(manifest.sideEffects, false);
  assert.equal(
    manifest.repository?.directory,
    "packages/pepewpay-merchant",
  );
});

test("packed merchant SDK installs and imports in a clean Node consumer", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "pepewpay-merchant-pack-"));
  t.after(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  const packOutput = run(
    npmCommand,
    ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch],
    { cwd: packageRoot },
  );
  const [packed] = JSON.parse(packOutput);
  assert.ok(packed?.filename);

  const paths = new Set(packed.files.map((entry) => entry.path));
  assert.ok(paths.has("package.json"));
  assert.ok(paths.has("README.md"));
  assert.ok(paths.has("dist/index.js"));
  assert.ok(paths.has("dist/index.d.ts"));
  assert.equal([...paths].some((path) => path.startsWith("src/")), false);
  assert.equal([...paths].some((path) => path.startsWith("tests/")), false);

  const consumer = join(scratch, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );

  const tarball = join(scratch, packed.filename);
  run(
    npmCommand,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarball,
    ],
    { cwd: consumer },
  );

  const smoke = [
    'import { buildCheckoutUrl } from "@pepepow/pepewpay-merchant";',
    'const value = buildCheckoutUrl("pay_abcdefgh");',
    'if (value !== "https://pay.pepepow.net/?payment_id=pay_abcdefgh") process.exit(1);',
  ].join("\n");

  run(process.execPath, ["--input-type=module", "--eval", smoke], {
    cwd: consumer,
  });
});
