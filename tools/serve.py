"""Local dev server: python's http.server, plus the two things static hosts do that it doesn't.

    python tools/serve.py          # http://localhost:3000
    python tools/serve.py 8080     # another port

* unknown paths get 404.html, which is how the subject urls (/chemistry, /advanced-music, ...)
  work on GitHub Pages, Netlify, Vercel and Cloudflare Pages
* .mjs and .wasm are served with the right types, which some python versions get wrong
"""

import contextlib
import functools
import http.server
import pathlib
import socket
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
    }

    def send_error(self, code, message=None, explain=None):
        page = ROOT / "404.html"
        if code != 404 or not page.exists():
            return super().send_error(code, message, explain)
        body = page.read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


class DualStackServer(http.server.ThreadingHTTPServer):
    # listen on IPv6 and IPv4 at once. browsers try "localhost" as ::1 first, and an
    # IPv4-only server makes every request wait ~300ms for the fallback on windows
    address_family = socket.AF_INET6

    def server_bind(self):
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    handler = functools.partial(Handler, directory=str(ROOT))
    with DualStackServer(("::", port), handler) as server:
        print(f"lonlii running at http://localhost:{port}")
        server.serve_forever()
