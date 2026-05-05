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
const mode = (args.get("mode") || "lite").toLowerCase();
const phase = (args.get("phase") || "start").toLowerCase();
const touches = new Set((args.get("touches") || "").split(",").map((x) => x.trim()).filter(Boolean));
const isTemplate = args.get("template") === "true";
const freshnessDays = parseInt(args.get("freshness") || "14", 10);

const coreLite = [
  "docs/project_memory.md",
  "docs/task_tracker.md",
  "docs/design_summary.md",
  "docs/stack.md",
  "docs/anti_patterns.md",
  "docs/capability_map.md",
];

const coreFull = [
  "docs/requirements.md",
  "docs/design_summary.md",
  "docs/project_memory.md",
  "docs/task_tracker.md",
  "docs/stack.md",
  "docs/anti_patterns.md",
  "docs/capability_map.md",
  "docs/security_checklist.md",
  "docs/definition_of_done.md",
  "docs/test_plan.md",
  "docs/verification_log.md",
  "docs/decision_log.md",
  "docs/risk_register.md",
  "docs/effectiveness_metrics.md",
  "docs/skill_inventory.md",
  "docs/mcp_inventory.md",
  "docs/agent_policy.md",
];

const conditional = {
  api: ["docs/api_contracts.md"],
  data: ["docs/data_model.md"],
  security: ["docs/security_checklist.md", "docs/agent_policy.md"],
  deploy: ["docs/deployment.md", "docs/backup_restore.md", "docs/observability.md"],
  agent: ["docs/agent_policy.md"],
  environment: ["docs/environment.md", "docs/environment_matrix.md"],
  change: ["docs/change_control.md"],
  module: ["docs/module_map.md"],
  integration: ["docs/integration_matrix.md"],
  backup: ["docs/backup_restore.md"],
  observability: ["docs/observability.md"],
  license: ["docs/license_compliance.md"],
  stack: ["docs/stack.md", "docs/decision_log.md"],
  capability: ["docs/capability_map.md"],
  trifecta: ["docs/agent_policy.md"],
  production: [
    "docs/environment_matrix.md",
    "docs/backup_restore.md",
    "docs/observability.md",
    "docs/deployment.md",
  ],
};

const failures = [];
const warnings = [];
const validModes = new Set(["lite", "full"]);
const validPhases = new Set(["start", "close"]);

if (!validModes.has(mode)) failures.push(`invalid mode: ${mode}`);
if (!validPhases.has(phase)) failures.push(`invalid phase: ${phase}`);
for (const item of touches) {
  if (!Object.hasOwn(conditional, item)) failures.push(`unknown touch type: ${item}`);
}

if (failures.length) {
  console.log(JSON.stringify({
    root,
    mode,
    phase,
    template: isTemplate,
    touches: [...touches],
    failures,
    warnings,
    status: "fail",
  }, null, 2));
  process.exit(1);
}

const required = new Set(mode === "full" ? coreFull : coreLite);
for (const item of touches) {
  for (const file of conditional[item] || []) required.add(file);
}

if (mode === "full") {
  required.add("docs/data_model.md");
  required.add("docs/api_contracts.md");
  required.add("docs/environment.md");
  required.add("docs/deployment.md");
  required.add("docs/module_map.md");
  required.add("implementation/change_impact.md");
}

function read(file) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    failures.push(`missing: ${file}`);
    return "";
  }
  const stat = fs.statSync(absolute);
  if (stat.size < 40) failures.push(`too small or empty: ${file}`);
  return fs.readFileSync(absolute, "utf8");
}

function fileMtime(file) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) return null;
  return fs.statSync(absolute).mtime;
}

function hasPlaceholder(text) {
  return /\[POR DEFINIR\]/i.test(text);
}

for (const file of required) {
  const text = read(file);
  if (text && hasPlaceholder(text)) {
    const message = `placeholder remains: ${file}`;
    if (isTemplate) warnings.push(message);
    else failures.push(message);
  }
}

const hasAgentFile = fs.existsSync(path.join(root, "AGENTS.md")) || fs.existsSync(path.join(root, "CLAUDE.md"));
if (!hasAgentFile) {
  const message = "AGENTS.md or CLAUDE.md not found at project root";
  if (isTemplate) warnings.push(message);
  else failures.push(message);
}

const tracker = read("docs/task_tracker.md");

if (phase === "start") {
  if (!/\|\s*IT-\d+\s*\|\s*in_progress\s*\|/i.test(tracker)) {
    const message = "no active in_progress task found in docs/task_tracker.md";
    if (isTemplate) warnings.push(message);
    else failures.push(message);
  }

  if (!isTemplate) {
    const taskRows = [...tracker.matchAll(/\|\s*(IT-\d+)\s*\|[^\n]+/g)].map((m) => m[0]);
    const rowsWithoutCriterion = taskRows.filter((row) => {
      const cells = row.split("|").map((c) => c.trim());
      const criterionCell = cells[4] || "";
      const sourceCell = cells[5] || "";
      return !criterionCell || /por definir/i.test(criterionCell) || !sourceCell || /por definir/i.test(sourceCell);
    });
    if (rowsWithoutCriterion.length) {
      failures.push(`task rows missing per-task criterion or source in tracker: ${rowsWithoutCriterion.length}`);
    }
  }
}

if (phase === "close") {
  const verification = read("docs/verification_log.md");
  const memory = read("docs/project_memory.md");
  const doneTaskIds = [...tracker.matchAll(/\|\s*(IT-\d+)\s*\|\s*done\s*\|/gi)].map((match) => match[1].toUpperCase());
  if (!doneTaskIds.length) failures.push("task_tracker.md has no done task during close phase");
  const missingEvidence = doneTaskIds.filter((id) => !new RegExp(`\\b${id}\\b`, "i").test(verification));
  if (missingEvidence.length) {
    failures.push(`verification_log.md missing evidence for done task(s): ${missingEvidence.join(", ")}`);
  }
  if (!/Tarea Activa|Decisiones Recientes|Pr.ximos Pasos|Proximos Pasos|Next Steps/i.test(memory)) {
    failures.push("project_memory.md does not include required closeout sections");
  }
  if (!/Stack Snapshot/i.test(memory)) {
    failures.push("project_memory.md does not include Stack Snapshot section (v8 requirement)");
  }
  if (!/Provenance/i.test(memory)) {
    warnings.push("project_memory.md does not include Provenance section (v8 final recommendation)");
  }
  if (/\|\s*IT-\d+\s*\|\s*in_progress\s*\|/i.test(tracker)) {
    failures.push("task_tracker.md still has an in_progress task during close phase");
  }
}

if (!isTemplate && phase === "start") {
  const mtime = fileMtime("docs/project_memory.md");
  if (mtime) {
    const ageDays = (Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > freshnessDays) {
      warnings.push(`docs/project_memory.md is ${Math.floor(ageDays)} days old (threshold ${freshnessDays}). Refresh before continuing.`);
    }
  }
}

if (!isTemplate) {
  const antipatterns = read("docs/anti_patterns.md");
  if (antipatterns && !/AP-\d+/.test(antipatterns)) {
    warnings.push("docs/anti_patterns.md has no AP-XXX entries yet. This is fine on day one but should grow with the project.");
  }
}

if (!isTemplate) {
  const stack = read("docs/stack.md");
  if (stack && !/##\s*1\.\s*Lenguaje/i.test(stack)) {
    failures.push("docs/stack.md missing required section: Lenguaje Y Runtime");
  }
}

if (!isTemplate) {
  const decisionLog = read("docs/decision_log.md");
  if (decisionLog && !/why-?not/i.test(decisionLog)) {
    warnings.push("docs/decision_log.md does not appear to use the 'why-not' field for alternatives. v8 final recommends documenting why each alternative was rejected.");
  }
}

if (!isTemplate) {
  const policy = read("docs/agent_policy.md");
  if (policy && !/lethal trifecta/i.test(policy)) {
    warnings.push("docs/agent_policy.md does not include Lethal Trifecta section (v8 final security recommendation)");
  }
}

const result = {
  root,
  mode,
  phase,
  template: isTemplate,
  touches: [...touches],
  failures,
  warnings,
  status: failures.length ? "fail" : "pass",
};

console.log(JSON.stringify(result, null, 2));
process.exit(failures.length ? 1 : 0);
