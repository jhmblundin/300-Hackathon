// Saves the game so a server restart mid-game doesn't lose anything.
// Postgres when DATABASE_URL is set (Railway), otherwise a JSON file in DATA_DIR.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type { GameState } from '../shared/types';

export interface Store {
  kind: string;
  load(): Promise<GameState | null>;
  /** Debounced: call on every change; writes the latest state shortly after. */
  save(get: () => GameState): void;
  flush(): Promise<void>;
}

abstract class DebouncedStore implements Store {
  abstract kind: string;
  abstract load(): Promise<GameState | null>;
  protected abstract write(json: string): Promise<void>;

  private timer: NodeJS.Timeout | null = null;
  private getter: (() => GameState) | null = null;
  private writing: Promise<void> | null = null;
  private dirty = false;

  save(get: () => GameState) {
    this.getter = get;
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 250);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.writing) await this.writing;
    if (!this.dirty || !this.getter) return;
    this.dirty = false;
    const json = JSON.stringify(this.getter());
    this.writing = this.write(json)
      .catch((err) => {
        this.dirty = true; // retry on the next change or flush
        console.error(`[store:${this.kind}] save failed:`, err?.message ?? err);
      })
      .finally(() => {
        this.writing = null;
      });
    await this.writing;
  }
}

class PgStore extends DebouncedStore {
  kind = 'postgres';
  private pool: pg.Pool;

  constructor(url: string) {
    super();
    const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;
    this.pool = new pg.Pool({ connectionString: url, ssl, max: 3 });
    this.pool.on('error', (err) => console.error('[store:postgres] pool error:', err.message));
  }

  async init() {
    await this.pool.query(
      `create table if not exists hackathon_game_state (
         id text primary key,
         data jsonb not null,
         updated_at timestamptz not null default now()
       )`,
    );
  }

  async load() {
    const r = await this.pool.query('select data from hackathon_game_state where id = $1', ['main']);
    return (r.rows[0]?.data as GameState) ?? null;
  }

  protected async write(json: string) {
    await this.pool.query(
      `insert into hackathon_game_state (id, data, updated_at) values ($1, $2::jsonb, now())
       on conflict (id) do update set data = excluded.data, updated_at = now()`,
      ['main', json],
    );
  }
}

class FileStore extends DebouncedStore {
  kind = 'file';
  private file: string;

  constructor(private dir: string) {
    super();
    this.file = path.join(dir, 'game-state.json');
  }

  async load() {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as GameState;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  protected async write(json: string) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, json);
    await rename(tmp, this.file);
  }
}

export async function createStore(opts: { databaseUrl: string; dataDir: string }): Promise<Store> {
  if (opts.databaseUrl) {
    const s = new PgStore(opts.databaseUrl);
    await s.init();
    return s;
  }
  return new FileStore(opts.dataDir);
}
