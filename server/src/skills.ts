// Skill library: skills/<name>/SKILL.md (front matter: name, description) plus skills/assignments.json
// (agent id -> skill folder names). Agents see their skills' names and descriptions in the system prompt
// and open one with the use_skill tool when the work calls for it (progressive disclosure).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

export interface SkillMeta {
  name: string;
  description: string;
  source: string | null; // "repo@commit (licence)" for imported skills, null for the agency's own
}

const MAX_CHARS = 40_000;

function frontMatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  let key = "";
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1] ?? "";
      out[key] = (kv[2] ?? "").replace(/^[>|]-?\s*$/, "").replace(/^["']|["']$/g, "");
    } else if (key && /^\s+\S/.test(line)) out[key] = `${out[key] ?? ""} ${line.trim()}`.trim();
  }
  return out;
}

export class Skills {
  private readonly metas = new Map<string, SkillMeta>();
  private readonly byAgent = new Map<string, string[]>();

  constructor(private readonly dir: string) {
    if (!existsSync(dir)) return;
    for (const folder of readdirSync(dir)) {
      const file = join(dir, folder, "SKILL.md");
      if (!existsSync(file)) continue;
      const fm = frontMatter(readFileSync(file, "utf8"));
      let source: string | null = null;
      const src = join(dir, folder, "SOURCE.md");
      if (existsSync(src)) {
        const t = readFileSync(src, "utf8");
        const repo = /Repository: (\S+)/.exec(t)?.[1] ?? "?";
        const commit = /Commit: (\w{7})/.exec(t)?.[1] ?? "?";
        const lic = /Licence: ([^(\n]+)/.exec(t)?.[1]?.trim() ?? "?";
        source = `${repo}@${commit} (${lic})`;
      }
      this.metas.set(folder, { name: folder, description: (fm.description ?? "").slice(0, 400), source });
    }
    const assignFile = join(dir, "assignments.json");
    if (existsSync(assignFile)) {
      const raw = JSON.parse(readFileSync(assignFile, "utf8")) as Record<string, unknown>;
      for (const [agent, list] of Object.entries(raw))
        if (Array.isArray(list)) this.byAgent.set(agent, list.filter((s): s is string => typeof s === "string" && this.metas.has(s)));
    }
  }

  for(agentId: string): SkillMeta[] {
    return (this.byAgent.get(agentId) ?? []).map((n) => this.metas.get(n)).filter((m): m is SkillMeta => !!m);
  }

  /** System-prompt section listing an agent's skills. Empty when it has none. */
  promptFor(agentId: string): string {
    const list = this.for(agentId);
    if (!list.length) return "";
    const lines = list.map((s) => `- ${s.name}: ${s.description}`);
    return `\n\nYour skills (open one with use_skill before doing that kind of work, and follow it):\n${lines.join("\n")}`;
  }

  /** Full text of SKILL.md, or of another Markdown file inside the skill. */
  read(agentId: string, name: string, file?: string): { ok: true; text: string } | { ok: false; error: string } {
    const mine = this.byAgent.get(agentId) ?? [];
    if (!mine.includes(name)) return { ok: false, error: `"${name}" is not one of your skills. Yours: ${mine.join(", ") || "none"}.` };
    const base = join(this.dir, name);
    const rel = normalize(file ?? "SKILL.md").replace(/^([/\\])+/, "");
    const path = join(base, rel);
    if (!path.startsWith(base + sep) || !/\.(md|txt)$/i.test(path) || !existsSync(path)) {
      return { ok: false, error: `No file "${file}" in ${name}. Files: ${this.files(name).join(", ")}` };
    }
    let text = readFileSync(path, "utf8");
    if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n\n[truncated at ${MAX_CHARS} characters]`;
    const others = this.files(name).filter((f) => f !== rel && f !== "SKILL.md");
    const meta = this.metas.get(name);
    const head = meta?.source ? `[Imported skill from ${meta.source}. Only its Markdown is available in HQ: skip steps that run scripts or tools you do not have. Where it says to read or write a local file (for example voice.md or about-me.md), use read_file and save_file in HQ; if the file does not exist yet, ask for it in your report instead of inventing it.]\n\n` : "";
    return { ok: true, text: head + text + (others.length && !file ? `\n\nOther files in this skill (open with use_skill + file): ${others.join(", ")}` : "") };
  }

  private files(name: string): string[] {
    const base = join(this.dir, name);
    const out: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(md|txt)$/i.test(f) && !/^licen[cs]e/i.test(f)) out.push(p.slice(base.length + 1));
      }
    };
    if (existsSync(base)) walk(base);
    return out.sort();
  }
}
