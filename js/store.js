// 앱 상태 + 시간표/업무일지 도메인 로직
import { api } from './api.js';
import { weekday, DAY_NAMES, datesBetween, today, addDays } from './util.js';

export const state = {
  user: null,
  settings: {},
  teachers: [],
  students: [],
  versions: [],
};

export const DAYS = [1, 2, 3, 4, 5];
export const isAdmin = () => state.user?.role === 'admin';

export async function reload() {
  const b = await api.bootstrap();
  Object.assign(state, b);
  state.versions.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return state;
}

export const slots = () => state.settings.slots || [];
export const slotById = (id) => slots().find((s) => s.id === id);
export const academyName = () => state.settings.academy?.name || '오늘학원';
export const teacherById = (id) => state.teachers.find((t) => t.id === Number(id));
export const studentById = (id) => state.students.find((s) => s.id === Number(id));
export const activeStudents = () => state.students.filter((s) => s.status === 'active');

// 시간표에 표시할 선생님: 활성 + (비활성이지만 해당 버전에 수업이 남아있는 선생님)
export function gridTeachers(version) {
  const used = new Set();
  for (const day of Object.values(version?.grid || {}))
    for (const slot of Object.values(day))
      for (const [tid, cell] of Object.entries(slot)) if (cell.items?.length) used.add(Number(tid));
  return state.teachers.filter((t) => t.active || used.has(t.id));
}

// 날짜에 적용되는 시간표 버전 (그 날짜 이전 가장 최근 적용일, 없으면 가장 오래된 버전)
export function versionFor(date) {
  let v = null;
  for (const x of state.versions) if (x.effective_from <= date) v = x;
  return v || state.versions[0] || null;
}
export const nextVersionAfter = (v) => state.versions.find((x) => x.effective_from > v.effective_from) || null;

export const dayOfDate = (date) => weekday(date); // 1=월 … 5=금 (0,6 주말)

export function cellOf(grid, day, slot, tid) {
  return grid?.[day]?.[slot]?.[tid] || { items: [], note: '' };
}
export function setCell(grid, day, slot, tid, cell) {
  const clean = { items: cell.items || [], note: cell.note || '' };
  if (!clean.items.length && !clean.note) {
    if (grid[day]?.[slot]) {
      delete grid[day][slot][tid];
      if (!Object.keys(grid[day][slot]).length) delete grid[day][slot];
      if (!Object.keys(grid[day]).length) delete grid[day];
    }
    return;
  }
  ((grid[day] ||= {})[slot] ||= {})[tid] = clean;
}

// 항목: 숫자 = 학생 id, 문자열 = 메모성 항목(아이들, 관리보충 …)
export const itemKey = (it) => (typeof it === 'number' ? `s${it}` : `t:${it}`);
export function itemLabel(it) {
  if (typeof it !== 'number') return String(it);
  return studentById(it)?.name || `(삭제된 학생 #${it})`;
}
export const isStudentItem = (it) => typeof it === 'number';
export function keyToItem(key) {
  if (key.startsWith('s')) return Number(key.slice(1));
  return key.slice(2);
}

// 업무일지 행: 해당 날짜 요일의 선생님 칸에서 자동 생성
export function worklogRows(date, teacherId) {
  const v = versionFor(date);
  const day = dayOfDate(date);
  if (!v || !DAYS.includes(day)) return [];
  const rows = [];
  for (const s of slots()) {
    const cell = cellOf(v.grid, day, s.id, teacherId);
    for (const it of cell.items) rows.push({ slot: s.id, item: it, key: `${s.id}|${itemKey(it)}` });
  }
  return rows;
}

// 일지에 표시할 전체 행 = 시간표 행 + 추가(보강) 행 + 시간표 변경으로 빠졌지만 기록이 있는 행
// extras 항목: { slot, item } = 그날만 추가, { slot, item, removed: true } = 그날만 제외
export const removedKeys = (log) => new Set((log.extras || []).filter((x) => x.removed).map((x) => `${x.slot}|${itemKey(x.item)}`));

export function logRows(date, teacherId, log) {
  const removed = removedKeys(log);
  const base = worklogRows(date, teacherId).filter((r) => !removed.has(r.key));
  const keys = new Set([...base.map((r) => r.key), ...removed]);
  const extras = (log.extras || []).filter((x) => !x.removed)
    .map((x) => ({ slot: x.slot, item: x.item, key: `${x.slot}|${itemKey(x.item)}`, extra: true }))
    .filter((r) => !keys.has(r.key) && keys.add(r.key));
  const orphans = Object.entries(log.entries || {})
    .filter(([k, e]) => !keys.has(k) && (e.att || e.progress || e.homework || e.note))
    .map(([k]) => ({ slot: k.split('|')[0], item: keyToItem(k.split('|')[1]), key: k, orphan: true }));
  const order = Object.fromEntries(slots().map((s, i) => [s.id, i]));
  return [...base, ...extras, ...orphans].map((r, i) => ({ ...r, i }))
    .sort((a, b) => (order[a.slot] ?? 99) - (order[b.slot] ?? 99) || a.i - b.i);
}

// 학생의 주간 수업 목록
export function placementsOf(version, studentId) {
  const out = [];
  for (const day of DAYS) for (const s of slots()) {
    const slot = version?.grid?.[day]?.[s.id] || {};
    for (const [tid, cell] of Object.entries(slot))
      if (cell.items.includes(studentId)) out.push({ day, slot: s.id, tid: Number(tid) });
  }
  return out;
}

export function placementText(p) {
  return `${DAY_NAMES[p.day]} ${slotById(p.slot)?.label || p.slot} ${teacherById(p.tid)?.name || ''}`;
}

export function removeFromGrid(grid, studentId) {
  let n = 0;
  for (const day of Object.keys(grid)) for (const slot of Object.keys(grid[day])) for (const tid of Object.keys(grid[day][slot])) {
    const c = grid[day][slot][tid];
    const before = c.items.length;
    c.items = c.items.filter((x) => x !== studentId);
    n += before - c.items.length;
    setCell(grid, day, slot, tid, c);
  }
  return n;
}

// date 부터 적용되는 변경: date 시점 버전(없으면 복사 생성) + 그 이후 버전 모두에 mutate 적용
export async function applyFromDate(date, mutate, title, changes) {
  const base = versionFor(date);
  const targets = [];
  if (!base) {
    const grid = {};
    mutate(grid);
    targets.push({ effective_from: date, title, memo: '', grid });
  } else {
    if (base.effective_from === date || (base.effective_from > date && base === state.versions[0])) {
      targets.push(structuredClone(base));
    } else {
      targets.push({ effective_from: date, title, memo: base.memo || '', grid: structuredClone(base.grid) });
    }
    for (const v of state.versions) if (v.effective_from > targets[0].effective_from) targets.push(structuredClone(v));
    for (const t of targets) mutate(t.grid);
  }
  for (const t of targets) await api.saveVersion({ ...t, changes });
  await reload();
  return targets.length;
}

export const ATT = ['출석', '지각', '결석', '보강', '조퇴'];

// ---------- 휴원일 ----------
// settings.holidays = [{ date: 'YYYY-MM-DD', name: '추석' }]
export const holidays = () => state.settings.holidays || [];
export const holidayOf = (date) => holidays().find((h) => h.date === date) || null;
export const isClassDay = (date) => DAYS.includes(dayOfDate(date)) && !holidayOf(date);

// ---------- 업무일지 미작성 ----------
// 알림 기간: 최근 14일 ~ 어제. 시작일 = 설정값(관리 > 알림 시작일), 없으면 처음 저장된 일지 날짜 (도입 전 날짜는 알림 X)
// 시스템 사용 시작일 (이 날 이전은 미작성·미기록으로 치지 않음)
export function trackingStart(logs) {
  return state.settings.alerts?.from || logs.map((w) => w.log_date).sort()[0] || today();
}
export function alertRange(logs) {
  const from = [addDays(today(), -14), trackingStart(logs)].sort()[1];
  return { from, to: addDays(today(), -1) };
}

// 수업이 있는 날(휴원일 제외) × 선생님 중 저장된 일지가 없는 것
export function missingLogs(logs, from, to, teacherIds) {
  const have = new Set(logs.map((w) => `${w.log_date}|${w.teacher_id}`));
  const out = [];
  if (to < from) return out;
  for (const d of datesBetween(from, to)) {
    if (!isClassDay(d)) continue;
    for (const tid of teacherIds) {
      if (have.has(`${d}|${tid}`)) continue;
      const n = worklogRows(d, tid).length;
      if (n) out.push({ date: d, teacherId: tid, rows: n });
    }
  }
  return out;
}

export const alerts = { missing: [], checkedAt: 0 };
export async function refreshAlerts(force = false) {
  if (!force && Date.now() - alerts.checkedAt < 60000) return alerts;
  const tids = isAdmin() ? state.teachers.filter((t) => t.active).map((t) => t.id) : state.user.teacher_id ? [state.user.teacher_id] : [];
  if (!tids.length) { alerts.missing = []; return alerts; }
  const logs = await api.getWorklogs(addDays(today(), -60), today(), isAdmin() ? null : tids[0]);
  const { from, to } = alertRange(logs);
  alerts.missing = missingLogs(logs, from, to, tids);
  alerts.checkedAt = Date.now();
  return alerts;
}

// ---------- 출결 집계 ----------
export const PRESENT = ['출석', '지각', '보강', '조퇴'];
// logs: 기간 내 업무일지 전체. 반환: Map(학생id → { sessions, 출석, 지각, 결석, 보강, 조퇴, none })
export function attendanceStats(logs, from, to, teacherIds) {
  const byKey = Object.fromEntries(logs.map((w) => [`${w.log_date}|${w.teacher_id}`, w]));
  const stats = new Map();
  const end = [to, today()].sort()[0];
  for (const d of datesBetween(from, end)) {
    if (!DAYS.includes(dayOfDate(d)) && !teacherIds.some((t) => byKey[`${d}|${t}`])) continue;
    if (holidayOf(d)) continue;
    for (const tid of teacherIds) {
      const log = byKey[`${d}|${tid}`] || { entries: {}, extras: [] };
      for (const r of logRows(d, tid, log)) {
        if (!isStudentItem(r.item)) continue;
        if (!stats.has(r.item)) stats.set(r.item, { sessions: 0, 출석: 0, 지각: 0, 결석: 0, 보강: 0, 조퇴: 0, none: 0 });
        const s = stats.get(r.item);
        const att = log.entries?.[r.key]?.att;
        s.sessions++;
        if (att && att in s) s[att]++; else s.none++;
      }
    }
  }
  return stats;
}
export function attendanceRate(s) {
  const p = PRESENT.reduce((n, k) => n + (s[k] || 0), 0);
  const total = p + (s.결석 || 0);
  return total ? p / total : null;
}
export const pct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);