#!/usr/bin/env python3
"""
HELIO-FORGE — api/dev_server.py
Local stand-in for the Vercel Python runtime so `npm run dev` can exercise the
*online* Python path through the Vite proxy at /api/helio_ephemeris.

    python3 api/dev_server.py          # -> http://127.0.0.1:8787/api/helio_ephemeris
"""
from __future__ import annotations

import os
import sys
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from helio_ephemeris import handler  # noqa: E402

if __name__ == "__main__":
    port = int(os.environ.get("HELIO_PORT", "8787"))
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"HELIO-FORGE python kernel serving on http://0.0.0.0:{port}/api/helio_ephemeris")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
