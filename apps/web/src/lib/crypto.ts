// The only door to @paper-trail/core from the web app: loaded on demand so its crypto (and the
// SDKs it wraps) stay out of the first page load. Never implement crypto here; only call core.
export const loadCore = () => import('@paper-trail/core');
