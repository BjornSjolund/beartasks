import type { Task } from "../models/Task";

/**
 * Pure task logic: creation, mutation, sorting, validation.
 * Kept free of DOM and Tauri imports so it can be unit-tested directly.
 */

/** Generate an RFC 4122 v4 UUID, with a fallback for older webviews. */
export function uuidv4(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Build a new task from a raw title.
 * Returns null when the title is empty or whitespace-only.
 */
export function createTask(rawTitle: string): Task | null {
  const title = rawTitle.trim();
  if (title.length === 0) return null;
  const ts = nowIso();
  return {
    id: uuidv4(),
    title,
    isCompleted: false,
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
  };
}

export type RenameResult =
  | { ok: true; tasks: Task[] }
  | { ok: false; reason: "not-found" | "empty-title" };

/** Rename a task. Empty/whitespace titles are rejected; the list is unchanged. */
export function renameTask(tasks: readonly Task[], id: string, rawTitle: string): RenameResult {
  const title = rawTitle.trim();
  if (title.length === 0) return { ok: false, reason: "empty-title" };
  const task = tasks.find((t) => t.id === id);
  if (!task) return { ok: false, reason: "not-found" };
  const updated: Task = { ...task, title, updatedAt: nowIso() };
  return { ok: true, tasks: tasks.map((t) => (t.id === id ? updated : t)) };
}

export type ToggleResult = { ok: true; tasks: Task[] } | { ok: false; reason: "not-found" };

/** Toggle completion state; tracks completedAt, clears it when reopened. */
export function toggleTask(tasks: readonly Task[], id: string): ToggleResult {
  const task = tasks.find((t) => t.id === id);
  if (!task) return { ok: false, reason: "not-found" };
  const isCompleted = !task.isCompleted;
  const updated: Task = {
    ...task,
    isCompleted,
    completedAt: isCompleted ? nowIso() : null,
    updatedAt: nowIso(),
  };
  return { ok: true, tasks: tasks.map((t) => (t.id === id ? updated : t)) };
}

/** Remove a task by id. Returns the new list (input list if not found). */
export function deleteTask(tasks: readonly Task[], id: string): Task[] {
  return tasks.filter((t) => t.id !== id);
}

/**
 * Sort order (deterministic):
 *  1. Incomplete tasks before completed tasks.
 *  2. Newest createdAt first within each group.
 *  3. Lexicographic id as a stable tie-breaker for identical timestamps.
 */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    const byCreated = b.createdAt.localeCompare(a.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });
}

export function countCompleted(tasks: readonly Task[]): number {
  return tasks.reduce((n, t) => n + (t.isCompleted ? 1 : 0), 0);
}

/** Runtime type guard validating one stored task object. */
export function isValidTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    t.id.length > 0 &&
    typeof t.title === "string" &&
    typeof t.isCompleted === "boolean" &&
    typeof t.createdAt === "string" &&
    !Number.isNaN(Date.parse(t.createdAt)) &&
    typeof t.updatedAt === "string" &&
    !Number.isNaN(Date.parse(t.updatedAt)) &&
    (t.completedAt === null ||
      (typeof t.completedAt === "string" && !Number.isNaN(Date.parse(t.completedAt))))
  );
}

export interface ParseTasksResult {
  /** Valid tasks found in the input. */
  tasks: Task[];
  /** True when the input (or any entry within it) was not valid task data. */
  corrupted: boolean;
}

/**
 * Validate data loaded from storage. Skips invalid entries instead of
 * rejecting the whole array, and reports corruption so callers can back the
 * bad data up rather than silently overwriting it.
 */
export function parseTasks(raw: unknown): ParseTasksResult {
  if (!Array.isArray(raw)) {
    return { tasks: [], corrupted: raw !== undefined };
  }
  const tasks: Task[] = [];
  const seen = new Set<string>();
  let corrupted = false;
  for (const entry of raw) {
    if (isValidTask(entry) && !seen.has(entry.id)) {
      seen.add(entry.id);
      tasks.push({
        id: entry.id,
        title: entry.title,
        isCompleted: entry.isCompleted,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        completedAt: entry.completedAt,
      });
    } else {
      corrupted = true;
    }
  }
  return { tasks, corrupted };
}
