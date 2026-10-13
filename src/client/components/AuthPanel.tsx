import type { ReactNode } from 'react';
import { GameIcon } from './ui';

/** Account forms use the same header, surface and controls as the game panels. */
export function AuthPanel({ title, headingLevel = 1, children }: { title: string; headingLevel?: 1 | 2; children: ReactNode }) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return <div className="auth-panel">
    <header className="auth-panel-head"><GameIcon name="world" /><Heading>{title}</Heading></header>
    <div className="auth-panel-body">{children}</div>
  </div>;
}
