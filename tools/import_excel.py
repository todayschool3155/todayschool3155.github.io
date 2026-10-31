"""
엑셀 시간표/업무일지 → 초기 데이터 변환 스크립트

사용법:
  python tools/import_excel.py "시간표.xlsx" "업무일지.xlsx" [--sheet 260830] [--from 2026-08-30]

결과물 (둘 다 .gitignore 처리됨 — 학생 이름이 들어있으므로 GitHub에 올리지 마세요):
  data/seed.json          데모 모드(로컬 테스트)용
  supabase/seed.sql       Supabase SQL Editor 에 붙여넣어 실행
"""
import argparse, datetime, json, re, sys, warnings
from pathlib import Path

import openpyxl
from openpyxl.utils import column_index_from_string, get_column_letter

warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent

# 엑셀 한 요일 블록의 5개 열 = 선생님 5명 (왼쪽부터)
TEACHERS = [
    {"id": 1, "name": "찌니쌤", "subject": "수학", "color": "#ffe27a", "login": "jjini"},
    {"id": 2, "name": "수쌤", "subject": "수학", "color": "#ffc870", "login": "su"},
    {"id": 3, "name": "수학3", "subject": "수학", "color": "#f9b26b", "login": "math3"},
    {"id": 4, "name": "애니쌤", "subject": "영어", "color": "#8eddc4", "login": "annie"},
    {"id": 5, "name": "조이쌤", "subject": "영어", "color": "#bfebdd", "login": "joie"},
]
DAY_START_COLS = ["B", "G", "L", "Q", "V"]  # 월~금
SLOTS = [
    {"id": "p1", "label": "2:00", "time": "2:00~2:50"},
    {"id": "p2", "label": "2:50", "time": "2:50~3:40"},
    {"id": "p3", "label": "3:40", "time": "3:40~4:30"},
    {"id": "p4", "label": "4:30/4:50", "time": "4:30~5:20 / 4:50~5:40"},
    {"id": "p5", "label": "5:40", "time": "5:40~6:30"},
    {"id": "p6", "label": "6:30", "time": "6:30~7:20"},
    {"id": "p7", "label": "7:20", "time": "7:20~8:10"},
]
LABELS = {"아이들", "관리보충", "수학테스트", "오클", "보충", "중학", "전담관리", "아이들보충"}
NAME_RE = re.compile(r"^[가-힣]{2,4}$")
GRADE_RE = re.compile(r"^(초|중|고)\s*\d")


def is_note(v: str) -> bool:
    return any(k in v for k in ("~", "휴식", "기준", "라즈"))


def parse_timetable(path, sheet):
    wb = openpyxl.load_workbook(path, data_only=False)
    ws = wb[sheet]
    # 교시 구간 = A열 병합 범위 (6행부터)
    a_ranges = sorted(
        (r.min_row, r.max_row) for r in ws.merged_cells.ranges
        if r.min_col == 1 and r.max_col == 1 and r.min_row >= 6
    )
    if len(a_ranges) != len(SLOTS):
        raise SystemExit(f"교시 구간 수({len(a_ranges)})가 예상({len(SLOTS)})과 다릅니다: {a_ranges}")
    merged_notes = {}
    for r in ws.merged_cells.ranges:
        if r.min_row >= 6 and r.min_col > 1 and r.max_col > r.min_col:
            merged_notes[(r.min_row, r.min_col)] = r.max_col

    grid = {}
    for di, start in enumerate(DAY_START_COLS):
        day = str(di + 1)
        c0 = column_index_from_string(start)
        for si, (r1, r2) in enumerate(a_ranges):
            slot = SLOTS[si]["id"]
            for ti, t in enumerate(TEACHERS):
                col = c0 + ti
                items, notes = [], []
                for row in range(r1, r2 + 1):
                    v = ws.cell(row, col).value
                    if v is None or isinstance(v, (int, float, datetime.datetime)):
                        continue
                    v = str(v).strip()
                    if not v or v.startswith("="):
                        continue
                    if is_note(v):
                        notes.append(v)
                    else:
                        items.append(v)
                # 여러 선생님 열에 걸친 병합 메모 → 해당 열들에도 복사
                for (mr, mc), mx in merged_notes.items():
                    if r1 <= mr <= r2 and mc < col <= mx and mc >= c0:
                        v = ws.cell(mr, mc).value
                        if isinstance(v, str) and is_note(v.strip()):
                            notes.append(v.strip())
                if items or notes:
                    grid.setdefault(day, {}).setdefault(slot, {})[str(t["id"])] = {
                        "items": items, "note": " / ".join(dict.fromkeys(notes)),
                    }
    memo = []
    for row in range(a_ranges[-1][1] + 1, ws.max_row + 1):
        for col in range(1, 30):
            v = ws.cell(row, col).value
            if isinstance(v, str) and v.strip():
                memo.append(v.strip())
    return grid, "\n".join(memo)


def parse_grades(path):
    """업무일지 시트의 '구분' 열(초1, 초5A, 중1 …)에서 학생 학년 추정"""
    grades = {}
    wb = openpyxl.load_workbook(path, data_only=True)
    for ws in wb.worksheets:
        for gcol in ("A", "J", "S", "AB", "AK"):
            gi = column_index_from_string(gcol)
            cur = None
            for row in range(1, ws.max_row + 1):
                g = ws.cell(row, gi).value
                if isinstance(g, str) and g.strip():
                    cur = g.strip() if GRADE_RE.match(g.strip()) else None
                n = ws.cell(row, gi + 1).value
                if cur and isinstance(n, str) and NAME_RE.match(n.strip()):
                    grades[n.strip()] = cur
    return grades


def sql_str(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("timetable")
    ap.add_argument("worklog", nargs="?")
    ap.add_argument("--sheet", default="260830")
    ap.add_argument("--from", dest="eff", default=None, help="적용 시작일 YYYY-MM-DD (기본: 시트이름)")
    ap.add_argument("--grades", action="store_true", help="업무일지 '구분'열에서 학년 추정 (예전 자료라 틀릴 수 있음)")
    a = ap.parse_args()

    eff = a.eff
    if not eff:
        m = re.match(r"^(\d{2})(\d{2})(\d{2})", a.sheet)
        eff = f"20{m[1]}-{m[2]}-{m[3]}" if m else datetime.date.today().isoformat()

    grid, memo = parse_timetable(a.timetable, a.sheet)
    grades = parse_grades(a.worklog) if (a.worklog and a.grades) else {}

    # 학생 목록 (시간표 등장 순서)
    names = []
    for day in sorted(grid):
        for slot in [s["id"] for s in SLOTS]:
            for tid, cell in grid[day].get(slot, {}).items():
                for it in cell["items"]:
                    if it not in LABELS and NAME_RE.match(it) and it not in names:
                        names.append(it)
    students = [
        {"id": i + 1, "name": n, "grade": grades.get(n, ""), "status": "active"}
        for i, n in enumerate(names)
    ]
    sid = {s["name"]: s["id"] for s in students}
    # 이름 → 학생 id(숫자), 그 외(아이들, 관리보충 등)는 문자열 그대로
    for day in grid.values():
        for slot in day.values():
            for cell in slot.values():
                cell["items"] = [sid.get(it, it) for it in cell["items"]]

    version = {"id": 1, "effective_from": eff, "title": f"{a.sheet} 시간표 (엑셀 이전)", "memo": memo, "grid": grid}

    (ROOT / "data").mkdir(exist_ok=True)
    seed = {"teachers": TEACHERS, "students": students, "slots": SLOTS, "versions": [version]}
    (ROOT / "data" / "seed.json").write_text(json.dumps(seed, ensure_ascii=False, indent=1), encoding="utf-8")

    out = ["-- 자동 생성: tools/import_excel.py  (학생 개인정보 포함 — GitHub에 올리지 마세요)", "begin;"]
    out.append("delete from worklogs; delete from timetable_versions; delete from students;")
    out.append("delete from app_users where role = 'teacher'; delete from teachers;")
    for t in TEACHERS:
        out.append(
            f"insert into teachers(id,name,subject,color,sort) values ({t['id']},{sql_str(t['name'])},"
            f"{sql_str(t['subject'])},{sql_str(t['color'])},{t['id']});"
        )
        out.append(
            f"insert into app_users(login_id,name,role,teacher_id,pw_hash) values ({sql_str(t['login'])},"
            f"{sql_str(t['name'])},'teacher',{t['id']},extensions.crypt('today1234', extensions.gen_salt('bf')));"
        )
    out.append("select setval('teachers_id_seq', (select max(id) from teachers));")
    for s in students:
        out.append(
            f"insert into students(id,name,grade,status) values ({s['id']},{sql_str(s['name'])},{sql_str(s['grade'])},'active');"
        )
    out.append("select setval('students_id_seq', (select max(id) from students));")
    out.append(
        "insert into settings(key,value) values ('slots', " + sql_str(json.dumps(SLOTS, ensure_ascii=False)) +
        "::jsonb) on conflict (key) do update set value = excluded.value;"
    )
    out.append(
        "insert into timetable_versions(effective_from,title,memo,grid,updated_by) values ("
        f"{sql_str(eff)},{sql_str(version['title'])},{sql_str(memo)},{sql_str(json.dumps(grid, ensure_ascii=False))}::jsonb,'import');"
    )
    out.append("commit;")
    (ROOT / "supabase" / "seed.sql").write_text("\n".join(out) + "\n", encoding="utf-8")

    print(f"선생님 {len(TEACHERS)}명, 학생 {len(students)}명 (학년 추정 {sum(1 for s in students if s['grade'])}명), 적용일 {eff}")
    print("→ data/seed.json, supabase/seed.sql 생성 완료")


if __name__ == "__main__":
    main()
