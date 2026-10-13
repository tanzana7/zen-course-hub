/* Public access is a release artifact setting, never a stored user preference. */
(function exposeCurriculumAccess(root) {
  const CURRICULUM_TREE_PUBLIC_ENABLED = false;
  const canAccess = (location) => CURRICULUM_TREE_PUBLIC_ENABLED || (
    ['localhost', '127.0.0.1'].includes(location.hostname)
    && new URLSearchParams(location.search).get('curriculumPreview') === '1'
  );
  const api = Object.freeze({ publicEnabled: CURRICULUM_TREE_PUBLIC_ENABLED, canAccess });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CurriculumAccess = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
