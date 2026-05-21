---
layout: home

hero:
  name: Annot
  text: SVG-first annotated screenshots
  tagline: Call it from Playwright. Edit by hand in a PWA. Share through GitHub.
  image:
    src: /favicon.svg
    alt: Annot
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/
    - theme: alt
      text: API reference
      link: /api/
    - theme: alt
      text: View on GitHub
      link: https://github.com/ingcreators/annot

features:
  - icon: 🎭
    title: Playwright fixture
    details: |
      `npm install --save-dev @ingcreators/annot-playwright`. Drop the
      fixture into `test.extend({ annotator })` and annotate
      screenshots with a single call.
    link: /getting-started/playwright
    linkText: Install
  - icon: ⚡
    title: Headless annotator
    details: |
      `npm install @ingcreators/annot-annotator`. The same
      annotation engine as the PWA, callable from any Node script
      — no browser required.
    link: /getting-started/annotator
    linkText: Install
  - icon: 🖋
    title: SVG-first core
    details: |
      `npm install @ingcreators/annot-core`. Versioned SVG
      annotation format with round-trip-safe parsing. Plug into
      your own renderer or build a new host.
    link: /getting-started/core
    linkText: Install
  - icon: 🧩
    title: Open source
    details: |
      Apache-2.0. The PWA, the Chrome extension, the desktop app,
      the headless annotator, and the Playwright fixture all live
      in one monorepo.
    link: https://github.com/ingcreators/annot
    linkText: Browse the repo
---
