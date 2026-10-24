// SoundCloud: the backup for searching and for playback when YouTube can't play a song.
// uses SoundCloud's own api (api-v2.soundcloud.com) through the bare proxy, with the public
// client id its website ships in its scripts.
window.SC = (() => {
  const API = "https://api-v2.soundcloud.com";
  const ID_KEY = "lonlii_scClientId";
  const DAY = 24 * 60 * 60 * 1000;
  let clientIdPromise;

  const get = async (url) => {
    const r = await lonliiProxy.fetch(url);
    if (!r.ok) throw new Error(`SoundCloud ${r.status}`);
    return r;
  };

  // soundcloud.com's scripts contain client_id:"..." — find it once a day
  function clientId(refresh = false) {
    if (!refresh && clientIdPromise) return clientIdPromise;
    clientIdPromise = (async () => {
      if (!refresh) {
        try {
          const saved = JSON.parse(localStorage.getItem(ID_KEY) ?? "null");
          if (saved && Date.now() - saved.at < DAY) return saved.id;
        } catch {}
      }
      const html = await (await get("https://soundcloud.com/")).text();
      const scripts = [...html.matchAll(/<script crossorigin src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
      for (const src of scripts.reverse()) {
        const js = await (await get(src)).text();
        const m = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/) || js.match(/client_id=([a-zA-Z0-9]{32})/);
        if (m) {
          try { localStorage.setItem(ID_KEY, JSON.stringify({ id: m[1], at: Date.now() })); } catch {}
          return m[1];
        }
      }
      throw new Error("couldn't find a SoundCloud client id");
    })();
    clientIdPromise.catch(() => (clientIdPromise = null));
    return clientIdPromise;
  }

  async function api(path, params = {}, retried = false) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("client_id", await clientId(retried));
    const r = await lonliiProxy.fetch(url.toString());
    if ((r.status === 401 || r.status === 403) && !retried) return api(path, params, true); // stale id
    if (!r.ok) throw new Error(`SoundCloud ${r.status}`);
    return r.json();
  }

  /* ---------- shapes ---------- */

  const art = (url, size = "t500x500") => (url ? url.replace("-large.", `-${size}.`) : "");

  const track = (t) => ({
    type: "track",
    source: "sc",
    id: String(t.id),
    title: t.title,
    artists: [{ id: t.user ? `sc:${t.user.id}` : null, name: t.publisher_metadata?.artist || t.user?.username || "" }],
    album: t.publisher_metadata?.album_title ? { id: null, name: t.publisher_metadata.album_title } : null,
    duration: Math.round((t.full_duration || t.duration || 0) / 1000) || null,
    thumb: art(t.artwork_url || t.user?.avatar_url),
    sc: t, // kept for playback
    unplayable: !playable(t), // label releases are encrypted or 30 second previews
  });

  const artist = (u) => ({
    type: "artist",
    source: "sc",
    id: `sc:${u.id}`,
    name: u.username,
    thumb: art(u.avatar_url),
    subtitle: u.followers_count ? `${Intl.NumberFormat("en", { notation: "compact" }).format(u.followers_count)} followers` : "",
  });

  const album = (p) => ({
    type: "album",
    source: "sc",
    id: `sc:${p.id}`,
    title: p.title,
    artists: [{ id: p.user ? `sc:${p.user.id}` : null, name: p.user?.username ?? "" }],
    kind: p.set_type ? p.set_type[0].toUpperCase() + p.set_type.slice(1) : p.is_album ? "Album" : "Playlist",
    year: (p.release_date || p.created_at || "").slice(0, 4),
    thumb: art(p.artwork_url || p.tracks?.[0]?.artwork_url || p.user?.avatar_url),
  });

  // full songs only: 30 second previews and encrypted streams can't be played here
  function playable(t) {
    return (
    t.policy !== "BLOCK" &&
    (t.media?.transcodings ?? []).some((x) => !x.snipped && (x.format.protocol === "progressive" || x.format.protocol === "hls"))
    );
  }

  /* ---------- api ---------- */

  async function search(query) {
    const [tracks, users, albums] = await Promise.all([
      api("/search/tracks", { q: query, limit: 30 }),
      api("/search/users", { q: query, limit: 8 }).catch(() => ({ collection: [] })),
      api("/search/albums", { q: query, limit: 8 }).catch(() => ({ collection: [] })),
    ]);
    const songs = tracks.collection.filter(playable).map(track);
    const artists = users.collection.map(artist);
    return {
      top: artists[0] ?? songs[0] ?? null,
      songs: songs.slice(0, 20),
      artists,
      albums: albums.collection.map(album),
      playlists: [],
    };
  }

  async function profile(id) {
    const userId = id.replace(/^sc:/, "");
    const [user, top, albums, tracks] = await Promise.all([
      api(`/users/${userId}`),
      api(`/users/${userId}/toptracks`, { limit: 10 }).catch(() => ({ collection: [] })),
      api(`/users/${userId}/albums`, { limit: 20 }).catch(() => ({ collection: [] })),
      api(`/users/${userId}/tracks`, { limit: 30 }).catch(() => ({ collection: [] })),
    ]);
    const shelves = [];
    if (albums.collection.length) shelves.push({ title: "Albums", items: albums.collection.map(album) });
    const latest = tracks.collection.map(track);
    if (latest.length) shelves.push({ title: "Latest releases", items: latest });
    return {
      type: "artist",
      source: "sc",
      id: `sc:${user.id}`,
      name: user.username,
      thumb: art(user.avatar_url),
      banner: user.visuals?.visuals?.[0]?.visual_url ?? "",
      description: user.description ?? "",
      listeners: user.followers_count ? `${Intl.NumberFormat("en", { notation: "compact" }).format(user.followers_count)} followers` : "",
      subscribers: "",
      topSongs: (top.collection.length ? top.collection : tracks.collection).map(track).slice(0, 10),
      topSongsMore: null,
      shelves,
    };
  }

  async function collection(id) {
    const p = await api(`/playlists/${id.replace(/^sc:/, "")}`);
    // playlists only include the first few tracks in full; fetch the rest by id
    const full = p.tracks.filter((t) => t.title);
    const stubs = p.tracks.filter((t) => !t.title).map((t) => t.id);
    for (let i = 0; i < stubs.length; i += 50) {
      full.push(...(await api("/tracks", { ids: stubs.slice(i, i + 50).join(",") })));
    }
    const order = new Map(p.tracks.map((t, i) => [t.id, i]));
    full.sort((a, b) => order.get(a.id) - order.get(b.id));
    const a = album(p);
    return {
      ...a,
      type: a.kind === "Playlist" ? "playlist" : "album",
      info: `${p.track_count} songs`,
      description: p.description ?? "",
      thumb: art(p.artwork_url || full[0]?.artwork_url, "t500x500"),
      tracks: full.map(track),
      shelves: [],
    };
  }

  // the closest full SoundCloud upload of a song, for when YouTube can't play it
  async function match(t) {
    const query = `${t.artists?.[0]?.name ?? ""} ${t.title}`.trim();
    const { collection } = await api("/search/tracks", { q: query, limit: 15 });
    const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const want = norm(t.title);
    const candidates = collection.filter(playable).map((c) => {
      let score = 0;
      if (norm(c.title).includes(want)) score += 3;
      if (norm(c.user?.username).includes(norm(t.artists?.[0]?.name)) || norm(c.publisher_metadata?.artist).includes(norm(t.artists?.[0]?.name))) score += 2;
      if (t.duration && Math.abs(c.full_duration / 1000 - t.duration) < 8) score += 3;
      if (/sped|slowed|nightcore|8d|reverb|cover|remix|karaoke/i.test(c.title) && !/remix|cover/i.test(t.title)) score -= 4;
      return [score, c];
    });
    candidates.sort((a, b) => b[0] - a[0]);
    const best = candidates[0];
    return best && best[0] >= 3 ? track(best[1]) : null;
  }

  // where to stream a SoundCloud track from: { url, kind: "hls" | "file" }
  async function stream(t) {
    const all = (t.sc?.media?.transcodings ?? []).filter((x) => !x.snipped);
    // aac over hls first: the old mp3 hls variant often 404s now
    const pick =
      all.find((x) => x.format.protocol === "progressive") ??
      all.find((x) => x.format.protocol === "hls" && x.format.mime_type.startsWith("audio/mp4")) ??
      all.find((x) => x.format.protocol === "hls");
    if (!pick) throw new Error("no playable stream");
    const params = t.sc.track_authorization ? { track_authorization: t.sc.track_authorization } : {};
    const url = new URL(pick.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("client_id", await clientId());
    const r = await (await get(url.toString())).json();
    return { url: r.url, kind: pick.format.protocol === "hls" ? "hls" : "file" };
  }

  return { search, profile, collection, match, stream };
})();
