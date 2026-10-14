import { safeReturnTo } from '@/lib/return-to';
import { NEXT_HEADER } from '@/lib/sfw';

/**
 * The gate (`proxy.ts` rewrites every page here until a browser has gone
 * past it): the market edition's maintenance page, `maintenance/index.html`,
 * plus a button into the safe for work edition. Plain HTML outside the root
 * layout, as the maintenance page is. The button posts to `/enter` with the
 * page that was asked for.
 */
export async function GET(request: Request) {
  const next = safeReturnTo(request.headers.get(NEXT_HEADER));
  const escaped = next.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return new Response(PAGE.replace('__NEXT__', escaped), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>acceptodds</title>
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
      }
      body {
        display: flex;
        flex-direction: column;
        padding: 0 16px;
        background: #fbfaf7;
        color: #1d1d1d;
        font-family: Georgia, 'Times New Roman', serif;
        text-align: center;
      }
      main {
        flex: 1;
        display: flex;
        align-items: center;
        flex-direction: column;
        justify-content: center;
        gap: 24px;
      }
      h1 {
        margin: 0;
        font: inherit;
        font-size: 44px;
      }
      /* The header's wordmark (components/Wordmark): "accept" in ink, "odds" in the accent. */
      main i {
        font-style: normal;
        color: #b31b1b;
      }
      /* The first-trade page's X share button (components/ShareButtons). */
      .x {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 16px;
        background: #000;
        color: #fff;
        font:
          600 14px/normal -apple-system,
          'Segoe UI',
          Helvetica,
          Arial,
          sans-serif;
        text-decoration: none;
      }
      .x:hover {
        opacity: 0.9;
      }
      .x svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }
      .updates p {
        margin: 0 0 8px;
        color: #777;
        font-size: 15px;
      }
      footer {
        padding: 16px 0;
        font-size: 13px;
      }
      footer a {
        color: #777;
        text-decoration: none;
      }
      /* Into the safe for work edition: the site's own button (components/ui.ts btn), in the accent. */
      form {
        margin: 8px 0 0;
      }
      .enter {
        padding: 10px 20px;
        border: 1px solid #b31b1b;
        background: #b31b1b;
        color: #fff;
        font: inherit;
        font-size: 17px;
        cursor: pointer;
      }
      .enter:hover {
        background: #8f1515;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>accept<i>odds</i></h1>
      <div class="updates">
        <p>For updates:</p>
        <a
          class="x"
          href="https://x.com/uptosomestuff/status/2110108404882551209"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
            />
          </svg>
          Follow on X
        </a>
      </div>
      <form method="post" action="/enter">
        <input type="hidden" name="next" value="__NEXT__" />
        <button type="submit" class="enter">Take me to the Safe for work edition &rarr;</button>
      </form>
    </main>
    <footer><a href="mailto:mail@acceptodds.com">mail@acceptodds.com</a></footer>
  </body>
</html>
`;
