#!/bin/bash
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then exec node server.mjs "$@"; fi
if command -v python3 >/dev/null 2>&1; then exec python3 server.py "$@"; fi
echo "找不到 Node.js 或 Python 3，請先安裝其中一個。"
read -r -p "按 Enter 關閉…"
