// movies & tv, ported from https://github.com/x8rr/movies to run without its server:
// TMDB is called directly, and the VidSrc scraper + HLS playback run in the browser through the bare proxy.

const TMDB_KEY = "ebbc810d0c9a9a4a13a264f96897036e"; // public read-only key
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// fallback players, loaded through ultraviolet
const EMBEDS = [
  { name: "VidLink", movie: (id) => `https://vidlink.pro/movie/${id}`, tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}` },
  { name: "VidSrc", movie: (id) => `https://vidsrc.sh/embed/movie/${id}`, tv: (id, s, e) => `https://vidsrc.sh/embed/tv/${id}/${s}/${e}` },
  { name: "Videasy", movie: (id) => `https://player.videasy.net/movie/${id}`, tv: (id, s, e) => `https://player.videasy.net/tv/${id}/${s}/${e}` },
  { name: "VidFast", movie: (id) => `https://vidfast.pro/movie/${id}`, tv: (id, s, e) => `https://vidfast.pro/tv/${id}/${s}/${e}` },
  { name: "CineSrc", movie: (id) => `https://cinesrc.st/embed/movie/${id}`, tv: (id, s, e) => `https://cinesrc.st/embed/tv/${id}?s=${s}&e=${e}` },
  { name: "VidSrc.to", movie: (id) => `https://vidsrc.to/embed/movie/${id}`, tv: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}` },
  { name: "2Embed", movie: (id) => `https://www.2embed.cc/embed/${id}`, tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}` },
  { name: "MultiEmbed", movie: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`, tv: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` },
];

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

async function tmdb(path, params = {}) {
  const url = new URL(TMDB + path);
  url.searchParams.set("api_key", TMDB_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

/* ---------------- VidSrc scraper (browser port of src/providers.js) ---------------- */

const bareGet = (url, headers = {}) => lonliiProxy.fetch(url, { headers: { "User-Agent": UA, ...headers } });

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const wasmCache = new Map();

function getWasmModule(vs) {
  if (vs.wasm_url) {
    const key = `u:${vs.w ?? vs.wasm_url}`;
    if (!wasmCache.has(key)) {
      wasmCache.set(key, bareGet(vs.wasm_url).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)));
    }
    return wasmCache.get(key);
  }
  if (vs.wasm) {
    const key = `b:${vs.w ?? Math.random()}`;
    if (!wasmCache.has(key)) wasmCache.set(key, WebAssembly.compile(b64ToBytes(vs.wasm)));
    return wasmCache.get(key);
  }
  return null;
}

async function decryptStreamUrls(encB64, vs) {
  const mod = await getWasmModule(vs);
  if (!mod) return null;
  const inst = await WebAssembly.instantiate(mod, {});
  const { alloc, decrypt, memory } = inst.exports;
  const enc = b64ToBytes(encB64);
  const ptr = alloc(enc.length);
  new Uint8Array(memory.buffer, ptr, enc.length).set(enc);
  const outLen = decrypt(ptr, enc.length);
  const text = new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 12, outLen));
  return text.split("\n").filter(Boolean);
}

async function vidsrcExtract(type, tmdbId, season, episode) {
  const isTV = type !== "movie";
  const srcPath = isTV ? `${tmdbId}/${season}/${episode}` : String(tmdbId);

  const { src } = await bareGet(
    `https://vidsrc.sh/vs_src.php?type=${isTV ? "tv" : "movie"}&id=${srcPath}`,
    { Referer: "https://vidsrc.sh/" },
  ).then((r) => r.json());
  if (!src) return [];

  const landHtml = await bareGet(src, { Referer: "https://vidsrc.sh/" }).then((r) => r.text());
  const cfgMatch = landHtml.match(/window\.CFG\s*=\s*(\{[^}]+\})/);
  if (!cfgMatch) return [];
  const cfg = JSON.parse(cfgMatch[1]);
  const origin = new URL(src).origin;

  const playerHtml = await bareGet(origin + cfg.playerUrl, { Referer: origin + "/" }).then((r) => r.text());
  const configMatch = playerHtml.match(/window\.CONFIG\s*=\s*(\{.*?\});/s);
  if (!configMatch) return [];
  const config = JSON.parse(configMatch[1]);
  if (!config.apiToken) return [];

  const token = encodeURIComponent(config.apiToken);
  const streamApiUrl = isTV
    ? `https://data.vidsrc.sh/api.php?type=tv&tmdb=${tmdbId}&season=${season}&episode=${episode}&stream_urls&api_token=${token}`
    : `https://data.vidsrc.sh/api.php?type=movie&tmdb=${tmdbId}&stream_urls&api_token=${token}`;

  const json = await bareGet(streamApiUrl, { Referer: origin + "/" }).then((r) => r.json());
  if (String(json.status_code) !== "200" || !json.data) return [];

  let urls;
  if (typeof json.data.stream_urls === "string" && json.vs) {
    urls = await decryptStreamUrls(json.data.stream_urls, json.vs);
    if (!urls) return [];
  } else if (Array.isArray(json.data.stream_urls)) {
    urls = json.data.stream_urls;
  } else {
    return [];
  }

  // each stream host hands out a token that has to ride along on every request
  const hostTokens = new Map();
  for (const u of urls) {
    const host = new URL(u).origin;
    if (!hostTokens.has(host)) {
      hostTokens.set(
        host,
        bareGet(host + "/generate.php", { Accept: "application/json" })
          .then((r) => r.text())
          .then((t) => {
            try {
              const j = JSON.parse(t);
              return typeof j === "string" ? j : j.token || j.data || j.string || j.result || "";
            } catch {
              return t.trim();
            }
          })
          .catch(() => ""),
      );
    }
  }

  const results = [];
  for (const rawUrl of urls) {
    if (!rawUrl.includes(".m3u8")) continue; // only HLS can be streamed through the bare loader
    const tok = await hostTokens.get(new URL(rawUrl).origin);
    results.push({
      url: tok ? rawUrl + (rawUrl.includes("?") ? "&" : "?") + "token=" + tok : rawUrl,
      name: "VidSrc direct",
    });
  }
  return results;
}

/* ---------------- browsing ---------------- */

let feed = "trending";
let page = 1;
let query = "";
let searchTimer;

const FEEDS = {
  trending: { title: "trending this week", path: "/trending/all/week" },
  movie: { title: "popular movies", path: "/movie/popular" },
  tv: { title: "popular tv shows", path: "/tv/popular" },
};

function card(item, index) {
  const title = item.title || item.name;
  const type = item.media_type || (feed === "tv" || item.first_air_date ? "tv" : "movie");
  const year = (item.release_date || item.first_air_date || "").slice(0, 4);

  const poster = item.poster_path
    ? el("img", { src: `${IMG}/w342${item.poster_path}`, alt: title, loading: "lazy" })
    : el("div", { className: "no-poster", textContent: title });

  const node = el(
    "button",
    { className: "card" },
    el("div", { className: "poster" }, poster,
      item.vote_average ? el("span", { className: "rating", textContent: `★ ${item.vote_average.toFixed(1)}` }) : null),
    el("div", { className: "info" },
      el("div", { className: "title", textContent: title }),
      el("div", { className: "year", textContent: [year, type === "tv" ? "TV" : "Movie"].filter(Boolean).join(" · ") })),
  );
  node.style.setProperty("--i", index % 20);
  node.addEventListener("click", () => openDetail(item.id, type));
  return node;
}

async function loadGrid(reset) {
  const grid = $("grid");
  if (reset) {
    page = 1;
    grid.replaceChildren();
  }
  $("loadMore").disabled = true;

  try {
    const data = query
      ? await tmdb("/search/multi", { query, page })
      : await tmdb(FEEDS[feed].path, { page });
    const items = data.results.filter((r) => query ? r.media_type === "movie" || r.media_type === "tv" : true);

    if (reset && !items.length) {
      grid.append(el("p", { className: "empty", textContent: "nothing found" }));
    }
    items.forEach((item, i) => grid.append(card(item, i)));
    $("loadMore").hidden = page >= (data.total_pages || 1);
  } catch (e) {
    grid.append(el("p", { className: "empty", textContent: `couldn't reach TMDB (${e.message})` }));
  }
  $("loadMore").disabled = false;
}

$("loadMore").addEventListener("click", () => {
  page++;
  loadGrid(false);
});

$("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  feed = tab.dataset.feed;
  query = "";
  $("searchInput").value = "";
  $("sectionTitle").textContent = FEEDS[feed].title;
  loadGrid(true);
});

$("searchInput").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = $("searchInput").value.trim();
    $("sectionTitle").textContent = query ? `results for "${query}"` : FEEDS[feed].title;
    loadGrid(true);
  }, 400);
});

/* ---------------- details ---------------- */

async function openDetail(id, type) {
  const overlay = $("detailOverlay");
  const detail = $("detail");
  detail.replaceChildren(el("p", { className: "empty", textContent: "loading..." }));
  overlay.classList.add("active");

  const data = await tmdb(`/${type}/${id}`);
  const title = data.title || data.name;
  const year = (data.release_date || data.first_air_date || "").slice(0, 4);
  const meta = [
    year,
    type === "tv" ? "TV" : "Movie",
    data.runtime ? `${data.runtime} min` : null,
    data.number_of_seasons ? `${data.number_of_seasons} season${data.number_of_seasons > 1 ? "s" : ""}` : null,
    data.vote_average ? `★ ${data.vote_average.toFixed(1)}` : null,
  ].filter(Boolean).join(" · ");

  const info = el("div", { className: "detail-info" },
    el("h2", { textContent: title }),
    el("div", { className: "meta", textContent: meta }),
    el("div", { className: "genres" }, ...(data.genres || []).map((g) => el("span", { textContent: g.name }))),
    el("p", { className: "overview", textContent: data.overview || "" }),
  );

  if (type === "movie") {
    const play = el("button", { className: "button play-btn" }, el("i", { className: "ri-play-fill" }), " Play");
    play.addEventListener("click", () => watch(id, "movie", title));
    info.append(play);
  }

  const close = el("button", { className: "icon-btn detail-close", title: "Close" }, el("i", { className: "ri-close-line" }));
  close.addEventListener("click", closeDetail);

  detail.replaceChildren(
    data.backdrop_path ? el("div", { className: "backdrop", style: `background-image:url('${IMG}/w1280${data.backdrop_path}')` }) : null,
    close,
    el("div", { className: "detail-header" },
      data.poster_path ? el("img", { className: "detail-poster", src: `${IMG}/w342${data.poster_path}`, alt: "" }) : null,
      info),
  );

  if (type === "tv" && data.seasons) {
    const seasons = data.seasons.filter((s) => s.season_number > 0);
    const tabs = el("div", { className: "season-tabs" });
    const list = el("div", { className: "episode-list" }, el("p", { className: "empty", textContent: "pick a season" }));

    seasons.forEach((s) => {
      const btn = el("button", { className: "season-tab", textContent: s.name });
      btn.addEventListener("click", () => {
        tabs.querySelectorAll(".season-tab").forEach((t) => t.classList.toggle("active", t === btn));
        loadEpisodes(id, s.season_number, title, list);
      });
      tabs.append(btn);
    });

    detail.append(el("div", { className: "seasons" }, tabs, list));
    tabs.querySelector(".season-tab")?.click();
  }
}

async function loadEpisodes(showId, season, showTitle, list) {
  list.replaceChildren(el("p", { className: "empty", textContent: "loading..." }));
  const data = await tmdb(`/tv/${showId}/season/${season}`);
  list.replaceChildren(
    ...data.episodes.map((ep, i) => {
      const item = el("button", { className: "episode" },
        ep.still_path ? el("img", { src: `${IMG}/w300${ep.still_path}`, alt: "", loading: "lazy" }) : el("div", { className: "still-empty" }),
        el("div", { className: "ep-text" },
          el("span", { className: "ep-num", textContent: `E${ep.episode_number}` }),
          el("span", { className: "ep-title", textContent: ep.name }),
          ep.overview ? el("span", { className: "ep-overview", textContent: ep.overview }) : null),
      );
      item.style.setProperty("--i", Math.min(i, 20));
      item.addEventListener("click", () => watch(showId, "tv", showTitle, season, ep.episode_number));
      return item;
    }),
  );
}

function closeDetail() {
  $("detailOverlay").classList.remove("active");
}

$("detailOverlay").addEventListener("click", (e) => {
  if (e.target === $("detailOverlay")) closeDetail();
});

/* ---------------- player ---------------- */

let hls;
let watchToken = 0;

// the main site's floating nav would cover the top of the player
function setParentNav(hidden) {
  if (window.parent !== window) window.parent.postMessage({ type: "lonlii-nav", hidden }, location.origin);
}

function cleanupPlayer() {
  const video = $("videoPlayer");
  if (hls) {
    hls.destroy();
    hls = null;
  }
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("embedPlayer").removeAttribute("src");
}

function setStatus(text) {
  $("playerStatus").textContent = text;
}

function playDirect(stream) {
  cleanupPlayer();
  const video = $("videoPlayer");
  $("playerOverlay").dataset.mode = "direct";
  setStatus("loading stream...");

  if (!Hls.isSupported()) {
    setStatus("this browser can't play direct streams, pick another server");
    return;
  }

  // what the repo's /api/proxy did: carry the host token along and send the stream host as referer
  const token = new URL(stream.url).searchParams.get("token");
  const loader = lonliiBareHlsLoader({
    rewrite: (url) => (token && !url.includes("token=") ? url + (url.includes("?") ? "&" : "?") + "token=" + token : url),
    headers: (url) => ({ Referer: new URL(url).origin + "/", "User-Agent": UA }),
  });
  hls = new Hls({ loader, enableWorker: true });
  hls.loadSource(stream.url);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    setStatus("");
    video.play().catch(() => {});
  });
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (data.fatal) setStatus("stream error, try another server");
  });
}

async function playEmbed(url) {
  cleanupPlayer();
  $("playerOverlay").dataset.mode = "embed";
  setStatus("loading through proxy...");
  const frame = $("embedPlayer");
  frame.onload = () => setStatus("");
  frame.src = await lonliiProxy.url(url);
}

function renderServers(options, activeIndex) {
  const bar = $("serverBar");
  bar.replaceChildren(
    ...options.map((opt, i) => {
      const btn = el("button", { className: "server-btn" + (i === activeIndex ? " active" : ""), textContent: opt.name });
      btn.addEventListener("click", () => {
        bar.querySelectorAll(".server-btn").forEach((b) => b.classList.toggle("active", b === btn));
        opt.play();
      });
      return btn;
    }),
  );
}

async function watch(id, type, title, season, episode) {
  const token = ++watchToken;
  closeDetail();
  cleanupPlayer();
  $("playerOverlay").classList.add("active");
  setParentNav(true);
  $("nowPlaying").textContent = type === "tv" ? `${title} · S${season}E${episode}` : title;

  const embeds = EMBEDS.map((e) => {
    const url = type === "tv" ? e.tv(id, season, episode) : e.movie(id);
    return { name: e.name, play: () => playEmbed(url) };
  });
  renderServers(embeds, -1);
  setStatus("finding direct streams...");

  let direct = [];
  try {
    direct = await vidsrcExtract(type, id, season, episode);
  } catch (e) {
    console.warn("[vidsrc]", e);
  }
  if (token !== watchToken) return; // user moved on

  const directOptions = direct.slice(0, 3).map((s, i) => ({
    name: direct.length > 1 ? `${s.name} ${i + 1}` : s.name,
    play: () => playDirect(s),
  }));
  const options = [...directOptions, ...embeds];
  renderServers(options, 0);
  options[0].play();
}

function closePlayer() {
  watchToken++;
  cleanupPlayer();
  $("playerOverlay").classList.remove("active");
  setParentNav(false);
}

$("playerClose").addEventListener("click", closePlayer);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if ($("playerOverlay").classList.contains("active")) closePlayer();
  else closeDetail();
});

loadGrid(true);
