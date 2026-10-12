/**
 * L-O HR — Job Descriptions, KPIs & Performance · API (Netlify Function + Netlify Blobs)
 * Prepared by HR Manager Aws Firas Al-Shalal — إعداد مدير الموارد البشرية أوس فراس الشلال
 */
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import PUB from '../../data/seed.public.json' with { type: 'json' };
import ENC from '../../data/seed.enc.json' with { type: 'json' };

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
  SEED = applyEdits(BASE, await getJSON('edits', {})); JOBS = Object.fromEntries(SEED.jobs.map((j) => [j.code, j]));
  return SEED;
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
  if (k === 'raise' || k === 'promo_raise') { o.mode = p.mode === 'amt' ? 'amt' : 'pct'; o.val = num(p.val); if (o.mode === 'pct' && o.val > 100) err('invalid', 'نسبة الزيادة غير منطقية'); }
  if (k === 'promo' || k === 'promo_raise' || k === 'move') { o.job = s(p.job, 20); o.txt = s(p.txt, 150); }
  if (k !== 'periodic') o.date = s(p.date, 10);
  return o;
}
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
const deptList = (u) => (u.role === 'admin' ? 'ALL' : (u.depts || []).map(Number));
const permsOf = (u) => (u.role === 'admin' ? { jd: true, emp: true } : { jd: !!(u.perms && u.perms.jd), emp: !!(u.perms && u.perms.emp) });
const publicUser = (email, u) => ({ email, name: u.name, title: u.title || '', role: u.role === 'admin' ? 'admin' : 'manager', depts: deptList(u), allJD: u.role === 'admin' || !!u.allJD, perms: permsOf(u) });
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
async function evals() { return getJSON('evals', {}); }

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
    return res;
  },
  async unlockData({ token, passphrase }) {
    await admin(token);
    let d; try { d = decrypt(passphrase); } catch { err('bad_key', 'مفتاح البيانات غير صحيح'); }
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
    if (a.length !== job.b.kpis.length || b.length !== SEED.crit.length) err('invalid', 'عدد الدرجات لا يطابق النموذج، حدّث الصفحة');
    if (a.every((v) => v === null)) err('invalid', 'يجب تقييم مؤشر أداء واحد على الأقل');
    const c = calc(job.b.kpis, a, b, rec.type), clip = (s) => String(s || '').slice(0, 1500), n = rec.n || {};
    const all = await evals();
    let ex = rec.id && all[rec.id] && (all[rec.id].ev.email === email || pu.role === 'admin') ? all[rec.id] : null;
    if (!rec.id) ex = Object.values(all).find((x) => x.ev.email === email && x.emp.id === e[0] && x.type === rec.type && x.period === period) || null;
    if (ex && ex.status === 'signed') err('locked', 'هذا التقييم موقّع ومحفوظ ولا يمكن تعديله. راجع الموارد البشرية.');
    const ts = now(), id = ex ? ex.id : crypto.randomBytes(5).toString('hex').toUpperCase();
    const out = {
      id, created: ex ? ex.created : ts, updated: ts, type: rec.type, period,
      emp: { id: e[0], name: e[1], code: e[2], dept: job.dept, br: e[4] || e[3], rep: e[6] || e[5] },
      a, b, ...c, n: { s: clip(n.s), d: clip(n.d), t: clip(n.t), g: clip(n.g) },
      pp: cleanPurpose(rec.pp), rcs: (Array.isArray(rec.rcs) ? rec.rcs : []).filter((x, i, a) => REC_KEYS.includes(x) && a.indexOf(x) === i),
      k: job.b.kpis.map((x) => ({ en: x.en, ar: x.ar, t_en: x.t_en, t_ar: x.t_ar, w: x.w })), cw: SEED.crit.map((x) => [x[0], x[1], x[2]]),
      ev: { email: ex ? ex.ev.email : email, name: String(rec.evName || u.name).slice(0, 80), title: String(rec.evTitle || u.title || '').slice(0, 80) },
      status: ex ? ex.status : 'new', read: false,
    };
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
    if (status !== undefined) { if (!STATUSES.includes(status)) err('invalid', 'حالة غير صالحة'); all[id].status = status; }
    if (read !== undefined) all[id].read = !!read;
    if (archived !== undefined) all[id].archived = !!archived;
    await setJSON('evals', all); return {};
  },
  async deleteEval({ token, id }) {
    const me = await admin(token), all = await evals(); if (!all[id]) err('not_found', 'التقييم غير موجود');
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

  async listUsers({ token }) {
    const { all } = await admin(token), ev = Object.values(await evals()), vis = await getJSON('visits', []);
    return { users: Object.entries(all).map(([email, u]) => ({
      email, name: u.name, title: u.title || '', role: u.role, depts: deptList(u), allJD: !!u.allJD, active: u.active !== false, perms: permsOf(u),
      activated: !!u.hash, code: u.hash ? '' : (u.code || ''), created: u.created || '', lastLogin: u.last_login || '',
      logins: u.visits || 0, actions: vis.filter((v) => v[1] === email).length, evals: ev.filter((x) => x.ev.email === email).length })) };
  },
  async saveUser({ token, user: d = {} }) {
    const me = await admin(token), all = me.all, email = lower(d.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) err('invalid', 'البريد الإلكتروني غير صالح');
    const role = d.role === 'admin' ? 'admin' : 'manager', depts = role === 'admin' ? [] : (d.depts || []).map(Number).filter((n) => n > 0);
    if (role !== 'admin' && !depts.length) err('invalid', 'حدد قسماً واحداً على الأقل للمدير');
    if (email === me.email && (role !== 'admin' || d.active === false)) err('invalid', 'لا يمكنك إزالة صلاحية المدير أو إيقاف حسابك');
    const cur = all[email]; let code = '';
    all[email] = { ...(cur || {}), name: String(d.name || '').slice(0, 80), title: String(d.title || '').slice(0, 80), role, depts, allJD: !!d.allJD, active: d.active !== false, perms: { jd: !!(d.perms && d.perms.jd), emp: !!(d.perms && d.perms.emp) } };
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
  try { return ok(await fn(body)); }
  catch (e) { if (e instanceof ApiError) return fail(e.code, e.message); console.error(e); return fail('server', 'حدث خطأ في الخادم، أعد المحاولة'); }
};

export const config = { path: '/api' };
