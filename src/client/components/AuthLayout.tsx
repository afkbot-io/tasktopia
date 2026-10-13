import type { ReactNode } from 'react';
import { AuthWorldScene } from './AuthWorldScene';
import { GameIcon } from './ui';

export function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-screen auth-game-entry">
    <section className="auth-landscape" aria-label="Город Tasktopia">
      <div className="auth-entry-brand"><GameIcon name="world" /><span>Tasktopia</span></div>
      <div className="auth-city-viewport" aria-hidden="true"><AuthWorldScene /></div>
      <div className="auth-landscape-copy"><p>Задачи становятся зданиями.</p></div>
    </section>
    <section className="auth-form-section">{children}</section>
  </main>;
}
