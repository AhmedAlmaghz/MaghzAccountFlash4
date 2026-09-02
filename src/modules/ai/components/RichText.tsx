import { memo } from 'react';
import { cn } from '@/core/utils';

/**
 * Lightweight rich-text renderer for assistant messages.
 *
 * Supports the formatting the AI emits: **bold**, *italic*, `code`,
 * ##/### headings, bullet `-` / numbered `1.` lists, pipe tables,
 * ``` fenced code blocks, blockquotes, and blank-line paragraphs.
 * RTL-aware + dark-mode friendly. No external markdown dependency.
 */

interface RichTextProps {
  text: string;
  className?: string;
}

type Block =
  | { type: 'heading'; level: 2 | 3 | 4; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'code'; content: string }
  | { type: 'quote'; content: string }
  | { type: 'spacer' };

/** Split inline text on **bold**, *italic*, and `code` markers. */
function renderInline(content: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  // Split on code first, then bold, then italic within non-code segments.
  const codeParts = content.split(/(`[^`]+`)/g);

  codeParts.forEach((part, ci) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${ci}`}
          className="px-1 py-0.5 rounded bg-zinc-950/10 dark:bg-white/15 text-[0.85em] font-mono text-zinc-800 dark:text-zinc-100"
        >
          {part.slice(1, -1)}
        </code>
      );
      return;
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    boldParts.forEach((bp, bi) => {
      if (bp.startsWith('**') && bp.endsWith('**') && bp.length >= 4) {
        nodes.push(
          <strong key={`${keyPrefix}-b-${ci}-${bi}`} className="font-bold">
            {bp.slice(2, -2)}
          </strong>
        );
        return;
      }
      const italicParts = bp.split(/(\*[^*]+\*)/g);
      italicParts.forEach((ip, ii) => {
        if (ip.startsWith('*') && ip.endsWith('*') && ip.length >= 3) {
          nodes.push(
            <em key={`${keyPrefix}-i-${ci}-${bi}-${ii}`} className="italic">
              {ip.slice(1, -1)}
            </em>
          );
          return;
        }
        if (ip) nodes.push(<span key={`${keyPrefix}-t-${ci}-${bi}-${ii}`}>{ip}</span>);
      });
    });
  });

  return nodes;
}

/** Parse raw text into structured blocks. */
function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: 'code', content: code.join('\n') });
      continue;
    }

    // Blank line → spacer (collapse consecutive)
    if (trimmed === '') {
      if (blocks[blocks.length - 1]?.type !== 'spacer') {
        blocks.push({ type: 'spacer' });
      }
      i++;
      continue;
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{2,4})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: Math.min(headingMatch[1].length, 4) as 2 | 3 | 4,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Pipe table block
    if (line.trimStart().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const dataLines = tableLines.filter((l) => !/^\|[\s\-:]+\|$/.test(l.trim()));
      if (dataLines.length >= 2) {
        const headers = dataLines[0].split('|').map((h) => h.trim()).filter(Boolean);
        const rows = dataLines.slice(1).map((r) =>
          r.split('|').map((c) => c.trim()).filter(Boolean)
        );
        blocks.push({ type: 'table', headers, rows });
      } else {
        blocks.push({ type: 'paragraph', content: tableLines.join('\n') });
      }
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', content: quote.join(' ') });
      continue;
    }

    // List — collect consecutive bullet/numbered lines
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (orderedMatch || bulletMatch) {
      const ordered = !!orderedMatch;
      const items: string[] = [];
      while (i < lines.length) {
        const li = lines[i].trim();
        const om = li.match(/^\d+[.)]\s+(.*)$/);
        const bm = li.match(/^[-*•]\s+(.*)$/);
        if (ordered && om) {
          items.push(om[1]);
          i++;
        } else if (!ordered && bm) {
          items.push(bm[1]);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Regular paragraph
    blocks.push({ type: 'paragraph', content: trimmed });
    i++;
  }

  return blocks;
}

export const RichText = memo(function RichText({ text, className }: RichTextProps) {
  const blocks = parseBlocks(text);

  return (
    <div dir="auto" className={cn('space-y-1.5', className)}>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading': {
            const headingClass =
              block.level === 2
                ? 'text-base font-bold mt-1 text-zinc-900 dark:text-zinc-50'
                : block.level === 3
                  ? 'text-sm font-bold text-zinc-900 dark:text-zinc-100'
                  : 'text-sm font-semibold text-zinc-600 dark:text-zinc-300';
            const Tag = block.level === 2 ? 'h3' : block.level === 3 ? 'h4' : 'h5';
            return (
              <Tag key={idx} className={headingClass}>
                {renderInline(block.content, `h${idx}`)}
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p key={idx} className="whitespace-pre-wrap">
                {renderInline(block.content, `p${idx}`)}
              </p>
            );
          case 'list':
            if (block.ordered) {
              return (
                <ol key={idx} className="list-decimal ps-5 space-y-0.5">
                  {block.items.map((item, li) => (
                    <li key={li}>{renderInline(item, `ol${idx}-${li}`)}</li>
                  ))}
                </ol>
              );
            }
            return (
              <ul key={idx} className="list-disc ps-5 space-y-0.5">
                {block.items.map((item, li) => (
                  <li key={li}>{renderInline(item, `ul${idx}-${li}`)}</li>
                ))}
              </ul>
            );
          case 'table':
            return (
              <div key={idx} className="overflow-x-auto my-1">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {block.headers.map((h, hi) => (
                        <th
                          key={hi}
                          className="border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-700 px-2 py-1 text-start font-semibold text-zinc-700 dark:text-zinc-200"
                        >
                          {renderInline(h, `th${idx}-${hi}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr key={ri} className={ri % 2 === 0 ? 'bg-white/60 dark:bg-zinc-800/40' : 'bg-transparent'}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="border border-zinc-300 dark:border-zinc-600 px-2 py-1 text-start text-zinc-700 dark:text-zinc-300"
                          >
                            {renderInline(cell, `td${idx}-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'code':
            return (
              <pre
                key={idx}
                className="p-2 rounded-lg bg-zinc-950/5 dark:bg-white/10 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap"
              >
                {block.content}
              </pre>
            );
          case 'quote':
            return (
              <blockquote
                key={idx}
                className="border-s-2 border-primary-300 dark:border-primary-700 ps-3 text-zinc-600 dark:text-zinc-300 italic"
              >
                {renderInline(block.content, `q${idx}`)}
              </blockquote>
            );
          case 'spacer':
            return <div key={idx} className="h-1" />;
          default:
            return null;
        }
      })}
    </div>
  );
});
