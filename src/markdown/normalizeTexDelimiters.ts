/**
 * Rewrites LaTeX-native math delimiters into the dollar-sign form that
 * `remark-math` understands.
 *
 *   \(x^2\)  ->  $x^2$
 *   \[y = 1\] -> $$y = 1$$
 *
 * This has to run on the raw source, before Markdown parsing. CommonMark
 * treats every ASCII punctuation character as escapable, so `\(` is parsed as
 * an escaped `(` and the backslash is gone by the time an mdast plugin could
 * look at it -- at that point `\(x\)` and a literal `(x)` are identical.
 *
 * Code stays untouched: fenced blocks and inline code spans are skipped so
 * Markdown files that document these delimiters keep rendering their examples
 * verbatim.
 *
 * Known limitation: indented (four-space) code blocks are not detected.
 */

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE_PATTERN = /(`+)[\s\S]*?\1/g;
const DISPLAY_MATH_PATTERN = /\\\[([\s\S]+?)\\\]/g;
const INLINE_MATH_PATTERN = /\\\(([\s\S]+?)\\\)/g;

function replaceDelimiters(text: string): string {
  return text
    .replace(
      DISPLAY_MATH_PATTERN,
      // `remark-math` only produces a block-level `math` node when the `$$`
      // fence sits on its own line, so force line breaks around it.
      (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`,
    )
    .replace(INLINE_MATH_PATTERN, (_match, body: string) => `$${body}$`);
}

/** Applies the rewrite to everything except inline code spans. */
function transformChunk(chunk: string): string {
  let result = "";
  let lastIndex = 0;

  INLINE_CODE_PATTERN.lastIndex = 0;
  let match = INLINE_CODE_PATTERN.exec(chunk);

  while (match) {
    result += replaceDelimiters(chunk.slice(lastIndex, match.index));
    result += match[0];
    lastIndex = match.index + match[0].length;
    match = INLINE_CODE_PATTERN.exec(chunk);
  }

  return result + replaceDelimiters(chunk.slice(lastIndex));
}

export function normalizeTexDelimiters(source: string): string {
  const lines = source.split("\n");
  const output: string[] = [];
  let pending: string[] = [];
  let openFence: string | null = null;

  const flushPending = () => {
    if (pending.length) {
      output.push(transformChunk(pending.join("\n")));
      pending = [];
    }
  };

  for (const line of lines) {
    const fence = FENCE_PATTERN.exec(line)?.[1];

    if (openFence) {
      // Only a fence of the same character and at least the same length closes.
      if (fence && fence[0] === openFence[0] && fence.length >= openFence.length) {
        openFence = null;
      }
      output.push(line);
      continue;
    }

    if (fence) {
      flushPending();
      openFence = fence;
      output.push(line);
      continue;
    }

    pending.push(line);
  }

  flushPending();

  return output.join("\n");
}
