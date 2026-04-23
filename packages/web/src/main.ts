// CSS imports
import "@ingcreators/annot-core/styles/material-symbols.css";
import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
import "./styles/app.css";
import "./styles/file-manager.css";

import { App } from "./app.js";

const app = new App();
app.init();
