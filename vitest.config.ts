import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.ts on purpose: that file's `healthEndpoint` plugin
 * is `apply: "build"` and shells out to git, and pulling it into every test run
 * buys nothing. Tests live beside `src` under `tests/`.
 *
 * `environment: "node"` because what is worth testing here is the service layer
 * — what the monitor concludes from an endpoint's answer — and none of it
 * touches the DOM. The DOM-facing tests (sidebar, sidebar-controls,
 * zone-tabs) stub the handful of `document` calls they make instead of
 * pulling in a DOM implementation. The Phaser zones are not unit-testable
 * without a WebGL context and are deliberately out of scope; the pieces of
 * them worth testing live Phaser-free in src/ui/ so that they can be: the
 * markup built from other services' data (HubMap's tooltip, the status counts
 * its HUD shares with the sidebar, the phone's belt card), the map's tap
 * selection and text placement, and the reduced-motion setting.
 */
export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
});
