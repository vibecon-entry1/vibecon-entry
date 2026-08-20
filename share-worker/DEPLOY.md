# sb-share — the unfurl worker

`worker.js` is the whole thing: one stateless module worker that turns

```
https://sb-share.vibecon-entry.workers.dev/?s=12437&k=9&d=2&m=g
```

into a page whose OpenGraph tags say *"i got 12437 WOW in SUCH BLAST"* over the
`10k+` tier card. The game copies that URL to your clipboard when you press **S**
on an end screen; nothing else in the repo ever calls it.

It stores nothing, logs nothing, and has no bindings — the entire state of a
share is the query string, which is why it needs no KV, no D1 and no account
data at runtime.

## why no wrangler

Adding wrangler would add ~200 npm packages to a repo whose whole pitch is
*zero dependencies*. The Workers REST API takes the same upload directly:

```bash
CF_ENV=/path/to/cloudflare.env ./share-worker/deploy.sh
```

`deploy.sh` does exactly two calls:

1. `PUT /accounts/{id}/workers/scripts/sb-share` — multipart body, a `metadata`
   part naming the entry module plus `worker.js` as
   `application/javascript+module`.
2. `POST /accounts/{id}/workers/scripts/sb-share/subdomain` `{"enabled":true}` —
   routes it on `*.workers.dev`. Idempotent.

The credentials (`CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_SUBDOMAIN`) live in a file
**outside this repo** and are never echoed. Nothing secret is committed here.

First deploy can 500 (`error code: 1104`) for a few seconds while the
workers.dev route propagates. Poll the URL rather than re-uploading.

## contract

| request | response |
|---|---|
| `GET /?s&k&d&m` | 200 `text/html`, og + twitter tags, meta-refresh to the game |
| `HEAD`, `POST`, anything else | 405 with `Allow: GET` |

- `s` — score. Clamped to `[-100000, 9999999]`. **Negative is legal**: the
  respawn economy docks 100 WOW a death, so a bad run genuinely ends below zero
  and unfurls into the `SUCH ATTEMPT` card.
- `k`, `d` — kills, deaths. Clamped to `[0, 9999999]`.
- `m` — `g` (gauntlet) or `w` (WOW ZONE). Anything else reads as `g`.
- Keys are matched case-insensitively, because the game's no-clipboard fallback
  prints the URL in a CAPS-only bitmap font for hand-copying.
- Junk parses to 0 rather than erroring — a mangled link still unfurls.

`og:image` points at `web/share/card-{tier}.png` on the **Pages** domain, not at
the worker: the cards are committed art, the worker is text.

## verified live

```
$ curl -s 'https://sb-share.vibecon-entry.workers.dev/?s=12437&k=9&d=2&m=g'
<meta property="og:title" content="i got 12437 WOW in SUCH BLAST">
<meta property="og:description" content="9 kills · 2 deaths · gauntlet · the gun is your legs.">
<meta property="og:image" content="https://vibecon-entry1.github.io/vibecon-entry/share/card-10.png">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=https://vibecon-entry1.github.io/vibecon-entry/">

$ curl -s '...?s=-100&k=0&d=3&m=w' | grep og:image
<meta property="og:image" content=".../share/card-0.png">     # negative → SUCH ATTEMPT

$ curl -sI '...?s=1' | head -1
HTTP/2 405
```
