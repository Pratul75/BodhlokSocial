#!/usr/bin/env node
// Fails when the VM timers (scripts/vm/systemd + scripts/vm/job.sh) and Cloud Scheduler
// (infra/scheduler.tf) disagree on which jobs exist, which worker path each calls, or when.
// Run from the repository root: node scripts/check-schedules.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");

/** Terraform: `"name" = { path = "/jobs/...", cron = "..." }` lines. */
function terraform() {
  const jobs = new Map();
  const re = /"([a-z0-9-]+)"\s*=\s*\{\s*path\s*=\s*"([^"]+)",\s*cron\s*=\s*"([^"]+)"\s*\}/g;
  for (const m of read("infra/scheduler.tf").matchAll(re)) jobs.set(m[1], { path: m[2], cron: m[3] });
  return jobs;
}

/** systemd OnCalendar forms used by the timers, as the equivalent cron line. */
export function calendarToCron(spec) {
  const s = spec.replace(/\s+Asia\/Kolkata$/, "").trim();
  let m;
  if (s === "*:*:00") return "* * * * *";
  if ((m = s.match(/^\*:0\/(\d+)$/))) return `*/${m[1]} * * * *`;
  if ((m = s.match(/^\*:(\d{1,2})$/))) return `${Number(m[1])} * * * *`;
  if ((m = s.match(/^\*-\*-\* \*:(\d{2}):00$/))) return `${Number(m[1])} * * * *`;
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  if ((m = s.match(/^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?\*-\*-(\*|\d{2}) (\d{2}):(\d{2}):00$/))) {
    const [, dow, dom, hh, mm] = m;
    return `${Number(mm)} ${Number(hh)} ${dom === "*" ? "*" : Number(dom)} * ${dow ? days[dow] : "*"}`;
  }
  throw new Error(`Unrecognised OnCalendar "${spec}"`);
}

/** VM: one timer per job, and job.sh's case statement for the path. */
function vm() {
  const script = read("scripts/vm/job.sh");
  const paths = new Map();
  for (const m of script.matchAll(/^\s+([a-z0-9-]+)\)\s+path=([^\s;]+)\s*;;/gm)) paths.set(m[1], m[2]);
  const agents = script.match(/^\s+((?:agent-[a-z]+\|?)+)\)\n\s+path="\/jobs\/\$\{1#agent-\}\?trigger=schedule"/m);
  for (const name of agents ? agents[1].split("|") : []) paths.set(name, `/jobs/${name.slice(6)}?trigger=schedule`);

  const jobs = new Map();
  const dir = join(root, "scripts/vm/systemd");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".timer"))) {
    const text = readFileSync(join(dir, file), "utf8");
    const name = file.replace(/^bodh-/, "").replace(/\.timer$/, "");
    const cal = text.match(/^OnCalendar=(.+)$/m)?.[1];
    // Timers for VM housekeeping (backups) run their own unit, not a worker job; Cloud SQL backs itself up.
    if (!/^Unit=bodh-job@/m.test(text)) continue;
    const unit = text.match(/^Unit=bodh-job@(.+)\.service$/m)?.[1];
    if (unit !== name) throw new Error(`${file}: Unit= should be bodh-job@${name}.service`);
    jobs.set(name, { path: paths.get(name), cron: calendarToCron(cal) });
  }
  return jobs;
}

const tf = terraform();
const v = vm();
const problems = [];
for (const [name, j] of v) {
  const t = tf.get(name);
  if (!t) problems.push(`${name}: VM timer has no Cloud Scheduler job`);
  else {
    if (!j.path) problems.push(`${name}: not handled in scripts/vm/job.sh`);
    else if (t.path !== j.path) problems.push(`${name}: path ${j.path} (VM) vs ${t.path} (Terraform)`);
    if (t.cron !== j.cron) problems.push(`${name}: schedule "${j.cron}" (VM) vs "${t.cron}" (Terraform)`);
  }
}
for (const name of tf.keys()) if (!v.has(name)) problems.push(`${name}: Cloud Scheduler job has no VM timer`);

if (problems.length) {
  console.error(`Schedules disagree:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Schedules match: ${v.size} jobs.`);
