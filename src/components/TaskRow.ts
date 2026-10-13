import type { Task } from "../models/Task";

export interface TaskRowHandlers {
  onToggle: (id: string) => void;
  onRename: (id: string, title: string) => boolean;
  onDelete: (id: string) => void;
}

/**
 * One row in the task list: checkbox, title, Edit and Delete controls.
 * Handles its own inline edit state (Enter saves, Escape cancels).
 */
export class TaskRow {
  readonly element: HTMLLIElement;
  private editInput: HTMLInputElement | null = null;
  private originalTitle = "";

  constructor(task: Task, private readonly handlers: TaskRowHandlers) {
    this.element = document.createElement("li");
    this.element.className = "task-row";
    this.element.dataset.taskId = task.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = task.isCompleted;
    checkbox.setAttribute("aria-label", `Mark "${task.title}" as ${task.isCompleted ? "incomplete" : "complete"}`);
    checkbox.addEventListener("change", () => this.handlers.onToggle(task.id));

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;
    title.title = task.title;

    const actions = document.createElement("span");
    actions.className = "task-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "icon-button edit";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit "${task.title}"`);
    editButton.addEventListener("click", () => this.beginEdit(task, title));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "icon-button delete";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete "${task.title}"`);
    deleteButton.addEventListener("click", () => this.handlers.onDelete(task.id));

    actions.append(editButton, deleteButton);
    this.element.append(checkbox, title, actions);

    if (task.isCompleted) this.element.classList.add("completed");
  }

  /** True while this row's inline editor is open (blocks popup-level Escape). */
  get isEditing(): boolean {
    return this.editInput !== null;
  }

  private beginEdit(task: Task, titleSpan: HTMLSpanElement): void {
    if (this.editInput) return;
    this.originalTitle = task.title;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "task-edit-input";
    input.value = task.title;
    input.maxLength = 500;
    input.setAttribute("aria-label", "Task title");
    this.editInput = input;
    this.element.replaceChild(input, titleSpan);
    input.focus();
    input.select();

    const commit = () => {
      if (!this.editInput) return;
      const value = input.value;
      if (value.trim().length === 0) {
        this.cancelEdit(titleSpan); // empty titles revert to the original
        return;
      }
      if (value.trim() !== this.originalTitle) {
        const saved = this.handlers.onRename(task.id, value);
        if (!saved) {
          this.cancelEdit(titleSpan);
          return;
        }
      }
      this.editInput = null;
      titleSpan.textContent = value.trim();
      titleSpan.title = value.trim();
      this.element.replaceChild(titleSpan, input);
    };

    const cancel = () => this.cancelEdit(titleSpan);

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation(); // don't let the popup close
        cancel();
      }
    });
    input.addEventListener("blur", () => {
      // Commit on blur with a valid value, revert otherwise.
      if (this.editInput && input.value.trim().length > 0) commit();
      else if (this.editInput) cancel();
    });
  }

  private cancelEdit(titleSpan: HTMLSpanElement): void {
    const input = this.editInput;
    if (!input) return;
    this.editInput = null;
    titleSpan.textContent = this.originalTitle;
    titleSpan.title = this.originalTitle;
    if (input.parentNode === this.element) {
      this.element.replaceChild(titleSpan, input);
    }
  }
}
