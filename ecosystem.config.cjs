module.exports = {
    apps: [
        {
            name: "pixel-agent-lab",
            script: "npx",
            args: "serve dist -l 6300 -s",
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
