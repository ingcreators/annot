import { defineConfig } from "vitepress";

// VitePress config for annot.work/docs.
//
// `base: "/docs/"` matches the Phase 8 plan's URL layout
// (annot.work/ = landing, annot.work/app = PWA, annot.work/docs =
// these pages). Internal links resolve correctly against that
// prefix; the deploy worker added in Phase 8d will serve the
// built artefact under that path.
export default defineConfig({
  base: "/docs/",
  title: "Annot",
  description:
    "An SVG-first screenshot annotation toolkit. Call it from Playwright, host it in a PWA, share annotated screenshots through GitHub.",
  cleanUrls: true,
  lastUpdated: true,

  // VitePress's default outDir is `.vitepress/dist/`. Cloudflare's
  // static-asset binding (configured via `wrangler.jsonc`) maps an
  // incoming URL path to a file inside `assets.directory` —
  // including the route prefix. So `annot.work/docs/index.html`
  // → `<assets.directory>/docs/index.html`. We nest the build
  // output one level deeper so the on-disk path mirrors the
  // public URL.
  outDir: "./.vitepress/dist/docs",

  // The package README.md is repo metadata, not docs content — it
  // links out to ../../docs/plans/ (sibling docs in the monorepo)
  // and that path doesn't exist inside the docs-site build root.
  // Exclude it from the VitePress route table.
  srcExclude: ["README.md"],

  // Dev-server URLs are mentioned as literal text in the
  // contributing guide; they're not navigation links and would
  // 404 from the published docs site by design.
  ignoreDeadLinks: [
    /^https?:\/\/localhost(:\d+)?(\/.*)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?(\/.*)?$/,
  ],

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/docs/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#0f1730" }],
    ["meta", { property: "og:type", content: "website" }],
    [
      "meta",
      {
        property: "og:title",
        content: "Annot — documentation",
      },
    ],
  ],

  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "Annot docs",

    nav: [
      { text: "Home", link: "/" },
      { text: "Getting started", link: "/getting-started/" },
      { text: "API", link: "/api/" },
      { text: "Recipes", link: "/recipes/" },
      {
        text: "Annot.work",
        items: [
          { text: "Landing", link: "https://annot.work" },
          { text: "Open editor", link: "https://annot.work/app" },
          {
            text: "GitHub",
            link: "https://github.com/ingcreators/annot",
          },
        ],
      },
    ],

    sidebar: {
      "/getting-started/": [
        {
          text: "Getting started",
          items: [
            { text: "Overview", link: "/getting-started/" },
            {
              text: "Install annot-playwright",
              link: "/getting-started/playwright",
            },
            {
              text: "Install annot-annotator",
              link: "/getting-started/annotator",
            },
            { text: "Install annot-core", link: "/getting-started/core" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API reference",
          items: [
            { text: "Overview", link: "/api/" },
            { text: "createAnnotator", link: "/api/create-annotator" },
            { text: "Playwright fixture", link: "/api/playwright-fixture" },
            { text: "SVG helpers", link: "/api/svg-helpers" },
          ],
        },
      ],
      "/recipes/": [
        {
          text: "Recipes",
          items: [
            { text: "Overview", link: "/recipes/" },
            {
              text: "Annotate on assertion failure",
              link: "/recipes/assertion-failure",
            },
            {
              text: "Draw by DOM locator",
              link: "/recipes/dom-locator",
            },
            {
              text: "Attach to the HTML report",
              link: "/recipes/html-report",
            },
          ],
        },
      ],
      "/pwa/": [
        {
          text: "Annot Cloud (PWA)",
          items: [
            { text: "Overview", link: "/pwa/" },
            { text: "Sign in", link: "/pwa/sign-in" },
            { text: "Switch storage backends", link: "/pwa/storage-backends" },
            { text: "Share links", link: "/pwa/share-links" },
          ],
        },
      ],
      "/contributing/": [
        {
          text: "Contributing",
          items: [
            { text: "Overview", link: "/contributing/" },
            { text: "Local setup", link: "/contributing/local-setup" },
            { text: "Sending a PR", link: "/contributing/pr-workflow" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/ingcreators/annot" }],

    footer: {
      message: "Released under the Apache-2.0 License.",
      copyright: "Copyright © 2026 ingcreators",
    },

    editLink: {
      pattern: "https://github.com/ingcreators/annot/edit/main/packages/docs-site/:path",
      text: "Edit this page on GitHub",
    },

    search: {
      provider: "local",
    },
  },
});
