/**
 * L-O HR — Job Descriptions, KPIs & Performance · API (Netlify Function + Netlify Blobs)
 * Prepared by HR Manager Aws Firas Al-Shalal — إعداد مدير الموارد البشرية أوس فراس الشلال
 */
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import PUB from '../../data/seed.public.json' with { type: 'json' };
import MIGRATIONS from '../../data/migrations.json' with { type: 'json' };
let ENC = null;
async function loadEnc() { if (ENC) return ENC; for (const u of ['https://alobaidi-hr.github.io/data/seed.enc.json', 'https://raw.githubusercontent.com/alobaidi-hr/alobaidi-hr.github.io/main/data/seed.enc.json']) { try { const r = await fetch(u); if (r.ok) { ENC = await r.json(); return ENC; } } catch {} } err('seed_unavailable', 'تعذّر تحميل ملف البيانات المشفّر'); }

const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_FAILS = 6;
const RATES = [['ضعيف', 'Weak'], ['متوسط', 'Average'], ['جيد', 'Good'], ['ممتاز', 'Excellent']];
const TYPES = { annual: 1, mid: 1, quarter: 1, probation: 1 };
const STATUSES = ['new', 'printed', 'sent', 'signed'];

const store = () => getStore({ name: 'lo-hr', consistency: 'strong' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const ok = (o = {}) => Response.json({ ok: true, ...o }, { headers: CORS });
const fail = (error, message) => Response.json({ ok: false, error, message }, { headers: CORS });
class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const err = (code, msg) => { throw new ApiError(code, msg); };
const now = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Baghdad' });
const lower = (s) => String(s || '').trim().toLowerCase();

async function getJSON(key, def) { const v = await store().get(key, { type: 'json' }); return v == null ? def : v; }
async function setJSON(key, val) { await store().setJSON(key, val); }

/* ---------- data: public part in the repository, employee data encrypted until HR unlocks it ---------- */
let SEED = null, JOBS = {}, BASE = null;
/* HR edits (jobs, KPIs, employees, departments, criteria) are stored apart from the original data and applied on top */
function applyEdits(B, ed) {
  const merge = (list, key, map) => {
    map = map || {}; const out = list.map((x) => (Object.prototype.hasOwnProperty.call(map, key(x)) ? map[key(x)] : x)).filter(Boolean);
    const have = new Set(list.map(key)); for (const [k, v] of Object.entries(map)) if (v && !have.has(k)) out.push(v);
    return out;
  };
  return { ...B, jobs: merge(B.jobs, (j) => j.code, ed.jobs), emps: merge(B.emps, (e) => e[0], ed.emps),
    depts: merge(B.depts, (d) => String(d.no), ed.depts).sort((a, b) => a.no - b.no), crit: ed.crit || B.crit, profiles: ed.profiles || {}, orgs: ed.orgs || { companies: [], brands: [] } };
}
async function loadData(required = true) {
  if (!BASE) { const d = await getJSON('data', null); if (d) BASE = { ...PUB, ...d }; }
  if (!BASE) { SEED = null; if (required) err('locked_data', 'بيانات النظام بانتظار التفعيل من مدير الموارد البشرية.'); return null; }
  let ed = await getJSON('edits', {});
  if (MIGRATIONS.some((m) => !(ed.applied || []).includes(m.id))) { ed = runMigrations(BASE, ed); await setJSON('edits', ed); }
  SEED = applyEdits(BASE, ed); JOBS = Object.fromEntries(SEED.jobs.map((j) => [j.code, j]));
  return SEED;
}
/* one-time data changes requested by HR, applied on top of the live edits (never twice) */
function runMigrations(B, ed) {
  ed = { ...ed, applied: [...(ed.applied || [])] };
  for (const m of MIGRATIONS) {
    if (ed.applied.includes(m.id)) continue;
    const cur = () => applyEdits(B, ed), jobOf = (c) => cur().jobs.find((j) => j.code === c);
    const putJob = (j) => { ed.jobs = { ...(ed.jobs || {}), [j.code]: j }; };
    const putEmp = (e) => { ed.emps = { ...(ed.emps || {}), [e[0]]: e }; };
    for (const o of m.ops) {
      if (o.op === 'addJob' && !jobOf(o.job.code)) putJob(cleanJob(o.job));
      else if (o.op === 'jobReportsTo') for (const c of o.codes) { const j = jobOf(c); if (j) putJob({ ...j, b: { ...j.b, ov: { ...j.b.ov, 'Reports To': o.value } } }); }
      else if (o.op === 'jobText') { const j = jobOf(o.code); if (j) putJob({ ...j, b: { ...j.b, duties: j.b.duties.map((p) => p.map((t) => String(t).split(o.from).join(o.to))) } }); }
      else if (o.op === 'moveEmp') {
        const e = cur().emps.find((x) => x[1] === o.name); if (!e || e[2] === o.to || !jobOf(o.to)) continue;
        const from = e[2], fd = (jobOf(from) || {}).dept; putEmp([e[0], e[1], o.to, e[3], e[4], e[5], e[6]]);
        const pf = { ...((ed.profiles || {})[e[0]] || {}) }; pf.history = [...(pf.history || []), { d: now(), t: 'move', from, to: o.to, fd, td: jobOf(o.to).dept, by: m.by }].slice(-50);
        ed.profiles = { ...(ed.profiles || {}), [e[0]]: pf };
      } else if (o.op === 'empRep') for (const e of cur().emps) { if (o.codes.includes(e[2])) putEmp([e[0], e[1], e[2], e[3], e[4], o.rep, o.rep_ar]); }
      else if (o.op === 'deptHead') { const d = cur().depts.find((x) => x.no === o.no); if (d) ed.depts = { ...(ed.depts || {}), [String(o.no)]: { ...d, head: o.head, head_ar: o.head_ar } }; }
    }
    ed.applied.push(m.id);
  }
  return ed;
}
function decrypt(pass) {
  const key = crypto.scryptSync(String(pass), Buffer.from(ENC.salt, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  const buf = Buffer.from(ENC.data, 'base64'), tag = buf.subarray(buf.length - 16), body = buf.subarray(0, buf.length - 16);
  const dc = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ENC.iv, 'base64')); dc.setAuthTag(tag);
  return JSON.parse(Buffer.concat([dc.update(body), dc.final()]).toString('utf8'));
}
function cleanJob(j) {
  const s = (v, n = 2000) => String(v == null ? '' : v).trim().slice(0, n), b = j.b || {};
  const pair = (p, n) => [s(p && p[0], n), s(p && p[1], n)];
  const list = (l) => (Array.isArray(l) ? l : []).map((p) => pair(p, 600)).filter((p) => p[0] || p[1]).slice(0, 40);
  const kpis = (Array.isArray(b.kpis) ? b.kpis : []).map((k) => ({ en: s(k.en, 300), ar: s(k.ar, 300), t_en: s(k.t_en, 300), t_ar: s(k.t_ar, 300), m_en: s(k.m_en, 300), m_ar: s(k.m_ar, 300), f_en: s(k.f_en, 60), f_ar: s(k.f_ar, 60), w: Math.round(Number(k.w) * 100) / 100 || 0 })).filter((k) => k.en || k.ar);
  const q = b.qual || {}, o = b.ov || {};
  return { code: s(j.code, 20).toUpperCase(), dept: Number(j.dept), en: s(j.en, 150), ar: s(j.ar, 150),
    b: { purpose: pair(b.purpose, 1500), duties: list(b.duties), kpis,
      qual: { Education: pair(q.Education, 600), Experience: pair(q.Experience, 600), Languages: pair(q.Languages, 600) },
      tech: list(b.tech), beh: list(b.beh),
      ov: { 'Reports To': pair(o['Reports To'], 200), Grade: [s((o.Grade || [])[0], 200)], Branches: [s((o.Branches || [])[0], 200)], Headcount: [s((o.Headcount || [])[0], 20)], 'Employment Type': [s((o['Employment Type'] || [])[0], 200)] } } };
}
function checkKpis(k) {
  if (k.length < 1 || k.length > 15) err('invalid', 'عدد مؤشرات الأداء بين 1 و 15');
  if (k.some((x) => x.w <= 0)) err('invalid', 'كل مؤشر يحتاج وزناً أكبر من صفر');
  const sum = Math.round(k.reduce((t, x) => t + x.w, 0) * 100) / 100; if (Math.abs(sum - 100) > 0.5) err('invalid', 'مجموع أوزان المؤشرات يجب أن يساوي 100% (الحالي ' + sum + '%)');
}
const PURPOSES = ['periodic', 'raise', 'promo_raise', 'promo', 'move', 'confirm'];
const REC_KEYS = ['PROMO', 'CONF', 'EXT', 'KEEP', 'DEV', 'PIP', 'TERM'];
function cleanPurpose(p) {
  p = p || {}; const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n), num = (v) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.round(x * 100) / 100 : null; };
  const k = PURPOSES.includes(p.k) ? p.k : 'periodic';
  const o = { k, why: s(p.why, 1500) };
  if (k === 'raise' || k === 'promo_raise') { o.mode = ['pct', 'iqd', 'usd', 'amt'].includes(p.mode) ? p.mode : 'pct'; o.val = num(p.val); if (o.mode === 'pct' && o.val > 100) err('invalid', 'نسبة الزيادة غير منطقية'); }
  if (k === 'promo' || k === 'promo_raise' || k === 'move') { o.job = s(p.job, 20); o.txt = s(p.txt, 150); }
  if (k !== 'periodic') o.date = s(p.date, 10);
  return o;
}
const cleanSig = (x) => (typeof x === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(x) && x.length < 90000 ? x : '');
const WF_NAMES = { employee: 'بانتظار توقيع الموظف', hr: 'مراجعة الموارد البشرية', gm: 'عند المدير العام', ceo: 'عند الرئيس التنفيذي', returned: 'مُعاد للمقيّم', done: 'معتمد نهائياً', cancelled: 'ملغاة' };
const PROFILE_KEYS = ['phone', 'email', 'hire', 'birth', 'company', 'brand', 'grade', 'contract', 'nat', 'address', 'notes'];
const empDept = (e) => (JOBS[e[2]] ? JOBS[e[2]].dept : 0);

async function settings() { return { ...PUB.settings, ...(await getJSON('settings', {})) }; }
const publicSettings = (s) => ({ company_ar: s.company_ar, company_en: s.company_en, system_title: s.system_title, theme: s.theme, logo: s.logo || '' });

async function users() {
  let u = await getJSON('users', null);
  if (!u) { u = PUB.users; await setJSON('users', u); }
  return u;
}
const hash = (pw, salt) => crypto.pbkdf2Sync(String(pw), salt, 120000, 32, 'sha256').toString('base64');
const randCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const ROLES = ['admin', 'manager', 'gm', 'ceo', 'auditor'];
const roleOf = (u) => (ROLES.includes(u.role) ? u.role : 'manager');
const deptList = (u) => (roleOf(u) === 'manager' ? (u.depts || []).map(Number) : roleOf(u) === 'auditor' ? [] : 'ALL');
const permsOf = (u) => (u.role === 'admin' ? { jd: true, emp: true } : { jd: !!(u.perms && u.perms.jd), emp: !!(u.perms && u.perms.emp) });
const publicUser = (email, u) => ({ email, name: u.name, title: u.title || '', role: roleOf(u), depts: deptList(u), allJD: roleOf(u) !== 'manager' || !!u.allJD, perms: permsOf(u), sig: u.sig || '', owner: isOwner(u), grants: grantsOf(u), cap: capOf(u), scope: u.role === 'auditor' ? (u.scope || { companies: [], branches: [] }) : null });
/* admin, or a manager given the edit permission — limited to his own departments */
async function editor(token, kind, depts) {
  const a = await auth(token), pu = publicUser(a.email, a.u); if (pu.role === 'admin') return a;
  if (!pu.perms[kind]) err('forbidden', 'ليست لديك صلاحية التعديل');
  for (const d of depts) if (d != null && !pu.depts.includes(Number(d))) err('forbidden', 'هذا خارج أقسامك');
  return a;
}

async function logVisit(email, name, action, ref) {
  const v = await getJSON('visits', []);
  v.push([now(), email, name, action, String(ref || '').slice(0, 80)]);
  if (v.length > 5000) v.splice(0, v.length - 5000);
  await setJSON('visits', v);
}

/* ---------- auth ---------- */
async function startSession(email, u, all) {
  const token = crypto.randomBytes(24).toString('hex');
  await setJSON('sess/' + token, { email, exp: Date.now() + SESSION_MS });
  u.last_login = now(); u.visits = (u.visits || 0) + 1; all[email] = u;
  await setJSON('users', all);
  await logVisit(email, u.name, 'login', '');
  return { token, user: publicUser(email, u) };
}
async function auth(token) {
  if (!token) err('auth', 'انتهت الجلسة، سجّل الدخول مرة أخرى');
  const s = await getJSON('sess/' + token, null);
  if (!s || s.exp < Date.now()) err('auth', 'انتهت الجلسة، سجّل الدخول مرة أخرى');
  const all = await users(), u = all[s.email];
  if (!u || u.active === false) err('auth', 'الحساب غير فعّال');
  if (s.exp - Date.now() < SESSION_MS / 2) await setJSON('sess/' + token, { email: s.email, exp: Date.now() + SESSION_MS });
  return { email: s.email, u, all };
}
async function admin(token) { const a = await auth(token); if (a.u.role !== 'admin') err('forbidden', 'هذه الصفحة لمدير النظام فقط'); return a; }

/* ---------- evaluations ---------- */
function calc(kpis, a, b, type) {
  let sw = 0, ss = 0, anyLow = false, allHi = true;
  kpis.forEach((k, i) => { const v = a[i]; if (v !== null && v !== undefined) { sw += k.w; ss += k.w * v; if (v < 5) anyLow = true; if (v < 6) allHi = false; } });
  let bw = 0, bs = 0; SEED.crit.forEach((c, i) => { bw += c[2]; bs += c[2] * b[i]; });
  const r1 = (x) => Math.round(x * 10) / 10;
  const A = ss / sw * 10, B = bs / bw * 10, F = r1(0.6 * A + 0.4 * B), rc = [];
  if (F >= 85 && allHi) rc.push('PROMO');
  if (type === 'probation') rc.push(F >= 70 ? 'CONF' : 'EXT');
  if (F < 70 || anyLow) rc.push('DEV');
  if (F < 65) rc.push('PIP');
  if (F < 55) rc.push('TERM');
  if (!rc.length) rc.push('KEEP');
  return { A: r1(A), B: r1(B), F, r: F >= 85 ? 3 : F >= 70 ? 2 : F >= 55 ? 1 : 0, rc };
}
const score = (v, allowNull) => {
  if ((v === null || v === undefined || v === '') && allowNull) return null;
  const n = Number(v); if (!(n >= 0 && n <= 10) || Math.round(n) !== n) err('invalid', 'درجة غير صالحة'); return n;
};
async function evals() { await migrateV3(); return getJSON('evals', {}); }
/* incoming box for managers / GM / CEO: evaluations and self-assessments that reach them */
async function boxItems(email, u) {
  const role = roleOf(u), pu = publicUser(email, u), inD = (d) => pu.depts === 'ALL' || pu.depts.includes(Number(d)), out = [];
  for (const x of Object.values(await evals())) {
    const w = x.wf || null, st = w ? w.stage : '';
    let take = false, act = false, why = '';
    if (role === 'gm') { take = !!(w && (st === 'gm' || st === 'ceo' || st === 'done' || (w.sig && w.sig.gm))); act = st === 'gm'; why = act ? 'بانتظار اعتمادك ومصادقتك' : st === 'done' ? 'معتمد نهائياً' : ''; }
    else if (role === 'ceo') { take = !!(w && w.ceo && (st === 'ceo' || st === 'done')); act = st === 'ceo'; why = act ? 'حالة استثنائية بانتظار مصادقتك' : 'تمت المصادقة'; }
    else if (role === 'manager') { take = x.ev.email === email || inD(x.emp.dept); act = !!(w && st === 'returned' && x.ev.email === email); why = act ? 'أُعيد إليك للتعديل' : x.ev.email === email ? (w && st === 'done' ? 'اعتُمد تقييمك نهائياً' : w && st === 'hr' ? 'وقّع الموظف — لدى الموارد البشرية' : w && (st === 'gm' || st === 'ceo') ? 'قيد الاعتماد لدى الإدارة' : '') : 'تقييم لموظف في قسمك'; }
    else if (role === 'admin') { take = !!(w && st === 'hr'); act = take; why = 'وقّع الموظف — بانتظار مراجعتك'; }
    if (take) out.push({ k: 'eval', key: 'e:' + x.id, at: x.updated, act, why, eval: x });
  }
  if (role === 'manager' || role === 'admin') for (const x of Object.values(await getJSON('selfs', {}))) {
    if (x.status !== 'done' || !(x.by === email || (role === 'manager' && inD(x.emp.dept)))) continue;
    out.push({ k: 'self', key: 's:' + x.code, at: x.submitted, act: false, why: 'وصل التقييم الذاتي للموظف', self: { code: x.code, emp: x.emp, type: x.type, period: x.period, F: x.F, r: x.r, submitted: x.submitted } });
  }
  const seen = ((await getJSON('seen', {}))[email]) || {};
  for (const i of out) i.unread = !seen[i.key] || seen[i.key] < i.at;
  return out.sort((a, b) => (Number(b.act) - Number(a.act)) || (a.at < b.at ? 1 : -1));
}

/* ================= v3: versions, raise, recall / cancel / HR edit, official approvals register ================= */
const GRANTS = ['recall', 'cancel', 'edit', 'exec'];
const isOwner = (u) => u.role === 'admin' && !!u.owner;
const grantsOf = (u) => { const g = {}; for (const k of GRANTS) g[k] = isOwner(u) || (u.role === 'admin' && !!(u.grants && u.grants[k])); return g; };
const capOf = (u) => (isOwner(u) ? 'owner' : u.role === 'admin' ? 'hr' : u.role === 'manager' ? 'evaluator' : u.role);
const CAP_NAMES = { owner: 'مالك النظام', hr: 'الموارد البشرية', evaluator: 'المقيّم', gm: 'المدير العام', ceo: 'الرئيس التنفيذي', auditor: 'المدقق الداخلي', employee: 'الموظف' };
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const needGrant = (u, k) => { if (!grantsOf(u)[k]) err('forbidden', 'ليست لديك صلاحية هذا الإجراء (تُمنح من مالك النظام)'); };
const needReason = (s, min = 5) => { s = String(s || '').trim().slice(0, 1500); if (s.length < min) err('invalid', 'السبب إلزامي'); return s; };

/* exchange rate: IQD per 1 USD, set by HR; a raise stores the rate it was computed with */
const rnd = (x, d) => { const f = 10 ** d; return Math.round((Number(x) + Number.EPSILON) * f) / f; };
const curRound = (cur, x) => rnd(x, cur === 'USD' ? 2 : 0);
function computeRaise(p, fx) {
  const cur = p.cur === 'USD' ? 'USD' : 'IQD', mode = ['pct', 'iqd', 'usd'].includes(p.mode) ? p.mode : 'pct';
  const base = Number(p.base), val = Number(p.val), rate = Number(fx && fx.rate);
  if (!(base > 0) || base > 1e10) err('invalid', 'اكتب الراتب الأساسي الحالي');
  if (!(val > 0) || val > 1e10) err('invalid', 'اكتب قيمة الزيادة (نسبة أو مبلغ)');
  if (mode === 'pct' && val > 100) err('invalid', 'نسبة الزيادة غير منطقية');
  if (!(rate > 0)) err('rate_required', 'سعر صرف الدولار غير محدد في النظام. يحدده مدير الموارد البشرية من الإعدادات أولاً.');
  const b = curRound(cur, base);
  let inc;
  if (mode === 'pct') inc = curRound(cur, b * rnd(val, 2) / 100);
  else if ((mode === 'iqd' && cur === 'IQD') || (mode === 'usd' && cur === 'USD')) inc = curRound(cur, val);
  else if (mode === 'iqd') inc = rnd(rnd(val, 0) / rate, 2);
  else inc = rnd(rnd(val, 2) * rate, 0);
  if (!(inc > 0)) err('invalid', 'الزيادة بعد التقريب تساوي صفراً');
  return { base: b, cur, mode, val: mode === 'iqd' ? rnd(val, 0) : rnd(val, 2), rate, rateDate: fx.date || '', inc,
    pct: mode === 'pct' ? rnd(val, 2) : rnd(inc / b * 100, 2),
    iqd: mode === 'iqd' ? rnd(val, 0) : cur === 'IQD' ? inc : rnd(inc * rate, 0),
    usd: mode === 'usd' ? rnd(val, 2) : cur === 'USD' ? inc : rnd(inc / rate, 2),
    newBase: curRound(cur, b + inc) };
}
const isRaise = (k) => k === 'raise' || k === 'promo_raise';
const isPromo = (k) => k === 'promo' || k === 'promo_raise' || k === 'move';
/* purpose with raise / promotion; the server always recomputes the amounts */
function buildPurpose(p, e, fx, keep) {
  p = p || {}; const o = cleanPurpose(p), s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  if (o.k !== 'periodic') { if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) err('invalid', 'حدد تاريخ النفاذ'); }
  if (isRaise(o.k)) {
    o.mode = ['pct', 'iqd', 'usd'].includes(p.mode) ? p.mode : 'pct'; o.cur = p.cur === 'USD' ? 'USD' : 'IQD';
    const fxOk = (keep && keep.rate) || (fx && fx.rate);
    if (p.allowIncomplete && (!(Number(p.base) > 0) || !fxOk)) {
      if (!(Number(p.val) > 0)) err('invalid', 'اكتب قيمة الزيادة (نسبة أو مبلغ)');
      o.val = Number(p.val); o.base = Number(p.base) > 0 ? Number(p.base) : null; o.incomplete = !fxOk ? 'rate' : 'base';
    } else {
    const rate = keep && keep.rate && !p.refreshRate ? { rate: keep.rate, date: keep.rateDate } : fx;
    Object.assign(o, computeRaise({ base: p.base, cur: p.cur, mode: p.mode, val: p.val }, rate));
    }
  }
  if (isPromo(o.k) || isRaise(o.k)) {
    const pf = (SEED.profiles || {})[e[0]] || {};
    o.jobFrom = e[2]; o.titleFrom = (JOBS[e[2]] && (JOBS[e[2]].ar || JOBS[e[2]].en)) || '';
    o.gradeFrom = s(p.gradeFrom != null && p.gradeFrom !== '' ? p.gradeFrom : pf.grade, 40);
    if (isPromo(o.k)) { if (o.job && !JOBS[o.job]) err('invalid', 'الوظيفة الجديدة غير معرّفة'); o.titleTo = o.job ? (JOBS[o.job].ar || JOBS[o.job].en) : o.txt; o.gradeTo = s(p.gradeTo, 40); if (!o.titleTo && !o.gradeTo) err('invalid', 'حدد المسمى أو الدرجة بعد الترقية/النقل'); }
  }
  return o;
}

function calcWith(kpis, cw, a, b, type) {
  let sw = 0, ss = 0, anyLow = false, allHi = true;
  kpis.forEach((k, i) => { const v = a[i]; if (v !== null && v !== undefined) { sw += k.w; ss += k.w * v; if (v < 5) anyLow = true; if (v < 6) allHi = false; } });
  let bw = 0, bs = 0; cw.forEach((c, i) => { bw += c[2]; bs += c[2] * b[i]; });
  const r1 = (x) => Math.round(x * 10) / 10;
  const A = ss / sw * 10, B = bs / bw * 10, F = r1(0.6 * A + 0.4 * B), rc = [];
  if (F >= 85 && allHi) rc.push('PROMO');
  if (type === 'probation') rc.push(F >= 70 ? 'CONF' : 'EXT');
  if (F < 70 || anyLow) rc.push('DEV');
  if (F < 65) rc.push('PIP');
  if (F < 55) rc.push('TERM');
  if (!rc.length) rc.push('KEEP');
  return { A: r1(A), B: r1(B), F, r: F >= 85 ? 3 : F >= 70 ? 2 : F >= 55 ? 1 : 0, rc };
}
const CONTENT = ['type', 'period', 'emp', 'a', 'b', 'A', 'B', 'F', 'r', 'rc', 'n', 'pp', 'rcs', 'k', 'cw', 'ev'];
const snapOf = (r) => JSON.parse(JSON.stringify(Object.fromEntries(CONTENT.map((k) => [k, r[k] === undefined ? null : r[k]]))));
const NOTE_NAMES = { s: 'نقاط القوة', d: 'مجالات التحسين', t: 'الاحتياجات التدريبية', g: 'أهداف الفترة القادمة', e: 'ملاحظات الموظف' };
const PP_NAMES = { k: 'الغرض', why: 'المبرر', base: 'الراتب الأساسي الحالي', cur: 'عملة الراتب', mode: 'أساس الزيادة', val: 'قيمة الأساس', rate: 'سعر الصرف', inc: 'الزيادة بعملة الراتب', pct: 'نسبة الزيادة', iqd: 'الزيادة بالدينار', usd: 'الزيادة بالدولار', newBase: 'الراتب الأساسي الجديد', date: 'تاريخ النفاذ', job: 'الوظيفة الجديدة', txt: 'المسمى الجديد', titleTo: 'المسمى بعد', gradeFrom: 'الدرجة قبل', gradeTo: 'الدرجة بعد' };
/* field-by-field differences between two snapshots, with readable labels */
function diffSnap(o, n) {
  const out = [], add = (f, label, a, b) => { if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push({ f, label, from: a ?? null, to: b ?? null }); };
  (n.k || []).forEach((k, i) => add('a.' + i, 'مؤشر: ' + (k.ar || k.en), (o.a || [])[i], n.a[i]));
  (n.cw || []).forEach((c, i) => add('b.' + i, 'معيار: ' + (c[1] || c[0]), (o.b || [])[i], n.b[i]));
  for (const k of Object.keys(NOTE_NAMES)) add('n.' + k, NOTE_NAMES[k], (o.n || {})[k] || '', (n.n || {})[k] || '');
  const op = o.pp || {}, np = n.pp || {};
  for (const k of new Set([...Object.keys(op), ...Object.keys(np)])) if (!['rateDate', 'jobFrom', 'titleFrom', 'refreshRate'].includes(k)) add('pp.' + k, PP_NAMES[k] || k, op[k], np[k]);
  add('rcs', 'التوصيات', o.rcs || [], n.rcs || []);
  add('A', 'درجة القسم أ', o.A, n.A); add('B', 'درجة القسم ب', o.B, n.B); add('F', 'الدرجة النهائية', o.F, n.F); add('rc', 'توصيات النظام', o.rc, n.rc);
  return out;
}
/* append-only: entries are only ever pushed */
function logAct(r, who, act, x = {}) {
  r.wf.log = r.wf.log || [];
  r.wf.log.push({ at: now(), by: who.name, email: who.email || '', cap: who.cap || '', act, v: r.v || 1, round: r.wf.round || 0, ...x });
}
function addVersion(r, who, kind, reason, prev) {
  const snap = snapOf(r), v = (r.versions || []).length + 1;
  const changes = prev ? diffSnap(prev, snap) : [];
  r.versions = r.versions || [];
  r.versions.push({ v, at: now(), kind, by: { name: who.name, email: who.email, cap: who.cap }, reason: reason || '', changes,
    scoreFrom: prev ? prev.F : null, scoreTo: snap.F, sha: sha(snap), snap });
  r.v = v; return changes;
}
function pushSig(r, role, s) { r.wf.sigs = r.wf.sigs || []; const x = { role, ...s, v: r.v || 1, round: r.wf.round || 0 }; r.wf.sigs.push(x); r.wf.sig[role] = x; return x; }
/* who took part in the current version / round (for separation of duties) */
function involved(r) {
  const w = r.wf, cur = (w.sigs || []).filter((s) => s.v === r.v && s.round === w.round);
  const editors = (r.versions || []).filter((x) => x.kind === 'hr_edit' || x.kind === 'correction').map((x) => x.by.email);
  return { evaluator: r.ev.email, forwarder: (cur.find((s) => s.role === 'hr') || {}).email, gm: (cur.find((s) => s.role === 'gm') || {}).email, editors };
}
/* existing evaluations get version 1 from their current content; nothing is archived retroactively */
let MIGRATED = false;
async function migrateV3() {
  if (MIGRATED) return; const m = await getJSON('mig/v3', null); if (m) { MIGRATED = true; return; }
  const all = await getJSON('evals', {}), ts = now();
  for (const r of Object.values(all)) {
    if (r.v) continue;
    r.submitted = r.submitted || r.created;
    if (!r.wf) r.wf = { stage: r.status === 'signed' ? 'done' : 'hr', ceo: false, ack: crypto.randomBytes(9).toString('base64url'), sig: {}, log: [] };
    r.wf.round = ['gm', 'ceo', 'done'].includes(r.wf.stage) ? 1 : 0;
    r.versions = []; const snap = snapOf(r);
    r.versions.push({ v: 1, at: r.created, kind: 'migrated', by: { name: r.ev.name, email: r.ev.email, cap: 'evaluator' }, reason: '', changes: [], scoreFrom: null, scoreTo: r.F, sha: sha(snap), snap });
    r.v = 1; r.wf.sigs = [];
    for (const [role, s] of Object.entries(r.wf.sig || {})) { const x = { role, ...s, v: 1, round: role === 'mgr' || role === 'emp' ? 0 : r.wf.round }; r.wf.sigs.push(x); r.wf.sig[role] = x; }
    if (r.wf.stage === 'done') r.legacyDone = true;
  }
  await setJSON('evals', all);
  const us = await users(); for (const u of Object.values(us)) if (u.role === 'admin' && u.owner === undefined) u.owner = true; await setJSON('users', us);
  const st = await getJSON('settings', {}); if (!st.records_start) st.records_start = ts; await setJSON('settings', st);
  await setJSON('mig/v3', { at: ts }); MIGRATED = true;
}

/* ---------- official approvals register ---------- */
const EXEC_NAMES = { na: 'لا يوجد أثر تنفيذي', scheduled: 'مجدول — قبل تاريخ النفاذ', due: 'مستحق التنفيذ', executed: 'نُفّذ', reversal_pending: 'بانتظار عكس الأثر', reversed: 'عُكس الأثر', adjust_pending: 'بانتظار التسوية', adjusted: 'سُوّي', cancelled: 'أُلغي التنفيذ' };
const REC_STATUS = { active: 'سارٍ', superseded: 'مستبدل', cancelled: 'ملغى' };
const today = () => now().slice(0, 10);
const hasEffect = (pp) => !!pp && pp.k !== 'periodic' && pp.k !== 'confirm';
const execInit = (pp) => (!hasEffect(pp) ? 'na' : (pp.date || '') > today() ? 'scheduled' : 'due');
const execNow = (x) => (x.exec.status === 'scheduled' && (x.effective || '') <= today() ? 'due' : x.exec.status);
async function recIndex() { return getJSON('records', { seq: {}, items: {} }); }
function empMeta(id) {
  const e = (SEED && SEED.emps.find((x) => x[0] === id)) || null, pf = (SEED && SEED.profiles[id]) || {};
  const co = ((SEED && SEED.orgs.companies) || []).find((c) => c.id === pf.company), br = ((SEED && SEED.orgs.brands) || []).find((c) => c.id === pf.brand);
  return { branch: e ? (e[4] || e[3]) : '', branch_en: e ? e[3] : '', company: pf.company || '', companyName: co ? (co.ar || co.en) : '', brandName: br ? (br.ar || br.en) : '' };
}
function nextRef(idx, prefix) { const y = today().slice(0, 4), k = prefix + y; idx.seq[k] = (idx.seq[k] || 0) + 1; return prefix + '-' + y + '-' + String(idx.seq[k]).padStart(6, '0'); }
/* archive an evaluation that reached final approval: exactly once per (evaluation, version) */
async function archiveEval(r, extra = {}) {
  if (r.legacyDone && !extra.force) return null;
  const idx = await recIndex();
  const have = Object.values(idx.items).find((x) => x.srcId === r.id && x.v === r.v);
  if (have) { if (r.recordRef !== have.ref) { r.recordRef = have.ref; } return have; }
  const dept = SEED && SEED.depts.find((d) => d.no === r.emp.dept), meta = empMeta(r.emp.id);
  const ref = nextRef(idx, 'OR'), ts = now(), fin = (r.wf.sigs || []).filter((s) => s.v === r.v && s.round === r.wf.round);
  const content = { eval: JSON.parse(JSON.stringify(r)), versions: r.versions.map((x) => ({ v: x.v, at: x.at, kind: x.kind, by: x.by, reason: x.reason, sha: x.sha })) };
  const item = { ref, type: 'performance_eval', typeName: 'تقييم أداء', module: 'performance', srcId: r.id, v: r.v, round: r.wf.round,
    title: (r.pp && r.pp.k !== 'periodic' ? ({ raise: 'زيادة راتب', promo_raise: 'ترقية مع زيادة', promo: 'ترقية', move: 'نقل', confirm: 'تثبيت' })[r.pp.k] + ' — ' : '') + ({ annual: 'سنوي', mid: 'نصف سنوي', quarter: 'ربع سنوي', probation: 'نهاية التجربة' }[r.type] || r.type) + ' ' + r.period,
    emp: { id: r.emp.id, name: r.emp.name, code: r.emp.code, dept: r.emp.dept, deptName: dept ? dept.ar : '', branch: meta.branch, company: meta.company, companyName: meta.companyName, brand: meta.brandName },
    F: r.F, archived: ts, approvedAt: (fin.find((s) => s.role === (r.wf.ceo ? 'ceo' : 'gm')) || {}).at || ts, submitted: r.submitted, effective: (r.pp && r.pp.date) || '',
    status: 'active', exec: { status: execInit(r.pp), history: [] }, supersedes: extra.supersedes || '', supersededBy: '', cancelledBy: '', changeRequests: [], notes: [],
    chain: fin.map((s) => ({ role: s.role, name: s.name, title: s.title || '', email: s.email || '', at: s.at, v: s.v, round: s.round })), sha: sha(content) };
  await setJSON('rec/' + ref, { ...item, content });
  idx.items[ref] = item; await setJSON('records', idx);
  r.recordRef = ref; return item;
}
/* retry: any final approval not yet in the register (e.g. a failed write) is archived now */
async function sweepRecords() {
  const st = await settings(); if (!st.records_start) return 0;
  const all = await evals(); let n = 0;
  for (const r of Object.values(all)) if (r.wf && r.wf.stage === 'done' && !r.legacyDone && !r.recordRef) { await archiveEval(r); n++; }
  if (n) await setJSON('evals', all);
  return n;
}
function scopeOk(u, item) {
  if (u.role !== 'auditor') return true;
  const sc = u.scope || {}, co = sc.companies || [], br = sc.branches || [];
  return (!co.length || co.includes(item.emp.company)) && (!br.length || br.includes(item.emp.branch));
}
async function recReader(token) {
  const a = await auth(token); if (!['admin', 'gm', 'ceo', 'auditor'].includes(a.u.role)) err('forbidden', 'سجل الموافقات للإدارة والموارد البشرية والتدقيق فقط'); return a;
}
const recSummary = (x) => ({ ...x, exec: { ...x.exec, status: execNow(x) }, notesOpen: (x.notes || []).filter((n) => n.status !== 'closed').length });

/* ---------- routes ---------- */
const R = {
  async branding() { return { settings: publicSettings(await settings()) }; },

  async login({ email, password }) {
    email = lower(email); const pw = String(password || '').trim();
    const fk = 'fail/' + crypto.createHash('sha1').update(email).digest('hex');
    const f = await getJSON(fk, { n: 0, t: 0 });
    if (f.n >= MAX_FAILS && Date.now() - f.t < 15 * 60 * 1000) err('locked', 'محاولات كثيرة غير صحيحة. حاول بعد 15 دقيقة.');
    const all = await users(), u = all[email];
    const bad = async () => { await setJSON(fk, { n: (Date.now() - f.t < 15 * 60 * 1000 ? f.n : 0) + 1, t: Date.now() }); err('bad_login', 'البريد الإلكتروني أو كلمة المرور غير صحيحة'); };
    if (!u || !pw) return bad();
    if (u.active === false) err('inactive', 'الحساب موقوف. راجع مدير الموارد البشرية.');
    const codeOk = (u.code && pw.toUpperCase() === String(u.code).toUpperCase()) || (u.code_hash && crypto.createHash('sha256').update(pw.toUpperCase()).digest('hex') === u.code_hash);
    if (codeOk) {
      const st = crypto.randomBytes(16).toString('hex');
      await setJSON('setup/' + st, { email, exp: Date.now() + 30 * 60 * 1000 });
      await store().delete(fk);
      return { needsPassword: true, setupToken: st, name: u.name };
    }
    if (!u.hash || hash(pw, u.salt) !== u.hash) return bad();
    await store().delete(fk);
    return startSession(email, u, all);
  },
  async setPassword({ setupToken, password }) {
    const s = await getJSON('setup/' + setupToken, null);
    if (!s || s.exp < Date.now()) err('expired', 'انتهت صلاحية رمز التفعيل. سجّل الدخول مرة أخرى بالرمز.');
    if (String(password || '').length < 8) err('weak', 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    const all = await users(), u = all[s.email]; if (!u) err('bad_login', 'الحساب غير موجود');
    u.salt = crypto.randomBytes(12).toString('hex'); u.hash = hash(password, u.salt); u.code = ''; delete u.code_hash;
    await store().delete('setup/' + setupToken);
    return startSession(s.email, u, all);
  },
  async changePassword({ token, old, password }) {
    const { email, u, all } = await auth(token);
    if (!u.hash || hash(old, u.salt) !== u.hash) err('bad_login', 'كلمة المرور الحالية غير صحيحة');
    if (String(password || '').length < 8) err('weak', 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    u.salt = crypto.randomBytes(12).toString('hex'); u.hash = hash(password, u.salt); all[email] = u; await setJSON('users', all);
    return {};
  },
  async logout({ token }) { if (token) await store().delete('sess/' + token); return {}; },

  async bootstrap({ token }) {
    const { email, u } = await auth(token), pu = publicUser(email, u), dl = pu.depts;
    if (!(await loadData(false))) { if (pu.role === 'admin') err('locked_data', 'admin'); err('locked_data', 'النظام بانتظار تفعيل البيانات من مدير الموارد البشرية. حاول لاحقاً.'); }
    const inDept = (d) => dl === 'ALL' || dl.includes(Number(d));
    const st = await settings();
    const res = {
      user: pu, settings: publicSettings(st), depts: SEED.depts,
      jobs: SEED.jobs.filter((j) => pu.allJD || inDept(j.dept)),
      emps: SEED.emps.filter((e) => inDept(empDept(e))),
      crit: SEED.crit, authority: SEED.authority, orgs: SEED.orgs,
      evals: Object.values(await evals()).filter((x) => x.ev.email === email).sort((a, b) => (a.updated < b.updated ? 1 : -1)),
    };
    res.profiles = {}; for (const e of res.emps) if (SEED.profiles[e[0]]) res.profiles[e[0]] = SEED.profiles[e[0]];
    if (pu.role === 'admin') {
      res.settings.notify_email = st.notify_email || ''; res.settings.app_url = st.app_url || '';
      res.law = SEED.law; res.gaps = SEED.gaps;
      res.unread = Object.values(await evals()).filter((x) => !x.read).length;
    }
    res.boxUnread = (await boxItems(email, u)).filter((i) => i.unread).length;
    res.fx = st.fx || null;
    if (['admin', 'gm', 'ceo', 'auditor'].includes(pu.role)) {
      if (pu.role === 'admin') { try { await sweepRecords(); } catch (e) { console.error('sweep', e); } }
      const idx = await recIndex(), its = Object.values(idx.items).filter((x) => scopeOk(u, x)), crs = Object.values(await getJSON('chreqs', {}));
      res.recStats = { total: its.length, due: its.filter((x) => ['due', 'reversal_pending', 'adjust_pending'].includes(execNow(x))).length, notes: its.reduce((t, x) => t + (x.notes || []).filter((n) => n.status !== 'closed').length, 0),
        changes: crs.filter((c) => (pu.role === 'gm' && c.status === 'pending_gm') || (pu.role === 'ceo' && c.status === 'pending_ceo')).length };
    }
    if (pu.role === 'admin') res.users = Object.entries(await users()).filter(([, x]) => x.role === 'admin').map(([e, x]) => ({ email: e, name: x.name }));
    return res;
  },
  async unlockData({ token, passphrase }) {
    await admin(token);
    await loadEnc(); let d; try { d = decrypt(passphrase); } catch { err('bad_key', 'مفتاح البيانات غير صحيح'); }
    await setJSON('data', d); BASE = null; SEED = null; await loadData(); return {};
  },
  async logView({ token, kind, ref }) { const { email, u } = await auth(token); await logVisit(email, u.name, String(kind || 'view').slice(0, 20), ref); return {}; },

  async submitEval({ token, rec = {} }) {
    await loadData();
    const { email, u } = await auth(token), pu = publicUser(email, u), dl = pu.depts;
    const e = SEED.emps.find((x) => x[0] === String(rec.empId)); if (!e) err('invalid', 'الموظف غير موجود');
    const job = JOBS[e[2]]; if (!job) err('invalid', 'وظيفة الموظف غير معرّفة');
    if (dl !== 'ALL' && !dl.includes(job.dept)) err('forbidden', 'هذا الموظف ليس ضمن قسمك');
    if (!TYPES[rec.type]) err('invalid', 'نوع التقييم غير صالح');
    const period = String(rec.period || '').slice(0, 20); if (!period) err('invalid', 'حدد الفترة');
    const a = (rec.a || []).map((v) => score(v, true)), b = (rec.b || []).map((v) => score(v, false));
    const ex0 = rec.id ? (await evals())[rec.id] : null, nk = ex0 ? ex0.k.length : job.b.kpis.length, nc = ex0 ? ex0.cw.length : SEED.crit.length;
    if (a.length !== nk || b.length !== nc) err('invalid', 'عدد الدرجات لا يطابق النموذج، حدّث الصفحة');
    if (a.every((v) => v === null)) err('invalid', 'يجب تقييم مؤشر أداء واحد على الأقل');
    const c = ex0 ? {} : calc(job.b.kpis, a, b, rec.type), clip = (s) => String(s || '').slice(0, 1500), n = rec.n || {};
    const all = await evals();
    let ex = rec.id && all[rec.id] ? all[rec.id] : null;
    if (!rec.id) ex = Object.values(all).find((x) => x.ev.email === email && x.emp.id === e[0] && x.type === rec.type && x.period === period && (!x.wf || x.wf.stage !== 'cancelled')) || null;
    if (ex && ex.ev.email !== email) err('forbidden', pu.role === 'admin' ? 'تعديل الموارد البشرية يتم من «تعديل الموارد البشرية» مع ذكر السبب' : 'هذه الاستمارة لمقيّم آخر');
    if (ex && (ex.status === 'signed' || (ex.wf && ex.wf.stage === 'done'))) err('locked', 'هذا التقييم معتمد ومحفوظ ولا يمكن تعديله. التصحيح يتم بطلب من سجل الموافقات الرسمية.');
    if (ex && ex.wf && ex.wf.stage === 'cancelled') err('locked', 'هذه الاستمارة ملغاة');
    if (ex && ex.wf && !['employee', 'returned'].includes(ex.wf.stage)) err('locked', 'التقييم قيد الاعتماد ولا يمكن تعديله الآن. راجع الموارد البشرية.');
    const sig = cleanSig(rec.sig) || (u.sig || ''); if (!sig) err('invalid', 'التوقيع الإلكتروني للمقيّم مطلوب');
    const fx = (await settings()).fx, pp = buildPurpose({ ...(rec.pp || {}), allowIncomplete: true }, e, fx, null);
    const ts = now(), id = ex ? ex.id : crypto.randomBytes(5).toString('hex').toUpperCase();
    const out = {
      id, created: ex ? ex.created : ts, updated: ts, submitted: ex ? (ex.submitted || ex.created) : ts, resubmitted: ex ? ts : '', type: rec.type, period,
      emp: { id: e[0], name: e[1], code: e[2], dept: job.dept, br: e[4] || e[3], rep: e[6] || e[5] },
      a, b, ...c, n: { s: clip(n.s), d: clip(n.d), t: clip(n.t), g: clip(n.g) },
      pp, rcs: (Array.isArray(rec.rcs) ? rec.rcs : []).filter((x, i, a) => REC_KEYS.includes(x) && a.indexOf(x) === i),
      k: ex0 ? ex0.k : job.b.kpis.map((x) => ({ en: x.en, ar: x.ar, t_en: x.t_en, t_ar: x.t_ar, w: x.w })), cw: ex0 ? ex0.cw : SEED.crit.map((x) => [x[0], x[1], x[2]]),
      ev: { email: ex ? ex.ev.email : email, name: String(rec.evName || u.name).slice(0, 80), title: String(rec.evTitle || u.title || '').slice(0, 80) },
      status: ex ? ex.status : 'new', read: false, versions: ex ? ex.versions || [] : [], v: ex ? ex.v : 0,
    };
    if (ex0) Object.assign(out, calcWith(out.k, out.cw, a, b, rec.type));
    const xw = (ex && ex.wf) || {};
    out.wf = { stage: 'employee', ceo: false, round: xw.round || 0, ack: xw.ack || crypto.randomBytes(9).toString('base64url'), sig: {}, sigs: xw.sigs || [], log: xw.log || [], recalled: xw.recalled || null };
    const who = { name: u.name, email, cap: 'evaluator' };
    const changes = addVersion(out, who, ex ? 'resubmit' : 'submit', '', ex ? snapOf(ex) : null);
    pushSig(out, 'mgr', { name: out.ev.name, title: out.ev.title, email: out.ev.email, at: ts, img: sig });
    logAct(out, who, ex ? 'resubmit' : 'submit', { changes, scoreFrom: ex ? ex.F : null, scoreTo: out.F, stFrom: ex ? ex.wf && ex.wf.stage : '', stTo: 'employee' });
    const sf = Object.values(await getJSON('selfs', {})).filter((x) => x.status === 'done' && x.emp.id === e[0] && x.type === rec.type && x.period === period).sort((a, b) => (a.submitted < b.submitted ? 1 : -1))[0];
    if (sf) out.self = { code: sf.code, a: sf.a, b: sf.b, A: sf.A, B: sf.B, F: sf.F, r: sf.r, n: sf.n, at: sf.submitted };
    all[id] = out; await setJSON('evals', all);
    await logVisit(email, u.name, ex ? 'eval-update' : 'eval-submit', e[0] + ' ' + period);
    return { eval: out };
  },
  async myEvals({ token }) { const { email } = await auth(token); return { evals: Object.values(await evals()).filter((x) => x.ev.email === email) }; },

  async listEvals({ token }) { await admin(token); return { evals: Object.values(await evals()).sort((a, b) => (a.updated < b.updated ? 1 : -1)) }; },
  async markEval({ token, id, status, read, archived }) {
    await admin(token); const all = await evals(); if (!all[id]) err('not_found', 'التقييم غير موجود');
    if (status !== undefined) { if (!STATUSES.includes(status)) err('invalid', 'حالة غير صالحة'); const w = all[id].wf || {}; if ((status === 'signed') !== (w.stage === 'done') && (status === 'signed' || all[id].status === 'signed')) err('locked', 'الاعتماد النهائي يتم عبر سلسلة الاعتماد فقط'); all[id].status = status; }
    if (read !== undefined) all[id].read = !!read;
    if (archived !== undefined) all[id].archived = !!archived;
    await setJSON('evals', all); return {};
  },
  async deleteEval({ token, id }) {
    const me = await admin(token), all = await evals(); if (!all[id]) err('not_found', 'التقييم غير موجود');
    const w0 = all[id].wf || {}; if (all[id].recordRef || w0.round > 0 || ['done', 'cancelled', 'gm', 'ceo'].includes(w0.stage)) err('locked', 'لا تُحذف استمارة أُحيلت للاعتماد أو اعتُمدت أو أُلغيت؛ تبقى بياناتها وسجلها. استخدم «إلغاء» مع السبب.');
    const t = await getJSON('trash', {}); t[id] = { ...all[id], deleted: now(), deletedBy: me.email }; delete all[id];
    await setJSON('trash', t); await setJSON('evals', all); return {};
  },
  async saveJob({ token, job, isNew }) {
    await loadData(); const j = cleanJob(job || {}); await editor(token, 'jd', [j.dept, JOBS[j.code] && JOBS[j.code].dept]);
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(j.code)) err('invalid', 'رمز الوظيفة غير صالح (أحرف إنجليزية وأرقام وشرطة، مثل LO-HR-05)');
    if (!SEED.depts.some((d) => d.no === j.dept)) err('invalid', 'اختر القسم');
    if (!j.ar && !j.en) err('invalid', 'اكتب المسمى الوظيفي');
    if (isNew && JOBS[j.code]) err('exists', 'يوجد وصف وظيفي بنفس الرمز');
    if (!isNew && !JOBS[j.code]) err('not_found', 'الوصف الوظيفي غير موجود');
    checkKpis(j.b.kpis);
    const ed = await getJSON('edits', {}); ed.jobs = ed.jobs || {}; ed.jobs[j.code] = j; await setJSON('edits', ed);
    return { job: j };
  },
  async deleteJob({ token, code }) {
    await admin(token); await loadData(); if (!JOBS[code]) err('not_found', 'الوصف الوظيفي غير موجود');
    const n = SEED.emps.filter((e) => e[2] === code).length; if (n) err('in_use', 'لا يمكن حذف الوصف: عليه ' + n + ' موظف. انقلهم لوظيفة أخرى أولاً');
    const ed = await getJSON('edits', {}); ed.jobs = ed.jobs || {};
    if (BASE.jobs.some((x) => x.code === code)) ed.jobs[code] = null; else delete ed.jobs[code];
    await setJSON('edits', ed); return {};
  },
  async revertJob({ token, code }) {
    await admin(token); await loadData(); const ed = await getJSON('edits', {});
    if (!BASE.jobs.some((x) => x.code === code)) err('invalid', 'هذا وصف مضاف وليس له نسخة أصلية');
    if (ed.jobs) delete ed.jobs[code]; await setJSON('edits', ed); return {};
  },
  async saveEmp({ token, emp, isNew }) {
    await loadData(); const s = (v, n = 120) => String(v == null ? '' : v).trim().slice(0, n); emp = emp || {};
    const e = [s(emp.id, 30), s(emp.name), s(emp.code, 20), s(emp.br_en), s(emp.br_ar), s(emp.rep), s(emp.rep_ar)];
    if (!e[0] || !e[1]) err('invalid', 'اكتب الرقم الوظيفي والاسم');
    if (!JOBS[e[2]]) err('invalid', 'اختر الوظيفة');
    const old = SEED.emps.find((x) => x[0] === e[0]);
    if (isNew && old) err('exists', 'يوجد موظف بنفس الرقم الوظيفي'); if (!isNew && !old) err('not_found', 'الموظف غير موجود');
    const me = await editor(token, 'emp', [JOBS[e[2]].dept, old && empDept(old)]);
    const ed = await getJSON('edits', {}); ed.emps = ed.emps || {}; ed.profiles = ed.profiles || {}; ed.emps[e[0]] = e;
    const pf = { ...(ed.profiles[e[0]] || {}) }, f = emp.profile || {};
    for (const k of PROFILE_KEYS) if (f[k] !== undefined) pf[k] = s(f[k], k === 'notes' ? 1500 : 200);
    pf.history = pf.history || [];
    if (isNew) pf.history.push({ d: now(), t: 'hire', to: e[2], by: me.email });
    else if (old[2] !== e[2]) pf.history.push({ d: now(), t: 'move', from: old[2], to: e[2], fd: empDept(old), td: JOBS[e[2]].dept, by: me.email });
    pf.history = pf.history.slice(-50); ed.profiles[e[0]] = pf;
    await setJSON('edits', ed); return { emp: e, profile: pf };
  },
  async deleteEmp({ token, id }) {
    await loadData(); const old = SEED.emps.find((x) => x[0] === id); if (!old) err('not_found', 'الموظف غير موجود');
    await editor(token, 'emp', [empDept(old)]);
    const ed = await getJSON('edits', {}); ed.emps = ed.emps || {};
    if (BASE.emps.some((x) => x[0] === id)) ed.emps[id] = null; else delete ed.emps[id];
    await setJSON('edits', ed); return {};
  },
  async saveDept({ token, dept, isNew }) {
    await admin(token); await loadData(); const s = (v) => String(v == null ? '' : v).trim().slice(0, 150);
    const no = isNew ? Math.max(0, ...SEED.depts.map((d) => d.no)) + 1 : Number(dept && dept.no);
    if (!isNew && !SEED.depts.some((d) => d.no === no)) err('not_found', 'القسم غير موجود');
    const d = { no, en: s(dept.en), ar: s(dept.ar), head: s(dept.head), head_ar: s(dept.head_ar), rep: s(dept.rep), rep_ar: s(dept.rep_ar) };
    if (!d.ar && !d.en) err('invalid', 'اكتب اسم القسم');
    const ed = await getJSON('edits', {}); ed.depts = ed.depts || {}; ed.depts[String(no)] = d; await setJSON('edits', ed); return { dept: d };
  },
  async setPhoto({ token, id, photo }) {
    await loadData(); const e = SEED.emps.find((x) => x[0] === id); if (!e) err('not_found', 'الموظف غير موجود');
    await editor(token, 'emp', [empDept(e)]);
    const ed = await getJSON('edits', {}); ed.profiles = ed.profiles || {}; const pf = ed.profiles[id] = ed.profiles[id] || {};
    if (photo) { if (typeof photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 300000) err('invalid', 'الصورة كبيرة جداً أو بصيغة غير مدعومة'); await setJSON('photo/' + id, { p: photo }); pf.ph = Date.now(); }
    else { await store().delete('photo/' + id); delete pf.ph; }
    await setJSON('edits', ed); return { ph: pf.ph || 0 };
  },
  async getPhoto({ token, id }) {
    await loadData(); const { email, u } = await auth(token), pu = publicUser(email, u); const e = SEED.emps.find((x) => x[0] === id); if (!e) err('not_found', 'الموظف غير موجود');
    if (pu.depts !== 'ALL' && !pu.depts.includes(empDept(e))) err('forbidden', 'هذا الموظف ليس ضمن قسمك');
    const r = await getJSON('photo/' + id, null); return { photo: r ? r.p : '' };
  },
  async saveOrgs({ token, orgs }) {
    await admin(token); const s = (v) => String(v == null ? '' : v).trim().slice(0, 120), o = orgs || {};
    const id = (v) => s(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
    const companies = (o.companies || []).map((c) => ({ id: id(c.id) || ('C' + Math.random().toString(36).slice(2, 7)), ar: s(c.ar), en: s(c.en), logo: typeof c.logo === 'string' && c.logo.startsWith('data:image/') && c.logo.length < 80000 ? c.logo : '' })).filter((c) => c.ar || c.en).slice(0, 50);
    const brands = (o.brands || []).map((c) => ({ id: id(c.id) || ('B' + Math.random().toString(36).slice(2, 7)), ar: s(c.ar), en: s(c.en), company: id(c.company) })).filter((c) => c.ar || c.en).slice(0, 100);
    const ed = await getJSON('edits', {}); ed.orgs = { companies, brands }; await setJSON('edits', ed); return { orgs: ed.orgs };
  },
  async saveCrit({ token, crit }) {
    await admin(token); await loadData(); const s = (v, n = 600) => String(v == null ? '' : v).trim().slice(0, n);
    const c = (Array.isArray(crit) ? crit : []).map((x) => [s(x[0], 120), s(x[1], 120), Math.round(Number(x[2]) * 100) / 100 || 0, s(x[3]), s(x[4])]).filter((x) => x[0] || x[1]);
    if (c.length < 1 || c.length > 15) err('invalid', 'عدد المعايير بين 1 و 15');
    const sum = c.reduce((t, x) => t + x[2], 0); if (c.some((x) => x[2] <= 0) || Math.abs(sum - 100) > 0.5) err('invalid', 'مجموع أوزان المعايير يجب أن يساوي 100% (الحالي ' + sum + '%)');
    const ed = await getJSON('edits', {}); ed.crit = c; await setJSON('edits', ed); return {};
  },
  /* ---------- employee self-assessment (link + code, no account needed) ---------- */
  async createSelf({ token, empId, type, period }) {
    await loadData(); const { email, u } = await auth(token), pu = publicUser(email, u);
    const e = SEED.emps.find((x) => x[0] === String(empId)); if (!e) err('not_found', 'الموظف غير موجود');
    const job = JOBS[e[2]]; if (pu.depts !== 'ALL' && !pu.depts.includes(job.dept)) err('forbidden', 'هذا الموظف ليس ضمن قسمك');
    if (!TYPES[type]) err('invalid', 'نوع التقييم غير صالح'); period = String(period || '').slice(0, 20); if (!period) err('invalid', 'حدد الفترة');
    const all = await getJSON('selfs', {});
    const open = Object.values(all).find((x) => x.emp.id === e[0] && x.type === type && x.period === period && x.status === 'open'); if (open) return { self: open };
    const code = crypto.randomBytes(9).toString('base64url');
    const x = { code, emp: { id: e[0], name: e[1], code: e[2], dept: job.dept }, type, period, by: email, byName: u.name, created: now(), status: 'open',
      k: job.b.kpis.map((k) => ({ en: k.en, ar: k.ar, t_en: k.t_en, t_ar: k.t_ar, w: k.w })), cw: SEED.crit.map((c) => [c[0], c[1], c[2], c[3], c[4]]) };
    all[code] = x; await setJSON('selfs', all); await logVisit(email, u.name, 'self-request', e[0] + ' ' + period); return { self: x };
  },
  async listSelf({ token }) {
    await loadData(); const { email, u } = await auth(token), pu = publicUser(email, u);
    return { selfs: Object.values(await getJSON('selfs', {})).filter((x) => pu.depts === 'ALL' || pu.depts.includes(x.emp.dept)).sort((a, b) => (a.created < b.created ? 1 : -1)) };
  },
  async deleteSelf({ token, code }) {
    const { email, u } = await auth(token), pu = publicUser(email, u), all = await getJSON('selfs', {}), x = all[code]; if (!x) err('not_found', 'الطلب غير موجود');
    if (pu.role !== 'admin' && x.by !== email) err('forbidden', 'يمكن حذف الطلب من منشئه أو الموارد البشرية');
    delete all[code]; await setJSON('selfs', all); return {};
  },
  async selfForm({ code }) {
    const x = (await getJSON('selfs', {}))[String(code || '')]; if (!x) err('not_found', 'الرابط غير صالح أو انتهت صلاحيته');
    const st = await settings();
    return { self: { emp: x.emp, type: x.type, period: x.period, k: x.k, cw: x.cw, status: x.status, a: x.a, b: x.b, n: x.n, F: x.F, r: x.r, submitted: x.submitted, byName: x.byName }, settings: publicSettings(st) };
  },
  async selfSubmit({ code, a, b, n }) {
    const all = await getJSON('selfs', {}), x = all[String(code || '')]; if (!x) err('not_found', 'الرابط غير صالح أو انتهت صلاحيته');
    if (x.status === 'done') err('locked', 'تم إرسال التقييم الذاتي مسبقاً');
    a = (a || []).map((v) => score(v, true)); b = (b || []).map((v) => score(v, false));
    if (a.length !== x.k.length || b.length !== x.cw.length) err('invalid', 'أكمل جميع الدرجات');
    if (a.every((v) => v === null)) err('invalid', 'قيّم مؤشراً واحداً على الأقل');
    let sw = 0, ss = 0; x.k.forEach((k, i) => { if (a[i] !== null) { sw += k.w; ss += k.w * a[i]; } });
    let bw = 0, bs = 0; x.cw.forEach((c, i) => { bw += c[2]; bs += c[2] * b[i]; });
    const r1 = (v) => Math.round(v * 10) / 10, A = r1(ss / sw * 10), B = r1(bs / bw * 10), F = r1(0.6 * A + 0.4 * B);
    const clip = (v) => String(v || '').slice(0, 1500); n = n || {};
    Object.assign(x, { a, b, A, B, F, r: F >= 85 ? 3 : F >= 70 ? 2 : F >= 55 ? 1 : 0, n: { ach: clip(n.ach), ch: clip(n.ch), t: clip(n.t), g: clip(n.g) }, status: 'done', submitted: now() });
    await setJSON('selfs', all);
    const ev = await evals(); let ch = false;
    for (const r of Object.values(ev)) if (r.emp.id === x.emp.id && r.type === x.type && r.period === x.period) { r.self = { code: x.code, a, b, A, B, F, r: x.r, n: x.n, at: x.submitted }; ch = true; }
    if (ch) await setJSON('evals', ev);
    return { F, r: x.r };
  },
  /* ---------- approvals: employee › HR review › GM final approval › (CEO, optional) ---------- */
  async setMySig({ token, img }) {
    const { email, all } = await auth(token); const s = img ? cleanSig(img) : ''; if (img && !s) err('invalid', 'التوقيع غير صالح');
    all[email].sig = s; await setJSON('users', all); return { sig: s };
  },
  async ackForm({ code }) {
    const r = Object.values(await evals()).find((x) => x.wf && x.wf.ack === String(code || '')); if (!r) err('not_found', 'الرابط غير صالح أو انتهت صلاحيته');
    const st = await settings();
    return { eval: { id: r.id, emp: r.emp, type: r.type, period: r.period, k: r.k, cw: r.cw, a: r.a, b: r.b, A: r.A, B: r.B, F: r.F, r: r.r, n: r.n, pp: r.pp, ev: { name: r.ev.name, title: r.ev.title }, stage: r.wf.stage, empSig: r.wf.sig.emp || null }, settings: publicSettings(st) };
  },
  async ackSign({ code, img, note }) {
    const all = await evals(), r = Object.values(all).find((x) => x.wf && x.wf.ack === String(code || '')); if (!r) err('not_found', 'الرابط غير صالح أو انتهت صلاحيته');
    if (r.wf.stage !== 'employee') err('locked', 'تم توقيع هذا التقييم مسبقاً');
    const sig = cleanSig(img); if (!sig) err('invalid', 'التوقيع مطلوب'); const ts = now();
    pushSig(r, 'emp', { name: r.emp.name, at: ts, img: sig }); r.n.e = String(note || '').slice(0, 1500); r.wf.stage = 'hr'; r.read = false; r.updated = ts;
    logAct(r, { name: r.emp.name, email: '', cap: 'employee' }, 'employee-sign', { stFrom: 'employee', stTo: 'hr' }); await setJSON('evals', all); return { stage: 'hr' };
  },
  async wfAction({ token, id, act, img, note, ceo, v, round }) {
    await loadData(false);
    const { email, u } = await auth(token), role = roleOf(u), all = await evals(), r = all[id]; if (!r) err('not_found', 'التقييم غير موجود');
    const ts = now(), sig = cleanSig(img) || u.sig || '', who = { name: u.name, title: u.title || '', email, at: ts, img: sig }, actor = { name: u.name, email, cap: capOf(u) };
    note = String(note || '').slice(0, 600); const from = r.wf.stage;
    const need = (st, roles) => { if (!roles.includes(role)) err('forbidden', 'ليست لديك صلاحية هذا الإجراء'); if (!st.includes(r.wf.stage)) err('invalid', 'المرحلة الحالية: ' + WF_NAMES[r.wf.stage]); };
    const needSig = () => { if (!sig) err('invalid', 'التوقيع الإلكتروني مطلوب'); };
    /* an approval is bound to the version and round it reviewed */
    const bound = () => { if (Number(v) !== r.v || Number(round) !== r.wf.round) err('stale_version', 'تغيّرت الاستمارة بعد فتحها (النسخة الحالية ' + r.v + '). حدّث الصفحة وراجع النسخة الأخيرة قبل الاعتماد.'); };
    const inv = involved(r), sep = (list) => { if (list.filter(Boolean).includes(email)) err('forbidden', 'فصل المهام: لا يعتمد من قيّم الموظف أو أحال الاستمارة أو عدّلها أو اعتمدها في مرحلة سابقة'); };
    if (act === 'hr_forward') {
      need(['hr', 'employee'], ['admin']); needSig();
      if (r.pp && r.pp.incomplete) err('invalid', 'أكمل بيانات الزيادة (الراتب الأساسي والعملة) من «تعديل الموارد البشرية» قبل الإحالة');
      r.wf.round = (r.wf.round || 0) + 1;
      if (r.wf.stage === 'employee') pushSig(r, 'emp', { name: r.emp.name, at: ts, paper: true });
      pushSig(r, 'hr', who); r.wf.ceo = !!ceo; r.wf.stage = 'gm';
    } else if (act === 'hr_return') { need(['hr', 'employee'], ['admin']); r.wf.stage = 'returned'; r.wf.sig = { mgr: r.wf.sig.mgr }; }
    else if (act === 'gm_approve') { need(['gm'], ['gm']); bound(); sep([inv.evaluator, inv.forwarder, ...inv.editors]); needSig(); pushSig(r, 'gm', who); r.wf.stage = r.wf.ceo ? 'ceo' : 'done'; }
    else if (act === 'gm_return') { need(['gm'], ['gm']); r.wf.stage = 'hr'; delete r.wf.sig.hr; }
    else if (act === 'ceo_approve') { need(['ceo'], ['ceo']); bound(); sep([inv.evaluator, inv.forwarder, inv.gm, ...inv.editors]); needSig(); pushSig(r, 'ceo', who); r.wf.stage = 'done'; }
    else if (act === 'ceo_return') { need(['ceo'], ['ceo']); r.wf.stage = 'hr'; delete r.wf.sig.hr; delete r.wf.sig.gm; }
    else if (act === 'set_ceo') { need(['hr', 'gm', 'employee'], ['admin']); r.wf.ceo = !!ceo; }
    else err('bad_action', 'إجراء غير معروف');
    if (r.wf.stage === 'done') { r.status = 'signed'; r.doneAt = ts; }
    logAct(r, actor, act, { note, stFrom: from, stTo: r.wf.stage }); r.updated = ts;
    if (r.wf.stage === 'done') { try { await archiveEval(r); } catch (e) { console.error('archive', e); } }
    await setJSON('evals', all);
    await logVisit(email, u.name, 'wf-' + act, r.emp.id); return { eval: r };
  },
  async myBox({ token }) { const { email, u } = await auth(token); const items = await boxItems(email, u); return { items, unread: items.filter((i) => i.unread).length }; },
  async boxSeen({ token, keys }) {
    const { email, u } = await auth(token), items = await boxItems(email, u), want = keys === 'all' ? null : new Set((Array.isArray(keys) ? keys : []).map(String));
    const all = await getJSON('seen', {}), m = all[email] || {};
    for (const i of items) if (!want || want.has(i.key)) m[i.key] = i.at;
    all[email] = m; await setJSON('seen', all); return { unread: items.filter((i) => !m[i.key] || m[i.key] < i.at).length };
  },
  async listApprovals({ token }) {
    const { email, u } = await auth(token), role = roleOf(u); const l = Object.values(await evals());
    let out = [];
    if (role === 'admin') out = l.filter((x) => x.wf && x.wf.stage !== 'done' && x.wf.stage !== 'cancelled');
    else if (role === 'gm') out = l.filter((x) => x.wf && (x.wf.stage === 'gm' || (x.wf.sig.gm && x.wf.sig.gm.email === email)));
    else if (role === 'ceo') out = l.filter((x) => x.wf && (x.wf.stage === 'ceo' || (x.wf.sig.ceo && x.wf.sig.ceo.email === email)));
    else out = l.filter((x) => x.ev.email === email && x.wf);
    return { evals: out.sort((a, b) => (a.updated < b.updated ? 1 : -1)) };
  },
  async listTrash({ token }) { await admin(token); return { evals: Object.values(await getJSON('trash', {})).sort((a, b) => (a.deleted < b.deleted ? 1 : -1)) }; },
  async restoreEval({ token, id }) {
    await admin(token); const t = await getJSON('trash', {}), all = await evals(); if (!t[id]) err('not_found', 'التقييم غير موجود في السلة');
    if (all[id]) err('exists', 'يوجد تقييم أحدث لنفس الموظف والنوع والفترة — احذفه أولاً ثم استرجع هذا');
    const r = { ...t[id] }; delete r.deleted; delete r.deletedBy; all[id] = r; delete t[id];
    await setJSON('evals', all); await setJSON('trash', t); return { eval: r };
  },
  async purgeEval({ token, id }) {
    await admin(token); let t = await getJSON('trash', {});
    if (id === '*') t = {}; else { if (!t[id]) err('not_found', 'التقييم غير موجود في السلة'); delete t[id]; }
    await setJSON('trash', t); return {};
  },

  /* ---------- v3: exchange rate, raise preview ---------- */
  async saveFx({ token, rate }) {
    const { email, u } = await admin(token), x = Number(rate); if (!(x > 0 && x < 1e6)) err('invalid', 'سعر الصرف غير صالح');
    const s = await getJSON('settings', {}); const fx = { rate: rnd(x, 4), date: today(), at: now(), by: u.name, email };
    s.fxLog = (s.fxLog || []).concat([fx]).slice(-200); s.fx = fx; await setJSON('settings', s); await logVisit(email, u.name, 'fx-set', String(fx.rate));
    return { fx };
  },
  async raisePreview({ token, pp, keepRate }) {
    await auth(token); const st = await settings(); const fx = keepRate && keepRate.rate ? keepRate : st.fx;
    return { raise: computeRaise(pp || {}, fx), fx: st.fx || null };
  },
  async getEval({ token, id }) {
    const { email, u } = await auth(token), r = (await evals())[id]; if (!r) err('not_found', 'التقييم غير موجود');
    const role = roleOf(u), mine = r.ev.email === email;
    if (!(mine || ['admin', 'gm', 'ceo'].includes(role))) {
      if (role === 'auditor' && r.recordRef) { const it = (await recIndex()).items[r.recordRef]; if (it && scopeOk(u, it)) return { eval: r }; }
      err('forbidden', 'ليست لديك صلاحية عرض هذا التقييم');
    }
    return { eval: r };
  },
  /* ---------- v3: HR / owner on a form in review ---------- */
  async hrEdit({ token, id, rec = {}, reason }) {
    await loadData(); const { email, u } = await admin(token); needGrant(u, 'edit'); reason = needReason(reason);
    const all = await evals(), r = all[id]; if (!r) err('not_found', 'التقييم غير موجود');
    const st = r.wf.stage;
    if (st === 'gm' || st === 'ceo') err('recall_first', 'الاستمارة محالة إلى ' + WF_NAMES[st] + '. استرجعها أولاً ثم عدّلها.');
    if (st === 'done') err('locked', 'الاستمارة معتمدة ومؤرشفة. التعديل يتم بطلب تصحيح من سجل الموافقات الرسمية.');
    if (st !== 'hr') err('invalid', 'التعديل متاح في مرحلة مراجعة الموارد البشرية فقط (المرحلة الحالية: ' + WF_NAMES[st] + ')');
    if (r.ev.email === email) err('forbidden', 'لا يعدّل المقيّم استمارته من هنا');
    const e = SEED.emps.find((x) => x[0] === r.emp.id) || [r.emp.id, r.emp.name, r.emp.code];
    const a = (rec.a || r.a).map((v) => score(v, true)), b = (rec.b || r.b).map((v) => score(v, false));
    if (a.length !== r.k.length || b.length !== r.cw.length) err('invalid', 'عدد الدرجات لا يطابق الاستمارة');
    if (a.every((v) => v === null)) err('invalid', 'يجب تقييم مؤشر أداء واحد على الأقل');
    const prev = snapOf(r), clip = (s) => String(s || '').slice(0, 1500), n = rec.n || r.n;
    const fx = (await settings()).fx;
    const pp = rec.pp ? buildPurpose(rec.pp, e, fx, r.pp) : r.pp;
    const next = { ...r, a, b, ...calcWith(r.k, r.cw, a, b, r.type), n: { s: clip(n.s), d: clip(n.d), t: clip(n.t), g: clip(n.g), e: r.n.e || '' }, pp,
      rcs: (Array.isArray(rec.rcs) ? rec.rcs : r.rcs || []).filter((x, i, l) => REC_KEYS.includes(x) && l.indexOf(x) === i) };
    if (!diffSnap(prev, snapOf(next)).length) err('no_change', 'لا يوجد تغيير على الاستمارة');
    Object.assign(r, next);
    const who = { name: u.name, email, cap: capOf(u) }, changes = addVersion(r, who, 'hr_edit', reason, prev);
    logAct(r, who, 'hr_edit', { reason, changes, scoreFrom: prev.F, scoreTo: r.F, stFrom: st, stTo: st });
    r.updated = now(); await setJSON('evals', all); await logVisit(email, u.name, 'eval-hr-edit', r.emp.id); return { eval: r };
  },
  async recall({ token, id, reason }) {
    const { email, u } = await admin(token); needGrant(u, 'recall'); reason = needReason(reason);
    const all = await evals(), r = all[id]; if (!r) err('not_found', 'التقييم غير موجود');
    const st = r.wf.stage; if (st !== 'gm' && st !== 'ceo') err('invalid', 'الاسترجاع متاح بعد الإحالة إلى المدير العام أو الرئيس التنفيذي وقبل الاعتماد النهائي');
    const who = { name: u.name, email, cap: capOf(u) };
    r.wf.recalled = { at: now(), by: u.name, email, cap: who.cap, reason, v: r.v, round: r.wf.round, from: st };
    r.wf.stage = 'hr'; r.wf.sig = { mgr: r.wf.sig.mgr, emp: r.wf.sig.emp };
    logAct(r, who, 'recall', { reason, stFrom: st, stTo: 'hr' }); r.updated = now(); r.read = false;
    await setJSON('evals', all); await logVisit(email, u.name, 'eval-recall', r.emp.id); return { eval: r };
  },
  async cancelEval({ token, id, reason }) {
    const { email, u } = await admin(token); needGrant(u, 'cancel'); reason = needReason(reason);
    const all = await evals(), r = all[id]; if (!r) err('not_found', 'التقييم غير موجود');
    const st = r.wf.stage;
    if (st === 'done') err('locked', 'الاستمارة معتمدة ومؤرشفة. الإلغاء يتم بطلب إلغاء من سجل الموافقات الرسمية.');
    if (st === 'cancelled') err('invalid', 'الاستمارة ملغاة مسبقاً');
    const who = { name: u.name, email, cap: capOf(u) };
    r.wf.cancelled = { at: now(), by: u.name, email, cap: who.cap, reason, from: st }; r.wf.stage = 'cancelled';
    logAct(r, who, 'cancel', { reason, stFrom: st, stTo: 'cancelled' }); r.updated = now();
    await setJSON('evals', all); await logVisit(email, u.name, 'eval-cancel', r.emp.id); return { eval: r };
  },

  /* ---------- v3: official approvals register ---------- */
  async listRecords({ token }) {
    await loadData(false); const { u } = await recReader(token); if (u.role === 'admin') await sweepRecords();
    const idx = await recIndex(); return { records: Object.values(idx.items).filter((x) => scopeOk(u, x)).map(recSummary).sort((a, b) => (a.archived < b.archived ? 1 : -1)) };
  },
  async getRecord({ token, ref }) {
    const { email, u } = await recReader(token), idx = await recIndex(), it = idx.items[ref]; if (!it || !scopeOk(u, it)) err('not_found', 'السجل غير موجود');
    const full = await getJSON('rec/' + ref, null); if (!full) err('not_found', 'محتوى السجل غير موجود');
    const intact = sha(full.content) === it.sha;
    const crs = Object.values(await getJSON('chreqs', {})).filter((c) => c.ref === ref);
    await logVisit(email, u.name, 'record-view', ref);
    return { record: { ...recSummary(it), content: full.content, intact }, changes: crs };
  },
  async recordNote({ token, ref, text }) {
    const { email, u } = await recReader(token); if (u.role !== 'auditor') err('forbidden', 'ملاحظات التدقيق للمدقق الداخلي');
    text = needReason(text, 3); const idx = await recIndex(), it = idx.items[ref]; if (!it || !scopeOk(u, it)) err('not_found', 'السجل غير موجود');
    it.notes = it.notes || []; it.notes.push({ id: crypto.randomBytes(4).toString('hex'), at: now(), by: u.name, email, text, status: 'open', replies: [] });
    await setJSON('records', idx); return { record: recSummary(it) };
  },
  async noteReply({ token, ref, noteId, text, status }) {
    const { email, u } = await recReader(token), idx = await recIndex(), it = idx.items[ref]; if (!it || !scopeOk(u, it)) err('not_found', 'السجل غير موجود');
    const n = (it.notes || []).find((x) => x.id === noteId); if (!n) err('not_found', 'الملاحظة غير موجودة');
    if (text) n.replies.push({ at: now(), by: u.name, email, cap: capOf(u), text: String(text).slice(0, 1500) });
    if (status) { if (!['open', 'answered', 'closed'].includes(status)) err('invalid', 'حالة غير صالحة'); if (status === 'closed' && u.role !== 'auditor') err('forbidden', 'إغلاق الملاحظة للمدقق الداخلي'); n.status = status; }
    else if (text && u.role !== 'auditor' && n.status === 'open') n.status = 'answered';
    await setJSON('records', idx); return { record: recSummary(it) };
  },
  async markExec({ token, ref, status, note }) {
    const { email, u } = await admin(token); needGrant(u, 'exec'); note = needReason(note, 3);
    const idx = await recIndex(), it = idx.items[ref]; if (!it) err('not_found', 'السجل غير موجود');
    const cur = execNow(it), MOVES = { due: 'executed', reversal_pending: 'reversed', adjust_pending: 'adjusted' };
    if (cur === 'scheduled') err('invalid', 'لم يحن تاريخ النفاذ (' + it.effective + ')');
    if (MOVES[cur] !== status) err('invalid', 'الحالة التنفيذية الحالية: ' + EXEC_NAMES[cur]);
    if (status === 'executed' && it.status !== 'active') err('invalid', 'السجل ' + REC_STATUS[it.status] + ' ولا يُنفّذ');
    it.exec.history.push({ at: now(), by: u.name, email, from: cur, to: status, note }); it.exec.status = status; it.exec.at = now(); it.exec.by = u.name;
    await setJSON('records', idx); await logVisit(email, u.name, 'record-exec', ref + ' ' + status); return { record: recSummary(it) };
  },
  /* correction / cancellation of an archived record: a linked request with its own approval chain */
  async requestChange({ token, ref, kind, reason, rec }) {
    await loadData(); const { email, u } = await admin(token); needGrant(u, kind === 'cancel' ? 'cancel' : 'edit'); reason = needReason(reason);
    if (!['correct', 'cancel'].includes(kind)) err('invalid', 'نوع الطلب غير صالح');
    const idx = await recIndex(), it = idx.items[ref]; if (!it) err('not_found', 'السجل غير موجود');
    if (it.status !== 'active') err('invalid', 'السجل ' + REC_STATUS[it.status] + ' ولا يقبل طلبات');
    const all = await getJSON('chreqs', {}); if (Object.values(all).some((c) => c.ref === ref && c.status.startsWith('pending'))) err('exists', 'يوجد طلب قيد الاعتماد على هذا السجل');
    const r = (await evals())[it.srcId]; if (!r) err('not_found', 'الاستمارة الأصلية غير موجودة');
    if (r.ev.email === email) err('forbidden', 'المقيّم لا يطلب تغيير سجل تقييمه');
    const c = { id: '', ref, kind, reason, by: u.name, email, cap: capOf(u), at: now(), status: 'pending_gm', ceo: !!r.wf.ceo, sigs: [], log: [] };
    if (kind === 'correct') {
      const e = SEED.emps.find((x) => x[0] === r.emp.id) || [r.emp.id, r.emp.name, r.emp.code];
      const a = (rec && rec.a || r.a).map((v) => score(v, true)), b = (rec && rec.b || r.b).map((v) => score(v, false));
      if (a.length !== r.k.length || b.length !== r.cw.length) err('invalid', 'عدد الدرجات لا يطابق الاستمارة');
      const n = (rec && rec.n) || r.n, clip = (s) => String(s || '').slice(0, 1500);
      const pp = rec && rec.pp ? buildPurpose(rec.pp, e, (await settings()).fx, r.pp) : r.pp;
      const next = { ...snapOf(r), a, b, ...calcWith(r.k, r.cw, a, b, r.type), n: { s: clip(n.s), d: clip(n.d), t: clip(n.t), g: clip(n.g), e: r.n.e || '' }, pp,
        rcs: (Array.isArray(rec && rec.rcs) ? rec.rcs : r.rcs || []).filter((x, i, l) => REC_KEYS.includes(x) && l.indexOf(x) === i) };
      if (pp && pp.incomplete) err('invalid', 'أكمل بيانات الزيادة');
      c.proposed = next; c.changes = diffSnap(snapOf(r), next); if (!c.changes.length) err('no_change', 'لا يوجد تغيير');
      c.scoreFrom = r.F; c.scoreTo = next.F;
    }
    const seq = await getJSON('chreqs_seq', {}), y = today().slice(0, 4); seq[y] = (seq[y] || 0) + 1; await setJSON('chreqs_seq', seq);
    c.id = 'RC-' + y + '-' + String(seq[y]).padStart(5, '0'); c.log.push({ at: c.at, by: u.name, act: 'request', note: reason });
    all[c.id] = c; await setJSON('chreqs', all); it.changeRequests = (it.changeRequests || []).concat([c.id]); await setJSON('records', idx);
    await logVisit(email, u.name, 'record-change-request', ref + ' ' + c.id); return { change: c };
  },
  async listChanges({ token }) {
    const { u } = await recReader(token), idx = await recIndex();
    return { changes: Object.values(await getJSON('chreqs', {})).filter((c) => idx.items[c.ref] && scopeOk(u, idx.items[c.ref])).sort((a, b) => (a.at < b.at ? 1 : -1)) };
  },
  async changeAction({ token, id, act, img, note }) {
    await loadData(false); const { email, u } = await auth(token), role = roleOf(u), all = await getJSON('chreqs', {}), c = all[id]; if (!c) err('not_found', 'الطلب غير موجود');
    note = String(note || '').slice(0, 600); const ts = now(), sig = cleanSig(img) || u.sig || '';
    if (act === 'withdraw') { if (c.email !== email || !c.status.startsWith('pending')) err('forbidden', 'يسحب الطلب من قدّمه قبل اعتماده'); c.status = 'withdrawn'; c.log.push({ at: ts, by: u.name, act, note }); await setJSON('chreqs', all); return { change: c }; }
    const stage = c.status === 'pending_gm' ? 'gm' : c.status === 'pending_ceo' ? 'ceo' : ''; if (!stage) err('invalid', 'الطلب ليس قيد الاعتماد');
    if (role !== stage) err('forbidden', 'الطلب بانتظار ' + (stage === 'gm' ? 'المدير العام' : 'الرئيس التنفيذي'));
    const evs = await evals(), r = evs[(await recIndex()).items[c.ref].srcId];
    if (email === c.email || email === r.ev.email || c.sigs.some((s) => s.email === email)) err('forbidden', 'فصل المهام: لا يعتمد الطلب من قدّمه أو من قيّم الموظف أو من وقّعه سابقاً');
    if (act === 'reject') { c.status = 'rejected'; c.log.push({ at: ts, by: u.name, act, note }); await setJSON('chreqs', all); return { change: c }; }
    if (act !== 'approve') err('bad_action', 'إجراء غير معروف'); if (!sig) err('invalid', 'التوقيع الإلكتروني مطلوب');
    c.sigs.push({ role: stage, name: u.name, title: u.title || '', email, at: ts, img: sig }); c.log.push({ at: ts, by: u.name, act: 'approve', note });
    if (stage === 'gm' && c.ceo) { c.status = 'pending_ceo'; await setJSON('chreqs', all); return { change: c }; }
    /* final approval: apply */
    const idx = await recIndex(), it = idx.items[c.ref]; if (it.status !== 'active') err('invalid', 'السجل لم يعد سارياً');
    const who = { name: c.by, email: c.email, cap: c.cap }, wasExec = execNow(it);
    if (c.kind === 'cancel') {
      it.status = 'cancelled'; it.cancelledBy = c.id; it.cancelledAt = ts;
      const to = wasExec === 'executed' || wasExec === 'adjusted' ? 'reversal_pending' : ['scheduled', 'due'].includes(wasExec) ? 'cancelled' : wasExec;
      if (to !== wasExec) { it.exec.history.push({ at: ts, by: 'النظام', from: wasExec, to, note: 'إلغاء معتمد بالطلب ' + c.id }); it.exec.status = to; }
      r.recordCancelled = c.id; logAct(r, { name: u.name, email, cap: role }, 'record_cancelled', { reason: c.reason, ref: c.ref, change: c.id });
    } else {
      const prev = snapOf(r); Object.assign(r, { ...c.proposed, emp: r.emp, ev: r.ev, k: r.k, cw: r.cw, type: r.type, period: r.period });
      addVersion(r, who, 'correction', c.reason, prev); r.wf.round = (r.wf.round || 0) + 1;
      for (const s of c.sigs) pushSig(r, s.role, { name: s.name, title: s.title, email: s.email, at: s.at, img: s.img, change: c.id });
      logAct(r, who, 'correction', { reason: c.reason, changes: c.changes, scoreFrom: prev.F, scoreTo: r.F, ref: c.ref, change: c.id });
      r.recordRef = ''; await setJSON('evals', evs);
      const nx = await archiveEval(r, { supersedes: c.ref }); const idx2 = await recIndex(), old = idx2.items[c.ref];
      old.status = 'superseded'; old.supersededBy = nx.ref; old.supersededAt = ts;
      if (wasExec === 'executed' || wasExec === 'adjusted') { if (hasEffect(r.pp)) { idx2.items[nx.ref].exec = { status: 'adjust_pending', history: [{ at: ts, by: 'النظام', from: 'new', to: 'adjust_pending', note: 'تصحيح سجل منفّذ ' + c.ref }] }; } }
      else if (['scheduled', 'due'].includes(wasExec)) { old.exec.history.push({ at: ts, by: 'النظام', from: wasExec, to: 'cancelled', note: 'استُبدل بالسجل ' + nx.ref }); old.exec.status = 'cancelled'; }
      c.newRef = nx.ref; c.status = 'approved'; c.doneAt = ts;
      await setJSON('records', idx2); await setJSON('evals', evs); await setJSON('chreqs', all);
      await logVisit(email, u.name, 'record-corrected', c.ref + '>' + nx.ref); return { change: c };
    }
    c.status = 'approved'; c.doneAt = ts;
    await setJSON('records', idx); await setJSON('evals', evs); await setJSON('chreqs', all);
    await logVisit(email, u.name, 'record-cancelled', c.ref); return { change: c };
  },

  async listUsers({ token }) {
    const { all } = await admin(token), ev = Object.values(await evals()), vis = await getJSON('visits', []);
    return { users: Object.entries(all).map(([email, u]) => ({
      email, name: u.name, title: u.title || '', role: u.role, depts: deptList(u), allJD: !!u.allJD, active: u.active !== false, perms: permsOf(u),
      owner: isOwner(u), grants: grantsOf(u), scope: u.scope || null, activated: !!u.hash, code: u.hash ? '' : (u.code || ''), created: u.created || '', lastLogin: u.last_login || '',
      logins: u.visits || 0, actions: vis.filter((v) => v[1] === email).length, evals: ev.filter((x) => x.ev.email === email).length })) };
  },
  async saveUser({ token, user: d = {} }) {
    const me = await admin(token), all = me.all, email = lower(d.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) err('invalid', 'البريد الإلكتروني غير صالح');
    const role = ROLES.includes(d.role) ? d.role : 'manager', depts = role !== 'manager' ? [] : (d.depts || []).map(Number).filter((n) => n > 0);
    if (role === 'manager' && !depts.length) err('invalid', 'حدد قسماً واحداً على الأقل للمدير');
    if (email === me.email && (role !== 'admin' || d.active === false)) err('invalid', 'لا يمكنك إزالة صلاحية المدير أو إيقاف حسابك');
    const cur = all[email]; let code = '';
    const meOwner = isOwner(me.u), keep = cur || {};
    if (!meOwner && cur && isOwner(cur)) err('forbidden', 'حساب مالك النظام يعدّله المالك فقط');
    if (!meOwner && ((d.grants && GRANTS.some((k) => !!d.grants[k] !== !!(keep.grants && keep.grants[k]))) || (d.owner !== undefined && !!d.owner !== !!keep.owner))) err('forbidden', 'منح الصلاحيات الحساسة لمالك النظام فقط');
    const grants = meOwner ? Object.fromEntries(GRANTS.map((k) => [k, role === 'admin' && !!(d.grants && d.grants[k])])) : (keep.grants || {});
    const owner = meOwner ? role === 'admin' && !!d.owner : !!keep.owner;
    if (email === me.email && meOwner && !owner) err('invalid', 'لا يمكنك إزالة صفة المالك عن حسابك');
    const ids = (l) => (Array.isArray(l) ? l : []).map((x) => String(x).slice(0, 120)).filter(Boolean).slice(0, 50);
    const scope = role === 'auditor' ? { companies: ids(d.scope && d.scope.companies), branches: ids(d.scope && d.scope.branches) } : null;
    if (!meOwner && (role === 'auditor' || role === 'admin') && (!cur || cur.role !== role)) err('forbidden', 'منح دور الموارد البشرية أو التدقيق لمالك النظام فقط');
    all[email] = { ...keep, name: String(d.name || '').slice(0, 80), title: String(d.title || '').slice(0, 80), role, depts, allJD: !!d.allJD, active: d.active !== false, perms: { jd: !!(d.perms && d.perms.jd), emp: !!(d.perms && d.perms.emp) }, grants, owner, scope };
    if (!cur) { code = randCode(); all[email].code = code; all[email].created = now(); all[email].visits = 0; }
    await setJSON('users', all); return { code };
  },
  async resetUser({ token, email }) {
    const { all } = await admin(token), u = all[lower(email)]; if (!u) err('not_found', 'المستخدم غير موجود');
    const code = randCode(); u.code = code; delete u.hash; delete u.salt; await setJSON('users', all); return { code };
  },
  async deleteUser({ token, email }) {
    const me = await admin(token); email = lower(email); if (email === me.email) err('invalid', 'لا يمكنك حذف حسابك');
    delete me.all[email]; await setJSON('users', me.all); return {};
  },
  async listVisits({ token, limit }) { await admin(token); const v = await getJSON('visits', []); return { visits: v.slice(-Math.min(Number(limit) || 400, 2000)).reverse() }; },
  async saveSettings({ token, settings: d = {} }) {
    await admin(token); const s = await getJSON('settings', {});
    for (const k of ['company_ar', 'company_en', 'system_title', 'notify_email', 'theme', 'app_url', 'logo']) {
      if (d[k] === undefined) continue;
      let v = String(d[k]);
      if (k === 'logo' && v && (v.length > 60000 || !v.startsWith('data:image/'))) err('invalid', 'الشعار كبير جداً أو بصيغة غير مدعومة');
      s[k] = k === 'logo' ? v : v.slice(0, 200);
    }
    await setJSON('settings', s); return { settings: publicSettings(await settings()) };
  },
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') return ok({ service: 'L-O HR API', version: '1.0' });
  let body; try { body = JSON.parse(await req.text()); } catch { return fail('bad_request', 'طلب غير صالح'); }
  const fn = R[body.action]; if (!fn) return fail('bad_action', 'إجراء غير معروف');
  try { await migrateV3(); return ok(await fn(body)); }
  catch (e) { if (e instanceof ApiError) return fail(e.code, e.message); console.error(e); return fail('server', 'حدث خطأ في الخادم، أعد المحاولة'); }
};

export const config = { path: '/api' };
