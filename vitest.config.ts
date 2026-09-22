import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.ts on purpose: that file's `healthEndpoint` plugin
 * is `apply: "build"` and shells out to git, and pulling it into every test run
 * buys nothing. Tests live beside `src` under `tests/`.
 *
 * `environment: "node"` because what is worth testing here is the service layer
 * — what the monitor concludes from an endpoint's answer — and none of it
 * touches the DOM. The one DOM-facing test, tests/sidebar.test.ts, stubs the
 * handful of `document` calls Sidebar makes instead of pulling in a DOM
 * implementation. The Phaser zones are not unit-testable without a WebGL
 * context and are deliberately out of scope; the one piece of them that builds
 * markup from other services' data, HubMap's tooltip, lives Phaser-free in
 * src/ui/hub-tooltip.ts so that it can be tested.
 */
export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
});
