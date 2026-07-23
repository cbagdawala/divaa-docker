/*
 |--------------------------------------------------------------------------
 | Dev-server / HMR (env-driven — used by the divaa "hot" container)
 |--------------------------------------------------------------------------
 |
 | The generator inserts this block into webpack.mix.js verbatim, above the first
 | mix.js() call. If it reported "NEEDS A HAND-MERGE", merge these ideas into the
 | existing devServer config yourself — keeping the notes below, because every one
 | of them encodes a failure we actually hit.
 |
 | One config serves two environments:
 |   • Local PC (`npm run hot` on Windows) — no MIX_HMR_* set, so this whole block
 |     is skipped and Mix's localhost:8080 defaults apply. Patching is a no-op
 |     locally; nothing about existing behaviour changes.
 |   • divaa-docker — the <prefix>-hot container sets MIX_HMR_* to route
 |     webpack-dev-server + its HMR websocket through Traefik over HTTPS/WSS
 |     (see docker-compose.divaa.dev.yml). Laravel's mix() reads public/hot and
 |     serves assets from that host, so no blade change is needed.
 |
 | Keep it env-gated and never hardcode the domain: the same file has to work on
 | the PC and on the host.
 */
if (process.env.MIX_HMR_HOST) {
    const hmrHost = process.env.MIX_HMR_HOST;
    const hmrPort = Number(process.env.MIX_HMR_PORT || 443);

    // Written into public/hot as `http://<host>:<port>/`. That literal looks wrong
    // on an HTTPS page, but Laravel's mix() helper strips the scheme and returns a
    // protocol-relative URL (//host:443/...), so the browser fetches over HTTPS.
    // Don't "fix" the http:// in public/hot — it is never used as-is.
    mix.options({
        hmrOptions: {
            host: hmrHost,
            port: hmrPort
        }
    });

    mix.webpackConfig({
        // In hot mode Laravel Mix defaults output.publicPath to `http://host:port/`,
        // which the webpack runtime requests VERBATIM for async chunks → the browser
        // blocks them as mixed content on our HTTPS page (ChunkLoadError, and only
        // for lazy-loaded routes, so the app looks fine until you navigate). Forcing
        // it protocol-relative makes chunks load over the page's own protocol.
        output: { publicPath: `//${hmrHost}:${hmrPort}/` },
        devServer: {
            // Listen on every interface inside the container, on the same port
            // Traefik routes to — see the --hot-port note in generate.mjs.
            host: "0.0.0.0",
            port: hmrPort,
            // The address the HMR (sockjs) client dials. With the app page on HTTPS
            // the client upgrades to wss:// on its own.
            public: `${hmrHost}:${hmrPort}`,
            // Accept the Host header Traefik forwards. webpack-dev-server 3 (which
            // Mix 5 pins transitively) otherwise rejects it as "Invalid Host header"
            // and serves nothing. NOTE: this is wds 3 syntax — wds 4/5 replaced it
            // with `allowedHosts`, so on Mix 6+ use that instead.
            disableHostCheck: true,
            headers: { "Access-Control-Allow-Origin": "*" }
        }
    });
}
