const fs = require('node:fs');
const path = require('node:path');
const { build, publicFiles, output } = require('./build-public.cjs');
const { styleSources } = require('./styles.cjs');
const { createStaticServer } = require('./lib/static-server.cjs');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.ZEN_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('ZEN_PORT must be a port between 1 and 65535');
build();
const server = createStaticServer({ root: output, assets: publicFiles });
server.on('error', (error) => {
  console.error('開発サーバーを起動できません:', error);
  process.exitCode = 1;
  shutdown();
});
server.listen(port, '127.0.0.1', () => console.log(`ZEN Course Hub: http://127.0.0.1:${port}`));
let timer;
const watched = new Set([...publicFiles, ...styleSources, 'scripts/styles.cjs', 'scripts/build-public.cjs']);
const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
  const file = filename?.split(path.sep).join('/');
  // style.css is generated; rebuilding for its own write would create a feedback loop.
  if (!watched.has(file) || file === 'style.css') return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      build();
    } catch (error) {
      console.error('再ビルドに失敗しました:', error);
    }
  }, 120);
});
function shutdown() {
  clearTimeout(timer);
  watcher.close();
  server.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
