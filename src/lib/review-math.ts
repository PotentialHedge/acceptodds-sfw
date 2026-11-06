/**
 * Reviews' TeX as `Markdown` can set it: pure. Reviews come from a source that
 * wrote math every way there is and then escaped it as Markdown, so a paper's
 * `$a\_{ij}$` and `\\(\\mathrm{x}\\)` reach us where KaTeX would read a text
 * underscore and a line break. Everything here touches only what is taken for
 * math; code is left alone, and so is prose in escaped brackets (`\[1\]`).
 */

/** A `$` is math only under pandoc's rule: nothing blank inside its edges, and no digit after, so `$5 and $6` is money. */
const MATH_SPAN = /\$\$([\s\S]+?)\$\$|(?<![\\$\w])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\d$])/g;
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;
const DISPLAY = /(\\{1,2})\[([\s\S]*?)\1\]/g;
const INLINE = /(\\{1,2})\(((?:(?!\n\n)[\s\S])*?)\1\)/g;

/** Undoes the Markdown escaping of TeX. A `\\` in an environment is a real line break, so it stays. */
export function cleanTex(tex: string): string {
  const inEnvironment = /(^|[^\\])\\begin\{/.test(tex);
  const single = inEnvironment ? tex : tex.replace(/\\\\(?=[A-Za-z_^*])/g, '\\');
  return single.replace(/(^|[^\\])\\([_*^[\]<+\-()])/g, '$1$2').trim();
}

/** Whether `\[…\]` holds math, not a bracket someone escaped: `\[1\]`, `\[Smith, 2020\]`. */
function isDisplayMath(tex: string): boolean {
  return /[\\^_=]/.test(tex) || tex.trim().includes('\n');
}

/** Whether `\(…\)` holds math, not a parenthesis someone escaped: `\(see above\)`. */
function isInlineMath(tex: string): boolean {
  return tex.trim() !== '' && (/[\\^_={}<>+*/|]/.test(tex) || !/\p{L}{4,}/u.test(tex));
}

function prose(text: string): string {
  const spans: string[] = [];
  const hold = (span: string) => `\0${spans.push(span) - 1}\0`;
  return text
    .replace(DISPLAY, (all, _s, tex: string) =>
      isDisplayMath(tex) ? `\n\n${hold(`$$\n${cleanTex(tex)}\n$$`)}\n\n` : all,
    )
    .replace(INLINE, (all, _s, tex: string) => (isInlineMath(tex) ? hold(`$${cleanTex(tex)}$`) : all))
    .replace(MATH_SPAN, (_all, double: string | undefined, single: string | undefined) =>
      hold(double !== undefined ? `$$${cleanTex(double)}$$` : `$${cleanTex(single!)}$`),
    )
    .replace(/(?<!\\)\$/g, '\\$')
    .replace(/\0(\d+)\0/g, (_all, i: string) => spans[Number(i)]);
}

/** `text`, a review's Markdown, with its math in the `$…$` and `$$…$$` that `Markdown` reads and any other `$` escaped. */
export function reviewMath(text: string): string {
  return text
    .split(CODE)
    .map((part, i) => (i % 2 === 1 ? part : prose(part)))
    .join('');
}
