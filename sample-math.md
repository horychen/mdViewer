# Math rendering check

## Inline, dollar form

Einstein wrote $E = mc^2$, and the golden ratio is $\varphi = \frac{1+\sqrt5}{2}$.

## Inline, LaTeX form

The same thing as \(E = mc^2\), plus a subscript \(a_1 + a_2 + \dots + a_n\).

## Display, dollar form

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

## Display, LaTeX form

\[
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
\]

## A wide one (should scroll, not stretch the page)

$$
f(x) = a_0 + a_1x + a_2x^2 + a_3x^3 + a_4x^4 + a_5x^5 + a_6x^6 + a_7x^7 + a_8x^8 + a_9x^9 + a_{10}x^{10} + a_{11}x^{11}
$$

## Matrices and cases

$$
A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}
\qquad
|x| = \begin{cases} x & x \ge 0 \\ -x & x < 0 \end{cases}
$$

## Things that must NOT become math

Prices: $100 and $200 are plain text.

Inline code stays literal: `\(x^2\)` and `$a+b$`.

Fenced code stays literal:

```js
const label = "\\(not math\\)";
const price = "$100 and $200";
```

## A deliberately broken formula

This one is malformed: $\frac{1}{$ — it should show up in red without killing
the rest of the page.

Text after the broken formula still renders.
