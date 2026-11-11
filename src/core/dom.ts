/** Get one element. Throws if it is missing, so a typo in a selector fails at start-up. */
export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/** Call `onPick` with the button that was clicked inside a segmented control. */
export function segmented(el: HTMLElement, onPick: (button: HTMLButtonElement) => void): void {
  el.addEventListener('click', e => {
    const b = (e.target as Element).closest('button');
    if (b) onPick(b);
  });
}

/** Mark the button whose `data-<attr>` equals `val` as pressed, and the others as not pressed. */
export function setPressed(el: HTMLElement, attr: string, val: string): void {
  $$('button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === val)));
}
