// YouTube Music: search, artist pages, albums, playlists, home and radio, through the bare proxy.
// talks to music.youtube.com's own "innertube" api, the same one its website uses.
//
// everything comes back in lonlii's own shapes (see music/app.js):
//   track  { source: "yt", id, title, artists: [{ id, name }], album: { id, name } | null, duration, thumb }
//   album  { source: "yt", id, title, artists, year, kind, thumb }
//   artist { source: "yt", id, name, thumb, subtitle }
window.YTM = (() => {
  const BASE = "https://music.youtube.com/youtubei/v1/";
  const CLIENT_VERSION = "1.20260927.17.00";
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  // search filters, as YouTube Music encodes them
  const SONGS_ONLY = "EgWKAQIIAWoKEAkQBRALEAoQBA==";
  const ARTISTS_ONLY = "EgWKAQIgAWoKEAkQChAFEAMQBA==";

  async function call(endpoint, body) {
    const r = await lonliiProxy.fetch(`${BASE}${endpoint}?prettyPrint=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://music.youtube.com",
        Referer: "https://music.youtube.com/",
        "User-Agent": UA,
        "X-Youtube-Client-Name": "67",
        "X-Youtube-Client-Version": CLIENT_VERSION,
      },
      body: JSON.stringify({
        context: { client: { clientName: "WEB_REMIX", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" } },
        ...body,
      }),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok || !json || json.error) throw new Error(json?.error?.message || `YouTube Music ${r.status}`);
    return json;
  }

  /* ---------- small helpers ---------- */

  const text = (t) => (t?.runs ? t.runs.map((r) => r.text).join("") : t?.simpleText ?? "");

  // the biggest square-ish thumbnail, resized up when it's a googleusercontent image
  function thumb(node, size = 544) {
    const list =
      node?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
      node?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ??
      node?.thumbnails ??
      [];
    const url = list.at(-1)?.url ?? "";
    return /googleusercontent|ggpht/.test(url) ? url.replace(/=w\d+-h\d+.*$/, `=w${size}-h${size}-l90-rj`) : url;
  }

  const PAGE_TYPES = {
    MUSIC_PAGE_TYPE_ARTIST: "artist",
    MUSIC_PAGE_TYPE_ALBUM: "album",
    MUSIC_PAGE_TYPE_PLAYLIST: "playlist",
    MUSIC_PAGE_TYPE_AUDIOBOOK: "album",
  };

  function browseOf(endpoint) {
    const b = endpoint?.browseEndpoint;
    if (!b) return null;
    const type = PAGE_TYPES[b.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType];
    return type ? { id: b.browseId, type } : null;
  }

  const durationOf = (s) => {
    if (!/^\d+(:\d{2}){1,2}$/.test(s ?? "")) return null;
    return s.split(":").map(Number).reduce((a, n) => a * 60 + n, 0);
  };

  // "Song • Sabrina Carpenter • Short n' Sweet • 2:56" as runs -> fields, keeping each run's link
  function fields(runs = []) {
    const out = [[]];
    for (const r of runs) {
      if (r.text === " • ") out.push([]);
      else out.at(-1).push(r);
    }
    return out.filter((f) => f.length);
  }

  const KINDS = { Song: "song", Video: "video", Artist: "artist", Album: "album", Single: "album", EP: "album", Playlist: "playlist" };

  /* ---------- parsers ---------- */

  // one row in a list: a song, or an artist / album / playlist in search results
  function listItem(r, fallback = {}) {
    const cols = (r.flexColumns ?? []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text);
    const first = cols[0]?.runs?.[0];
    const title = text(cols[0]);
    if (!title) return null;

    const meta = fields(cols.slice(1).flatMap((c, i) => (c?.runs ? [...(i ? [{ text: " • " }] : []), ...c.runs] : [])));
    const label = meta[0]?.length === 1 && KINDS[meta[0][0].text] ? meta.shift()[0].text : null;

    const browse = browseOf(r.navigationEndpoint) ?? browseOf(first?.navigationEndpoint);
    const videoId =
      r.playlistItemData?.videoId ??
      first?.navigationEndpoint?.watchEndpoint?.videoId ??
      r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;

    const artists = [];
    let album = null;
    let duration = durationOf(text(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text));
    let subtitle = [];
    for (const f of meta) {
      const joined = f.map((x) => x.text).join("");
      const linkedArtists = f.filter((x) => browseOf(x.navigationEndpoint)?.type === "artist");
      const linkedAlbum = f.find((x) => browseOf(x.navigationEndpoint)?.type === "album");
      if (linkedArtists.length) {
        linkedArtists.forEach((x) => artists.push({ id: browseOf(x.navigationEndpoint).id, name: x.text }));
      } else if (linkedAlbum) {
        album = { id: browseOf(linkedAlbum.navigationEndpoint).id, name: linkedAlbum.text };
      } else if (duration === null && durationOf(joined) !== null) {
        duration = durationOf(joined);
      } else {
        subtitle.push(joined);
      }
    }

    const art = thumb(r.thumbnail) || fallback.thumb || "";

    if (videoId && (!browse || label === "Song" || label === "Video")) {
      // plain text artist names (album track lists, "Artist - Topic" rows) get the album's artists
      if (!artists.length) {
        const plain = subtitle.find((s) => !/plays|views|^\d{4}$/.test(s));
        if (plain && !fallback.artists?.length) artists.push({ id: null, name: plain.replace(/ - Topic$/, "") });
      }
      return {
        type: "track",
        source: "yt",
        id: videoId,
        title,
        artists: artists.length ? artists : fallback.artists ?? [],
        album: album ?? fallback.album ?? null,
        duration,
        thumb: art,
        isVideo: label === "Video",
      };
    }

    if (!browse) return null;
    if (browse.type === "artist") {
      return { type: "artist", source: "yt", id: browse.id, name: title, thumb: art, subtitle: subtitle.join(" • ") };
    }
    return {
      type: browse.type,
      source: "yt",
      id: browse.id,
      title,
      artists,
      kind: label ?? (browse.type === "playlist" ? "Playlist" : "Album"),
      year: subtitle.find((s) => /^\d{4}$/.test(s)) ?? "",
      subtitle: subtitle.join(" • "),
      thumb: art,
    };
  }

  // one card in a carousel: an album, single, artist, playlist or video
  function twoRow(r) {
    const browse = browseOf(r.navigationEndpoint);
    const videoId = r.navigationEndpoint?.watchEndpoint?.videoId;
    const title = text(r.title);
    const subRuns = r.subtitle?.runs ?? [];
    const artists = subRuns
      .filter((x) => browseOf(x.navigationEndpoint)?.type === "artist")
      .map((x) => ({ id: browseOf(x.navigationEndpoint).id, name: x.text }));
    const sub = text(r.subtitle);
    const art = thumb(r.thumbnailRenderer);

    if (videoId) {
      return { type: "track", source: "yt", id: videoId, title, artists, album: null, duration: null, thumb: art, isVideo: true };
    }
    if (!browse) return null;
    if (browse.type === "artist") return { type: "artist", source: "yt", id: browse.id, name: title, thumb: art, subtitle: sub };
    const parts = sub.split(" • ");
    return {
      type: browse.type,
      source: "yt",
      id: browse.id,
      title,
      artists,
      kind: KINDS[parts[0]] ? parts[0] : browse.type === "playlist" ? "Playlist" : "Album",
      year: parts.find((p) => /^\d{4}$/.test(p)) ?? "",
      subtitle: sub,
      thumb: art,
    };
  }

  // a titled row of items (carousel or list)
  function shelf(node, fallback) {
    const s = node.musicCarouselShelfRenderer ?? node.musicShelfRenderer ?? node.musicPlaylistShelfRenderer;
    if (!s) return null;
    const title = text(s.header?.musicCarouselShelfBasicHeaderRenderer?.title ?? s.title);
    const items = (s.contents ?? [])
      .map((c) =>
        c.musicTwoRowItemRenderer ? twoRow(c.musicTwoRowItemRenderer)
        : c.musicResponsiveListItemRenderer ? listItem(c.musicResponsiveListItemRenderer, fallback)
        : null,
      )
      .filter(Boolean);
    const more = browseOf(s.bottomEndpoint ?? s.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton?.buttonRenderer?.navigationEndpoint);
    return items.length ? { title, items, more } : null;
  }

  const sectionList = (json) =>
    json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

  /* ---------- api ---------- */

  async function search(query) {
    const [all, songs, artistsOnly] = await Promise.all([
      call("search", { query }),
      call("search", { query, params: SONGS_ONLY }).catch(() => null),
      call("search", { query, params: ARTISTS_ONLY }).catch(() => null),
    ]);
    const sections = all.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

    let top = null;
    const rows = [];
    for (const sec of sections) {
      const card = sec.musicCardShelfRenderer;
      if (card) {
        const b = browseOf(card.title?.runs?.[0]?.navigationEndpoint);
        const v = card.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
        const sub = text(card.subtitle);
        if (b?.type === "artist") top = { type: "artist", source: "yt", id: b.id, name: text(card.title), thumb: thumb(card.thumbnail), subtitle: sub };
        else if (b) top = { type: b.type, source: "yt", id: b.id, title: text(card.title), artists: [], kind: sub.split(" • ")[0], subtitle: sub, thumb: thumb(card.thumbnail) };
        else if (v) top = listItem({ flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: card.title } }, { musicResponsiveListItemFlexColumnRenderer: { text: card.subtitle } }], thumbnail: card.thumbnail, playlistItemData: { videoId: v } });
        for (const c of card.contents ?? []) {
          const item = c.musicResponsiveListItemRenderer && listItem(c.musicResponsiveListItemRenderer);
          if (item) rows.push(item);
        }
      }
      const list = sec.musicShelfRenderer?.contents ?? sec.itemSectionRenderer?.contents ?? [];
      for (const c of list) {
        const item = c.musicResponsiveListItemRenderer && listItem(c.musicResponsiveListItemRenderer);
        if (item) rows.push(item);
      }
    }

    const songRows = songs
      ? (songs.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [])
          .flatMap((s) => s.musicShelfRenderer?.contents ?? [])
          .map((c) => c.musicResponsiveListItemRenderer && listItem(c.musicResponsiveListItemRenderer))
          .filter((t) => t?.type === "track")
      : rows.filter((r) => r.type === "track" && !r.isVideo);

    const artistRows = (artistsOnly?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [])
      .flatMap((s) => s.musicShelfRenderer?.contents ?? [])
      .map((c) => c.musicResponsiveListItemRenderer && listItem(c.musicResponsiveListItemRenderer))
      .filter((a) => a?.type === "artist");

    const unique = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];
    return {
      top,
      songs: unique(songRows, (t) => t.id).slice(0, 20),
      artists: unique([...(top?.type === "artist" ? [top] : []), ...artistRows, ...rows.filter((r) => r.type === "artist")], (a) => a.id).slice(0, 10),
      albums: unique(rows.filter((r) => r.type === "album"), (a) => a.id).slice(0, 12),
      playlists: unique(rows.filter((r) => r.type === "playlist"), (a) => a.id).slice(0, 8),
    };
  }

  async function suggestions(input) {
    const json = await call("music/get_search_suggestions", { input });
    return (json.contents ?? [])
      .flatMap((s) => s.searchSuggestionsSectionRenderer?.contents ?? [])
      .map((c) => text(c.searchSuggestionRenderer?.suggestion))
      .filter(Boolean)
      .slice(0, 8);
  }

  async function artist(id) {
    const json = await call("browse", { browseId: id });
    const h = json.header?.musicImmersiveHeaderRenderer ?? json.header?.musicVisualHeaderRenderer ?? {};
    const name = text(h.title);
    const result = {
      type: "artist",
      source: "yt",
      id,
      name,
      thumb: thumb(h.thumbnail?.musicThumbnailRenderer ? h.thumbnail : h.foregroundThumbnail, 800),
      banner: (h.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? []).at(-1)?.url ?? "",
      description: text(h.description),
      listeners: text(h.monthlyListenerCount),
      subscribers: text(h.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText),
      topSongs: [],
      topSongsMore: null,
      shelves: [],
    };

    for (const sec of sectionList(json)) {
      const s = shelf(sec, { artists: [{ id, name }] });
      if (!s) continue;
      if (sec.musicShelfRenderer && !result.topSongs.length) {
        result.topSongs = s.items.filter((t) => t.type === "track");
        result.topSongsMore = s.more;
      } else {
        // the artist's own albums and singles don't repeat the artist's name, so fill it in
        for (const item of s.items) {
          if ((item.type === "album" || item.type === "track") && !item.artists?.length) item.artists = [{ id, name }];
        }
        result.shelves.push(s);
      }
    }
    return result;
  }

  // albums, singles, EPs and playlists all share one page layout
  async function collection(id) {
    const json = await call("browse", { browseId: id });
    const two = json.contents?.twoColumnBrowseResultsRenderer;
    const h = two?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer ?? {};

    const artists = (h.straplineTextOne?.runs ?? [])
      .filter((r) => browseOf(r.navigationEndpoint)?.type === "artist")
      .map((r) => ({ id: browseOf(r.navigationEndpoint).id, name: r.text }));
    if (!artists.length && text(h.straplineTextOne)) artists.push({ id: null, name: text(h.straplineTextOne) });

    const sub = text(h.subtitle).split(" • ");
    const result = {
      type: id.startsWith("VL") ? "playlist" : "album",
      source: "yt",
      id,
      title: text(h.title),
      artists,
      kind: sub[0] ?? "Album",
      year: sub.find((s) => /^\d{4}$/.test(s)) ?? "",
      info: text(h.secondSubtitle),
      description: text(h.description?.musicDescriptionShelfRenderer?.description),
      thumb: thumb(h.thumbnail, 800),
      tracks: [],
      shelves: [],
    };

    const albumRef = result.type === "album" ? { id, name: result.title } : null;
    const sections = two?.secondaryContents?.sectionListRenderer?.contents ?? [];
    sections.forEach((sec, i) => {
      const s = shelf(sec, { artists, album: albumRef, thumb: result.type === "album" ? result.thumb : "" });
      if (!s) return;
      if (i === 0) result.tracks = s.items.filter((t) => t.type === "track");
      else result.shelves.push(s);
    });
    return result;
  }

  async function home() {
    const json = await call("browse", { browseId: "FEmusic_home" });
    return sectionList(json).map((s) => shelf(s)).filter(Boolean);
  }

  async function charts() {
    const json = await call("browse", { browseId: "FEmusic_charts" });
    return sectionList(json).map((s) => shelf(s)).filter(Boolean);
  }

  // the "up next" radio YouTube Music builds from a song, for autoplay
  async function radio(videoId) {
    const json = await call("next", { videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true });
    const panel =
      json.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents ?? [];
    return panel
      .map((c) => c.playlistPanelVideoRenderer)
      .filter((v) => v?.videoId)
      .map((v) => {
        const runs = fields(v.longBylineText?.runs);
        const artists = (runs[0] ?? [])
          .filter((r) => browseOf(r.navigationEndpoint)?.type === "artist")
          .map((r) => ({ id: browseOf(r.navigationEndpoint).id, name: r.text }));
        const albumRun = runs.flat().find((r) => browseOf(r.navigationEndpoint)?.type === "album");
        return {
          type: "track",
          source: "yt",
          id: v.videoId,
          title: text(v.title),
          artists: artists.length ? artists : [{ id: null, name: text({ runs: runs[0] ?? [] }) }],
          album: albumRun ? { id: browseOf(albumRun.navigationEndpoint).id, name: albumRun.text } : null,
          duration: durationOf(text(v.lengthText)),
          thumb: thumb(v.thumbnail, 544),
        };
      });
  }

  return { search, suggestions, artist, collection, home, charts, radio };
})();
