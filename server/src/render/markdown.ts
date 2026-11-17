import { Marked, type Tokens } from 'marked';
import { escapeHtml } from '../util';

const safeHref = (href: string) => (/^(https?:|mailto:|#)/i.test(href.trim()) ? href.trim() : '#');

const md = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
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
