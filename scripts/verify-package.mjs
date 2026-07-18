import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "weread-pack-"));
const tarball = join(temporaryDirectory, "package.tgz");

try {
  run("pnpm", ["--config.ignore-scripts=true", "pack", "--out", tarball, "--json"]);
  run("tar", ["-xzf", tarball, "-C", temporaryDirectory]);

  const packageRoot = join(temporaryDirectory, "package");
  const files = (await walk(packageRoot, packageRoot)).sort();
  const expected = [
    "LICENSE",
    "README.md",
    "README.zh-CN.md",
    "dist/cli.js",
    "dist/cli.js.map",
    "package.json",
  ];
  assert(JSON.stringify(files) === JSON.stringify(expected), `Unexpected package files: ${files.join(", ")}`);

  const packedManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert(packedManifest.name === "@psycharch/weread", `Unexpected package name: ${packedManifest.name}`);
  assert(packedManifest.version === manifest.version, "Packed version does not match package.json.");
  assert(packedManifest.bin?.weread === "dist/cli.js", "Packed binary mapping is invalid.");

  const cli = await readFile(join(packageRoot, "dist/cli.js"), "utf8");
  assert(cli.startsWith("#!/usr/bin/env node\n"), "Packed CLI is missing its Node shebang.");

  const sourceMap = JSON.parse(await readFile(join(packageRoot, "dist/cli.js.map"), "utf8"));
  assert(Array.isArray(sourceMap.sources), "Packed source map has no sources list.");
  assert(
    sourceMap.sources.every((source) => typeof source === "string" && !source.startsWith("/") && !source.includes("node_modules") && !source.includes(".env")),
    "Packed source map leaks an absolute, dependency, or environment path.",
  );

  for (const path of files.filter((file) => /\.(?:js|json|map|md)$/.test(file))) {
    const content = await readFile(join(packageRoot, path), "utf8");
    assert(!/(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)/.test(content), `${path} contains a local machine path.`);
    assert(!/wrk-[A-Za-z0-9_-]{12,}/.test(content), `${path} contains an API-key-shaped value.`);
  }

  console.log(`Verified ${manifest.name}@${manifest.version}: ${files.length} packed files, no local paths or API keys.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
}

async function walk(directory, base) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path, base));
    else files.push(relative(base, path));
  }
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
