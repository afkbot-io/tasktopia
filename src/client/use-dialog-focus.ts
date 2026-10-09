import { useEffect, useRef, type RefObject } from "react";

const stack: HTMLElement[] = [];
const isolated = new Map<HTMLElement, { count: number; previous: boolean }>();

/** Isolate only sibling branches, preserving existing inert state and nested dialogs. */
function isolate(dialog: HTMLElement) {
  const nodes: HTMLElement[] = [];
  for (let branch: HTMLElement | null = dialog; branch?.parentElement; branch = branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
      const state = isolated.get(sibling) ?? { count: 0, previous: sibling.inert };
      state.count++; isolated.set(sibling, state); sibling.inert = true; nodes.push(sibling);
    }
    if (branch.parentElement === document.body) break;
  }
  return () => {
    for (const node of nodes) {
      const state = isolated.get(node)!;
      if (--state.count === 0) { node.inert = state.previous; isolated.delete(node); }
    }
  };
}

export function useDialogFocus(ref: RefObject<HTMLElement | null>, { onClose, active = true }: { onClose?: () => void; active?: boolean } = {}) {
  const close = useRef(onClose);
  const savedFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !active) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = isolate(dialog);
    stack.push(dialog);
    const isTop = () => stack.at(-1) === dialog;
    const targets = () => [...dialog.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, [tabindex]")]
      .filter(node => node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden");
    dialog.tabIndex = -1;
    const focusFirst = () => (targets()[0] ?? dialog).focus({ preventScroll: true });
    const resume = savedFocus.current;
    if (resume && dialog.contains(resume) && resume.getClientRects().length) resume.focus({ preventScroll: true });
    else focusFirst();
    const contain = (event: FocusEvent) => {
      if (!isTop() || !(event.target instanceof HTMLElement)) return;
      if (dialog.contains(event.target)) savedFocus.current = event.target;
      else focusFirst();
    };
    const trap = (event: KeyboardEvent) => {
      if (!isTop()) return;
      // Nested disclosures consume Escape in capture before it reaches the dialog.
      if (event.key === "Escape" && close.current) { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = targets(), first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", trap);
    const outsideKey = (event: KeyboardEvent) => {
      // Removing a focused retry control can leave focus on body without focusin.
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target)) trap(event);
    };
    document.addEventListener("keydown", outsideKey, true);
    document.addEventListener("focusin", contain);
    return () => {
      dialog.removeEventListener("keydown", trap); document.removeEventListener("focusin", contain);
      document.removeEventListener("keydown", outsideKey, true);
      stack.splice(stack.indexOf(dialog), 1); release();
      if (previous?.isConnected && !previous.closest("[inert]")) previous.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
