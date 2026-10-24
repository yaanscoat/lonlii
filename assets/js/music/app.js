// the music page: views (home, search, artist, album, liked, recent) and the player controls.
// data comes from YTM (music/ytm.js) and falls back to SC (music/soundcloud.js).
// pages are addressed with the hash: #/, #/search?q=..., #/artist/<id>, #/album/<id>, #/liked, #/recent
(() => {
  const $ = (id) => document.getElementById(id);
  const view = $("view");
  const player = MusicPlayer;

  /* ---------- tiny dom helpers (all text goes in as text, never as html) ---------- */

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "style") node.style.cssText = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) node[k] = v;
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c);
    return node;
  }

  const icon = (name) => el("i", { class: name });
  const fmt = (s) => {
    if (!s || !Number.isFinite(s)) return "0:00";
    s = Math.floor(s);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const go = (hash) => (location.hash = hash);
  const artistHref = (a) => (a?.id ? `#/artist/${encodeURIComponent(a.id)}` : null);

  // "Artist, Other Artist" with each linked to its profile
  function artistLinks(artists = []) {
    const out = [];
    artists.forEach((a, i) => {
      if (i) out.push(", ");
      const href = artistHref(a);
      out.push(href ? el("a", { href, textContent: a.name, onclick: (e) => e.stopPropagation() }) : a.name);
    });
    return out;
  }

  /* ---------- likes ---------- */

  const LIKED = "lonlii_musicLiked";
  const liked = () => {
    try { return JSON.parse(localStorage.getItem(LIKED) ?? "[]"); } catch { return []; }
  };
  const isLiked = (t) => liked().some((x) => x.id === t.id && x.source === t.source);
  function toggleLike(t) {
    const list = liked();
    const i = list.findIndex((x) => x.id === t.id && x.source === t.source);
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ ...t, sc: t.sc ? { id: t.sc.id, media: t.sc.media, track_authorization: t.sc.track_authorization } : undefined });
    try { localStorage.setItem(LIKED, JSON.stringify(list)); } catch {}
    syncLikes();
  }
  function likeButton(t) {
    const b = el("button", { class: "round like small", title: "Like", onclick: (e) => { e.stopPropagation(); toggleLike(t); } }, icon("ri-heart-3-line"));
    b.dataset.trackId = `${t.source}:${t.id}`;
    paintLike(b, isLiked(t));
    return b;
  }
  function paintLike(b, on) {
    b.classList.toggle("on", on);
    b.firstChild.className = on ? "ri-heart-3-fill" : "ri-heart-3-line";
  }
  function syncLikes() {
    const ids = new Set(liked().map((t) => `${t.source}:${t.id}`));
    document.querySelectorAll(".like[data-track-id]").forEach((b) => paintLike(b, ids.has(b.dataset.trackId)));
    const t = player.current();
    for (const id of ["npLike", "pbLike"]) paintLike($(id), !!t && ids.has(`${t.source}:${t.id}`));
  }

  /* ---------- building blocks ---------- */

  function trackRow(track, index, list, { number = true, art = true, album = true } = {}) {
    const playing = player.current()?.id === track.id;
    const row = el(
      "div",
      {
        class: "track-row" + (playing ? " playing" : "") + (track.unplayable ? " unplayable" : ""),
        style: `--i:${Math.min(index, 20)}`,
        title: track.unplayable ? "SoundCloud only has a preview of this song" : "",
        onclick: () => !track.unplayable && player.play(list, index),
      },
      number ? el("span", { class: "num" }, el("span", { textContent: index + 1 }), icon("ri-play-fill")) : null,
      art ? el("img", { class: "row-art", src: track.thumb, alt: "", loading: "lazy" }) : null,
      el("div", { class: "row-text" },
        el("span", { class: "row-title", textContent: track.title }),
        el("span", { class: "row-sub" }, track.isVideo ? el("span", { class: "tag", textContent: "Video" }) : null, ...artistLinks(track.artists))),
      album && track.album?.name
        ? el("span", { class: "row-album" }, track.album.id
            ? el("a", { href: `#/album/${encodeURIComponent(track.album.id)}`, textContent: track.album.name, onclick: (e) => e.stopPropagation() })
            : track.album.name)
        : el("span", { class: "row-album" }),
      el("div", { class: "row-actions" },
        likeButton(track),
        el("button", { class: "round small", title: "Add to queue", onclick: (e) => { e.stopPropagation(); player.addToQueue(track); toast("Added to queue"); } }, icon("ri-play-list-add-line"))),
      el("span", { class: "row-time", textContent: track.duration ? fmt(track.duration) : "" }),
    );
    row.dataset.trackId = `${track.source}:${track.id}`;
    return row;
  }

  function trackList(tracks, opts) {
    return el("div", { class: "track-list" }, tracks.map((t, i) => trackRow(t, i, tracks, opts)));
  }

  function card(item) {
    const isArtist = item.type === "artist";
    const isTrack = item.type === "track";
    const href = isArtist ? artistHref(item) : isTrack ? null : `#/album/${encodeURIComponent(item.id)}`;
    const sub = isArtist
      ? item.subtitle?.replace(/^Artist • /, "") || "Artist"
      : isTrack
        ? item.artists.map((a) => a.name).join(", ")
        : [item.kind, item.year, item.artists?.map((a) => a.name).join(", ")].filter(Boolean).join(" • ") || item.subtitle;

    const playBtn = el("button", {
      class: "card-play",
      title: "Play",
      onclick: async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (isTrack) return player.play([item], 0);
        const data = isArtist ? await loadArtist(item.id) : await loadCollection(item.id);
        const tracks = (isArtist ? data.topSongs : data.tracks).filter((t) => !t.unplayable);
        if (tracks.length) player.play(tracks, 0);
      },
    }, icon("ri-play-fill"));

    return el(
      href ? "a" : "div",
      { class: "card" + (isArtist ? " artist" : ""), href, onclick: isTrack ? () => player.play([item], 0) : null },
      el("div", { class: "card-art" }, el("img", { src: item.thumb, alt: "", loading: "lazy" }), playBtn),
      el("span", { class: "card-title", textContent: item.title ?? item.name }),
      el("span", { class: "card-sub", textContent: sub ?? "" }),
    );
  }

  function shelf(title, items, more) {
    if (!items?.length) return null;
    const row = el("div", { class: "shelf-row" }, items.map(card));
    const scroll = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: "smooth" });
    return el("section", { class: "shelf" },
      el("div", { class: "shelf-head" },
        el("h2", { textContent: title }),
        more ? el("a", { class: "more", href: more, textContent: "Show all" }) : null,
        el("div", { class: "shelf-arrows desktop-only" },
          el("button", { class: "round small", onclick: () => scroll(-1) }, icon("ri-arrow-left-s-line")),
          el("button", { class: "round small", onclick: () => scroll(1) }, icon("ri-arrow-right-s-line")))),
      row);
  }

  // items in a YouTube Music shelf can be songs (a list) or cards
  function anyShelf(s) {
    const tracks = s.items.filter((i) => i.type === "track" && !i.isVideo);
    if (tracks.length === s.items.length && tracks.length > 3) {
      return el("section", { class: "shelf" }, el("div", { class: "shelf-head" }, el("h2", { textContent: s.title })),
        trackList(tracks.slice(0, 12), { number: false }));
    }
    return shelf(s.title, s.items, s.more ? `#/album/${encodeURIComponent(s.more.id)}` : null);
  }

  const loading = () => view.replaceChildren(el("div", { class: "loading" }, el("span", { class: "spinner" }), "Loading…"));
  const message = (title, text) => el("div", { class: "empty" }, el("h2", { textContent: title }), el("p", { textContent: text }));

  function toast(text) {
    const t = el("div", { class: "music-toast glass", textContent: text });
    document.body.append(t);
    setTimeout(() => t.classList.add("out"), 1600);
    setTimeout(() => t.remove(), 2000);
  }

  /* ---------- data, with soundcloud as the fallback ---------- */

  const cache = new Map();
  const cached = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
    return cache.get(key);
  };
  const loadArtist = (id) => cached(`artist:${id}`, () => (id.startsWith("sc:") ? SC.profile(id) : YTM.artist(id)));
  const loadCollection = (id) => cached(`col:${id}`, () => (id.startsWith("sc:") ? SC.collection(id) : YTM.collection(id)));

  async function searchEverywhere(q) {
    try {
      const r = await YTM.search(q);
      if (r.songs.length || r.artists.length || r.albums.length) return { ...r, source: "yt" };
      throw new Error("no results");
    } catch {
      return { ...(await SC.search(q)), source: "sc" };
    }
  }

  /* ---------- views ---------- */

  const greeting = () => {
    const h = new Date().getHours();
    return h < 5 ? "Up late?" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  };

  const recent = () => {
    try { return JSON.parse(localStorage.getItem("lonlii_musicRecent") ?? "[]"); } catch { return []; }
  };

  async function homeView() {
    const rec = recent();
    const page = el("div", { class: "page" },
      el("h1", { class: "page-title", textContent: greeting() }),
      rec.length ? el("div", { class: "quick-grid" }, rec.slice(0, 8).map((t, i) =>
        el("button", { class: "quick", onclick: () => player.play(rec, i) },
          el("img", { src: t.thumb, alt: "" }), el("span", { textContent: t.title })))) : null);
    view.replaceChildren(page);

    const status = el("div", { class: "loading" }, el("span", { class: "spinner" }), "Loading recommendations…");
    page.append(status);
    try {
      const [home, charts] = await Promise.all([YTM.home(), YTM.charts().catch(() => [])]);
      status.remove();
      [...home, ...charts].forEach((s) => page.append(anyShelf(s) ?? ""));
    } catch {
      status.replaceWith(message("Recommendations aren't loading", "YouTube Music isn't answering right now, but search still works (it'll use SoundCloud)."));
    }
  }

  async function searchView(q) {
    $("searchInput").value = q ?? "";
    if (!q) {
      view.replaceChildren(el("div", { class: "page" }, el("h1", { class: "page-title", textContent: "Search" }),
        message("Find something to play", "Search for songs, artists or albums.")));
      $("searchInput").focus();
      return;
    }
    loading();
    let r;
    try {
      r = await searchEverywhere(q);
    } catch {
      view.replaceChildren(message("Search isn't working", "Neither YouTube Music nor SoundCloud answered. Try again in a moment, or set your own bare server in Settings → Proxy."));
      return;
    }

    const page = el("div", { class: "page" });
    if (r.source === "sc") page.append(el("p", { class: "source-note" }, icon("ri-soundcloud-line"), " Showing SoundCloud results, YouTube Music isn't answering."));

    const top = r.top ?? r.songs[0];
    if (top || r.songs.length) {
      const topCard = top
        ? el(top.type === "track" ? "div" : "a", {
            class: "top-result glass" + (top.type === "artist" ? " artist" : ""),
            href: top.type === "artist" ? artistHref(top) : top.type === "track" ? null : `#/album/${encodeURIComponent(top.id)}`,
            onclick: top.type === "track" ? () => player.play([top], 0) : null,
          },
          el("img", { src: top.thumb, alt: "" }),
          el("h2", { textContent: top.name ?? top.title }),
          el("span", { class: "pill", textContent: top.type === "artist" ? "Artist" : top.kind ?? "Song" }))
        : null;
      page.append(el("div", { class: "search-top" },
        top ? el("section", {}, el("h2", { class: "section-title", textContent: "Top result" }), topCard) : null,
        el("section", { class: "grow" }, el("h2", { class: "section-title", textContent: "Songs" }),
          trackList(r.songs.slice(0, 5), { number: false, album: false }))));
    }
    page.append(shelf("Artists", r.artists) ?? "", shelf("Albums", r.albums) ?? "", shelf("Playlists", r.playlists) ?? "");
    if (r.songs.length > 5) {
      page.append(el("section", { class: "shelf" }, el("div", { class: "shelf-head" }, el("h2", { textContent: "More songs" })),
        trackList(r.songs, { number: true })));
    }
    if (!page.children.length) page.append(message("No results", `Nothing found for "${q}".`));
    view.replaceChildren(page);
  }

  async function artistView(id) {
    loading();
    let a;
    try {
      a = await loadArtist(id);
    } catch {
      view.replaceChildren(message("Couldn't load this artist", "Try again in a moment."));
      return;
    }
    const playable = a.topSongs.filter((t) => !t.unplayable);
    const hero = el("header", { class: "artist-hero", style: a.banner ? `--banner:url("${a.banner.replace(/"/g, "%22")}")` : "" },
      el("img", { class: "artist-avatar", src: a.thumb, alt: "" }),
      el("div", { class: "hero-text" },
        el("span", { class: "pill", textContent: a.source === "sc" ? "SoundCloud artist" : "Artist" }),
        el("h1", { textContent: a.name }),
        el("p", { class: "hero-meta", textContent: [a.listeners, a.subscribers && `${a.subscribers} subscribers`].filter(Boolean).join(" • ") }),
        el("div", { class: "hero-actions" },
          el("button", { class: "button play-big", disabled: !playable.length, onclick: () => player.play(playable, 0) }, icon("ri-play-fill"), " Play"),
          el("button", { class: "button", disabled: !playable.length, onclick: () => { if (!player.state.shuffle) player.toggleShuffle(); player.play(playable, Math.floor(Math.random() * playable.length)); } }, icon("ri-shuffle-line"), " Shuffle"))));

    const page = el("div", { class: "page artist-page" }, hero);
    if (a.topSongs.length) {
      page.append(el("section", { class: "shelf" },
        el("div", { class: "shelf-head" }, el("h2", { textContent: "Popular" }),
          a.topSongsMore ? el("a", { class: "more", href: `#/album/${encodeURIComponent(a.topSongsMore.id)}`, textContent: "Show all" }) : null),
        trackList(a.topSongs, { number: true })));
    }
    a.shelves.forEach((s) => page.append(anyShelf(s) ?? ""));
    if (a.description) {
      page.append(el("section", { class: "about glass" }, el("h2", { textContent: "About" }), el("p", { textContent: a.description })));
    }
    view.replaceChildren(page);
  }

  async function albumView(id) {
    loading();
    let c;
    try {
      c = await loadCollection(id);
    } catch {
      view.replaceChildren(message("Couldn't load this", "Try again in a moment."));
      return;
    }
    const playable = c.tracks.filter((t) => !t.unplayable);
    const page = el("div", { class: "page" },
      el("header", { class: "album-hero", style: `--art:url("${(c.thumb ?? "").replace(/"/g, "%22")}")` },
        el("img", { class: "album-cover", src: c.thumb, alt: "" }),
        el("div", { class: "hero-text" },
          el("span", { class: "pill", textContent: c.kind ?? "Album" }),
          el("h1", { textContent: c.title }),
          el("p", { class: "hero-meta" }, ...artistLinks(c.artists), c.year ? ` • ${c.year}` : "", c.info ? ` • ${c.info}` : ""),
          el("div", { class: "hero-actions" },
            el("button", { class: "button play-big", disabled: !playable.length, onclick: () => player.play(playable, 0) }, icon("ri-play-fill"), " Play"),
            el("button", { class: "button", disabled: !playable.length, onclick: () => { if (!player.state.shuffle) player.toggleShuffle(); player.play(playable, Math.floor(Math.random() * playable.length)); } }, icon("ri-shuffle-line"), " Shuffle")))),
      c.tracks.length ? trackList(c.tracks, { number: true, art: c.type === "playlist", album: c.type === "playlist" }) : message("No songs", "This one's empty."));
    c.shelves.forEach((s) => page.append(anyShelf(s) ?? ""));
    if (c.description) page.append(el("section", { class: "about glass" }, el("h2", { textContent: "About" }), el("p", { textContent: c.description })));
    view.replaceChildren(page);
  }

  function libraryView(title, tracks, emptyText) {
    view.replaceChildren(el("div", { class: "page" },
      el("header", { class: "album-hero library" },
        el("div", { class: "album-cover library-cover" }, icon(title === "Liked songs" ? "ri-heart-3-fill" : "ri-history-line")),
        el("div", { class: "hero-text" },
          el("span", { class: "pill", textContent: "Playlist" }),
          el("h1", { textContent: title }),
          el("p", { class: "hero-meta", textContent: `${tracks.length} songs` }),
          el("div", { class: "hero-actions" },
            el("button", { class: "button play-big", disabled: !tracks.length, onclick: () => player.play(tracks, 0) }, icon("ri-play-fill"), " Play")))),
      tracks.length ? trackList(tracks, { number: true }) : message("Nothing here yet", emptyText)));
  }

  /* ---------- router ---------- */

  async function route() {
    const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const section = parts[0] ?? "home";
    document.querySelectorAll("[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === section || (section === "home" && a.dataset.view === "home")));
    view.scrollTop = 0;
    document.querySelector(".main").scrollTop = 0;

    if (section === "search") return searchView(new URLSearchParams(query).get("q"));
    if (section === "artist" && parts[1]) return artistView(parts[1]);
    if (section === "album" && parts[1]) return albumView(parts[1]);
    if (section === "liked") return libraryView("Liked songs", liked(), "Tap the heart on any song to save it here.");
    if (section === "recent") return libraryView("Recently played", recent(), "Songs you play show up here.");
    return homeView();
  }

  addEventListener("hashchange", route);

  /* ---------- search box + suggestions ---------- */

  const input = $("searchInput");
  const box = $("suggestions");
  let suggestTimer;

  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    box.classList.remove("open");
    const q = input.value.trim();
    if (q) go(`#/search?q=${encodeURIComponent(q)}`);
    input.blur();
  });

  input.addEventListener("input", () => {
    clearTimeout(suggestTimer);
    const q = input.value.trim();
    if (!q) return box.classList.remove("open");
    suggestTimer = setTimeout(async () => {
      try {
        const list = await YTM.suggestions(q);
        if (input.value.trim() !== q) return;
        box.replaceChildren(...list.map((s) => el("button", { type: "button", onclick: () => { input.value = s; $("searchForm").requestSubmit(); } }, icon("ri-search-line"), s)));
        box.classList.toggle("open", list.length > 0);
      } catch {
        box.classList.remove("open");
      }
    }, 220);
  });

  input.addEventListener("blur", () => setTimeout(() => box.classList.remove("open"), 150));

  /* ---------- player ui ---------- */

  const npPanel = $("nowPlaying");
  const isNarrow = () => matchMedia("(max-width: 1199px)").matches;

  function renderTrack(t) {
    for (const [img, title, artist] of [["pbArt", "pbTitle", "pbArtist"], ["npArt", "npTitle", "npArtist"]]) {
      $(img).src = t?.thumb ?? "";
      $(img).hidden = !t?.thumb;
      $(title).textContent = t?.title ?? "Nothing playing";
      $(artist).replaceChildren(...(t ? artistLinks(t.artists) : []));
    }
    document.title = t ? `${t.title} • lonlii` : "lonlii | music";
    document.querySelectorAll(".track-row").forEach((r) => r.classList.toggle("playing", !!t && r.dataset.trackId === `${t.source}:${t.id}`));
    syncLikes();
  }

  function renderState(s) {
    const t = player.current();
    document.querySelectorAll('[data-action="toggle"] i').forEach((i) => (i.className = s.loading && !s.playing ? "ri-loader-4-line spin" : s.playing ? "ri-pause-fill" : "ri-play-fill"));
    document.querySelectorAll('[data-action="shuffle"]').forEach((b) => b.classList.toggle("on", s.shuffle));
    document.querySelectorAll('[data-action="repeat"]').forEach((b) => {
      b.classList.toggle("on", s.repeat !== "off");
      b.firstChild.className = s.repeat === "one" ? "ri-repeat-one-line" : "ri-repeat-line";
    });
    $("npMedia").classList.toggle("engine-sc", s.engine !== "yt");
    $("npNote").textContent = s.note;
    $("volume").value = s.volume;
    $("volume").style.setProperty("--fill", `${s.volume}%`);
    $("volIcon").className = (s.volume === 0 ? "ri-volume-mute-line" : s.volume < 50 ? "ri-volume-down-line" : "ri-volume-up-line") + " vol-icon";
    document.body.classList.toggle("has-track", !!t);
    renderQueue(s);
  }

  let queueKey = "";
  function renderQueue(s) {
    const key = `${s.index}:${s.queue.length}:${s.queue[s.index]?.id}`;
    if (key === queueKey) return;
    queueKey = key;
    const upcoming = s.queue.slice(s.index + 1, s.index + 31);
    $("queue").replaceChildren(...(upcoming.length
      ? upcoming.map((t, i) => el("button", { class: "queue-item", onclick: () => player.jump(s.index + 1 + i) },
          el("img", { src: t.thumb, alt: "", loading: "lazy" }),
          el("span", { class: "q-text" }, el("span", { class: "q-title", textContent: t.title }), el("span", { class: "q-artist", textContent: t.artists.map((a) => a.name).join(", ") })),
          el("span", { class: "q-time", textContent: t.duration ? fmt(t.duration) : "" })))
      : [el("p", { class: "q-empty", textContent: "Similar songs will play when the queue runs out." })]));
  }

  let seeking = false;
  function renderProgress(s) {
    if (seeking) return;
    const ratio = s.duration ? s.time / s.duration : 0;
    for (const id of ["pbSeek", "npSeek"]) {
      $(id).value = Math.round(ratio * 1000);
      $(id).style.setProperty("--fill", `${ratio * 100}%`);
    }
    $("pbMiniProgress").style.width = `${ratio * 100}%`;
    for (const id of ["pbTime", "npTime"]) $(id).textContent = fmt(s.time);
    for (const id of ["pbDur", "npDur"]) $(id).textContent = fmt(s.duration);
  }

  player.on("change", renderTrack);
  player.on("state", renderState);
  player.on("progress", renderProgress);

  const actions = {
    toggle: () => player.toggle(),
    next: () => player.next(),
    prev: () => player.previous(),
    shuffle: () => player.toggleShuffle(),
    repeat: () => player.cycleRepeat(),
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    e.stopPropagation();
    actions[b.dataset.action]?.();
  });

  for (const id of ["pbSeek", "npSeek"]) {
    const r = $(id);
    r.addEventListener("input", () => {
      seeking = true;
      r.style.setProperty("--fill", `${r.value / 10}%`);
    });
    r.addEventListener("change", () => {
      seeking = false;
      player.seek((r.value / 1000) * player.state.duration);
    });
  }

  $("volume").addEventListener("input", (e) => player.setVolume(Number(e.target.value)));
  $("volIcon").addEventListener("click", () => player.setVolume(player.state.volume ? 0 : 80));
  for (const id of ["npLike", "pbLike"]) $(id).addEventListener("click", () => player.current() && toggleLike(player.current()));

  // like youtube music: "song" shows the cover over the player, "video" shows the video itself
  const setMediaMode = (mode) => {
    $("npMedia").classList.toggle("show-video", mode === "video");
    $("npSwitch").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    try { localStorage.setItem("lonlii_musicMode", mode); } catch {}
  };
  $("npSwitch").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (b) setMediaMode(b.dataset.mode);
  });
  setMediaMode(localStorage.getItem("lonlii_musicMode") === "video" ? "video" : "song");

  // the now playing panel is a column on wide screens and a sheet on smaller ones
  const openNp = (open) => {
    npPanel.classList.toggle("open", open);
    if (window.parent !== window) window.parent.postMessage({ type: "lonlii-nav", hidden: open && isNarrow() }, location.origin);
  };
  $("npToggle").addEventListener("click", () => (isNarrow() ? openNp(!npPanel.classList.contains("open")) : document.body.classList.toggle("np-hidden")));
  $("npClose").addEventListener("click", () => openNp(false));
  $("pbTrack").addEventListener("click", (e) => {
    if (isNarrow() && !e.target.closest("a, button")) openNp(true);
  });

  // keyboard: space plays/pauses, arrows seek, unless you're typing
  addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea")) return;
    if (e.code === "Space") {
      e.preventDefault();
      player.toggle();
    } else if (e.code === "ArrowRight" && e.shiftKey) player.next();
    else if (e.code === "ArrowLeft" && e.shiftKey) player.previous();
    else if (e.code === "ArrowRight") player.seek(Math.min(player.state.time + 5, player.state.duration));
    else if (e.code === "ArrowLeft") player.seek(Math.max(player.state.time - 5, 0));
    else if (e.code === "Escape") openNp(false);
  });

  renderTrack(null);
  renderState(player.state);
  route();
})();
