// bare-only transport. the bare server lives elsewhere, so the site itself can be served from any static host.
const LONLII_DEFAULT_BARE = "https://tomp.app/";
const LONLII_BARE_TRANSPORT = "/proxy/bare-transport/lonlii-transport.mjs";

// bare-mux runs the transport in a SharedWorker with a fixed name. on a reload, chromium can hand the
// new page the old page's worker while it's shutting down, and that worker never answers again.
// a unique url per page load always gets a fresh worker. every page sets its own worker's transport.
const LONLII_BAREMUX_WORKER = `/proxy/bare-mux/worker.js?page=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function getBareUrl() {
  return localStorage.getItem("lonlii_bareUrl") || LONLII_DEFAULT_BARE;
}

async function setBareTransport(conn) {
  await conn.setTransport(LONLII_BARE_TRANSPORT, [getBareUrl()]);
}
