module.exports = {
    apps: [
        {
            name: "pixel-agent-lab",
            script: "npx",
            args: "serve dist -l 6300 -s",
            cwd: "/Users/wooramson/Documents/GitHub/pixel-agent-lab",
            watch: false,
            max_memory_restart: "256M",
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
