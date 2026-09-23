import { useEffect, useRef } from "react";

/** All header disclosures share outside/Escape behavior, including keyboard
 * activation. Nested mobile tools keep their parent menu open. */
export function useToolbarDisclosure() {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const outside = (event: PointerEvent) => {
      if (node.open && event.target instanceof Node && !node.contains(event.target)) node.open = false;
    };
    const toggle = () => {
      if (!node.open) return;
      for (const other of document.querySelectorAll<HTMLDetailsElement>('.map-toolbar details[open]')) {
        if (other !== node && !other.contains(node) && !node.contains(other)) other.open = false;
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !node.open || node.querySelector('details[open]')) return;
      node.open = false;
      node.querySelector('summary')?.focus();
      event.stopImmediatePropagation();
    };
    node.addEventListener('toggle', toggle);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      node.removeEventListener('toggle', toggle);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return root;
}
