/** Enrollment transitions are pure; persistence and rendering belong to the controller. */
(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenEnrollmentState = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function transition(state, id, action) {
    if (typeof id !== 'string' || !id.trim()) return null;
    const registeredClasses = new Set(state.registeredClasses);
    const completedClasses = new Set(state.completedClasses);
    switch (action) {
      case 'REGISTER':
        completedClasses.delete(id);
        registeredClasses.add(id);
        break;
      case 'COMPLETE':
        registeredClasses.delete(id);
        completedClasses.add(id);
        break;
      case 'DELETE':
        registeredClasses.delete(id);
        completedClasses.delete(id);
        break;
      default:
        return null;
    }
    // Unknown stored IDs remain intact so a later catalog update can recover them.
    return { registeredClasses, completedClasses };
  }
  return { transition };
});
