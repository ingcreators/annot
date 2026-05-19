# Recipes

End-to-end working examples for the three flows that motivated
the Playwright integration.

| Recipe | What it shows |
| ------ | ------------- |
| **[Annotate on assertion failure](./assertion-failure.md)** | Wrap an assertion in try/catch and annotate the locator that misbehaved. |
| **[Draw by DOM locator](./dom-locator.md)** | Use `locator.boundingBox()` + `rectForBoundingBox` to draw an exact overlay rectangle. |
| **[Attach to the HTML report](./html-report.md)** | Land the annotated PNG inline next to the failing step. |

Each recipe is self-contained — copy-paste it into a new
`example.spec.ts`, install the packages, and it works against
any URL.
