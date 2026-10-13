/**
 * Core data model for a single task.
 *
 * All timestamps are stored as ISO 8601 strings so they serialize cleanly to
 * the JSON store and survive application upgrades.
 */
export interface Task {
  /** UUID v4, unique per task. */
  id: string;
  /** User-visible title, trimmed and non-empty. */
  title: string;
  isCompleted: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp of the last modification. */
  updatedAt: string;
  /** ISO 8601 timestamp of the most recent completion, null when incomplete. */
  completedAt: string | null;
}
