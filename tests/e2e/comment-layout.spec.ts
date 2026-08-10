import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("keeps every Markdown block in a task comment at full readable width", async ({ page }) => {
  const styles = await readFile("src/client/styles.css", "utf8");
  await page.setContent(`
    <style>${styles}</style>
    <section class="task-modal">
      <section class="comments">
        <article>
          <div class="comment-meta"><strong>Автор</strong><time>09.08.2026</time></div>
          <div class="markdown">
            <p>Первый абзац комментария с нормальной длиной строки.</p>
            <p>Второй абзац содержит <code>naturalWidth</code> и не должен превращаться в отдельную колонку.</p>
            <pre><code>npm test\nnpm run lint\nnpm run typecheck</code></pre>
          </div>
        </article>
      </section>
    </section>
  `);

  const markdown = page.locator(".comments article > .markdown");
  await expect(markdown).toHaveCSS("display", "block");
  const widths = await markdown.evaluate((element) => ({
    container: element.getBoundingClientRect().width,
    paragraphs: [...element.querySelectorAll("p")].map((paragraph) => paragraph.getBoundingClientRect().width),
  }));
  expect(Math.min(...widths.paragraphs)).toBeGreaterThan(widths.container * 0.9);
});

test("keeps task documents and checklist readable without horizontal overflow", async ({ page }) => {
  const styles = await readFile("src/client/styles.css", "utf8");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <style>${styles}</style>
    <section class="task-modal">
      <section class="task-documents">
        <div class="task-section-title"><div><h3>Материалы для реализации</h3><p>Markdown-документы обновляются AI-агентами через MCP.</p></div><span>4/5</span></div>
        <div class="task-document-shelf">
          <button class="filled selected"><i>MD</i><span><strong>Системный анализ</strong><small>system-analysis.md</small></span><b>›</b></button>
          <button class="filled"><i>MD</i><span><strong>Архитектура</strong><small>architecture.md</small></span><b>›</b></button>
        </div>
        <article class="task-document-preview"><header><div><strong>Системный анализ</strong><code>system-analysis.md</code></div><small>AI Agent · 09.08.2026</small></header><div class="markdown"><p>Длинный связный текст остаётся одной читаемой колонкой и не распадается на отдельные узкие слова.</p><pre><code>npm test\nnpm run typecheck</code></pre></div></article>
      </section>
      <section class="task-checklist"><div class="task-section-title"><div><h3>Чек-лист</h3></div><span>1/2</span></div><ol><li class="done"><i>✓</i><span>Добавить миграцию</span></li><li><i></i><span>Проверить MCP-контракт</span></li></ol></section>
    </section>
  `);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const preview = page.locator(".task-document-preview .markdown");
  expect(await preview.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(250);
  await expect(page.locator(".task-checklist li")).toHaveCount(2);
});
