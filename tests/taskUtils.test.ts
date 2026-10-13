import { describe, expect, it } from "vitest";
import type { Task } from "../src/models/Task";
import {
  countCompleted,
  createTask,
  deleteTask,
  isValidTask,
  parseTasks,
  renameTask,
  sortTasks,
  toggleTask,
  uuidv4,
} from "../src/utils/taskUtils";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: uuidv4(),
    title: "Test task",
    isCompleted: false,
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    completedAt: null,
    ...overrides,
  };
}

describe("createTask", () => {
  it("creates a valid, incomplete task from a title", () => {
    const task = createTask("  Buy oat milk  ");
    expect(task).not.toBeNull();
    expect(task!.title).toBe("Buy oat milk");
    expect(task!.isCompleted).toBe(false);
    expect(task!.completedAt).toBeNull();
    expect(Date.parse(task!.createdAt)).not.toBeNaN();
    expect(task!.createdAt).toBe(task!.updatedAt);
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(createTask("")).toBeNull();
    expect(createTask("   ")).toBeNull();
    expect(createTask("\t\n ")).toBeNull();
  });

  it("generates unique ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const task = createTask(`Task ${i}`);
      expect(task).not.toBeNull();
      expect(ids.has(task!.id)).toBe(false);
      ids.add(task!.id);
    }
  });
});

describe("renameTask", () => {
  it("updates title and modification timestamp", () => {
    const original = makeTask({ title: "old" });
    const result = renameTask([original], original.id, "  new title ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0].title).toBe("new title");
    expect(result.tasks[0].updatedAt >= original.updatedAt).toBe(true);
    expect(result.tasks[0].createdAt).toBe(original.createdAt);
  });

  it("rejects empty titles and unknown ids", () => {
    const original = makeTask();
    expect(renameTask([original], original.id, "   ")).toEqual({ ok: false, reason: "empty-title" });
    expect(renameTask([original], "missing", "x")).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("toggleTask", () => {
  it("marks a task complete with a completion timestamp", () => {
    const task = makeTask();
    const result = toggleTask([task], task.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0].isCompleted).toBe(true);
    expect(result.tasks[0].completedAt).not.toBeNull();
  });

  it("reopens completed tasks and clears completedAt", () => {
    const task = makeTask({ isCompleted: true, completedAt: new Date().toISOString() });
    const result = toggleTask([task], task.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0].isCompleted).toBe(false);
    expect(result.tasks[0].completedAt).toBeNull();
  });
});

describe("deleteTask", () => {
  it("removes exactly the targeted task", () => {
    const a = makeTask();
    const b = makeTask();
    expect(deleteTask([a, b], a.id)).toEqual([b]);
    expect(deleteTask([a, b], "missing")).toEqual([a, b]);
  });
});

describe("sortTasks", () => {
  it("groups incomplete first, newest first, deterministic on ties", () => {
    const older = makeTask({ createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeTask({ createdAt: "2026-01-02T00:00:00.000Z" });
    const doneOlder = makeTask({
      isCompleted: true,
      createdAt: "2026-01-03T00:00:00.000Z",
      completedAt: "2026-01-04T00:00:00.000Z",
    });
    const doneNewer = makeTask({
      isCompleted: true,
      createdAt: "2026-01-05T00:00:00.000Z",
      completedAt: "2026-01-06T00:00:00.000Z",
    });
    const sorted = sortTasks([doneOlder, newer, doneNewer, older]);
    expect(sorted.map((t) => t.id)).toEqual([newer.id, older.id, doneNewer.id, doneOlder.id]);

    // Stable secondary key: identical timestamps sort by id, both directions.
    const a = makeTask({ id: "aaa", createdAt: "2026-01-01T00:00:00.000Z" });
    const b = makeTask({ id: "bbb", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(sortTasks([b, a]).map((t) => t.id)).toEqual(["aaa", "bbb"]);
    expect(sortTasks([a, b]).map((t) => t.id)).toEqual(["aaa", "bbb"]);
  });

  it("completed tasks sink below newly created incomplete ones", () => {
    const completed = makeTask({
      isCompleted: true,
      createdAt: "2026-06-01T00:00:00.000Z",
      completedAt: "2026-06-01T00:00:00.000Z",
    });
    const fresh = makeTask({ createdAt: "2026-01-01T00:00:00.000Z" });
    expect(sortTasks([completed, fresh]).map((t) => t.id)).toEqual([fresh.id, completed.id]);
  });
});

describe("countCompleted", () => {
  it("counts completed tasks", () => {
    expect(countCompleted([makeTask(), makeTask({ isCompleted: true })])).toBe(1);
  });
});

describe("isValidTask / parseTasks", () => {
  it("accepts well-formed tasks", () => {
    expect(isValidTask(makeTask())).toBe(true);
    const result = parseTasks([makeTask(), makeTask({ isCompleted: true, completedAt: new Date().toISOString() })]);
    expect(result.corrupted).toBe(false);
    expect(result.tasks).toHaveLength(2);
  });

  it("reports corruption for non-array payloads", () => {
    expect(parseTasks("garbage")).toEqual({ tasks: [], corrupted: true });
    expect(parseTasks({ nope: true }).corrupted).toBe(true);
  });

  it("skips invalid entries but keeps the valid ones", () => {
    const good = makeTask({ title: "keep me" });
    const result = parseTasks([good, { id: "x" }, null, 42, { ...makeTask(), createdAt: "not-a-date" }]);
    expect(result.corrupted).toBe(true);
    expect(result.tasks).toEqual([good]);
  });

  it("drops duplicate ids", () => {
    const dupe = makeTask();
    const result = parseTasks([dupe, { ...dupe }]);
    expect(result.tasks).toHaveLength(1);
    expect(result.corrupted).toBe(true);
  });

  it("treats a missing key (undefined) as a clean first launch", () => {
    expect(parseTasks(undefined)).toEqual({ tasks: [], corrupted: false });
  });
});
