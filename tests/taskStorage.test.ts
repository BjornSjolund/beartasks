import { describe, expect, it } from "vitest";
import type { Task } from "../src/models/Task";
import {
  MemoryStore,
  TaskStorage,
  TASKS_KEY,
  type KeyValueStore,
} from "../src/services/taskStorage";
import { uuidv4 } from "../src/utils/taskUtils";

function makeTask(title: string, overrides: Partial<Task> = {}): Task {
  const iso = new Date("2026-01-01T00:00:00Z").toISOString();
  return {
    id: uuidv4(),
    title,
    isCompleted: false,
    createdAt: iso,
    updatedAt: iso,
    completedAt: null,
    ...overrides,
  };
}

/** Store double with configurable per-call latency to provoke races. */
class SlowStore implements KeyValueStore {
  data = new Map<string, unknown>();
  saveCount = 0;

  constructor(private readonly latencyMs: number) {}

  private async wait(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.wait();
    return this.data.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.wait();
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    await this.wait();
    return this.data.delete(key);
  }
  async save(): Promise<void> {
    await this.wait();
    this.saveCount += 1;
  }
}

describe("TaskStorage", () => {
  it("loads saved tasks and keeps them sorted", async () => {
    const store = new MemoryStore();
    const older = makeTask("older", { createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeTask("newer", { createdAt: "2026-01-02T00:00:00.000Z" });
    await store.set(TASKS_KEY, [older, newer]);

    const storage = new TaskStorage(store);
    const result = await storage.load();
    expect(result.corrupted).toBe(false);
    expect(result.tasks.map((t) => t.title)).toEqual(["newer", "older"]);
  });

  it("returns an empty list on a clean first launch", async () => {
    const storage = new TaskStorage(new MemoryStore());
    const result = await storage.load();
    expect(result).toEqual({ tasks: [], corrupted: false });
  });

  it("round-trips tasks through save/load", async () => {
    const store = new MemoryStore();
    const storage = new TaskStorage(store);
    const tasks = [makeTask("persist me")];
    await storage.save(tasks);
    const reloaded = new TaskStorage(store);
    const result = await reloaded.load();
    expect(result.tasks).toEqual(tasks);
  });

  it("preserves corrupted data under a backup key instead of overwriting it", async () => {
    const store = new MemoryStore();
    const garbage = { totally: "not tasks" };
    await store.set(TASKS_KEY, garbage);

    const storage = new TaskStorage(store);
    const result = await storage.load();
    expect(result.corrupted).toBe(true);
    expect(result.tasks).toEqual([]);

    const backupKeys = [...store.data.keys()].filter((k) => k.startsWith("corrupt-backup-"));
    expect(backupKeys).toHaveLength(1);
    expect(store.data.get(backupKeys[0])).toEqual(garbage);
  });

  it("keeps valid entries when part of the data is corrupted", async () => {
    const store = new MemoryStore();
    const good = makeTask("survivor");
    await store.set(TASKS_KEY, [good, { broken: true }]);

    const storage = new TaskStorage(store);
    const result = await storage.load();
    expect(result.corrupted).toBe(true);
    expect(result.tasks).toEqual([good]);
  });

  it("serializes rapid concurrent saves so the newest state wins", async () => {
    const store = new SlowStore(4);
    const storage = new TaskStorage(store);

    // Fire 20 saves without awaiting, each with distinct content.
    const writes = Array.from({ length: 20 }, (_, i) => storage.save([makeTask(`v${i}`)]));
    await Promise.all(writes);
    await storage.flushed();

    const persisted = (await store.get<Task[]>(TASKS_KEY))!;
    // The *last* queued write must be what ends up on disk, never an older snapshot.
    expect(persisted[0].title).toBe("v19");
    expect(store.saveCount).toBe(20);
  });

  it("does not leave the queue stuck after a failed write", async () => {
    let failOnce = true;
    const store = new MemoryStore();
    const originalSave = store.save.bind(store);
    store.save = async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error("disk full");
      }
      return originalSave();
    };

    const storage = new TaskStorage(store);
    await expect(storage.save([makeTask("fails")])).rejects.toThrow("disk full");
    await expect(storage.save([makeTask("succeeds")])).resolves.toBeUndefined();
    await storage.flushed();
    const persisted = (await store.get<Task[]>(TASKS_KEY))!;
    expect(persisted[0].title).toBe("succeeds");
  });
});
