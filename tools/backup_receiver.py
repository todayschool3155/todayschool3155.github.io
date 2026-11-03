"""백업 받기용 임시 서버: 이 PC의 앱(localhost:8765) 화면에서 보낸 전체 백업 JSON을 백업/ 폴더에 저장.
   python tools/backup_receiver.py   (저장 후 Ctrl+C 로 종료)"""
import http.server, json, os, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '백업')
ALLOW = {'http://localhost:8765', 'http://127.0.0.1:8765'}

class H(http.server.BaseHTTPRequestHandler):
    def cors(self):
        o = self.headers.get('Origin', '')
        if o in ALLOW:
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Access-Control-Allow-Methods', 'POST')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        if self.headers.get('Origin', '') not in ALLOW:
            self.send_response(403); self.end_headers(); return
        body = self.rfile.read(int(self.headers['Content-Length']))
        data = json.loads(body)  # 올바른 JSON 인지 확인
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, time.strftime('오늘학원_백업_%Y%m%d_%H%M%S.json'))
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        counts = {k: len(v) for k, v in data.items() if isinstance(v, list)}
        msg = json.dumps({'path': path, 'bytes': os.path.getsize(path), 'counts': counts}, ensure_ascii=False).encode()
        self.send_response(200); self.cors(); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(msg)
        print('saved', path, counts, flush=True)

http.server.HTTPServer(('127.0.0.1', 8766), H).serve_forever()
