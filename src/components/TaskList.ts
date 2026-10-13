import type { Task } from "../models/Task";
import { TaskRow, type TaskRowHandlers } from "./TaskRow";

/**
 * Renders the sorted task list. The list is re-rendered wholesale on every
 * state change — at this scale that is simpler and less error-prone than
 * incremental DOM updates, and it keeps row ordering always consistent with
 * the sorted state (completed tasks sink to the bottom).
 */
export class TaskList {
  private rows = new Map<string, TaskRow>();

  constructor(
    private readonly listElement: HTMLUListElement,
    private readonly emptyElement: HTMLElement,
    private readonly handlers: TaskRowHandlers,
  ) {}

  render(tasks: readonly Task[]): void {
    this.listElement.replaceChildren();
    this.rows.clear();
    for (const task of tasks) {
      const row = new TaskRow(task, this.handlers);
      this.rows.set(task.id, row);
      this.listElement.appendChild(row.element);
    }
    this.emptyElement.hidden = tasks.length > 0;
  }

  /** True when any row currently has an open inline editor. */
  get anyEditing(): boolean {
    for (const row of this.rows.values()) {
      if (row.isEditing) return true;
    }
    return false;
  }
}
