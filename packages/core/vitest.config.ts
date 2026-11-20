import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "node", environment: "node", server: { deps: { inline: ["shamir-secret-sharing"] } } } },
      {
        extends: true,
        resolve: { conditions: ["browser", "import", "default"] },
        test: { name: "jsdom", environment: "jsdom", include: ["test/shamir.test.ts"], server: { deps: { inline: ["shamir-secret-sharing"] } } },
      },
    ],
  },
});
