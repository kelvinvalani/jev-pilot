#!/usr/bin/env node
/**
 * Static checks for the unpacked extension: JS syntax, manifest shape,
 * referenced files, and that every API endpoint has a host permission.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const problems = [];

function fail(message) {
  problems.push(message);
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel.split("?")[0]));
}

const jsFiles = ["background.js", "content.js", "launcher.js", "popup.js", "scripts/check.js"];
for (const dir of ["test", "test/helpers", "test/fixtures"]) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs)) {
    if (name.endsWith(".js")) jsFiles.push(path.join(dir, name));
  }
}
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
  } catch (err) {
    fail("Syntax error in " + file + ":\n" + String(err.stderr || err.message));
  }
}

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
} catch (err) {
  fail("manifest.json is not valid JSON: " + err.message);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail("manifest_version must be 3.");
  const refs = [];
  if (manifest.background && manifest.background.service_worker) refs.push(manifest.background.service_worker);
  if (manifest.action && manifest.action.default_popup) refs.push(manifest.action.default_popup);
  for (const icon of Object.values(manifest.icons || {})) refs.push(icon);
  for (const icon of Object.values((manifest.action && manifest.action.default_icon) || {})) refs.push(icon);
  for (const script of manifest.content_scripts || []) refs.push(...(script.js || []), ...(script.css || []));
  for (const entry of manifest.web_accessible_resources || []) refs.push(...(entry.resources || []));
  for (const ref of refs) {
    if (!exists(ref)) fail("manifest.json references missing file: " + ref);
  }

  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const endpoints = background.match(/https:\/\/api\.[a-z0-9.-]+\/[^"'\s]*/g) || [];
  const hosts = manifest.host_permissions || [];
  for (const endpoint of new Set(endpoints)) {
    const origin = new URL(endpoint).origin;
    if (!hosts.some((pattern) => pattern.startsWith(origin))) {
      fail("No host_permissions entry covers " + endpoint);
    }
  }

  const perms = new Set(manifest.permissions || []);
  for (const needed of ["scripting", "storage", "activeTab"]) {
    if (!perms.has(needed)) fail("Missing permission: " + needed);
  }
}

if (problems.length) {
  console.error(problems.map((p) => "✗ " + p).join("\n"));
  process.exit(1);
}
console.log("✓ " + jsFiles.length + " JS files parse, manifest.json is valid, all referenced files exist.");
