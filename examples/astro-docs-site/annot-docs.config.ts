import { defineConfig } from "@ingcreators/annot-product-docs";

export default defineConfig({
  meta: {
    projectName: "Annot Sample",
  },
  xlsx: {
    defaultBook: "Screen spec",
    books: {
      "Screen spec": {},
    },
  },
});
