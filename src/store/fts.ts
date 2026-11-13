// Code-friendly tokenization for FTS5. SQLite cannot load a custom tokenizer through
// better-sqlite3, so text is expanded here before it is indexed or queried: every identifier
// is kept whole and also split into its camelCase and snake_case parts.

const WORD = /[\p{L}\p{N}_$]+/gu;

/** `parseHTTPResponse` gives `['parse', 'http', 'response']`; `find_user` gives `['find', 'user']`. */
export function identifierParts(identifier: string): string[] {
  return identifier
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[\s_$]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

/** Every identifier in lower case, followed by its parts when it has more than one. */
export function expandTerms(text: string): string[] {
  const out: string[] = [];
  for (const word of text.match(WORD) ?? []) {
    const parts = identifierParts(word);
    out.push(word.toLowerCase());
    if (parts.length > 1) out.push(...parts);
  }
  return out;
}

/** The text stored in the FTS index for a piece of code, a symbol name, or a path. */
export const expandForIndex = (text: string): string => expandTerms(text).join(' ');
