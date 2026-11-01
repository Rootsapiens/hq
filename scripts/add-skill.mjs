#!/usr/bin/env node
// Download a skill folder from a GitHub repository into skills/ and assign it to an agent.
//   npm run skills:add -- <repo-url> <path/in/repo>[,<path2>,...] --agent <id> [--name <folder>] [--ref <branch>]
// Several comma-separated paths are imported from one clone (--name only applies to a single path).
// Copies only Markdown and licence files (no scripts run or copied), refuses skills without an
// open licence, and writes SOURCE.md (repo, path, commit, licence, date) next to the skill.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = process.env.HQ_SKILLS_DIR ?? join(root, "skills");
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const agent = flag("agent");
const name = flag("name");
const ref = flag("ref");
const [repo, path] = args;
if (!repo || !path || !agent) {
  console.error("usage: npm run skills:add -- <repo-url> <path/in/repo> --agent <id> [--name <folder>] [--ref <branch>]");
  process.exit(2);
}
if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/.test(repo)) throw new Error("repo must be https://github.com/<owner>/<repo>");
const paths = path.split(",").map((p) => p.trim()).filter(Boolean);
if (paths.some((p) => p.includes(".."))) throw new Error("bad path");
if (name && paths.length > 1) throw new Error("--name works with one path only");

const OPEN = /Apache License|MIT License|Permission is hereby granted, free of charge|BSD \d-Clause|Redistribution and use in source and binary forms|Creative Commons Attribution|CC-BY|ISC License/i;
const CLOSED = /All rights reserved|proprietary|may not (?:copy|use|distribute)/i;
const licenceIn = (dir) => readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));

const tmp = mkdtempSync(join(tmpdir(), "hq-skill-"));
try {
  execFileSync("git", ["clone", "--quiet", "--depth", "1", ...(ref ? ["--branch", ref] : []), repo, tmp], { stdio: "inherit" });
  const commit = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"]).toString().trim();
  for (const p of paths) {
    const src = join(tmp, p);
    if (!existsSync(join(src, "SKILL.md"))) throw new Error(`${p}/SKILL.md not found in ${repo}`);
    const own = licenceIn(src);
    const licFile = own ? join(src, own) : licenceIn(tmp) ? join(tmp, licenceIn(tmp)) : null;
    if (!licFile) throw new Error("no LICENSE in the skill folder or the repository: refusing (unknown terms)");
    const lic = readFileSync(licFile, "utf8");
    if (CLOSED.test(lic.slice(0, 2000)) && !OPEN.test(lic)) throw new Error(`licence is not open (${basename(licFile)}): refusing`);
    if (!OPEN.test(lic)) throw new Error(`licence not recognised as open (${basename(licFile)}): refusing; review it by hand`);
    const licName = (lic.match(OPEN)?.[0] ?? "open licence").replace(/Permission is hereby granted.*/i, "MIT License");
  
    const dest = join(skillsDir, name ?? basename(p));
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(md|txt)$/i.test(f) || /^licen[cs]e/i.test(f)) {
          const out = join(dest, relative(src, p));
          mkdirSync(dirname(out), { recursive: true });
          cpSync(p, out);
        }
      }
    };
    walk(src);
    if (!own) cpSync(licFile, join(dest, "LICENSE"));
    writeFileSync(
      join(dest, "SOURCE.md"),
      `# Source\n\n- Repository: ${repo}\n- Path: ${p}\n- Commit: ${commit}\n- Licence: ${licName} (see LICENSE)\n- Imported: ${new Date().toISOString().slice(0, 10)}\n- Only Markdown files were copied; scripts and binaries in the original were left out, so steps that run them do not apply in HQ.\n`,
    );

    const assignFile = join(skillsDir, "assignments.json");
    const assign = existsSync(assignFile) ? JSON.parse(readFileSync(assignFile, "utf8")) : {};
    const folder = basename(dest);
    assign[agent] = [...new Set([...(assign[agent] ?? []), folder])];
    writeFileSync(assignFile, `${JSON.stringify(assign, null, 2)}\n`);
    console.log(`added ${folder} (${licName}, ${commit.slice(0, 7)}) for ${agent}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
