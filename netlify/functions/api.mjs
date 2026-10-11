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
const ok = (o = {}) => Response.json({ ok: true, ...o });
const fail = (error, message) => Response.json({ ok: false, error, message });
class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const err = (code, msg) => { throw new ApiError(code, msg); };
const now = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Baghdad' });
const lower = (s) => String(s || '').trim().toLowerCase();

async function getJSON(key, def) { const v = await store().get(key, { type: 'json' }); return v == null ? def : v; }
async function setJSON(key, val) { await store().setJSON(key, val); }

/* ---------- data: public part in the repository, employee data encrypted until HR unlocks it ---------- */
let SEED = null, JOBS = {};
async function loadData(required = true) {
  if (!SEED) {
    const d = await getJSON('data', null);
    if (d) { SEED = { ...PUB, ...d }; JOBS = Object.fromEntries(SEED.jobs.map((j) => [j.code, j])); }
  }
  if (!SEED && required) err('locked_data', 'بيانات النظام بانتظار التفعيل من مدير الموارد البشرية.');
  return SEED;
}
function decrypt(pass) {
  const key = crypto.scryptSync(String(pass), Buffer.from(ENC.salt, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  const buf = Buffer.from(ENC.data, 'base64'), tag = buf.subarray(buf.length - 16), body = buf.subarray(0, buf.length - 16);
  const dc = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ENC.iv, 'base64')); dc.setAuthTag(tag);
  return JSON.parse(Buffer.concat([dc.update(body), dc.final()]).toString('utf8'));
}
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
const publicUser = (email, u) => ({ email, name: u.name, title: u.title || '', role: u.role === 'admin' ? 'admin' : 'manager', depts: deptList(u), allJD: u.role === 'admin' || !!u.allJD });

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
  let bw = 0, bs = 0; PUB.crit.forEach((c, i) => { bw += c[2]; bs += c[2] * b[i]; });
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
      crit: SEED.crit, authority: SEED.authority,
      evals: Object.values(await evals()).filter((x) => x.ev.email === email).sort((a, b) => (a.updated < b.updated ? 1 : -1)),
    };
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
    await setJSON('data', d); SEED = null; await loadData(); return {};
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
      ev: { email: ex ? ex.ev.email : email, name: String(rec.evName || u.name).slice(0, 80), title: String(rec.evTitle || u.title || '').slice(0, 80) },
      status: ex ? ex.status : 'new', read: false,
    };
    all[id] = out; await setJSON('evals', all);
    await logVisit(email, u.name, ex ? 'eval-update' : 'eval-submit', e[0] + ' ' + period);
    return { eval: out };
  },
  async myEvals({ token }) { const { email } = await auth(token); return { evals: Object.values(await evals()).filter((x) => x.ev.email === email) }; },

  async listEvals({ token }) { await admin(token); return { evals: Object.values(await evals()).sort((a, b) => (a.updated < b.updated ? 1 : -1)) }; },
  async markEval({ token, id, status, read }) {
    await admin(token); const all = await evals(); if (!all[id]) err('not_found', 'التقييم غير موجود');
    if (status !== undefined) { if (!STATUSES.includes(status)) err('invalid', 'حالة غير صالحة'); all[id].status = status; }
    if (read !== undefined) all[id].read = !!read;
    await setJSON('evals', all); return {};
  },
  async deleteEval({ token, id }) { await admin(token); const all = await evals(); delete all[id]; await setJSON('evals', all); return {}; },

  async listUsers({ token }) {
    const { all } = await admin(token), ev = Object.values(await evals()), vis = await getJSON('visits', []);
    return { users: Object.entries(all).map(([email, u]) => ({
      email, name: u.name, title: u.title || '', role: u.role, depts: deptList(u), allJD: !!u.allJD, active: u.active !== false,
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
    all[email] = { ...(cur || {}), name: String(d.name || '').slice(0, 80), title: String(d.title || '').slice(0, 80), role, depts, allJD: !!d.allJD, active: d.active !== false };
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
  if (req.method === 'GET') return ok({ service: 'L-O HR API', version: '1.0' });
  let body; try { body = JSON.parse(await req.text()); } catch { return fail('bad_request', 'طلب غير صالح'); }
  const fn = R[body.action]; if (!fn) return fail('bad_action', 'إجراء غير معروف');
  try { return ok(await fn(body)); }
  catch (e) { if (e instanceof ApiError) return fail(e.code, e.message); console.error(e); return fail('server', 'حدث خطأ في الخادم، أعد المحاولة'); }
};

export const config = { path: '/api' };
