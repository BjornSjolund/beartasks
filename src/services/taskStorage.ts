import type { Task } from "../models/Task";
import { parseTasks, sortTasks } from "../utils/taskUtils";

/**
 * Persistence layer for tasks.
 *
 * All reads and writes go through this module. Writes are serialized through
 * an internal promise queue so an older in-memory snapshot can never be
 * flushed to disk after a newer one, even under rapid consecutive edits.
 */

/** Key under which the task array lives inside the store file. */
export const TASKS_KEY = "tasks";
/** Prefix for keys holding preserved copies of corrupted data. */
export const CORRUPT_BACKUP_PREFIX = "corrupt-backup-";

/** Minimal store contract so the app can run against the Tauri store or a test double. */
export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
}

export interface LoadResult {
  tasks: Task[];
  /** True when stored data was present but invalid (a backup was preserved). */
  corrupted: boolean;
}

function backupKey(): string {
  // Sanitize the ISO timestamp so the key stays a simple identifier.
  return `${CORRUPT_BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export class TaskStorage {
  private readonly store: KeyValueStore;
  /** Tail of the write queue; every save() chains onto it. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  /**
   * Load and validate tasks. When corruption is detected, the raw value is
   * preserved in the same file under a `corrupt-backup-<timestamp>` key so
   * the user's data is never silently overwritten.
   */
  async load(): Promise<LoadResult> {
    const raw = await this.store.get<unknown>(TASKS_KEY);
    const { tasks, corrupted } = parseTasks(raw);
    if (corrupted) {
      // Persist the raw corrupted value alongside the sanitized state.
      await this.store.set(backupKey(), raw ?? null);
      await this.store.set(TASKS_KEY, tasks);
      await this.store.save();
    }
    return { tasks: sortTasks(tasks), corrupted };
  }

  /**
   * Queue a full-state save. Resolves once *this* write has been flushed.
   * Concurrent calls are applied strictly in call order.
   */
  save(tasks: readonly Task[]): Promise<void> {
    const snapshot = tasks.map((t) => ({ ...t }));
    const next = this.writeChain.then(async () => {
      await this.store.set(TASKS_KEY, snapshot);
      await this.store.save();
    });
    // Keep the chain alive even when a write fails, but surface the error to the caller.
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  /** Resolve when every queued write has been flushed (used by tests and shutdown). */
  flushed(): Promise<void> {
    return this.writeChain;
  }
}

/** In-memory KeyValueStore; used outside Tauri (plain browser dev, tests). */
export class MemoryStore implements KeyValueStore {
  /** Public for inspection in tests and debugging. */
  readonly data = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async save(): Promise<void> {
    /* no-op */
  }
}

let storagePromise: Promise<TaskStorage> | null = null;

/** Whether the app is currently running inside a Tauri webview. */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Create a TaskStorage backed by the Tauri store plugin (tasks.json in the
 * application data directory), or an in-memory store when running outside
 * Tauri so the frontend still works in a plain browser tab.
 */
export function getTaskStorage(): Promise<TaskStorage> {
  storagePromise ??= (async () => {
    if (inTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("tasks.json");
      return new TaskStorage(store);
    }
    return new TaskStorage(new MemoryStore());
  })();
  return storagePromise;
}
