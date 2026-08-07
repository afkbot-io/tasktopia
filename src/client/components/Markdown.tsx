import { Fragment, type ReactNode } from "react";

/**
 * Lightweight, safe Markdown subset renderer for task content that arrives
 * through MCP: headings, bold, italic, inline code, fenced code blocks,
 * ordered/unordered lists, links and plain paragraphs. It produces React
 * nodes directly (no dangerouslySetInnerHTML) and only links out to
 * http(s) URLs, so pasted content cannot inject markup or scripts.
 */

const INLINE_PATTERN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\(\s*https?:\/\/[^)\s]+\s*\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [token] = match;
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const labelEnd = token.indexOf("](");
      const label = token.slice(1, labelEnd);
      const url = token.slice(labelEnd + 2, -1).trim();
      nodes.push(<a key={key} href={url} target="_blank" rel="noreferrer noopener">{label}</a>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let blockIndex = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const content = paragraph.join("\n");
    blocks.push(
      <p key={`p-${blockIndex++}`}>
        {content.split("\n").map((line, lineIndex) => (
          <Fragment key={lineIndex}>
            {lineIndex > 0 && <br />}
            {renderInline(line, `p${blockIndex}-${lineIndex}`)}
          </Fragment>
        ))}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `li${blockIndex}-${itemIndex}`)}</li>);
    blocks.push(list.ordered ? <ol key={`l-${blockIndex++}`}>{items}</ol> : <ul key={`l-${blockIndex++}`}>{items}</ul>);
    list = null;
  };

  for (const line of lines) {
    if (code !== null) {
      if (line.trimStart().startsWith("```")) {
        blocks.push(<pre key={`c-${blockIndex++}`}><code>{code.join("\n")}</code></pre>);
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      code = [];
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      const content = renderInline(heading[2]!, `h${blockIndex}`);
      if (level <= 2) blocks.push(<h4 key={`h-${blockIndex++}`}>{content}</h4>);
      else blocks.push(<h5 key={`h-${blockIndex++}`}>{content}</h5>);
      continue;
    }
    const unordered = /^[-*+]\s+(.*)$/.exec(trimmed);
    const ordered = /^\d{1,3}[.)]\s+(.*)$/.exec(trimmed);
    if (unordered || ordered) {
      flushParagraph();
      const wantOrdered = Boolean(ordered);
      if (!list || list.ordered !== wantOrdered) {
        flushList();
        list = { ordered: wantOrdered, items: [] };
      }
      list.items.push((unordered?.[1] ?? ordered?.[1])!);
      continue;
    }
    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (code !== null) blocks.push(<pre key={`c-${blockIndex++}`}><code>{code.join("\n")}</code></pre>);
  flushParagraph();
  flushList();

  return <div className={className ? `markdown ${className}` : "markdown"}>{blocks}</div>;
}
