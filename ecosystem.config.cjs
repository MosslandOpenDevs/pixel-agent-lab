module.exports = {
    apps: [
        {
            name: "pixel-agent-lab",
            // Use the lockfile-installed server; startup must not download one.
            script: "./node_modules/serve/build/main.js",
            // Tabs do not change the URL. Missing assets must return 404,
            // rather than HTML at 200 through serve's single-page fallback.
            args: "dist -l 6300",
            // Resolve relative to this file so `pm2 start` works on any host.
            cwd: __dirname,
            watch: false,
            max_memory_restart: "256M",
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
