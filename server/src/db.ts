// SQLite persistence (better-sqlite3): chat messages, activity log, finished-task counter.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ActivityEntry, ChatMessage, FileMeta, HqFile } from "../../shared/events";

type ActivityKind = ActivityEntry["kind"];

interface MessageRow {
  id: string;
  thread: string;
  author: string;
  content: string;
  ts: number;
  state: string;
}
interface FileRow {
  id: string;
  agent_id: string;
  name: string;
  title: string;
  size: number;
  version: number;
  ts: number;
  content?: string;
}
const toMeta = (r: FileRow): FileMeta => ({ id: r.id, agentId: r.agent_id, name: r.name, title: r.title, size: r.size, version: r.version, ts: r.ts });

interface ActivityRow {
  id: number;
  ts: number;
  agent_id: string | null;
  kind: string;
  text: string;
}

function toState(s: string): ChatMessage["state"] {
  return s === "streaming" || s === "error" ? s : "done";
}
const KINDS: readonly ActivityKind[] = ["status", "message", "delegation", "report", "file", "error", "system"];
function toKind(s: string): ActivityKind {
  return (KINDS as readonly string[]).includes(s) ? (s as ActivityKind) : "system";
}

export class HqDb {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, thread TEXT NOT NULL, author TEXT NOT NULL,
        content TEXT NOT NULL, ts INTEGER NOT NULL, state TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread, ts);
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, agent_id TEXT,
        kind TEXT NOT NULL, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL,
        size INTEGER NOT NULL, version INTEGER NOT NULL, ts INTEGER NOT NULL, content TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS files_name ON files(name, version);
      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
    `);
    // Anything left "streaming" by a previous crash is closed as an error on boot.
    this.db.prepare("UPDATE messages SET state = 'error' WHERE state = 'streaming'").run();
  }

  saveMessage(m: ChatMessage): void {
    this.db
      .prepare(
        `INSERT INTO messages (id, thread, author, content, ts, state) VALUES (@id, @thread, @author, @content, @ts, @state)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, state = excluded.state`,
      )
      .run(m);
  }

  messages(thread: string, limit = 200): ChatMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM (SELECT * FROM messages WHERE thread = ? ORDER BY ts DESC, rowid DESC LIMIT ?) ORDER BY ts ASC")
      .all(thread, limit) as MessageRow[];
    return rows.map((r) => ({ ...r, state: toState(r.state) }));
  }

  addActivity(agentId: string | null, kind: ActivityKind, text: string, ts = Date.now()): ActivityEntry {
    const info = this.db.prepare("INSERT INTO activity (ts, agent_id, kind, text) VALUES (?, ?, ?, ?)").run(ts, agentId, kind, text);
    return { id: Number(info.lastInsertRowid), ts, agentId, kind, text };
  }

  activity(limit = 100): ActivityEntry[] {
    const rows = this.db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?").all(limit) as ActivityRow[];
    return rows.reverse().map((r) => ({ id: r.id, ts: r.ts, agentId: r.agent_id, kind: toKind(r.kind), text: r.text }));
  }

  /** Saves a new version of `name` (names are shared across the team; the newest version wins). */
  saveFile(f: { id: string; agentId: string; name: string; title: string; content: string; ts: number }): FileMeta {
    const row = this.db.prepare("SELECT MAX(version) AS v FROM files WHERE name = ?").get(f.name) as { v: number | null };
    const version = (row.v ?? 0) + 1;
    const size = Buffer.byteLength(f.content, "utf8");
    this.db
      .prepare("INSERT INTO files (id, agent_id, name, title, size, version, ts, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(f.id, f.agentId, f.name, f.title, size, version, f.ts, f.content);
    return { id: f.id, agentId: f.agentId, name: f.name, title: f.title, size, version, ts: f.ts };
  }

  /** Newest first. */
  files(limit = 200): FileMeta[] {
    const rows = this.db
      .prepare("SELECT id, agent_id, name, title, size, version, ts FROM files ORDER BY ts DESC, rowid DESC LIMIT ?")
      .all(limit) as FileRow[];
    return rows.map(toMeta);
  }

  file(id: string): HqFile | null {
    const r = this.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
    return r ? { ...toMeta(r), content: r.content ?? "" } : null;
  }

  latestFile(name: string): HqFile | null {
    const r = this.db.prepare("SELECT * FROM files WHERE name = ? ORDER BY version DESC LIMIT 1").get(name) as FileRow | undefined;
    return r ? { ...toMeta(r), content: r.content ?? "" } : null;
  }

  increment(name: string): number {
    this.db
      .prepare("INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1")
      .run(name);
    return this.counter(name);
  }

  counter(name: string): number {
    const row = this.db.prepare("SELECT value FROM counters WHERE name = ?").get(name) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
