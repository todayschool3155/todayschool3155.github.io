// 공통 유틸: HTML 이스케이프, 날짜, 토스트, 모달

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- 날짜 (모두 로컬 날짜 기준 'YYYY-MM-DD') ----------
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const DAY_NAMES = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };

export function ymd(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => ymd();
export function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
export function addMonths(s, n) { const d = parseYmd(s); d.setMonth(d.getMonth() + n); return ymd(d); }
export const weekday = (s) => parseYmd(s).getDay(); // 0=일 … 6=토
export const fmtDate = (s) => (s ? `${s.replace(/-/g, '.')} (${WEEKDAYS[weekday(s)]})` : '');
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const z = (n) => String(n).padStart(2, '0');
  return `${ymd(d)} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
export function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
export function mondayOf(s) { const w = weekday(s); return addDays(s, w === 0 ? -6 : 1 - w); }

// ---------- 토스트 ----------
export function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.classList.add('out'), type === 'err' ? 4500 : 2500);
  setTimeout(() => el.remove(), type === 'err' ? 5000 : 3000);
}

export async function guard(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), 'err');
    if (e.code === 'AUTH_REQUIRED') setTimeout(() => location.reload(), 1200);
    throw e;
  }
}

// ---------- 모달 ----------
// open({ title, body(html), foot(html), wide, onMount(el, close) }) → Promise(결과)
export function modal({ title, body, foot = '', wide = false, onMount }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="닫기">✕</button></header>
        <div class="modal-body">${body}</div>
        ${foot ? `<footer class="modal-foot">${foot}</footer>` : ''}
      </div>`;
    document.body.append(wrap);
    document.body.classList.add('modal-open');
    const close = (v) => {
      wrap.remove();
      if (!$('.modal-wrap')) document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && wrap === $$('.modal-wrap').pop()) close(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(null); });
    onMount?.(wrap.querySelector('.modal'), close);
    const first = wrap.querySelector('input:not([type=hidden]),select,textarea');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  });
}

export function confirmBox(message, { ok = '확인', danger = false } = {}) {
  return modal({
    title: '확인',
    body: `<p class="pre">${esc(message)}</p>`,
    foot: `<button class="btn" data-close>취소</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button>`,
    onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => close(true)),
  });
}

// 폼 모달: fields = [{ name, label, type, value, options, required, placeholder, hint }]
export function formModal(title, fields, { ok = '저장', wide = false, extra = '' } = {}) {
  const input = (f) => {
    const v = f.value ?? '';
    const common = `name="${f.name}" id="f_${f.name}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
    if (f.type === 'select') {
      return `<select ${common}>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    }
    if (f.type === 'textarea') return `<textarea ${common} rows="${f.rows || 3}">${esc(v)}</textarea>`;
    if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" ${common} ${v ? 'checked' : ''}> ${esc(f.text || '')}</label>`;
    return `<input type="${f.type || 'text'}" ${common} value="${esc(v)}" ${f.list ? `list="${f.list}"` : ''} autocomplete="off">`;
  };
  const body = `<form class="form" id="modal-form">${fields.map((f) => `
      <div class="field ${f.type === 'checkbox' ? 'field-check' : ''}">
        ${f.type === 'checkbox' ? '' : `<label for="f_${f.name}">${esc(f.label)}</label>`}
        ${input(f)}
        ${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ''}
      </div>`).join('')}${extra}</form>`;
  return modal({
    title, wide, body,
    foot: `<button class="btn" data-close type="button">취소</button><button class="btn btn-primary" form="modal-form" type="submit">${esc(ok)}</button>`,
    onMount: (el, close) => {
      el.querySelector('#st-del')?.addEventListener('click', () => close('delete'));
      el.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const out = {};
        for (const f of fields) {
          const node = el.querySelector(`[name="${f.name}"]`);
          out[f.name] = f.type === 'checkbox' ? node.checked : node.value.trim();
        }
        close(out);
      });
    },
  });
}

export function download(filename, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = () => { clearTimeout(t); fn(); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function loadScript(src) {
  return new Promise((res, rej) => {
    if ($(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('스크립트를 불러오지 못했습니다: ' + src));
    document.head.append(s);
  });
}
