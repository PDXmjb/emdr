"""Serve the EMDR Companion locally and open it in Edge.

Binds to 127.0.0.1 only, so nothing on your network can reach it.
Usage: python serve.py [--port 8000] [--no-browser]
"""
import argparse
import os
import subprocess
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    # No caching: a normal refresh always picks up edited files.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet; nothing here is worth logging


def make_server(start_port):
    for port in range(start_port, start_port + 20):
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=ROOT)), port
        except OSError:
            continue
    sys.exit(f"No free port found in {start_port}-{start_port + 19}.")


def open_browser(url):
    # Edge has the natural voices and speech recognition this app uses.
    if sys.platform == "win32":
        try:
            subprocess.Popen(["cmd", "/c", "start", "", "msedge", url])
            return
        except OSError:
            pass
    webbrowser.open(url)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    server, port = make_server(args.port)
    url = f"http://localhost:{port}/"
    print(f"EMDR Companion running at {url}")
    print("Press Ctrl+C (or close this window) to stop.")
    if not args.no_browser:
        open_browser(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
