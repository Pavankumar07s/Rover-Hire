// Phase 13: Render's disk doesn't last, so the remote server copies its mission files and the tunnel address into
// Postgres (Neon) and copies them back when it starts. The daily cap is read from the mission files themselves.
import pg from "pg";
import { mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export type Store = Awaited<ReturnType<typeof openStore>>;

const RETRY_MS = 30_000; // a copy that failed (Neon unreachable) is tried again until it lands

export async function openStore(url: string, root: string, schema = "p13") {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`bad schema name: ${schema}`);
  const u = new URL(url); // Neon gives sslmode=require; pg treats it as verify-full today, so say so and keep it strict
  if (["prefer", "require", "verify-ca"].includes(u.searchParams.get("sslmode") ?? "")) u.searchParams.set("sslmode", "verify-full");
  const pool = new pg.Pool({ connectionString: u.toString(), max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000 });
  pool.on("error", (e) => console.error(`[p13-store] idle connection: ${e.message}`)); // Neon closes idle ones
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema};
    CREATE TABLE IF NOT EXISTS ${schema}.files (path text PRIMARY KEY, data bytea NOT NULL, mtime_ms double precision NOT NULL,
                                                saved_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS ${schema}.kv (key text PRIMARY KEY, value jsonb NOT NULL, saved_at timestamptz NOT NULL DEFAULT now())`);

  const top = resolve(root) + sep;
  const inside = (rel: string) => (resolve(root, rel).startsWith(top) ? resolve(root, rel) : null);
  const copied = new Map<string, string>(); // relative path -> "size:mtime" of the version already in Postgres
  const sig = (file: string) => { const st = statSync(file); return st.isFile() ? `${st.size}:${st.mtimeMs}` : null; };
  let queue: Promise<void> = Promise.resolve(); // one write at a time, in the order asked
  const later = (what: string, job: () => Promise<void>) => {
    queue = queue.then(job).catch((e) => console.error(`[p13-store] ${what}: ${(e as Error).message}`));
  };
  const retrying = new Set<string>();

  /** Copies, in the background, the files in dir that changed since their last copy. */
  function syncDir(dir: string): void {
    later(`copy ${dir}`, async () => {
      try {
        for (const name of readdirSync(dir)) {
          const file = join(dir, name), rel = relative(root, file), now = sig(file);
          if (name.endsWith(".tmp") || !now || !inside(rel) || copied.get(rel) === now) continue;
          await pool.query(`INSERT INTO ${schema}.files (path, data, mtime_ms) VALUES ($1, $2, $3)
                            ON CONFLICT (path) DO UPDATE SET data = $2, mtime_ms = $3, saved_at = now()`,
                           [rel, readFileSync(file), Number(now.split(":")[1])]);
          copied.set(rel, now);
        }
      } catch (e) {
        if (!retrying.has(dir)) {
          retrying.add(dir);
          setTimeout(() => { retrying.delete(dir); syncDir(dir); }, RETRY_MS).unref();
        }
        throw e;
      }
    });
  }

  const latest = new Map<string, unknown>(); // a retry always writes the newest value of its key
  function setKey(key: string): void {
    later(`set ${key}`, async () => {
      try {
        await pool.query(`INSERT INTO ${schema}.kv (key, value) VALUES ($1, $2)
                          ON CONFLICT (key) DO UPDATE SET value = $2, saved_at = now()`, [key, JSON.stringify(latest.get(key))]);
      } catch (e) {
        if (!retrying.has(`kv:${key}`)) {
          retrying.add(`kv:${key}`);
          setTimeout(() => { retrying.delete(`kv:${key}`); setKey(key); }, RETRY_MS).unref();
        }
        throw e;
      }
    });
  }

  return {
    /** Writes every copied file back under root, 50 at a time (Render free has 512 MB); returns how many. */
    async restore(): Promise<number> {
      const paths = (await pool.query(`SELECT path FROM ${schema}.files ORDER BY path`)).rows.map((r) => r.path as string);
      for (let i = 0; i < paths.length; i += 50) {
        const { rows } = await pool.query(`SELECT path, data, mtime_ms FROM ${schema}.files WHERE path = ANY($1)`, [paths.slice(i, i + 50)]);
        for (const r of rows) {
          const file = inside(r.path);
          if (!file) continue;
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, r.data);
          utimesSync(file, new Date(), new Date(r.mtime_ms));
          copied.set(r.path, sig(file)!);
        }
      }
      return paths.length;
    },
    syncDir,
    async get<T>(key: string): Promise<T | undefined> {
      return (await pool.query(`SELECT value FROM ${schema}.kv WHERE key = $1`, [key])).rows[0]?.value;
    },
    set(key: string, value: unknown): void {
      latest.set(key, value);
      setKey(key);
    },
    /** Resolves when every copy asked for so far has been written. */
    flush: () => queue,
    close: () => pool.end(),
  };
}
