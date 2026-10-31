// 엑셀 내보내기 (SheetJS, 필요할 때만 CDN에서 로드)
import { api } from './api.js';
import { state, slots, slotById, teacherById, studentById, gridTeachers, cellOf, itemLabel, logRows, DAYS, dayOfDate } from './store.js';
import { loadScript, DAY_NAMES, WEEKDAYS, weekday, toast } from './util.js';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
async function X() { await loadScript(XLSX_URL); return window.XLSX; }

// 원래 엑셀과 같은 모양: 행 = 교시×학생 순번, 열 = 요일×선생님
export async function exportTimetableXlsx(v) {
  const XLSX = await X();
  const ts = gridTeachers(v);
  const aoa = [[`시간표 (적용일 ${v.effective_from}) ${v.title || ''}`], [], ['교시', ...DAYS.flatMap((d) => ts.map((t, i) => (i === 0 ? DAY_NAMES[d] : '')))],
    ['', ...DAYS.flatMap(() => ts.map((t) => t.name))]];
  const merges = [];
  DAYS.forEach((d, di) => merges.push({ s: { r: 2, c: 1 + di * ts.length }, e: { r: 2, c: (di + 1) * ts.length } }));
  for (const s of slots()) {
    const cells = DAYS.flatMap((d) => ts.map((t) => cellOf(v.grid, d, s.id, t.id)));
    const hasNote = cells.some((c) => c.note);
    const n = Math.max(1, ...cells.map((c) => c.items.length));
    const r0 = aoa.length;
    if (hasNote) aoa.push([`${s.label}\n${s.time || ''}`, ...cells.map((c) => c.note || '')]);
    for (let i = 0; i < n; i++) {
      aoa.push([!hasNote && i === 0 ? `${s.label}\n${s.time || ''}` : '', ...cells.map((c) => (c.items[i] != null ? itemLabel(c.items[i]) : ''))]);
    }
    if (aoa.length - r0 > 1) merges.push({ s: { r: r0, c: 0 }, e: { r: aoa.length - 1, c: 0 } });
  }
  if (v.memo) aoa.push([], [v.memo]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 10 }, ...DAYS.flatMap(() => ts.map(() => ({ wch: 8 })))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, v.effective_from.replace(/-/g, '').slice(2));
  XLSX.writeFile(wb, `시간표_${v.effective_from}.xlsx`);
}

// 업무일지 기간 내보내기: 시트1 학생별 기록, 시트2 공지/총평
export async function exportWorklogsXlsx(from, to) {
  const XLSX = await X();
  const logs = await api.getWorklogs(from, to);
  if (!logs.length) { toast('해당 기간의 일지가 없습니다.', 'warn'); return; }
  const rows = [['날짜', '요일', '선생님', '교시', '학생', '학년', '출결', '수업책/진도/프린트', '전날숙제 완료', '전날숙제', '오늘 숙제', '특이사항']];
  const notes = [['날짜', '요일', '선생님', '작성완료', '공지 및 전달사항', '하루 평가 및 총평', '최종 수정', '수정자']];
  for (const w of logs) {
    const t = teacherById(w.teacher_id)?.name || w.teacher_id;
    const wd = WEEKDAYS[weekday(w.log_date)];
    for (const r of logRows(w.log_date, w.teacher_id, w)) {
      const e = w.entries[r.key] || {};
      const s = typeof r.item === 'number' ? studentById(r.item) : null;
      rows.push([w.log_date, wd, t, slotById(r.slot)?.label || r.slot, itemLabel(r.item), s?.grade || '', e.att || '', e.progress || '', e.hwDone || '', e.hwPrev || '', e.homework || '', e.note || '']);
    }
    notes.push([w.log_date, wd, t, w.done ? 'O' : '', w.notice, w.review, w.updated_at, w.updated_by]);
  }
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(rows);
  ws1['!cols'] = [12, 5, 8, 8, 8, 6, 6, 30, 8, 24, 24, 24].map((wch) => ({ wch }));
  ws1['!autofilter'] = { ref: `A1:L${rows.length}` };
  const ws2 = XLSX.utils.aoa_to_sheet(notes);
  ws2['!cols'] = [12, 5, 8, 8, 40, 50, 20, 10].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws1, '학생별 기록');
  XLSX.utils.book_append_sheet(wb, ws2, '공지·총평');
  XLSX.writeFile(wb, `업무일지_${from}_${to}.xlsx`);
}

export async function exportStudentsXlsx() {
  const XLSX = await X();
  const aoa = [['이름', '학년', '학교', '연락처', '상태', '등록일', '퇴원일', '메모']];
  for (const s of [...state.students].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
    aoa.push([s.name, s.grade, s.school, s.phone, s.status === 'active' ? '재원' : '퇴원', s.enrolled_on || '', s.withdrawn_on || '', s.memo]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '학생');
  XLSX.writeFile(wb, `학생명단_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
