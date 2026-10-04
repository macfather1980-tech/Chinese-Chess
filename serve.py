#!/usr/bin/env python3
"""Local LAN server for the Chinese Chess V2 PWA — OPTIONAL.

The game no longer needs a server (double-click index.html for file://
play, or use the GitHub Pages link on the iPhone). Run this only when you
want to play on the iPhone over the local network.

Serves this folder on http://0.0.0.0:8080: open  http://<this-computer's-IP>:8080  in Safari.

It adds:
  - COOP/COEP headers (cross-origin isolation). Not needed by the current
    single-threaded engine, but required if a future -pthread multithreaded
    build is dropped into wasm/.
  - long cache lifetimes for the WASM artifacts (the 50MB net is then only
    downloaded once per browser; the service worker also caches it).

Usage:  python3 serve.py   (stop with Ctrl-C)
"""
import http.server
import socketserver
import socket
import os

PORT = 8080
ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # cross-origin isolation (needed only for a future -pthread build)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        p = self.path.split('?')[0].lstrip('/')
        if p.startswith('wasm/') and not p.endswith('/'):
            # immutable per content; sw.js cache name bumps handle updates
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            # 2026-10-04: always revalidate code files. Without this, a
            # phone browser's heuristic HTTP cache kept serving an OLD
            # engine.js for hours after a fix landed (stale cannon rules
            # => the "can't capture with the cannon" bug kept appearing).
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.address_string(), fmt % args))

def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print("serving %s" % ROOT)
    print("  this computer:  http://localhost:%d" % PORT)
    print("  iphone (Safari): http://%s:%d" % (lan_ip(), PORT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
