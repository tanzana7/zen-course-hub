// Publish an explicit static-asset allowlist. A root publish would also expose
// tracked QA screenshots and development data, including historical PDF crops.
// Netlify installs the locked development toolchain before running this entry point.
const fs = require('node:fs');
const path = require('node:path');
const { compileStyles } = require('./styles.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'netlify-dist');
const publicFiles = Object.freeze([
  '_redirects',
  'app.js',
  'src/features/simulator/graduation-panel.js',
  'src/features/simulator/dialogs.js',
  'src/features/curriculum/layout.js',
  'src/features/curriculum/interactions.js',
  'src/domain/enrollment-state.js',
  'src/data/course-repository.js',
  'src/features/navigation/controller.js',
  'src/features/help/controller.js',
  'src/features/enrollment/controller.js',
  'src/features/simulator/controller.js',
  'src/features/graduation/controller.js',
  'src/features/catalog/controller.js',
  'src/features/curriculum/controller.js',
  'course-relations.json',
  'course-sorting.js',
  'courses.json',
  'curriculum-config.js',
  'curriculum-map.css',
  'curriculum-map.js',
  'src/features/map/geometry.js',
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
  'tutorial.json',
]);

// Paths stay explicit so development scripts, test fixtures and source data cannot leak into a deployment.
function validateAssetPath(file) {
  if (
    typeof file !== 'string' ||
    !/^[a-zA-Z0-9_./-]+$/.test(file) ||
    file.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
  ) {
    throw new Error(`公開ファイル名を確認できません: ${file}`);
  }
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`シンボリックリンクは公開できません: ${absolute}`);
    if (entry.isDirectory()) return listFiles(absolute);
    if (!entry.isFile()) throw new Error(`公開ファイルを確認できません: ${absolute}`);
    return [path.relative(output, absolute).split(path.sep).join('/')];
  });
}

function build() {
  const stylesheet = path.join(root, 'style.css');
  if (
    fs.existsSync(stylesheet) &&
    (!fs.lstatSync(stylesheet).isFile() || fs.lstatSync(stylesheet).isSymbolicLink())
  ) {
    throw new Error('生成スタイルの保存先を確認できません');
  }
  fs.writeFileSync(stylesheet, compileStyles());
  if (path.dirname(output) !== root || path.basename(output) !== 'netlify-dist') {
    throw new Error('公開先ディレクトリを確認できません');
  }
  if (fs.existsSync(output)) {
    if (!fs.lstatSync(output).isDirectory() || fs.lstatSync(output).isSymbolicLink()) {
      throw new Error('公開先ディレクトリを確認できません');
    }
    const unexpected = listFiles(output).filter((file) => !publicFiles.includes(file));
    if (unexpected.length) throw new Error(`公開先に想定外のファイルがあります: ${unexpected.join(', ')}`);
  } else {
    fs.mkdirSync(output);
  }
  for (const file of publicFiles) {
    validateAssetPath(file);
    const source = path.join(root, file);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile() || fs.realpathSync(source) !== source) {
      throw new Error(`公開ファイルを確認できません: ${file}`);
    }
    const target = path.join(output, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  console.log(`Published ${publicFiles.length} static assets to ${output}`);
}

if (require.main === module) build();
module.exports = { build, publicFiles, output, validateAssetPath, listFiles };
