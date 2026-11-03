"""백업 파일 확인 / 두 백업 비교:
   python tools/backup_check.py 백업파일.json            → 개수·지문 출력
   python tools/backup_check.py 이전.json 이후.json       → 바뀐 것만 출력"""
import hashlib, json, sys

def h(o):
    return hashlib.sha256(json.dumps(o, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]

def fp(path):
    d = json.load(open(path, encoding='utf-8'))
    out = {'settings': h(d['settings'])}
    for t in d['teachers']: out[f"teacher {t['id']} {t['name']}"] = h(t)
    for s in d['students']: out[f"student {s['id']}"] = h(s)
    for v in d['versions']: out[f"version {v['effective_from']} grid"] = h(v['grid'])
    for v in d['versions']: out[f"version {v['effective_from']} meta"] = h({k: v[k] for k in ('effective_from', 'title', 'memo')})
    for w in d['worklogs']: out[f"worklog {w['log_date']} t{w['teacher_id']}"] = h(w)
    for t in d.get('tests', []): out[f"test {t['id']}"] = h(t)
    return d, out

if len(sys.argv) == 2:
    d, f = fp(sys.argv[1])
    print({k: len(v) for k, v in d.items() if isinstance(v, list)}, 'exported_at', d['exported_at'])
else:
    _, a = fp(sys.argv[1]); _, b = fp(sys.argv[2])
    same = [k for k in a if b.get(k) == a[k]]
    changed = [k for k in a if k in b and b[k] != a[k]]
    removed = [k for k in a if k not in b]
    added = [k for k in b if k not in a]
    print(f'그대로 {len(same)}개 / 바뀜 {len(changed)} / 없어짐 {len(removed)} / 새로 생김 {len(added)}')
    for k in changed: print('  바뀜:', k)
    for k in removed: print('  없어짐:', k)
    for k in added: print('  새로:', k)
