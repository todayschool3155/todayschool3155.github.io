"""배포 전 실행: 모든 css/js 주소에 ?v=버전 을 붙여 브라우저가 옛 파일(최대 10분 캐시)을 쓰지 않게 함.
   python tools/bump_version.py
같은 파일은 어디서든 같은 ?v= 로 불러야 하므로(모듈이 두 번 실행되지 않게) 항상 이 스크립트로 일괄 변경합니다."""
import pathlib, re, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M')

def stamp(m):
    return f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}"

# js: import ... from './x.js' / import('./x.js')
pat_js = re.compile(r"""((?:from\s+|import\s*\(\s*)['"])(\.{1,2}/[^'"?]+\.js)(?:\?v=\d+)?(['"])""")
n = 0
for f in (ROOT / 'js').rglob('*.js'):
    s = f.read_text(encoding='utf-8')
    t = pat_js.sub(stamp, s)
    if t != s:
        f.write_text(t, encoding='utf-8'); n += 1

# index.html: css/app.css, js/app.js
idx = ROOT / 'index.html'
s = idx.read_text(encoding='utf-8')
t = re.sub(r'((?:href|src)=")((?:css|js)/[^"?]+\.(?:css|js))(?:\?v=\d+)?(")', stamp, s)
idx.write_text(t, encoding='utf-8')
print(f'version {v}: js {n} files + index.html')
