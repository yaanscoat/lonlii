// shared proxy helpers for games and movies. needs /proxy/bare-mux/index.js, /assets/js/transport.js,
// /proxy/uv/uv.bundle.js and /proxy/uv/uv.config.js loaded first.
window.lonliiProxy = (() => {
  let readyPromise;

  // an already-active worker is enough. an updated one can sit in "waiting" forever while the old
  // one keeps working, so never wait on that, and give a first install at most a few seconds
  async function waitForActive(reg) {
    if (reg.active) return;
    const sw = reg.installing || reg.waiting;
    if (!sw) return;
    await Promise.race([
      new Promise((resolve) => sw.addEventListener("statechange", () => sw.state === "activated" && resolve())),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

  // bare transport + ultraviolet service worker, set up once per page
  function ready() {
    readyPromise ??= (async () => {
      await setBareTransport(new BareMux.BareMuxConnection(LONLII_BAREMUX_WORKER));
      await waitForActive(await navigator.serviceWorker.register("/proxy/uv/sw.js"));
    })();
    return readyPromise;
  }

  // a url that loads `url` through ultraviolet, for iframes and popouts
  async function url(target) {
    await ready();
    return __uv$config.prefix + __uv$config.encodeUrl(target);
  }

  // fetch through the bare server: no cors, and headers like referer are sent as given
  let client;
  async function fetch(target, init = {}) {
    await ready();
    client ??= new BareMux.BareClient(LONLII_BAREMUX_WORKER);
    return client.fetch(target, init);
  }

  return { ready, url, fetch };
})();
