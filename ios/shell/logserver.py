# ПРОБА: принимает лог оболочки (POST /log, пачка строк раз в секунду) и дописывает в build/shell.log.
#   python3 ios/shell/logserver.py   (порт 8766; адрес Mac — Log.mac в Shell/Log.swift)
import http.server, os, sys

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build', 'shell.log')

class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        with open(LOG, 'ab') as f: f.write(body)
        sys.stdout.buffer.write(body); sys.stdout.flush()
        self.send_response(204); self.end_headers()
    def log_message(self, *a): pass

os.makedirs(os.path.dirname(LOG), exist_ok=True)
http.server.ThreadingHTTPServer(('0.0.0.0', 8766), H).serve_forever()
