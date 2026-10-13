import type { Task } from "./models/Task";
import { getTaskStorage, inTauri } from "./services/taskStorage";
import { TaskInput } from "./components/TaskInput";
import { TaskList } from "./components/TaskList";
import {
  countCompleted,
  createTask,
  deleteTask,
  renameTask,
  sortTasks,
  toggleTask,
} from "./utils/taskUtils";

/**
 * Application wiring: owns the in-memory task state, keeps storage in sync,
 * and coordinates the popup window behaviour.
 */

const elements = {
  list: requireElement<HTMLUListElement>("task-list"),
  empty: requireElement<HTMLElement>("empty-state"),
  count: requireElement<HTMLElement>("completed-count"),
  error: requireElement<HTMLElement>("storage-error"),
  form: requireElement<HTMLFormElement>("add-form"),
  input: requireElement<HTMLInputElement>("add-input"),
};

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

let tasks: Task[] = [];

function render(): void {
  taskList.render(tasks);
  const completed = countCompleted(tasks);
  elements.count.textContent =
    completed === 0 ? "0 done" : `${completed} of ${tasks.length} done`;
}

function showError(message: string): void {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function clearError(): void {
  elements.error.textContent = "";
  elements.error.hidden = true;
}

/** Persist the current state; errors surface as an unobtrusive banner. */
function persist(): void {
  void storagePromise
    .then((storage) => storage.save(tasks))
    .catch(() => {
      showError("Could not save tasks. Your latest changes may not persist.");
    });
}

function mutate(next: Task[]): void {
  tasks = sortTasks(next);
  clearError();
  render();
  persist();
}

const storagePromise = getTaskStorage();

const taskList = new TaskList(elements.list, elements.empty, {
  onToggle: (id) => {
    const result = toggleTask(tasks, id);
    if (result.ok) mutate(result.tasks);
  },
  onRename: (id, title) => {
    const result = renameTask(tasks, id, title);
    if (result.ok) {
      mutate(result.tasks);
      return true;
    }
    return false;
  },
  onDelete: (id) => mutate(deleteTask(tasks, id)),
});

const taskInput = new TaskInput(elements.form, elements.input, (rawTitle) => {
  const task = createTask(rawTitle);
  if (task) mutate([...tasks, task]);
});

/** Reset transient UI state each time the popup becomes visible again. */
function onPopupShown(): void {
  clearError();
  taskInput.focus();
}

async function init(): Promise<void> {
  try {
    const storage = await storagePromise;
    const result = await storage.load();
    tasks = result.tasks;
    if (result.corrupted) {
      showError("Some stored tasks were invalid and were skipped. A backup of the original data was kept.");
    }
  } catch {
    showError("Could not read saved tasks. Starting with an empty list.");
    tasks = [];
  }
  render();
  onPopupShown();
}

/* ---------- Popup window integration ---------- */

async function hidePopup(): Promise<void> {
  if (!inTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  } catch {
    /* not fatal */
  }
}

if (inTauri()) {
  // Focus the input again whenever the popup is (re)opened.
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const unlisten = await win.listen("tauri://focus", () => onPopupShown());
      window.addEventListener("pagehide", () => unlisten());
    } catch {
      /* best-effort */
    }
  })();
}

/* ---------- Keyboard behaviour ---------- */

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !taskList.anyEditing) {
    // Escape outside an inline editor closes the popup.
    event.preventDefault();
    void hidePopup();
  }
});

// macOS: Cmd+N focuses the add field without conflicting with system shortcuts.
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    taskInput.focus();
  }
});

void init();
