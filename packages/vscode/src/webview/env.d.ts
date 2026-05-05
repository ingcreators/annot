// Ambient module declarations for the webview bundle.
//
// Vite handles `*.css` imports as side-effect bundling; TypeScript
// needs an ambient module shape to allow `import "...css"` without
// the "no type declarations" error.

declare module "*.css";
