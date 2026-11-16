const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const controllers = require('../../scripts/build-public.cjs').publicFiles.filter(
  (file) => file.startsWith('src/') && file.endsWith('.js'),
);
function readHubSource() {
  return [...controllers, 'app.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
}
module.exports = { readHubSource };
