module.exports = {
    apps: [
        {
            name: "pixel-agent-lab",
            // Use the lockfile-installed server; startup must not download one.
            script: "./node_modules/serve/build/main.js",
            // Tabs do not change the URL. Missing assets must return 404,
            // rather than HTML at 200 through serve's single-page fallback.
            //
            // Without `-s`, nothing shadows serve's directory index either: by
            // default serve lists a directory's contents (as HTML, or as JSON
            // on request). serve has no flag to turn that off; it reads
            // `serve.json` from the directory it serves. So public/serve.json
            // sets `directoryListing: false`, the build copies it into dist/, and
            // it applies however serve is started on dist/ — from this file,
            // `npm run serve`, or by hand. serve reads it once at startup, so
            // restart the process after deploying a build that changes it.
            // tests/static-serving.test.ts pins both behaviours to these args.
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
