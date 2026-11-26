import React from 'react';

interface OttoMarkdownRendererProps {
  markdown: string;
  variant?: 'chat' | 'thinking';
}

function isSafeHttpUrl(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

/**
 * Recursively renders inline Markdown tokens (code spans, bold, italic, safe http(s) links)
 * as pure React elements — zero `dangerouslySetInnerHTML`, zero XSS risk.
 * Intentionally avoids `_italic_` so snake_case SRE identifiers (`L2_AUTO`, `NOISE_SAFE_DROP`,
 * `create_bug_handoff`) stay untouched.
 */
export function renderOttoInline(text: string, variant: 'chat' | 'thinking' = 'chat'): React.ReactNode[] {
  if (!text) return [];

  const nodes: React.ReactNode[] = [];
  // Order matters: inline code first (never parse markdown inside backticks),
  // then bold (**...**), then italic (*...*), then links ([label](url)).
  const tokenRegex =
    /(`[^`\n]+`|\*\*(?=\S)(?:(?!\*\*).)+?\*\*|\*(?=\S)(?:[^*\n]|`[^`\n]+`)+?\*|\[[^\]\n]+\]\(([^)\s]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `inl-${keyIdx++}`;

    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      nodes.push(
        <code
          key={key}
          className={
            variant === 'thinking'
              ? 'px-1 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/30 font-mono text-[11px] text-emerald-950 dark:text-emerald-300'
              : 'px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 font-mono text-[11px] text-[var(--color-brand-text)] break-words'
          }
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      nodes.push(
        <strong
          key={key}
          className={
            variant === 'thinking'
              ? 'font-bold text-emerald-950 dark:text-emerald-200'
              : 'font-semibold text-slate-950 dark:text-white'
          }
        >
          {renderOttoInline(token.slice(2, -2), variant)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
      nodes.push(
        <em
          key={key}
          className={
            variant === 'thinking'
              ? 'italic text-emerald-900/90 dark:text-emerald-300/90'
              : 'italic text-slate-700 dark:text-slate-300'
          }
        >
          {renderOttoInline(token.slice(1, -1), variant)}
        </em>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        if (isSafeHttpUrl(href)) {
          nodes.push(
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-brand-text)] hover:underline font-medium break-all"
            >
              {label}
            </a>
          );
        } else {
          nodes.push(label);
        }
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 2;
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return isTableRow(t) && /^[\s|:-]+$/.test(t) && t.includes('-');
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

/**
 * Pure React Markdown renderer for Otto's SRE prose and Deep-Thinking rundowns.
 * Supports fenced code blocks, headings (#..####), GFM tables, blockquotes,
 * ordered & unordered lists, horizontal rules, and recursive inline formatting.
 */
export const OttoMarkdownRenderer: React.FC<OttoMarkdownRendererProps> = ({
  markdown,
  variant = 'chat',
}) => {
  const raw = String(markdown || '');
  if (!raw.trim()) return null;

  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  const textBaseClass =
    variant === 'thinking'
      ? 'text-xs leading-relaxed text-emerald-900 dark:text-emerald-400'
      : 'text-xs sm:text-[13px] leading-relaxed text-slate-800 dark:text-slate-200';

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Fenced code block (```lang ... ```)
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i += 1;
      }
      blocks.push(
        <div
          key={`code-${blockKey++}`}
          className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#050b14] overflow-hidden my-2"
        >
          {lang && (
            <div className="px-3 py-1 border-b border-slate-200/80 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/90 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {lang}
            </div>
          )}
          <pre className="p-3 overflow-x-auto text-emerald-900 dark:text-emerald-400 font-mono text-xs leading-relaxed">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>
      );
      continue;
    }

    // 2. GFM Table
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableCells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div
          key={`tbl-${blockKey++}`}
          className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 my-2"
        >
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-slate-100 dark:bg-slate-800/80 text-left font-semibold text-slate-700 dark:text-slate-200">
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="py-2 px-3 whitespace-nowrap">
                    {renderOttoInline(h, variant)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {rows.map((cells, rIdx) => (
                <tr key={rIdx}>
                  {cells.map((c, cIdx) => (
                    <td key={cIdx} className="py-1.5 px-3 text-slate-700 dark:text-slate-300">
                      {renderOttoInline(c, variant)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 3. Horizontal rule
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(
        <hr
          key={`hr-${blockKey++}`}
          className="my-2.5 border-t border-slate-200 dark:border-slate-800"
        />
      );
      i += 1;
      continue;
    }

    // 4. Headings (# .. ####)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const headingClass =
        variant === 'thinking'
          ? 'text-xs font-bold text-emerald-950 dark:text-emerald-200 pt-1'
          : level === 1
          ? 'text-base font-bold text-slate-950 dark:text-white pt-1.5 border-b border-slate-200 dark:border-slate-800 pb-1'
          : level === 2
          ? 'text-sm font-bold text-slate-950 dark:text-white pt-1.5'
          : 'text-[13px] font-bold text-[var(--color-brand-text)] pt-1.5';

      if (level === 1) {
        blocks.push(
          <h2 key={`h-${blockKey++}`} className={headingClass}>
            {renderOttoInline(content, variant)}
          </h2>
        );
      } else if (level === 2) {
        blocks.push(
          <h3 key={`h-${blockKey++}`} className={headingClass}>
            {renderOttoInline(content, variant)}
          </h3>
        );
      } else {
        blocks.push(
          <h4 key={`h-${blockKey++}`} className={headingClass}>
            {renderOttoInline(content, variant)}
          </h4>
        );
      }
      i += 1;
      continue;
    }

    // 5. Blockquotes (coalesce consecutive > lines)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`bq-${blockKey++}`}
          className="border-l-4 border-[var(--color-brand)] pl-3 py-1.5 my-1.5 rounded-r-xl bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300 space-y-1"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx} className="leading-relaxed">
              {renderOttoInline(ql, variant)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    // 6. Unordered bullet list (- , * , + )
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: Array<{ text: string; indent: number }> = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const leadingSpaces = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
        items.push({
          text: lines[i].trim().replace(/^[-*+]\s+/, ''),
          indent: leadingSpaces >= 2 ? 1 : 0,
        });
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${blockKey++}`} className={`list-disc pl-5 space-y-1.5 ${textBaseClass}`}>
          {items.map((item, idx) => (
            <li key={idx} className={item.indent > 0 ? 'ml-4 list-[circle]' : ''}>
              {renderOttoInline(item.text, variant)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 7. Ordered numbered list (1. , 2. , ...)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${blockKey++}`} className={`list-decimal pl-5 space-y-1.5 ${textBaseClass}`}>
          {items.map((item, idx) => (
            <li key={idx}>{renderOttoInline(item, variant)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // 8. Standard paragraph (coalesce consecutive plain lines until blank/block token)
    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        next.startsWith('```') ||
        next.startsWith('#') ||
        next.startsWith('>') ||
        /^[-*+]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^(\-{3,}|\*{3,}|_{3,})$/.test(next) ||
        isTableRow(next)
      ) {
        break;
      }
      paraLines.push(next);
      i += 1;
    }

    blocks.push(
      <p key={`p-${blockKey++}`} className={textBaseClass}>
        {renderOttoInline(paraLines.join(' '), variant)}
      </p>
    );
  }

  return <div className="space-y-2.5 break-words">{blocks}</div>;
};
