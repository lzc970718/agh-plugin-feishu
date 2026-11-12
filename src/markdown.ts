// `[label](body)` and `![alt](body)`. The body is parsed in the replacer, not in the regex: overlapping
// whitespace and optional groups here backtrack quadratically on an unterminated `[a](   ...`.
const LINK = /(!?)\[([^\[\]]*)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g
// The url is `<...>` or the first whitespace-separated token; whatever follows is a title and is dropped.
const ANGLED = /^<([^<>\n]*)>/
// Feishu markup such as <at user_id="all"></at>; a zero-width space after `<` stops it parsing, text looks the same.
const TAG = /<(?=[A-Za-z/])(?!https?:\/\/)/gi
// Whatever LINK misses (escaped brackets, reference links, definitions) must not parse as a link either.
const LINK_SEQUENCE = /\]([(\[:])/g
/**
 * Model output may be steered by web pages, so Markdown must not hide where a link goes or mention people.
 * One pass turns links into `label（url）`; every `](`, `][` and `]:` left over gets a zero-width space so a
 * renderer that parses links differently from LINK still shows the destination as text. Feishu tags are
 * defused too. Applied everywhere, code included, so a parser disagreement over code spans opens no bypass.
 */
export function neutralizeMarkdown(text: string): string {
  return text
    .replace(LINK, (_all, _bang: string, label: string, body: string) => {
      const inside = body.trim()
      const url = (ANGLED.exec(inside)?.[1] ?? inside.split(/\s/, 1)[0] ?? '').trim()
      const shown = label.trim()
      if (!url) return shown
      if (!shown || shown === url) return url
      return `${shown}（${url}）`
    })
    .replace(LINK_SEQUENCE, ']\u200b$1')
    .replace(TAG, '<\u200b')
}
