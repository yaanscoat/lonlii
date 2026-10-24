// every section of lonlii gets a school-subject url, so the address bar always looks like coursework.
// add a section here, then handle it in openSection() in index.html.
self.LONLII_ROUTES = {
  home: "/study-hall",
  games: "/physics",
  play: "/physics-lab",
  apps: "/biology",
  movies: "/film-studies",
  music: "/advanced-music",
  ai: "/ap-research",
  browser: "/chemistry",
  vms: "/computer-science",
  settings: "/homeroom",
};

self.lonliiRoutes = {
  // "/advanced-music" -> "music", or null when the path isn't a section
  sectionFor(path) {
    const clean = path.replace(/\/+$/, "").toLowerCase() || "/";
    return Object.keys(LONLII_ROUTES).find((s) => LONLII_ROUTES[s] === clean) ?? null;
  },
  pathFor(section) {
    return LONLII_ROUTES[section] ?? LONLII_ROUTES.home;
  },
  all() {
    return Object.values(LONLII_ROUTES);
  },
};
