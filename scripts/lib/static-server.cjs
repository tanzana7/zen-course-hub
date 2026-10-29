const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
});

/** Local development/QA server. The explicit asset list prevents serving .git, secrets or fixtures. */
function createStaticServer({
  root,
  assets,
  mapPath = (pathname) => pathname,
  transform = (_file, bytes) => bytes,
}) {
  const allowed = new Set(assets);
  return http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = mapPath(pathname).replace(/^\//, '') || 'index.html';
      if (!allowed.has(file)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const target = path.resolve(root, file);
      if (!target.startsWith(path.resolve(root) + path.sep) || (await fs.realpath(target)) !== target) {
        response.writeHead(403);
        response.end();
        return;
      }
      const bytes = transform(file, await fs.readFile(target), pathname);
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      const status = error instanceof URIError ? 400 : error.code === 'ENOENT' ? 404 : 500;
      if (status === 500) console.error('ローカルファイルを配信できません:', error);
      response.writeHead(status);
      response.end();
    }
  });
}
module.exports = { createStaticServer };
