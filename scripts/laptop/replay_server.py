#!/usr/bin/env python3
# The laptop's local copy of the replay site: the static export, plus /rover-status forwarded to the remote MCP server's
# /health (what apps/replay/public/vercel.json does on Vercel), so the Hire page's badge works in strict browsers (Brave).
#   python3 scripts/laptop/replay_server.py 3005 apps/replay/out
import http.server
import json
import sys
import urllib.request
from functools import partial

HEALTH = "https://rover-for-hire.onrender.com/health"


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] != "/rover-status":
            return super().do_GET()
        try:
            with urllib.request.urlopen(HEALTH, timeout=10) as r:
                body, code = r.read(), 200
        except Exception as e:
            body, code = json.dumps({"ok": False, "error": str(e)[:120]}).encode(), 502
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port, root = int(sys.argv[1]), sys.argv[2]
    http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=root)).serve_forever()
