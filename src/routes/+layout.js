// Fully static: prerender every route so the bundle drops straight into Vercel's
// CDN and into the Capacitor Android WebView with no server runtime.
export const prerender = true;
export const trailingSlash = 'never';
export const ssr = false; // the workstation is a client-side sensor app
