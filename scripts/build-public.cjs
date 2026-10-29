// Publish an explicit static-asset allowlist. A root publish would also expose
// tracked QA screenshots and development data, including historical PDF crops.
// Netlify runs this from the repository root; no package install is required.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'netlify-dist');
const publicFiles = Object.freeze([
  '_redirects',
  'app.js',
  'course-relations.json',
  'course-sorting.js',
  'courses.json',
  'curriculum-config.js',
  'curriculum-map.css',
  'curriculum-map.js',
  'curriculum-tree-layout.json',
  'curriculum.html',
  'difficulty.json',
  'exam-schedule-catalog.json',
  'exam-feedback.js',
  'exam-schedule.js',
  'feedback.html',
  'feedback.js',
  'google05151c606a13d780.html',
  'graduation-requirements.js',
  'graduation-requirements.json',
  'index.html',
  'quality-utils.js',
  'simulator-rules.js',
  'sitemap.xml',
  'style.css',
  'tutorial.json'
]);

function build() {
  if (path.dirname(output) !== root || path.basename(output) !== 'netlify-dist') {
    throw new Error('公開先ディレクトリを確認できません');
  }
  if (fs.existsSync(output)) {
    if (!fs.lstatSync(output).isDirectory() || fs.lstatSync(output).isSymbolicLink()) {
      throw new Error('公開先ディレクトリを確認できません');
    }
    const unexpected = fs.readdirSync(output).filter((name) => !publicFiles.includes(name));
    if (unexpected.length) throw new Error(`公開先に想定外のファイルがあります: ${unexpected.join(', ')}`);
  } else {
    fs.mkdirSync(output);
  }
  for (const file of publicFiles) {
    if (file.includes('/') || file.includes('\\') || file.startsWith('.')) throw new Error(`公開ファイル名を確認できません: ${file}`);
    const source = path.join(root, file);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) {
      throw new Error(`公開ファイルを確認できません: ${file}`);
    }
    const target = path.join(output, file);
    if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isFile())) {
      throw new Error(`公開先ファイルを確認できません: ${file}`);
    }
    fs.copyFileSync(source, target);
  }
  console.log(`Published ${publicFiles.length} static assets to ${output}`);
}

if (require.main === module) build();
module.exports = { build, publicFiles, output };
