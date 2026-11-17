import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import { TEXT_COLORS, type TextColor } from '../../../shared/defaults';
import { escapeHtml } from '../util';

const COLOR_NAMES = Object.keys(TEXT_COLORS).join('|');
const COLOR_START = new RegExp(`\\{(?:${COLOR_NAMES})\\}`);
const COLOR_SPAN = new RegExp(`^\\{(${COLOR_NAMES})\\}([\\s\\S]+?)\\{\\/\\1\\}`);

/** {red}text{/red}: coloured words. The text inside can still be bold, italic and so on. */
const textColor: TokenizerAndRendererExtension = {
  name: 'textColor',
  level: 'inline',
  start(src) {
    const i = src.search(COLOR_START);
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const m = COLOR_SPAN.exec(src);
    if (!m) return undefined;
    return { type: 'textColor', raw: m[0], color: m[1], tokens: this.lexer.inlineTokens(m[2]) };
  },
  renderer(token) {
    const hex = TEXT_COLORS[token.color as TextColor]?.hex ?? 'inherit';
    return `<span style="color:${hex}">${this.parser.parseInline(token.tokens ?? [])}</span>`;
  },
};

/** A table whose header cells are all empty is a plain grid of boxes. */
export const tableHasHeader = (t: Tokens.Table) => t.header.some((c) => c.text.trim() !== '');

const safeHref = (href: string) => (/^(https?:|mailto:|#)/i.test(href.trim()) ? href.trim() : '#');

const md = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  extensions: [textColor],
  renderer: {
    table(token: Tokens.Table) {
      const cell = (c: Tokens.TableCell, tag: 'th' | 'td') => `<${tag}${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`;
      const head = tableHasHeader(token) ? `<thead><tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr></thead>` : '';
      const body = token.rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('');
      return `<table class="md-table">${head}<tbody>${body}</tbody></table>\n`;
    },
    // Never pass raw HTML through: SOP text is shown to every user.
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      return `<a href="${escapeHtml(safeHref(token.href))}" target="_blank" rel="noopener">${text}</a>`;
    },
    image(token: Tokens.Image) {
      return escapeHtml(token.text || '');
    },
  },
});

export function mdToHtml(text: string): string {
  if (!text?.trim()) return '';
  return md.parse(text) as string;
}

export function mdInline(text: string): string {
  if (!text?.trim()) return '';
  return md.parseInline(text) as string;
}

export function mdLexer(text: string) {
  return md.lexer(text ?? '');
}
