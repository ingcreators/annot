/**
 * Built-in plugin — contributes "View on GitHub" to the drawer's
 * external-links section when the active backend is `GitHubStore`.
 *
 * Lifted out of `HeaderHost.buildExternalLinksFor` as part of the
 * Phase 4 Plugin API MVP. Sits here both as the reference
 * implementation of `ExternalLinkSource` and as validation that the
 * API covers a real, in-tree use case — if the plugin-host couldn't
 * express this, the API shape isn't right.
 */

import { builtinIcon } from "@ingcreators/annot-core";
import type { AnnotPlugin } from "../plugin-host.js";
import { GitHubStore } from "../../storage/github-store.js";

export const githubExternalLinksPlugin: AnnotPlugin = {
  name: "github-external-links",
  register(ctx) {
    ctx.addExternalLinkSource((path, storage) => {
      if (!(storage instanceof GitHubStore)) return undefined;
      const url = storage.getViewUrl(path);
      if (!url) return undefined;
      return [{ label: "View on GitHub", url, icon: builtinIcon("open_in_new") }];
    });
  },
};
