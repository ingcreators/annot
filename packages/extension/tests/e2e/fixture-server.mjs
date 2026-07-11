// Deterministic capture-target page for the extension e2e suite.
// A plain node:http server (no deps) — the extension can only
// capture http(s) tabs, so a data: URL or file:// page won't do.
import { createServer } from "node:http";

const PORT = 3100;

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Annot Capture Fixture</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #fdfdfd; }
    header { background: #1f6fff; color: #fff; padding: 16px 24px; }
    main { padding: 24px; }
    button { padding: 8px 16px; margin-right: 8px; }
  </style>
</head>
<body>
  <header><h1 id="page-title">Capture fixture page</h1></header>
  <main>
    <p id="intro">A deterministic page the Annot extension captures during e2e runs.</p>
    <button id="primary-action" type="button">Primary action</button>
    <button id="secondary-action" type="button">Secondary action</button>
    <a id="docs-link" href="#docs">Documentation link</a>
  </main>
</body>
</html>
`;

createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
}).listen(PORT, () => {
  console.log(`fixture server listening on http://localhost:${PORT}/`);
});
