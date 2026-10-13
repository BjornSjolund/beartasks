/**
 * The footer form used to add new tasks. Owns the text input and Add button.
 */
export class TaskInput {
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;

  constructor(
    form: HTMLFormElement,
    input: HTMLInputElement,
    private readonly onAdd: (title: string) => void,
  ) {
    this.form = form;
    this.input = input;
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submit();
    });
  }

  private submit(): void {
    const title = this.input.value;
    if (title.trim().length === 0) return; // empty titles are rejected silently
    this.onAdd(title);
    this.input.value = "";
    this.input.focus();
  }

  /** Give the input keyboard focus (used when the popup opens). */
  focus(): void {
    this.input.focus();
  }

  get hasFocus(): boolean {
    return document.activeElement === this.input;
  }
}
