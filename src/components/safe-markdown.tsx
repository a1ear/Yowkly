import { Fragment } from 'react';

/**
 * A deliberately tiny Markdown subset rendered as React elements: paragraphs,
 * "- " lists, "## " headings, **bold** and `code`. No raw HTML and no links,
 * so user descriptions can never inject markup or phishing URLs.
 */
export function SafeMarkdown({ text }: { text: string | null }) {
  if (!text) return null;
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-ink-2">
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="m-0 flex list-disc flex-col gap-1 pl-5 marker:text-ink-3">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>)}
            </ul>
          );
        }
        if (/^#{1,3} /.test(block)) {
          return <h3 key={i} className="m-0 mt-2 text-lg font-semibold text-ink">{inline(block.replace(/^#{1,3} /, ''))}</h3>;
        }
        return (
          <p key={i} className="m-0">
            {lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}
          </p>
        );
      })}
    </div>
  );
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="rounded-xs bg-surface-2 px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    return part;
  });
}
