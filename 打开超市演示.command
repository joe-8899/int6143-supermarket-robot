#!/bin/zsh
cd "$(dirname "$0")" || exit 1
python3 - <<'PY'
import http.server
import os
import webbrowser

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
url = f"http://127.0.0.1:{server.server_port}/#order"
print(f"超市机器人演示已启动：{url}", flush=True)
print("保持此终端窗口打开；结束演示时按 Control + C。", flush=True)
if os.environ.get("INT6143_NO_BROWSER") != "1":
    webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
