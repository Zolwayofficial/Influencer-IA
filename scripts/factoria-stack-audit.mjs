#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, "true");
    }
  }
}

const root = path.resolve(args.get("root") || process.cwd());
const stackFile = path.join(root, "docs/stack.md");
const includeShadow = args.get("shadow") !== "false";
const sourceDirs = (args.get("src") || "src,lib,app,packages").split(",").map((s) => s.trim()).filter(Boolean);

if (!fs.existsSync(stackFile)) {
  console.log(JSON.stringify({
    status: "fail",
    failures: ["docs/stack.md missing. Run install or initialize FactorIA first."],
  }, null, 2));
  process.exit(1);
}

const stackText = fs.readFileSync(stackFile, "utf8").toLowerCase();

function declared(name) {
  const lower = name.toLowerCase();
  if (!lower) return false;
  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9_-])${escaped}([^a-z0-9_-]|$)`);
  return re.test(stackText);
}

const installed = new Map();

const pkgPath = path.join(root, "package.json");
if (fs.existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    for (const dep of [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {}), ...Object.keys(pkg.peerDependencies || {})]) {
      if (!installed.has(dep)) installed.set(dep, "package.json");
    }
  } catch (err) {
    // ignore parse error
  }
}

const reqPath = path.join(root, "requirements.txt");
if (fs.existsSync(reqPath)) {
  const lines = fs.readFileSync(reqPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const name = trimmed.split(/[<>=!~\[]/)[0].trim();
    if (name && !installed.has(name)) installed.set(name, "requirements.txt");
  }
}

const pyProjectPath = path.join(root, "pyproject.toml");
if (fs.existsSync(pyProjectPath)) {
  const text = fs.readFileSync(pyProjectPath, "utf8");
  const sections = text.split(/^\[/m);
  for (const section of sections) {
    if (/^[^\]]*dependencies/i.test(section)) {
      const lines = section.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_\-.]+)\s*=/);
        if (match && match[1] && !["python"].includes(match[1].toLowerCase())) {
          if (!installed.has(match[1])) installed.set(match[1], "pyproject.toml");
        }
      }
    }
  }
}

const cargoPath = path.join(root, "Cargo.toml");
if (fs.existsSync(cargoPath)) {
  const text = fs.readFileSync(cargoPath, "utf8");
  const sections = text.split(/^\[/m);
  for (const section of sections) {
    if (/^(dependencies|dev-dependencies|build-dependencies)/i.test(section)) {
      const lines = section.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_\-.]+)\s*=/);
        if (match && match[1]) {
          if (!installed.has(match[1])) installed.set(match[1], "Cargo.toml");
        }
      }
    }
  }
}

const goModPath = path.join(root, "go.mod");
if (fs.existsSync(goModPath)) {
  const text = fs.readFileSync(goModPath, "utf8");
  const requireBlock = text.match(/require\s*\(([^)]*)\)/s);
  const lines = [];
  if (requireBlock) lines.push(...requireBlock[1].split(/\r?\n/));
  for (const m of text.matchAll(/^require\s+([^\s]+)\s+/gm)) lines.push(m[1]);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const name = trimmed.split(/\s+/)[0];
    if (name) {
      const short = name.split("/").pop();
      if (!installed.has(short)) installed.set(short, "go.mod");
    }
  }
}

if (installed.size === 0) {
  console.log(JSON.stringify({
    status: "skip",
    reason: "no recognized manifest found (package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod)",
  }, null, 2));
  process.exit(0);
}

// drift: dependencias instaladas no declaradas en stack.md
const drift = [];
for (const [name, source] of installed.entries()) {
  if (!declared(name)) drift.push({ name, source });
}

// shadow imports: imports en codigo que no estan en manifests
const shadowImports = [];
const builtInModules = new Set([
  "fs", "path", "url", "os", "crypto", "http", "https", "stream", "util", "events", "child_process", "process", "buffer", "querystring", "zlib", "net", "tls", "dgram", "dns", "readline", "tty", "vm", "v8", "perf_hooks", "worker_threads", "cluster", "module", "assert", "string_decoder", "punycode", "timers", "console", "node:fs", "node:path", "node:url", "node:os", "node:crypto", "node:http", "node:https", "node:stream", "node:util", "node:events", "node:child_process", "node:process", "node:buffer",
  "sys", "os", "json", "re", "math", "datetime", "collections", "itertools", "functools", "typing", "asyncio", "abc", "io", "logging", "subprocess", "pathlib", "argparse", "csv", "hashlib", "random", "string", "time", "uuid", "warnings", "copy", "pickle",
]);

if (includeShadow) {
  function walkDir(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    function recurse(d) {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name === "__pycache__" || entry.name === "target") continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) recurse(full);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(entry.name)) out.push(full);
      }
    }
    recurse(dir);
    return out;
  }

  const codeFiles = [];
  for (const sd of sourceDirs) {
    codeFiles.push(...walkDir(path.join(root, sd)));
  }

  const importedModules = new Map();
  const importPatterns = [
    /import\s+(?:.+?\s+from\s+)?["']([^"'.][^"']*)["']/g,                    // ES import
    /require\s*\(\s*["']([^"'.][^"']*)["']\s*\)/g,                           // CommonJS require
    /^\s*import\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm,                               // Python import X
    /^\s*from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import/gm,                       // Python from X import
  ];

  for (const file of codeFiles) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const pat of importPatterns) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(text)) !== null) {
        let modName = m[1];
        if (!modName) continue;
        // tomar solo el primer segmento (ej. "lodash/fp" -> "lodash"; "@scope/pkg/sub" -> "@scope/pkg")
        if (modName.startsWith("@")) {
          const parts = modName.split("/");
          modName = parts.slice(0, 2).join("/");
        } else {
          modName = modName.split("/")[0].split(".")[0];
        }
        if (!modName || modName.startsWith(".")) continue;
        if (builtInModules.has(modName)) continue;
        if (!importedModules.has(modName)) importedModules.set(modName, []);
        importedModules.get(modName).push(path.relative(root, file));
      }
    }
  }

  for (const [name, files] of importedModules.entries()) {
    if (!installed.has(name) && !declared(name)) {
      shadowImports.push({ name, sampleFiles: files.slice(0, 3), totalUses: files.length });
    }
  }
}

// stale: nombres en stack.md que no aparecen en manifests
const stackOriginal = fs.readFileSync(stackFile, "utf8");
const tableRows = [...stackOriginal.matchAll(/^\|([^\n]+)\|/gm)].map((m) => m[1]);
const declaredNames = new Set();
for (const row of tableRows) {
  const cells = row.split("|").map((c) => c.trim());
  for (const cell of cells) {
    if (cell.startsWith("[") || cell.startsWith("---") || /^(item|version|motivo|locked|layer|tool|alternativa|libreria|proposito|por que|servicio|reemplazable|coste|convencion|regla|donde)/i.test(cell)) continue;
    if (/^[a-zA-Z0-9_@\-\/.]+$/.test(cell) && cell.length > 1 && cell.length < 40 && !/^v?\d/.test(cell)) {
      declaredNames.add(cell);
    }
  }
}

const stale = [];
for (const name of declaredNames) {
  if (!installed.has(name) && /^[a-z@]/i.test(name) && name.length > 2) {
    stale.push(name);
  }
}

const totalProblems = drift.length + shadowImports.length;

const result = {
  root,
  manifestsScanned: [...new Set([...installed.values()])],
  totalInstalled: installed.size,
  drift,
  driftCount: drift.length,
  shadowImports,
  shadowImportCount: shadowImports.length,
  staleCandidates: stale,
  staleCount: stale.length,
  status: totalProblems === 0 ? "pass" : "fail",
  notes: [
    "drift: dependencias instaladas que no aparecen mencionadas en docs/stack.md",
    "shadowImports: modulos importados en el codigo que no estan en manifests ni declarados en stack.md (heuristica sobre src/, lib/, app/, packages/)",
    "staleCandidates: nombres encontrados en stack.md que no aparecen en manifests (heuristica, puede tener falsos positivos)",
  ],
};

console.log(JSON.stringify(result, null, 2));
process.exit(totalProblems === 0 ? 0 : 1);
