#!/usr/bin/env python3
"""JayAng Studio Web 本機伺服器（Python 3.8 以上，不需要安裝任何套件）
用法：python3 server.py [port]　預設 http://127.0.0.1:8080
所有回應都加上 Cache-Control: no-store，關閉後瀏覽器不會留下快取。"""
import http.server
import os
import posixpath
import sys
import webbrowser
from functools import partial
from urllib.parse import unquote

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.webmanifest': 'application/manifest+json',
        '.woff2': 'font/woff2',
        '.bcmap': 'application/octet-stream',
        '.pfb': 'application/octet-stream',
    }

    def translate_path(self, path):
        # 先解碼、正規化再判斷（/./source、/%73ource、/assets/../source 都要擋），大小寫不分
        p = posixpath.normpath(unquote(path.split('?', 1)[0].split('#', 1)[0])).lower()
        for blocked in ('/source', '/local-server', '/.git', '/.github'):
            if p == blocked or p.startswith(blocked + '/'):
                path = '/index.html'
        return super().translate_path(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    url = f'http://127.0.0.1:{PORT}/'
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), partial(Handler, directory=ROOT))
    print(f'\n  JayAng Studio Web 已啟動：{url}\n  關閉這個視窗（或按 Ctrl+C）即可停止伺服器。\n')
    if not os.environ.get('NO_OPEN'):
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
