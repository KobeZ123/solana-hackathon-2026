import { promises as fs } from "node:fs";
import path from "node:path";
import type { AttendanceRow, NonceRecord, Store, StoredEvent } from "./store";

interface Data {
  nonces: Record<string, NonceRecord>;
  events: Record<string, StoredEvent>;
  attendance: Record<string, AttendanceRow>;
}

const empty = (): Data => ({ nonces: {}, events: {}, attendance: {} });

/** JSON-file store for local dev and tests. Operations are serialized in-process. */
export class FileStore implements Store {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async load(): Promise<Data> {
    try {
      return {
        ...empty(),
        ...JSON.parse(await fs.readFile(this.file, "utf8")),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw e;
    }
  }

  private async save(data: Data): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, this.file);
  }

  /** Run a read-modify-write under the in-process lock. */
  private tx<T>(fn: (data: Data) => T, write: boolean): Promise<T> {
    const run = async () => {
      const data = await this.load();
      const result = fn(data);
      if (write) await this.save(data);
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  putNonce(record: NonceRecord): Promise<void> {
    return this.tx((d) => {
      d.nonces[record.wallet] = record;
    }, true);
  }

  consumeNonce(wallet: string, now: number): Promise<NonceRecord | null> {
    return this.tx((d) => {
      const rec = d.nonces[wallet];
      if (!rec) return null;
      delete d.nonces[wallet];
      return rec.expiresAt > now ? rec : null;
    }, true);
  }

  insertEvent(event: StoredEvent): Promise<boolean> {
    return this.tx((d) => {
      if (d.events[event.eventPda]) return false;
      d.events[event.eventPda] = event;
      return true;
    }, true);
  }

  getEvent(eventPda: string): Promise<StoredEvent | null> {
    return this.tx((d) => d.events[eventPda] ?? null, false);
  }

  listEvents(): Promise<StoredEvent[]> {
    return this.tx(
      (d) =>
        Object.values(d.events).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        ),
      false
    );
  }

  upsertAttendance(rows: AttendanceRow[]): Promise<void> {
    return this.tx((d) => {
      for (const r of rows) d.attendance[`${r.eventPda}:${r.wallet}`] = r;
    }, true);
  }

  listAttendance(): Promise<AttendanceRow[]> {
    return this.tx((d) => Object.values(d.attendance), false);
  }
}
