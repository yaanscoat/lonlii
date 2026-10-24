// an hls.js loader that sends every playlist, key and segment request through the bare server,
// so streams play even when their hosts are blocked or need special headers. used by movies and music.
//
//   new Hls({ loader: lonliiBareHlsLoader({ rewrite: (url) => url, headers: (url) => ({}) }) })
//
// rewrite: change a url before it's fetched (e.g. add a token)
// headers: extra request headers for a url (e.g. a referer)
window.lonliiBareHlsLoader = ({ rewrite = (u) => u, headers = () => ({}) } = {}) =>
  class BareLoader {
    constructor() {
      this.context = null;
      this.aborted = false;
      this.stats = {
        aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
        loading: { start: 0, first: 0, end: 0 },
        parsing: { start: 0, end: 0 },
        buffering: { start: 0, first: 0, end: 0 },
      };
    }

    load(context, _config, callbacks) {
      this.context = context;
      const stats = this.stats;
      stats.loading.start = performance.now();

      const url = rewrite(context.url);
      const h = { ...headers(url) };
      if (context.rangeEnd) h.Range = `bytes=${context.rangeStart}-${context.rangeEnd - 1}`;

      lonliiProxy
        .fetch(url, { headers: h })
        .then(async (r) => {
          if (this.aborted) return;
          if (!r.ok) {
            callbacks.onError({ code: r.status, text: r.statusText }, context, r, stats);
            return;
          }
          stats.loading.first = performance.now();
          const data = context.responseType === "arraybuffer" ? await r.arrayBuffer() : await r.text();
          if (this.aborted) return;
          stats.loaded = stats.total = data.byteLength ?? data.length;
          stats.loading.end = performance.now();
          // report the original url so relative playlist entries resolve normally
          callbacks.onSuccess({ url: r.finalURL || context.url, data, code: r.status }, stats, context, r);
        })
        .catch((e) => {
          if (!this.aborted) callbacks.onError({ code: 0, text: e.message }, context, null, stats);
        });
    }

    abort() {
      this.aborted = true;
      this.stats.aborted = true;
    }

    destroy() {
      this.abort();
    }
  };
