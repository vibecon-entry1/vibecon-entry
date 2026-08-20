// Static server for web/ with correct MIME for ES modules. Usage: node tools/serve.mjs [port]
// Also speaks HTTP Range (206) — HTMLAudioElement streams music by asking for
// byte ranges, and a server that only ever answers 200-with-the-whole-file makes
// "streaming" a 3MB blocking download.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { createReadStream } from 'node:fs';

const ROOT = new URL('../web/', import.meta.url).pathname;
const PORT = Number(process.argv[2] ?? 8123);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.css': 'text/css',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};

http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) throw new Error('traversal');
    const type = MIME[extname(file)] ?? 'application/octet-stream';

    const range = req.headers.range;
    if (range) {
      const size = (await stat(file)).size;
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        // Open-ended suffix forms are both legal: "bytes=500-" and "bytes=-500".
        let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
        let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2]);
        start = Math.max(0, Math.min(start, size - 1));
        end = Math.max(start, Math.min(end, size - 1));
        res.writeHead(206, {
          'content-type': type,
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
          'cache-control': 'no-store',
        });
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': type,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('404');
  }
}).listen(PORT, () => console.log(`such-blast on http://localhost:${PORT}`));
