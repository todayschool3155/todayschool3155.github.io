"""문서 내보내기 결과(JSON, base64)를 실제 파일로 저장: python tools/save_export.py <결과.txt> <저장할 파일>"""
import base64, json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))['data']
data = base64.b64decode(d['bytes_b64'])
assert len(data) == d['bytes'], (len(data), d['bytes'])
open(sys.argv[2], 'wb').write(data)
print(sys.argv[2], len(data), 'bytes', d.get('pages', ''), 'pages')
