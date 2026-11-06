import { parseTex, type TexNode } from './math-text';

/**
 * The share card's arithmetic: pure. The card is drawn by satori, which has no
 * TeX and no clip paths, so its title is flattened to text and the shaded part
 * of the curve is a path of its own.
 */

const GREEK =
  /\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega)(?![A-Za-z])/g;
const GREEK_LETTER: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

function flatTex(tex: string): string {
  return tex
    .replace(GREEK, (_all, name: string) => GREEK_LETTER[name])
    .replace(/\\[A-Za-z]+/g, '')
    .replace(/[{}^_\\$]/g, '')
    .trim();
}

function flatNodes(nodes: TexNode[]): string {
  return nodes.map((n) => (typeof n === 'string' ? n : 'math' in n ? flatTex(n.math) : flatNodes(n.children))).join('');
}

/** A title or abstract with its TeX as plain text: `$\alpha$-NET` is `α-NET`. */
export function plainText(text: string): string {
  return flatNodes(parseTex(text)).replace(/\s+/g, ' ').trim();
}

export interface CardCurve {
  line: string;
  area: string;
  /** The area left of the mean, to shade. */
  below: string;
  /** Where the paper's mean falls. */
  x: number;
  y: number;
}

/** A density `curve` across `domain`, peaking at 1, in a box of `width` × `height`, with `mean` marked. */
export function cardCurve(
  curve: readonly number[],
  domain: readonly [number, number],
  mean: number,
  width: number,
  height: number,
): CardCurve {
  const [lo, hi] = domain;
  const last = curve.length - 1;
  const px = (i: number) => (i / last) * width;
  const py = (y: number) => height - y * height;
  const round = (n: number) => n.toFixed(1);
  const at = (Math.min(hi, Math.max(lo, mean)) - lo) / (hi - lo);
  const position = at * last;
  const left = Math.floor(position);
  const t = position - left;
  const y = curve[left] + (curve[Math.min(last, left + 1)] - curve[left]) * t;
  const x = at * width;
  const trace = (points: readonly (readonly [number, number])[]) =>
    points.map(([a, b], i) => `${i ? 'L' : 'M'}${round(a)},${round(b)}`).join('');
  const all = curve.map((v, i) => [px(i), py(v)] as const);
  const upTo = [...all.slice(0, left + 1), [x, py(y)] as const];
  return {
    line: trace(all),
    area: `${trace(all)}L${round(width)},${height}L0,${height}Z`,
    below: `${trace(upTo)}L${round(x)},${height}L0,${height}Z`,
    x,
    y: py(y),
  };
}
