import { defineConfig } from "vitest/config";

// Q8: the package is inlined in both projects so vi.mock reaches its internal
// "shamir-secret-sharing/csprng" import. Run the same test under node and under jsdom with browser export conditions.
export default defineConfig({
  test: {
    include: ["scripts/findings/q8-shamir.test.ts"],
    projects: [
      {
        extends: true,
        test: { name: "node", environment: "node", server: { deps: { inline: ["shamir-secret-sharing"] } } },
      },
      {
        extends: true,
        resolve: { conditions: ["browser", "import", "default"] },
        test: { name: "jsdom", environment: "jsdom", server: { deps: { inline: ["shamir-secret-sharing"] } } },
      },
    ],
  },
});
