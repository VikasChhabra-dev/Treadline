// Threadline — standalone team chat on Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ================= utilities ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ms = t => (typeof t === 'number' ? t : Date.parse(t) || 0);
const iso = () => new Date().toISOString();
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const fmtTime = t => new Date(ms(t)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function fmtDay(t) { const d = new Date(ms(t)), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1); if (d.toDateString() === n.toDateString()) return 'Today'; if (d.toDateString() === y.toDateString()) return 'Yesterday'; return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' }); }
function fmtWhen(t) { const d = new Date(ms(t)); return (d.toDateString() === new Date().toDateString() ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ') + fmtTime(t); }
const COLORS = ['#2f7d6d', '#c0583a', '#6b4fbb', '#1f6fb2', '#b23a6f', '#8a6d00', '#3a7d2f', '#a8432f', '#2f5c7d', '#7d2f6b'];
const colorOf = id => COLORS[hash(String(id)) % COLORS.length];
const initials = n => { const p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
let toastT; function toast(msg) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3500); }
const errMsg = e => (e && (e.message || e.error_description)) || 'Something went wrong';

const EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '✅', '🙏', '🔥', '😄', '😮', '😢', '🤔', '👏', '💯', '🚀', '👌', '🙌', '😅', '😎', '🤝', '💡', '⚠️', '❌', '➕', '📌', '✨', '🥳', '😍', '🙂', '😐', '😬', '🤯', '☕', '🍕', '📅', '📝', '🐛', '✔️', '👋', '💬'];
const QUICK = ['👍', '❤️', '😂'];
const SHORT = { smile: '😄', '+1': '👍', thumbsup: '👍', heart: '❤️', joy: '😂', tada: '🎉', eyes: '👀', white_check_mark: '✅', check: '✅', pray: '🙏', fire: '🔥', rocket: '🚀', '100': '💯', wave: '👋', clap: '👏', thinking: '🤔', ok_hand: '👌', bug: '🐛', coffee: '☕', pizza: '🍕', sweat_smile: '😅', sunglasses: '😎', warning: '⚠️', x: '❌', bulb: '💡', sparkles: '✨', pushpin: '📌', memo: '📝', raised_hands: '🙌', partying_face: '🥳', cry: '😢' };
const MAX_FILE = 25 * 1048576;

/* ================= config & client ================= */
const CFG = window.THREADLINE_CONFIG || {};
const configured = CFG.supabaseUrl && CFG.supabaseAnonKey && !/YOUR-/.test(CFG.supabaseUrl + CFG.supabaseAnonKey);
const root = $('#root');
let sb = null;
if (!configured) {
  root.innerHTML = `<div class="auth"><div class="auth-card setup"><div class="brand"><span class="logo">✦</span>Threadline</div><h2>Almost there — connect Supabase</h2><p class="sub">Open <code>config.js</code> and paste your Supabase <b>Project URL</b> and <b>anon key</b> (Supabase Dashboard → Project Settings → API). Then reload this page.</p><p class="sub">Haven't set up the database yet? Follow the steps in <code>README.md</code>.</p></div></div>`;
} else {
  sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
}

/* ================= state ================= */
const S = {
  session: null, uid: null, me: null, ws: { name: 'Workspace' },
  profiles: new Map(), channels: new Map(), members: new Map(), // channel_id -> Map(user_id -> member row)
  cur: null, msgs: new Map(), thread: null, panel: null, notifs: [], editing: null,
  presence: {}, presenceCh: null, dbCh: null, jumpTo: null, jumpThread: null, booted: false, online: true,
  sound: (() => { try { return localStorage.getItem('tl-sound') !== 'off'; } catch (e) { return true; } })(),
};
const myMember = cid => (S.members.get(cid) || new Map()).get(S.uid);
const isMember = cid => !!myMember(cid);
const memberIds = cid => [...(S.members.get(cid) || new Map()).keys()];
const isAdmin = () => S.me && S.me.approved && S.me.role === 'admin';
const nameOf = uid => (S.profiles.get(uid) || {}).display_name || 'Someone';
const approvedPeople = () => [...S.profiles.values()].filter(p => p.approved);
const dmOther = cid => memberIds(cid).find(u => u !== S.uid) || S.uid;
const chLabel = c => c.kind === 'dm' ? (dmOther(c.id) === S.uid ? nameOf(S.uid) + ' (you)' : nameOf(dmOther(c.id))) : c.name;
function isUnread(c) { const m = myMember(c.id); if (!m || c.id === S.cur || !c.last_message_at || c.last_message_by === S.uid) return false; return ms(c.last_message_at) > ms(m.last_read_at); }
function sidebarChannels() { return [...S.channels.values()].filter(c => c.kind !== 'dm' && !c.archived && isMember(c.id)).sort((a, b) => a.name.localeCompare(b.name)); }
function sidebarDMs() { return [...S.channels.values()].filter(c => c.kind === 'dm' && isMember(c.id)).sort((a, b) => ms(b.last_message_at || b.created_at) - ms(a.last_message_at || a.created_at)); }
const isOnline = uid => !!(S.presence[uid] && S.presence[uid].length);
const statusOf = uid => { const p = S.profiles.get(uid) || {}; return { e: p.status_emoji || '', t: p.status_text || '' }; };
function avatar(uid, cls = '', dot = false) { return `<span class="av ${cls}" style="background:${colorOf(uid)}">${esc(initials(nameOf(uid)))}${dot ? `<span class="dot ${isOnline(uid) ? 'on' : ''}"></span>` : ''}</span>`; }

/* ================= sounds ================= */
let actx = null;
document.addEventListener('pointerdown', () => { try { if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); } if (actx && actx.state === 'suspended') actx.resume(); } catch (e) {} }, { capture: true });
function ding(kind) {
  if (!S.sound || !actx || actx.state !== 'running') return;
  try { const now = actx.currentTime, notes = kind === 'mention' ? [880, 1318.5] : [659.3, 987.8]; notes.forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(), t0 = now + i * 0.13; o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4); o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + 0.45); }); } catch (e) {}
}
function setSound(on) { S.sound = on; try { localStorage.setItem('tl-sound', on ? 'on' : 'off'); } catch (e) {} toast(on ? 'Notification sounds on' : 'Notification sounds off'); if (on) ding('mention'); }

/* ================= auth screens ================= */
let authMode = 'signin', authNotice = null;
function authCard(inner) { return `<div class="auth"><div class="auth-card"><div class="brand"><span class="logo">✦</span><span id="authWs">Threadline</span></div>${inner}</div></div>`; }
function renderAuth() {
  stopRealtime(); S.booted = false; closeModal(); const t = $('.toast'); if (t) t.remove();
  const n = authNotice ? `<div class="notice ${authNotice.bad ? 'bad' : ''}">${esc(authNotice.text)}</div>` : '';
  if (authMode === 'signup') {
    root.innerHTML = authCard(`<h2>Create your account</h2><p class="sub">An admin approves new members before they can see the workspace.</p>${n}
      <form id="authForm"><div class="field"><label>Your name</label><input name="name" required maxlength="60" autocomplete="name"></div>
      <div class="field"><label>Work email</label><input name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label>Password <small>(at least 8 characters)</small></label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
      <button class="btn primary" type="submit">Create account</button></form>
      <div class="auth-links"><span>Already have an account? <button data-mode="signin">Sign in</button></span></div>`);
  } else if (authMode === 'forgot') {
    root.innerHTML = authCard(`<h2>Reset your password</h2><p class="sub">We'll email you a link to choose a new password.</p>${n}
      <form id="authForm"><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
      <button class="btn primary" type="submit">Send reset link</button></form>
      <div class="auth-links"><button data-mode="signin">← Back to sign in</button></div>`);
  } else if (authMode === 'recover') {
    root.innerHTML = authCard(`<h2>Choose a new password</h2><p class="sub">Enter a new password for your account.</p>${n}
      <form id="authForm"><div class="field"><label>New password <small>(at least 8 characters)</small></label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
      <button class="btn primary" type="submit">Save password</button></form>`);
  } else {
    root.innerHTML = authCard(`<h2>Sign in</h2><p class="sub">Welcome back to your team's workspace.</p>${n}
      <form id="authForm"><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn primary" type="submit">Sign in</button></form>
      <div class="auth-links"><button data-mode="forgot">Forgot password?</button><span>New here? <button data-mode="signup">Create an account</button></span></div>`);
  }
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { authMode = b.dataset.mode; authNotice = null; renderAuth(); });
  const form = $('#authForm'); const f0 = form.querySelector('input'); if (f0) f0.focus();
  form.onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(form); const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    const email = String(fd.get('email') || '').trim(), password = String(fd.get('password') || '');
    const redirect = location.origin + location.pathname;
    try {
      if (authMode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (authMode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: String(fd.get('name') || '').trim() }, emailRedirectTo: redirect } });
        if (error) throw error;
        if (!data.session) { authMode = 'signin'; authNotice = { text: 'Check your email and click the confirmation link, then sign in here.' }; renderAuth(); }
      } else if (authMode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
        if (error) throw error;
        authMode = 'signin'; authNotice = { text: 'If that email has an account, a reset link is on its way.' }; renderAuth();
      } else if (authMode === 'recover') {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        authMode = 'signin'; authNotice = null; toast('Password updated'); boot();
      }
    } catch (err) {
      authNotice = { bad: true, text: /invalid login/i.test(errMsg(err)) ? 'Wrong email or password.' : /not confirmed/i.test(errMsg(err)) ? 'Please confirm your email first — check your inbox for the link.' : errMsg(err) };
      renderAuth();
    } finally { if (btn.isConnected) btn.disabled = false; }
  };
}

function renderPending() {
  S.booted = false; closeModal();
  root.innerHTML = authCard(`<h2>Waiting for approval</h2><p class="sub">Hi ${esc(S.me ? S.me.display_name : '')} — your account is created. A workspace admin needs to approve you before you can see channels and messages. This page updates by itself once you're approved.</p>
    <div style="display:flex;gap:8px"><button class="btn" id="pendCheck">Check again</button><button class="btn" id="pendOut">Sign out</button></div>`);
  $('#pendCheck').onclick = () => boot();
  $('#pendOut').onclick = signOut;
  stopRealtime();
  S.dbCh = sb.channel('pending-' + S.uid).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${S.uid}` }, p => { if (p.new && p.new.approved) boot(); }).subscribe();
}
async function signOut() { stopRealtime(); await sb.auth.signOut(); S.session = null; S.uid = null; authMode = 'signin'; authNotice = { text: 'You have been signed out.' }; renderAuth(); }

/* ================= boot ================= */
let booting = false;
async function boot() {
  if (booting) return; booting = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    S.session = session; S.uid = session ? session.user.id : null;
    if (!session) { renderAuth(); return; }
    let prof = null;
    for (let i = 0; i < 3 && !prof; i++) { const { data } = await sb.from('profiles').select('*').eq('id', S.uid).maybeSingle(); prof = data; if (!prof) await sleep(600); }
    if (!prof) { authNotice = { bad: true, text: 'Your profile could not be loaded. Make sure the database setup script has been run.' }; await sb.auth.signOut(); renderAuth(); return; }
    S.me = prof; S.profiles.set(prof.id, prof);
    if (!prof.approved) { renderPending(); return; }
    await loadAll();
    renderShell(); startRealtime(); S.booted = true;
    routeFromHash(true);
  } catch (e) {
    root.innerHTML = authCard(`<h2>Can't reach the server</h2><p class="sub">${esc(errMsg(e))}</p><button class="btn primary" onclick="location.reload()">Try again</button>`);
  } finally { booting = false; }
}
async function loadAll() {
  const [ws, profs, chans, mems, notifs] = await Promise.all([
    sb.from('workspace').select('name').eq('id', 1).maybeSingle(),
    sb.from('profiles').select('*'),
    sb.from('channels').select('*'),
    sb.from('channel_members').select('*'),
    sb.from('notifications').select('*').eq('user_id', S.uid).order('created_at', { ascending: false }).limit(100),
  ]);
  for (const r of [profs, chans, mems]) if (r.error) throw r.error;
  if (ws.data) S.ws = ws.data;
  S.profiles = new Map((profs.data || []).map(p => [p.id, p])); S.me = S.profiles.get(S.uid) || S.me;
  S.channels = new Map((chans.data || []).map(c => [c.id, c]));
  S.members = new Map(); (mems.data || []).forEach(addMemberRow);
  S.notifs = notifs.data || [];
}
function addMemberRow(m) { if (!S.members.has(m.channel_id)) S.members.set(m.channel_id, new Map()); S.members.get(m.channel_id).set(m.user_id, m); }

if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    // Never await Supabase calls directly inside this callback.
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') { authMode = 'recover'; authNotice = null; S.session = session; renderAuth(); return; }
      if (event === 'SIGNED_OUT') { if (S.uid) { stopRealtime(); S.uid = null; S.session = null; renderAuth(); } return; }
      if (event === 'SIGNED_IN' && authMode !== 'recover' && (!S.booted || (session && session.user.id !== S.uid))) boot();
    }, 0);
  });
  boot();
}

/* ================= realtime ================= */
function stopRealtime() { try { if (S.dbCh) sb.removeChannel(S.dbCh); if (S.presenceCh) sb.removeChannel(S.presenceCh); } catch (e) {} S.dbCh = null; S.presenceCh = null; S.presence = {}; }
let wasSubscribed = false;
function startRealtime() {
  stopRealtime(); wasSubscribed = false;
  const on = (table, fn, extra = {}) => S.dbCh.on('postgres_changes', { event: '*', schema: 'public', table, ...extra }, fn);
  S.dbCh = sb.channel('db-' + S.uid);
  on('messages', onMessageChange);
  on('reactions', onReactionChange);
  on('channels', onChannelChange);
  on('channel_members', onMemberChange);
  on('profiles', onProfileChange);
  on('workspace', p => { if (p.new && p.new.name) { S.ws = p.new; renderWsName(); } });
  on('notifications', onNotification, { event: 'INSERT', filter: `user_id=eq.${S.uid}` });
  S.dbCh.subscribe(status => {
    if (status === 'SUBSCRIBED') { if (wasSubscribed) resync(); wasSubscribed = true; setOnline(true); }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setOnline(false);
  });
  S.presenceCh = sb.channel('presence-workspace', { config: { presence: { key: S.uid } } });
  S.presenceCh.on('presence', { event: 'sync' }, () => { S.presence = S.presenceCh.presenceState(); renderSidebar(); renderTyping(); renderFoot(); if (S.panel && S.panel.kind === 'profile') renderPanel(); });
  S.presenceCh.subscribe(async st => { if (st === 'SUBSCRIBED') { try { await S.presenceCh.track({ typing: null, ts: Date.now() }); } catch (e) {} } });
}
function setOnline(v) { if (S.online === v) return; S.online = v; const b = $('#offlineBar'); if (b) b.hidden = v; }
async function resync() {
  try { await loadAll(); S.msgs.clear(); renderAll(); if (S.cur) loadMessages(S.cur); if (S.thread) openThread(S.thread.pid, true); } catch (e) {}
}
let typingSent = 0, typingT = null;
function sendTyping(key) {
  if (!S.presenceCh) return;
  if (Date.now() - typingSent > 2500) { typingSent = Date.now(); S.presenceCh.track({ typing: key, ts: Date.now() }).catch(() => {}); }
  clearTimeout(typingT); typingT = setTimeout(stopTyping, 4000);
}
function stopTyping() { typingSent = 0; clearTimeout(typingT); if (S.presenceCh) S.presenceCh.track({ typing: null, ts: Date.now() }).catch(() => {}); }

function normMsg(m, keepReactions) { return { ...m, reactions: Array.isArray(m.reactions) ? m.reactions : (keepReactions || []) }; }
function allLoadedMsgs() { const out = []; for (const v of S.msgs.values()) out.push(...v.list); if (S.thread) { out.push(...S.thread.replies); if (S.thread.parent) out.push(S.thread.parent); } return out; }
function findMsg(id) { return allLoadedMsgs().find(m => m.id === id); }

function onMessageChange(p) {
  if (p.eventType === 'INSERT') {
    const m = normMsg(p.new);
    if (!m.parent_id) {
      const c = S.msgs.get(m.channel_id);
      if (c && !c.list.some(x => x.id === m.id)) { c.list.push(m); c.list.sort((a, b) => ms(a.created_at) - ms(b.created_at)); if (m.channel_id === S.cur) { renderMessages(); markRead(); } }
    } else if (S.thread && S.thread.pid === m.parent_id && !S.thread.replies.some(x => x.id === m.id)) {
      S.thread.replies.push(m); S.thread.replies.sort((a, b) => ms(a.created_at) - ms(b.created_at)); renderThread();
    }
  } else if (p.eventType === 'UPDATE') {
    const n = p.new; let touched = false;
    for (const c of S.msgs.values()) { const i = c.list.findIndex(x => x.id === n.id); if (i >= 0) { c.list[i] = normMsg(n, c.list[i].reactions); touched = true; } }
    if (S.thread) { if (S.thread.parent && S.thread.parent.id === n.id) { S.thread.parent = normMsg(n, S.thread.parent.reactions); touched = true; } const i = S.thread.replies.findIndex(x => x.id === n.id); if (i >= 0) { S.thread.replies[i] = normMsg(n, S.thread.replies[i].reactions); touched = true; } }
    if (touched) { renderMessages(); if (S.thread) renderThread(); if (S.panel && S.panel.kind === 'pins') loadPins(); }
  }
}
function onReactionChange(p) {
  const r = p.eventType === 'DELETE' ? p.old : p.new; if (!r || !r.message_id) return;
  const m = findMsg(r.message_id); if (!m) return;
  const touch = list => list.forEach(x => { if (x.id !== r.message_id) return; x.reactions = x.reactions.filter(y => !(y.user_id === r.user_id && y.emoji === r.emoji)); if (p.eventType === 'INSERT') x.reactions.push({ emoji: r.emoji, user_id: r.user_id }); });
  for (const c of S.msgs.values()) touch(c.list);
  if (S.thread) { touch(S.thread.replies); if (S.thread.parent) touch([S.thread.parent]); }
  renderMessages(); if (S.thread) renderThread();
}
function onChannelChange(p) {
  if (p.eventType === 'DELETE') { S.channels.delete(p.old.id); }
  else {
    const prev = S.channels.get(p.new.id); S.channels.set(p.new.id, p.new);
    const c = p.new;
    if (c.kind === 'dm' && isMember(c.id) && c.last_message_by && c.last_message_by !== S.uid && (!prev || ms(c.last_message_at) > ms(prev.last_message_at)) && (c.id !== S.cur || document.visibilityState !== 'visible')) ding('dm');
    if (c.archived && c.id === S.cur) { toast('This channel was archived.'); S.cur = null; routeFromHash(true); }
  }
  renderSidebar(); renderHeader(); updateTitle();
}
async function onMemberChange(p) {
  if (p.eventType === 'DELETE') { const o = p.old; const mm = S.members.get(o.channel_id); if (mm) mm.delete(o.user_id); const ch = S.channels.get(o.channel_id); if (o.user_id === S.uid && ch && ch.kind !== 'public') { S.channels.delete(o.channel_id); S.msgs.delete(o.channel_id); if (o.channel_id === S.cur) { closePanel(true); S.cur = null; routeFromHash(true); } } }
  else {
    addMemberRow(p.new);
    if (p.new.user_id === S.uid && !S.channels.has(p.new.channel_id)) { const { data } = await sb.from('channels').select('*').eq('id', p.new.channel_id).maybeSingle(); if (data) S.channels.set(data.id, data); const { data: ms2 } = await sb.from('channel_members').select('*').eq('channel_id', p.new.channel_id); (ms2 || []).forEach(addMemberRow); }
  }
  renderSidebar(); renderHeader(); if (S.panel && S.panel.kind === 'details') renderPanel();
}
function onProfileChange(p) {
  if (p.eventType === 'DELETE') { S.profiles.delete(p.old.id); }
  else {
    S.profiles.set(p.new.id, p.new);
    if (p.new.id === S.uid) { S.me = p.new; if (!p.new.approved) { renderPending(); return; } }
  }
  renderAll();
}
function onNotification(p) {
  const n = p.new; if (!n || S.notifs.some(x => x.id === n.id)) return;
  S.notifs.unshift(n);
  if (n.kind !== 'reaction') {
    ding('mention');
    const viewing = document.visibilityState === 'visible' && n.channel_id === S.cur && (!n.parent_id || (S.thread && S.thread.pid === n.parent_id));
    const c = S.channels.get(n.channel_id);
    if (!viewing) toast(`${nameOf(n.actor_id)} ${n.kind === 'mention' ? 'mentioned you' : 'replied to a thread'}${c ? ' in ' + (c.kind === 'dm' ? 'a direct message' : '#' + c.name) : ''}`);
  }
  renderSidebar(); if (S.panel && S.panel.kind === 'activity') renderPanel();
}

/* ================= messages loading ================= */
const PAGE = 50;
async function loadMessages(cid, older) {
  let c = S.msgs.get(cid); if (!c) { c = { list: [], hasMore: true, loaded: false, loading: false }; S.msgs.set(cid, c); }
  if (c.loading) return; c.loading = true;
  let q = sb.from('messages').select('*, reactions(emoji, user_id)').eq('channel_id', cid).is('parent_id', null).order('created_at', { ascending: false }).limit(PAGE);
  if (older && c.list.length) q = q.lt('created_at', c.list[0].created_at);
  const { data, error } = await q; c.loading = false;
  if (error) { toast("Couldn't load messages: " + errMsg(error)); c.loaded = true; renderMessages(); return; }
  const rows = (data || []).map(m => normMsg(m)).reverse();
  const ids = new Set(c.list.map(m => m.id));
  c.list = older ? [...rows.filter(m => !ids.has(m.id)), ...c.list] : [...rows, ...c.list.filter(m => !rows.some(r => r.id === m.id) && m.pendingLocal)];
  c.hasMore = (data || []).length === PAGE; c.loaded = true;
  if (cid === S.cur) { renderMessages(older); markRead(); }
}
let readT = null;
function markRead() {
  const c = S.channels.get(S.cur); const m = myMember(S.cur); if (!c || !m || document.visibilityState !== 'visible') return;
  if (c.last_message_at && ms(c.last_message_at) > ms(m.last_read_at)) {
    m.last_read_at = iso(); renderSidebar(); updateTitle();
    clearTimeout(readT); const cid = S.cur;
    readT = setTimeout(() => sb.from('channel_members').update({ last_read_at: iso() }).match({ channel_id: cid, user_id: S.uid }).then(() => {}), 800);
  }
}
document.addEventListener('visibilitychange', () => { if (S.booted) markRead(); });

/* ================= text formatting ================= */
const plain = s => String(s || '').replace(/<@([0-9a-f-]{36})>/g, (_, u) => '@' + nameOf(u));
function fmt(s) {
  let h = esc(s);
  const blocks = []; h = h.replace(/```([\s\S]*?)```/g, (_, c) => { blocks.push(c.replace(/^\n/, '')); return `\u0001B${blocks.length - 1}\u0001`; });
  const codes = []; h = h.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0001C${codes.length - 1}\u0001`; });
  h = h.replace(/&lt;@([0-9a-f-]{36})&gt;/g, (_, u) => `<span class="mention ${u === S.uid ? 'me' : ''}" data-act="profile" data-uid="${u}">@${esc(nameOf(u))}</span>`);
  h = h.replace(/(^|[\s(])#([a-z0-9][a-z0-9_-]{0,79})\b/g, (m, pre, n) => { const ch = [...S.channels.values()].find(c => c.kind !== 'dm' && c.name === n && !c.archived); return ch ? `${pre}<span class="chref" data-act="open" data-id="${ch.id}">#${n}</span>` : m; });
  h = h.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, u => `<a href="${esc(u.replace(/&amp;/g, '&'))}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  h = h.replace(/(^|[\s(>])\*([^*\n]+)\*(?=$|[\s).,!?:;<])/g, '$1<b>$2</b>');
  h = h.replace(/(^|[\s(>])_([^_\n]+)_(?=$|[\s).,!?:;<])/g, '$1<i>$2</i>');
  h = h.replace(/(^|[\s(>])~([^~\n]+)~(?=$|[\s).,!?:;<])/g, '$1<s>$2</s>');
  h = h.replace(/:([a-z0-9_+]{1,30}):/g, (m, k) => SHORT[k] || m);
  h = h.split('\n').map(l => l.startsWith('&gt; ') ? `<blockquote>${l.slice(5)}</blockquote>` : l).join('\n').replace(/\n/g, '<br>').replace(/<\/blockquote><br>/g, '</blockquote>');
  return h.replace(/\u0001C(\d+)\u0001/g, (_, i) => `<code>${codes[i]}</code>`).replace(/\u0001B(\d+)\u0001/g, (_, i) => `<pre>${blocks[i]}</pre>`);
}

/* ================= attachments ================= */
const urlCache = new Map(); // path -> {url, exp}
const BUCKET = 'attachments';
function attHTML(atts) {
  if (!Array.isArray(atts) || !atts.length) return '';
  return `<div class="atts">${atts.slice(0, 5).filter(a => a && typeof a.path === 'string').map(a => {
    const t = String(a.type || ''), n = esc(String(a.name || 'file').slice(0, 120)), p = esc(a.path);
    if (t.startsWith('image/') && t !== 'image/svg+xml') return `<button class="att-img" data-act="lightbox" data-path="${p}" data-name="${n}" title="${n}"><img data-path="${p}" alt="${n}"></button>`;
    if (t.startsWith('video/')) return `<video class="att-vid" data-path="${p}" controls preload="metadata"></video>`;
    const ext = (String(a.name || '').split('.').pop() || 'file').slice(0, 4).toUpperCase();
    const col = t === 'application/pdf' ? '#c0392b' : /sheet|excel|csv/.test(t) ? '#2f7d4a' : /word|document/.test(t) ? '#1f6fb2' : /zip|compressed/.test(t) ? '#8a6d00' : '#5b6672';
    return `<a class="att-file" data-path="${p}" data-dl="1" target="_blank" rel="noopener noreferrer"><span class="ic" style="background:${col}">${esc(ext)}</span><span><b>${n}</b><small>${typeof a.size === 'number' ? fmtSize(a.size) + ' · ' : ''}Download ↓</small></span></a>`;
  }).join('')}</div>`;
}
async function signedUrls(paths, download) {
  const now = Date.now(); const key = p => (download ? 'dl:' : '') + p;
  const need = [...new Set(paths)].filter(p => { const c = urlCache.get(key(p)); return !c || c.exp < now; });
  if (need.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600, download ? { download: true } : undefined);
    (data || []).forEach(d => { if (d.signedUrl) urlCache.set(key(d.path), { url: d.signedUrl, exp: now + 50 * 60e3 }); });
  }
  return p => (urlCache.get(key(p)) || {}).url;
}
async function hydrateMedia(container) {
  if (!container) return;
  const media = [...container.querySelectorAll('img[data-path]:not([src]), video[data-path]:not([src])')];
  const files = [...container.querySelectorAll('a[data-dl]:not([href])')];
  try {
    if (media.length) { const get = await signedUrls(media.map(e => e.dataset.path)); media.forEach(e => { const u = get(e.dataset.path); if (u) e.src = u; else markBroken(e); }); }
    if (files.length) { const get = await signedUrls(files.map(e => e.dataset.path), true); files.forEach(e => { const u = get(e.dataset.path); if (u) e.href = u; }); }
  } catch (e) {}
}
function markBroken(img) { const b = img.closest('.att-img'); if (b) { b.classList.add('broken'); b.textContent = '🖼 File unavailable'; } }
document.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.closest && t.closest('.att-img')) markBroken(t); }, true);
const safeName = n => (String(n || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+/, '') || 'file').slice(-100);

/* ================= shell rendering ================= */
function renderShell() {
  root.innerHTML = `<div class="app" id="app">
    <header class="topbar"><button class="burger" data-act="toggleSide" aria-label="Menu">☰</button>
      <form class="search" id="searchForm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="searchInput" placeholder="Search messages" autocomplete="off"></form>
      <div class="top-right"><span class="kbd-hint">Ctrl/⌘ K to jump</span></div></header>
    <div class="main" id="main">
      <aside class="sidebar"><div class="ws-head"><button class="ws-name" data-act="wsMenu"><span id="wsName"></span> ▾</button><button class="icon-btn" data-act="newDM" title="New message">✎</button></div>
        <div class="side-scroll" id="sideList"></div><div class="side-foot" id="sideFoot"></div></aside>
      <section class="content" id="content"></section>
      <aside class="panel" id="panel" hidden><div class="panel-head" id="panelHead"></div><div class="panel-body" id="panelBody"></div><div id="panelComposer"></div></aside>
    </div><div class="scrim" data-act="toggleSide"></div></div>`;
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); runSearch($('#searchInput').value); $('#searchInput').blur(); });
  renderWsName(); renderAll();
}
function renderWsName() { const el = $('#wsName'); if (el) el.textContent = S.ws.name; updateTitle(); }
const unreadNotifs = () => S.notifs.filter(n => !n.read).length;
function updateTitle() { const n = unreadNotifs() + sidebarDMs().filter(isUnread).length; document.title = (n ? `(${n}) ` : '') + S.ws.name + ' — Threadline'; }
function renderAll() { if (!S.booted && !$('#app')) return; renderSidebar(); renderFoot(); renderContent(); if (S.panel) renderPanel(); }

function renderSidebar() {
  const el = $('#sideList'); if (!el) return;
  const chs = sidebarChannels(), dms = sidebarDMs(); const starred = [...chs, ...dms].filter(c => myMember(c.id) && myMember(c.id).starred);
  const pending = isAdmin() ? [...S.profiles.values()].filter(p => !p.approved).length : 0;
  const item = c => {
    const unread = isUnread(c);
    if (c.kind === 'dm') { const o = dmOther(c.id); return `<button class="item ${c.id === S.cur ? 'sel' : ''} ${unread ? 'unread' : ''}" data-act="open" data-id="${c.id}">${avatar(o, 'sm')}<span class="lbl">${esc(chLabel(c))}</span>${statusOf(o).e ? `<span>${esc(statusOf(o).e)}</span>` : ''}<span class="dot ${isOnline(o) ? 'on' : ''}"></span>${unread ? '<span class="badge">●</span>' : ''}</button>`; }
    return `<button class="item ${c.id === S.cur ? 'sel' : ''} ${unread ? 'unread' : ''}" data-act="open" data-id="${c.id}"><span class="hash">${c.kind === 'private' ? '🔒' : '#'}</span><span class="lbl">${esc(c.name)}</span></button>`;
  };
  const nAct = unreadNotifs();
  el.innerHTML = `<button class="item ${S.panel && S.panel.kind === 'activity' ? 'sel' : ''} ${nAct ? 'unread' : ''}" data-act="activity"><span class="hash">🔔</span><span class="lbl">Activity</span>${nAct ? `<span class="badge">${nAct > 99 ? '99+' : nAct}</span>` : ''}</button>` +
    (isAdmin() ? `<button class="item ${pending ? 'unread' : ''}" data-act="people"><span class="hash">👥</span><span class="lbl">People${pending ? ' · approvals' : ''}</span>${pending ? `<span class="badge">${pending}</span>` : ''}</button>` : '') +
    (starred.length ? `<div class="sec"><div class="sec-head"><span>★ Starred</span></div>${starred.map(item).join('')}</div>` : '') +
    `<div class="sec"><div class="sec-head"><span>Channels</span><button class="icon-btn" data-act="chMenu" title="Add channels">＋</button></div>${chs.filter(c => !myMember(c.id).starred).map(item).join('')}<button class="item add" data-act="browse"><span class="hash">＋</span><span class="lbl">Browse channels</span></button></div>
     <div class="sec"><div class="sec-head"><span>Direct messages</span><button class="icon-btn" data-act="newDM" title="New message">＋</button></div>${dms.filter(c => !myMember(c.id).starred).map(item).join('')}<button class="item add" data-act="newDM"><span class="hash">＋</span><span class="lbl">Message a teammate</span></button></div>`;
  updateTitle();
}
function renderFoot() {
  const el = $('#sideFoot'); if (!el) return; const st = statusOf(S.uid);
  el.innerHTML = `${avatar(S.uid, 'md', true)}<div class="who"><b>${esc(nameOf(S.uid))}</b><small>${st.e || st.t ? esc((st.e + ' ' + st.t).trim()) : (isAdmin() ? 'Admin' : 'Active')}</small></div><button class="icon-btn" data-act="account" title="Account">⚙</button>`;
}

let mainComposer = null;
function renderContent() {
  const el = $('#content'); if (!el) return;
  const c = S.channels.get(S.cur);
  if (!c) { el.innerHTML = `<div class="loading"><h2 style="margin:0">Welcome to ${esc(S.ws.name)}</h2><p style="margin:0">Pick a channel on the left, or create one.</p><div style="display:flex;gap:8px"><button class="btn primary" data-act="createCh">Create a channel</button><button class="btn" data-act="newDM">Message a teammate</button></div></div>`; mainComposer = null; return; }
  el.innerHTML = `<div class="ch-head" id="chHead"></div><div class="offline" id="offlineBar" ${S.online ? 'hidden' : ''}>Reconnecting… new messages will appear once you're back online.</div><div class="msgs" id="msgs"></div><div class="composer-wrap" id="mainComposerWrap"></div>`;
  renderHeader(); renderMessages();
  const canPost = isMember(c.id) && !c.archived;
  if (canPost) mainComposer = makeComposer($('#mainComposerWrap'), { placeholder: c.kind === 'dm' ? 'Message ' + chLabel(c) : 'Message #' + c.name, typingKey: c.id, channelId: c.id, onSend: (t, mn, f) => sendMessage(t, mn, null, f), main: true });
  else { $('#mainComposerWrap').innerHTML = `<div class="typing"></div><div class="readonly">You're viewing <b>#${esc(c.name)}</b>. <button class="btn primary" data-act="join" data-id="${c.id}" style="margin-left:8px">Join channel</button></div>`; mainComposer = null; }
  renderTyping();
}
function renderHeader() {
  const el = $('#chHead'); const c = S.channels.get(S.cur); if (!el || !c) return;
  const m = myMember(c.id); const starOn = m && m.starred;
  const star = m ? `<button class="icon-btn star ${starOn ? 'on' : ''}" data-act="star" title="${starOn ? 'Unstar' : 'Star'}">${starOn ? '★' : '☆'}</button>` : '';
  const pins = (S.msgs.get(c.id) || { list: [] }).list.filter(x => x.pinned && !x.deleted_at).length;
  if (c.kind === 'dm') {
    const o = dmOther(c.id); const st = statusOf(o);
    el.innerHTML = `<button class="ch-title" data-act="profile" data-uid="${o}">${avatar(o, 'sm')} ${esc(chLabel(c))} <span class="dot ${isOnline(o) ? 'on' : ''}" style="border-color:#fff"></span></button>${star}<span class="ch-topic">${esc((st.e + ' ' + st.t).trim())}</span><div class="ch-actions"><button class="pill" data-act="pins" title="Pinned messages">📌 ${pins}</button></div>`;
  } else {
    el.innerHTML = `<button class="ch-title" data-act="details">${c.kind === 'private' ? '🔒' : '#'} ${esc(c.name)} ▾</button>${star}<button class="ch-topic" data-act="editTopic" title="Edit topic">${c.topic ? esc(c.topic) : '<span style="color:var(--text-3)">Add a topic</span>'}</button><div class="ch-actions"><button class="pill" data-act="details" title="Members">👥 ${memberIds(c.id).length}</button><button class="pill" data-act="pins" title="Pinned messages">📌 ${pins}</button><button class="icon-btn" data-act="details" title="Channel details">ⓘ</button></div>`;
  }
}

function msgHTML(m, prev, ctx) {
  const sameDay = prev && new Date(ms(prev.created_at)).toDateString() === new Date(ms(m.created_at)).toDateString();
  const compact = prev && sameDay && prev.user_id === m.user_id && ms(m.created_at) - ms(prev.created_at) < 5 * 60e3 && !prev.deleted_at && !m.pinned && !prev.pinned;
  const mine = m.user_id === S.uid; const canDel = mine || isAdmin();
  const mentionsMe = !mine && Array.isArray(m.mentions) && m.mentions.includes(S.uid);
  const editing = S.editing && S.editing.id === m.id; const st = statusOf(m.user_id);
  const canAct = !m.pendingLocal && !m.deleted_at && !editing && isMember(m.channel_id);
  let body;
  if (m.deleted_at) body = `<div class="text deleted">This message was deleted.</div>`;
  else if (editing) body = `<div class="edit-box"><textarea data-edit="1" rows="2">${esc(S.editing.text)}</textarea><div class="row"><button class="btn" data-act="cancelEdit">Cancel</button><button class="btn primary" data-act="saveEdit">Save</button></div></div>`;
  else body = (m.body ? `<div class="text">${fmt(m.body)}${m.edited_at ? ' <span class="edited">(edited)</span>' : ''}</div>` : '') + attHTML(m.attachments);
  let reacts = '';
  if (!m.deleted_at && m.reactions && m.reactions.length) {
    const g = new Map(); m.reactions.forEach(r => { if (!g.has(r.emoji)) g.set(r.emoji, []); g.get(r.emoji).push(r.user_id); });
    reacts = `<div class="reacts">${[...g].map(([e, us]) => `<button class="react ${us.includes(S.uid) ? 'mine' : ''}" ${canAct ? `data-act="toggleReact" data-emoji="${esc(e)}" data-id="${m.id}"` : ''} title="${esc(us.map(nameOf).join(', '))}">${esc(e)} <b>${us.length}</b></button>`).join('')}${canAct ? `<button class="react add" data-act="reactPick" data-id="${m.id}" title="Add reaction">☺＋</button>` : ''}</div>`;
  }
  let thread = '';
  if (!ctx.inThread && m.reply_count > 0) thread = `<button class="thread-sum" data-act="thread" data-id="${m.id}">${(m.reply_users || []).slice(0, 4).map(u => avatar(u, 'sm')).join('')}<b>${m.reply_count} ${m.reply_count === 1 ? 'reply' : 'replies'}</b><span>Last reply ${esc(fmtWhen(m.last_reply_at || m.created_at))}</span></button>`;
  const actions = canAct ? `<div class="actions">${QUICK.map(e => `<button data-act="toggleReact" data-emoji="${e}" data-id="${m.id}" title="React ${e}">${e}</button>`).join('')}<button data-act="reactPick" data-id="${m.id}" title="Add reaction">☺</button>${ctx.inThread ? '' : `<button data-act="thread" data-id="${m.id}" title="Reply in thread">💬</button>`}<button data-act="msgMenu" data-id="${m.id}" data-del="${canDel ? 1 : 0}" title="More actions">⋯</button></div>` : '';
  const head = compact ? `<div class="gutter"><span class="t">${esc(fmtTime(m.created_at))}</span></div>` : `<div class="gutter" data-act="profile" data-uid="${m.user_id}" style="cursor:pointer">${avatar(m.user_id)}</div>`;
  const meta = compact ? '' : `<div class="meta"><span class="name" data-act="profile" data-uid="${m.user_id}">${esc(nameOf(m.user_id))}</span>${st.e ? `<span class="status-e" title="${esc(st.t)}">${esc(st.e)}</span>` : ''}<span class="time" title="${esc(new Date(ms(m.created_at)).toLocaleString())}">${esc(fmtTime(m.created_at))}</span></div>`;
  return `<div class="msg ${compact ? 'compact' : ''} ${m.pinned && !m.deleted_at ? 'pinned' : ''} ${mentionsMe ? 'mentions-me' : ''} ${m.pendingLocal ? 'pending' : ''}" id="m-${m.id}">${head}<div class="body">${m.pinned && !m.deleted_at ? `<div class="pin-tag">📌 Pinned${m.pinned_by ? ' by ' + esc(nameOf(m.pinned_by)) : ''}</div>` : ''}${meta}${body}${reacts}${thread}</div>${actions}</div>`;
}
function listHTML(msgs, ctx) {
  let out = '', prev = null;
  for (const m of msgs) {
    if (m.deleted_at && !(m.reply_count > 0)) continue;
    if (!ctx.inThread && (!prev || new Date(ms(prev.created_at)).toDateString() !== new Date(ms(m.created_at)).toDateString())) { out += `<div class="day-div"><span>${esc(fmtDay(m.created_at))}</span></div>`; prev = null; }
    out += msgHTML(m, prev, ctx); prev = m;
  }
  return out;
}
function renderMessages(keepOlderPos) {
  const el = $('#msgs'); const c = S.channels.get(S.cur); if (!el || !c) return;
  const store = S.msgs.get(c.id);
  if (!store || !store.loaded) { el.innerHTML = `<div class="loading">Loading messages…</div>`; return; }
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80 || !el.dataset.ready;
  const prevH = el.scrollHeight, prevTop = el.scrollTop;
  const intro = c.kind === 'dm'
    ? `<div class="intro">${avatar(dmOther(c.id), 'lg')}<h2 style="margin-top:12px">${esc(chLabel(c))}</h2><p>${dmOther(c.id) === S.uid ? 'This is your space. Draft messages, keep notes, or save links for later.' : `This is the beginning of your private conversation with <b>${esc(nameOf(dmOther(c.id)))}</b>. Only the two of you can see it.`}</p></div>`
    : `<div class="intro"><h2>${c.kind === 'private' ? '🔒' : '#'} ${esc(c.name)}</h2><p>${c.description ? esc(c.description) : `This is the very beginning of the <b>#${esc(c.name)}</b> channel.`}${c.kind === 'private' ? ' Only invited members can see this channel.' : ''}</p><div class="row">${isMember(c.id) ? `<button class="btn" data-act="addPeople">＋ Add people</button>` : ''}<button class="btn" data-act="details">👥 Members</button></div></div>`;
  el.innerHTML = (store.hasMore ? `<div class="load-older"><button class="btn" data-act="older">Load older messages</button></div>` : intro) + listHTML(store.list, { inThread: false });
  el.dataset.ready = '1';
  if (S.jumpTo) {
    const t = document.getElementById('m-' + S.jumpTo);
    if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); S.jumpTo = null; if (S.jumpThread) { const tp = S.jumpThread; S.jumpThread = null; setTimeout(() => openThread(tp), 0); } }
    else if (store.hasMore && store.list.length < 1000) { loadMessages(c.id, true); }
    else { S.jumpTo = null; S.jumpThread = null; toast('That message could not be found.'); }
  } else if (keepOlderPos) el.scrollTop = el.scrollHeight - prevH + prevTop;
  else if (atBottom) el.scrollTop = el.scrollHeight; else el.scrollTop = prevTop;
  if (S.editing) { const ta = el.querySelector('textarea[data-edit]'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
  hydrateMedia(el); renderHeader();
}
function renderTyping() {
  const who = key => Object.entries(S.presence).filter(([u, arr]) => u !== S.uid && arr.some(x => x.typing === key && Date.now() - (x.ts || 0) < 8000)).map(([u]) => nameOf(u));
  const line = n => n.length ? (n.length > 2 ? 'Several people are typing…' : n.join(' and ') + (n.length > 1 ? ' are' : ' is') + ' typing…') : '';
  const el = $('#mainComposerWrap .typing'); if (el) el.textContent = line(who(S.cur));
  if (S.thread) { const te = $('#panelComposer .typing'); if (te) te.textContent = line(who('t:' + S.thread.pid)); }
}
setInterval(() => { if (S.booted) renderTyping(); }, 4000);

/* ================= composer ================= */
function makeComposer(wrap, opts) {
  wrap.innerHTML = `<div class="typing"></div><div class="composer"><div class="tools"><button data-f="b" title="Bold"><b>B</b></button><button data-f="i" title="Italic"><i>I</i></button><button data-f="s" title="Strikethrough"><s>S</s></button><button data-f="c" title="Code" style="font-family:var(--mono)">&lt;/&gt;</button><button data-f="pre" title="Code block" style="font-family:var(--mono)">{ }</button><button data-f="q" title="Quote">❝</button><button data-f="at" title="Mention someone">@</button><button data-f="emoji" title="Emoji">☺</button><button data-f="file" title="Attach files">📎</button><input type="file" multiple hidden></div><div class="chips"></div><textarea rows="1"></textarea><div class="foot"><span class="hint"><b>Enter</b> to send · <b>Shift+Enter</b> new line</span><button class="send" disabled title="Send">Send ➤</button></div></div>`;
  const ta = wrap.querySelector('textarea'), send = wrap.querySelector('.send'), chipsEl = wrap.querySelector('.chips'), box = wrap.querySelector('.composer'), fileInput = wrap.querySelector('input[type=file]');
  ta.placeholder = opts.placeholder;
  const mmap = new Map(); const files = []; let ac = null, acSel = 0;
  const draftKey = 'tl-draft-' + opts.typingKey;
  try { const d = localStorage.getItem(draftKey); if (d) ta.value = d; } catch (e) {}
  const uploading = () => files.some(f => f.status === 'up');
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; send.disabled = uploading() || (!ta.value.trim() && !files.length); };
  const drawChips = () => { chipsEl.innerHTML = files.map(f => `<div class="chip ${f.status}" title="${esc(f.name)} · ${fmtSize(f.size)}"><span>${f.type.startsWith('image/') ? '🖼' : f.type.startsWith('video/') ? '🎬' : '📄'} ${esc(f.name)}</span><button data-k="${f.key}" title="Remove">✕</button></div>`).join(''); autosize(); };
  autosize();
  chipsEl.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; const i = files.findIndex(f => f.key === b.dataset.k); if (i < 0) return; const [f] = files.splice(i, 1); if (f.path) sb.storage.from(BUCKET).remove([f.path]).catch(() => {}); drawChips(); });
  async function addFiles(list) {
    for (const file of [...list]) {
      if (files.length >= 5) { toast('Up to 5 files per message.'); break; }
      if (file.size > MAX_FILE) { toast(`${file.name} is too big (25 MB max).`); continue; }
      const name = (file.name && file.name !== 'image.png') ? file.name : 'pasted-image-' + new Date().toISOString().slice(11, 19).replace(/:/g, '') + '.png';
      const it = { key: crypto.randomUUID(), name, type: file.type || 'application/octet-stream', size: file.size, status: 'up' }; files.push(it); drawChips();
      const path = `${opts.channelId}/${crypto.randomUUID()}/${safeName(name)}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: it.type, upsert: false });
      if (error) { toast(`Couldn't upload ${name}: ${errMsg(error)}`); files.splice(files.indexOf(it), 1); } else { it.path = path; it.status = 'ok'; }
      drawChips();
    }
  }
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; ta.focus(); });
  ta.addEventListener('paste', e => { const fl = e.clipboardData && e.clipboardData.files; if (fl && fl.length) { e.preventDefault(); addFiles(fl); } });
  box.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); box.classList.add('drag'); } });
  box.addEventListener('dragleave', () => box.classList.remove('drag'));
  box.addEventListener('drop', e => { box.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
  const insert = (before, after = '', ph = '') => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || ph; ta.setRangeText(before + sel + after, s, e, 'end'); if (sel === ph) { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; } ta.focus(); autosize(); };
  wrap.querySelector('.tools').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return; const f = b.dataset.f;
    if (f === 'b') insert('*', '*', 'bold'); else if (f === 'i') insert('_', '_', 'italic'); else if (f === 's') insert('~', '~', 'strike');
    else if (f === 'c') insert('`', '`', 'code'); else if (f === 'pre') insert('```\n', '\n```', 'code'); else if (f === 'q') insert('> ', '', 'quote');
    else if (f === 'at') { insert('@'); showAC(); } else if (f === 'file') fileInput.click();
    else if (f === 'emoji') emojiPicker(b, e => { ta.focus(); ta.setRangeText(e, ta.selectionStart, ta.selectionEnd, 'end'); autosize(); });
  });
  const candidates = q => approvedPeople().filter(p => p.display_name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.display_name.localeCompare(b.display_name)).slice(0, 8);
  const hideAC = () => { if (ac) { ac.remove(); ac = null; } };
  function showAC() {
    const m = ta.value.slice(0, ta.selectionStart).match(/(^|\s)@([^\s@]{0,24})$/); if (!m) return hideAC();
    const list = candidates(m[2]); if (!list.length) return hideAC();
    if (!ac) { ac = document.createElement('div'); ac.className = 'ac'; wrap.appendChild(ac); ac.addEventListener('mousedown', e => { e.preventDefault(); const b = e.target.closest('button'); if (b) pick(b.dataset.uid); }); }
    acSel = Math.min(acSel, list.length - 1);
    ac.innerHTML = list.map((p, i) => `<button class="${i === acSel ? 'sel' : ''}" data-uid="${p.id}">${avatar(p.id, 'sm', true)} ${esc(p.display_name)}${p.id === S.uid ? ' <small>(you)</small>' : ''}</button>`).join('');
  }
  function pick(uid) { const name = nameOf(uid); const pos = ta.selectionStart; const m = ta.value.slice(0, pos).match(/@([^\s@]{0,24})$/); ta.setRangeText('@' + name + ' ', pos - (m ? m[0].length : 0), pos, 'end'); mmap.set(name, uid); hideAC(); autosize(); ta.focus(); }
  ta.addEventListener('input', () => { autosize(); showAC(); try { if (ta.value) localStorage.setItem(draftKey, ta.value); else localStorage.removeItem(draftKey); } catch (e) {} sendTyping(opts.typingKey); });
  ta.addEventListener('keydown', e => {
    if (ac) { const n = ac.children.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); acSel = (acSel + 1) % n; showAC(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acSel = (acSel - 1 + n) % n; showAC(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const b = ac.children[acSel]; if (b) pick(b.dataset.uid); return; }
      if (e.key === 'Escape') { hideAC(); return; } }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); }
    else if (e.key === 'ArrowUp' && !ta.value && opts.main) { const own = ((S.msgs.get(S.cur) || {}).list || []).filter(m => m.user_id === S.uid && !m.deleted_at && !m.pendingLocal).pop(); if (own) { e.preventDefault(); startEdit(own.id); } }
  });
  ta.addEventListener('blur', () => setTimeout(hideAC, 150));
  send.addEventListener('click', doSend);
  function doSend() {
    if (uploading()) { toast('Wait for uploads to finish.'); return; }
    let text = ta.value.trim(); if (!text && !files.length) return;
    const mn = []; [...mmap].sort((a, b) => b[0].length - a[0].length).forEach(([n, u]) => { if (text.includes('@' + n)) { text = text.split('@' + n).join(`<@${u}>`); mn.push(u); } });
    const att = files.filter(f => f.path).map(f => ({ path: f.path, name: f.name, type: f.type, size: f.size }));
    const original = ta.value, keep = files.slice();
    ta.value = ''; files.length = 0; drawChips(); mmap.clear(); hideAC(); stopTyping();
    try { localStorage.removeItem(draftKey); } catch (e) {}
    Promise.resolve(opts.onSend(text, mn, att)).catch(() => { if (!ta.value) ta.value = original; if (!files.length) files.push(...keep); drawChips(); });
  }
  return { focus: () => { if (window.innerWidth > 760) ta.focus(); } };
}

/* ================= actions ================= */
async function sendMessage(text, mentions, parentId, attachments) {
  const cid = S.cur; if (!cid) return;
  if (text.length > 8000) { toast('That message is too long (8,000 characters max).'); throw new Error('long'); }
  const tmp = { id: 'tmp-' + crypto.randomUUID(), channel_id: cid, user_id: S.uid, parent_id: parentId, body: text, mentions, attachments: attachments || [], reactions: [], reply_count: 0, created_at: iso(), pendingLocal: true };
  const listRef = parentId ? (S.thread ? S.thread.replies : null) : (S.msgs.get(cid) || {}).list;
  if (listRef) { listRef.push(tmp); parentId ? renderThread() : renderMessages(); const el = parentId ? $('#panelBody') : $('#msgs'); if (el) el.scrollTop = el.scrollHeight; }
  const { data, error } = await sb.from('messages').insert({ channel_id: cid, parent_id: parentId, body: text, mentions, attachments: attachments || [] }).select('*').single();
  if (listRef) { const i = listRef.indexOf(tmp); if (i >= 0) listRef.splice(i, 1); if (data && !listRef.some(m => m.id === data.id)) listRef.push(normMsg(data)); listRef.sort((a, b) => ms(a.created_at) - ms(b.created_at)); }
  parentId ? renderThread() : renderMessages();
  if (error) { toast("Couldn't send: " + errMsg(error)); throw error; }
}
async function toggleReact(id, emoji) {
  const m = findMsg(id); if (!m) return; const on = m.reactions.some(r => r.user_id === S.uid && r.emoji === emoji);
  onReactionChange({ eventType: on ? 'DELETE' : 'INSERT', new: { message_id: id, user_id: S.uid, emoji }, old: { message_id: id, user_id: S.uid, emoji } });
  const { error } = on ? await sb.from('reactions').delete().match({ message_id: id, user_id: S.uid, emoji }) : await sb.from('reactions').insert({ message_id: id, emoji });
  if (error && !/duplicate/i.test(errMsg(error))) { toast("Couldn't update reaction"); onReactionChange({ eventType: on ? 'INSERT' : 'DELETE', new: { message_id: id, user_id: S.uid, emoji }, old: { message_id: id, user_id: S.uid, emoji } }); }
}
function startEdit(id) { const m = findMsg(id); if (!m) return; S.editing = { id, text: plain(m.body), map: new Map((m.mentions || []).map(u => [nameOf(u), u])) }; renderMessages(); if (S.thread) renderThread(); }
async function saveEdit() {
  const ed = S.editing; if (!ed) return; const m = findMsg(ed.id); let text = ed.text.trim();
  if (!text && !(m && m.attachments && m.attachments.length)) return;
  const mn = []; [...ed.map].sort((a, b) => b[0].length - a[0].length).forEach(([n, u]) => { if (text.includes('@' + n)) { text = text.split('@' + n).join(`<@${u}>`); mn.push(u); } });
  S.editing = null; renderMessages(); if (S.thread) renderThread();
  const { error } = await sb.from('messages').update({ body: text, mentions: mn }).eq('id', ed.id);
  if (error) toast("Couldn't save: " + errMsg(error));
}
function deleteMsg(id) {
  const m = findMsg(id); const n = m && m.attachments ? m.attachments.length : 0;
  confirmModal('Delete message', `Are you sure you want to delete this message${n ? ' and its attachments' : ''}? This can't be undone.`, 'Delete', async () => {
    const { data, error } = await sb.rpc('delete_message', { p_message: id });
    if (error) { toast("Couldn't delete: " + errMsg(error)); return; }
    const paths = (Array.isArray(data) ? data : []).map(a => a && a.path).filter(Boolean);
    if (paths.length) sb.storage.from(BUCKET).remove(paths).catch(() => {});
  });
}
async function togglePin(id) { const { error } = await sb.rpc('toggle_pin', { p_message: id }); if (error) toast("Couldn't pin: " + errMsg(error)); }

/* ================= routing ================= */
function routeFromHash(fallback) {
  const h = location.hash.slice(1);
  if (h && S.channels.has(h)) { if (h !== S.cur) openChannel(h); return; }
  if (!fallback) return;
  const gen = sidebarChannels().find(c => c.name === 'general') || sidebarChannels()[0] || sidebarDMs()[0];
  if (gen) openChannel(gen.id); else { S.cur = null; renderAll(); }
}
window.addEventListener('hashchange', () => { if (S.booted) routeFromHash(false); });
function openChannel(id) {
  if (!S.channels.has(id)) return;
  S.cur = id; S.editing = null;
  if (location.hash.slice(1) !== id) { try { history.replaceState(null, '', '#' + id); } catch (e) { location.hash = id; } }
  if (S.thread && S.thread.cid !== id) closePanel(true);
  if (S.panel && (S.panel.kind === 'details' || S.panel.kind === 'pins')) S.panel = { kind: S.panel.kind };
  const app = $('#app'); if (app) app.classList.remove('side-open');
  renderAll();
  const store = S.msgs.get(id); if (!store || !store.loaded) loadMessages(id); else markRead();
  if (S.panel && S.panel.kind === 'pins') loadPins();
  setTimeout(() => mainComposer && mainComposer.focus(), 0);
}

/* ================= panel ================= */
function openPanel(p) { S.panel = p; $('#panel').hidden = false; $('#main').classList.add('with-panel'); renderPanel(); }
function closePanel(silent) { S.thread = null; S.panel = null; const pn = $('#panel'); if (pn) { pn.hidden = true; $('#main').classList.remove('with-panel'); $('#panelComposer').innerHTML = ''; } if (!silent) { renderMessages(); renderSidebar(); } }
const personRow = (u, extra = '') => { const st = statusOf(u); return `<button class="person" data-act="profile" data-uid="${u}">${avatar(u, 'md', true)}<span class="nm">${esc(nameOf(u))}${u === S.uid ? ' <small>(you)</small>' : ''}${st.e ? ' ' + esc(st.e) : ''}${extra}</span></button>`; };
function renderPanel() {
  const p = S.panel; if (!p || !$('#panel')) return;
  const head = $('#panelHead'), body = $('#panelBody'); const close = `<button class="icon-btn" data-act="closePanel" title="Close">✕</button>`;
  if (p.kind === 'thread') return renderThread();
  $('#panelComposer').innerHTML = '';
  if (p.kind === 'details') {
    const c = S.channels.get(S.cur); if (!c) return closePanel();
    if (c.kind === 'dm') { S.panel = { kind: 'profile', uid: dmOther(c.id) }; return renderPanel(); }
    const ids = memberIds(c.id).sort((a, b) => nameOf(a).localeCompare(nameOf(b))); const mine = isMember(c.id);
    head.innerHTML = `<h3>${c.kind === 'private' ? '🔒' : '#'} ${esc(c.name)}</h3>${close}`;
    body.innerHTML = `<div class="sect"><h4>Topic ${mine ? '<button class="link-btn" data-act="editTopic">Edit</button>' : ''}</h4><p>${c.topic ? esc(c.topic) : '<span style="color:var(--text-3)">No topic yet</span>'}</p></div>
      <div class="sect"><h4>Description ${mine ? '<button class="link-btn" data-act="editDesc">Edit</button>' : ''}</h4><p>${c.description ? esc(c.description) : '<span style="color:var(--text-3)">No description</span>'}</p></div>
      <div class="sect"><h4>Created</h4><p>${c.created_by ? 'By ' + esc(nameOf(c.created_by)) + ' · ' : ''}${esc(new Date(ms(c.created_at)).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }))}${c.kind === 'private' ? ' · Private' : ''}</p></div>
      <div class="sect" style="padding-bottom:6px"><h4>${ids.length} member${ids.length === 1 ? '' : 's'} ${mine ? '<button class="link-btn" data-act="addPeople">＋ Add people</button>' : ''}</h4></div>
      ${ids.map(u => personRow(u)).join('') || '<div class="empty">No members yet</div>'}
      <div class="sect" style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);border-bottom:0">
        ${c.auto_join ? '' : (mine ? `<button class="btn danger" data-act="leave" data-id="${c.id}">Leave channel</button>` : (c.kind === 'public' ? `<button class="btn primary" data-act="join" data-id="${c.id}">Join channel</button>` : ''))}
        ${isAdmin() || c.created_by === S.uid ? `<button class="btn danger" data-act="archive">Archive channel</button>` : ''}</div>`;
  } else if (p.kind === 'pins') {
    head.innerHTML = `<h3>Pinned messages <small>${p.items ? p.items.length : ''}</small></h3>${close}`;
    if (!p.items) { body.innerHTML = '<div class="empty">Loading…</div>'; loadPins(); return; }
    body.innerHTML = p.items.length ? p.items.map(m => `<div class="result" data-act="jump" data-cid="${m.channel_id}" data-id="${m.id}"><div class="where">${esc(nameOf(m.user_id))} · ${esc(fmtWhen(m.created_at))}</div><div class="text">${fmt(m.body) || '📎 ' + esc((m.attachments || []).map(a => a.name).join(', '))}</div></div>`).join('') : `<div class="empty">No pinned messages yet.<br>Hover over a message and choose ⋯ → Pin to keep it handy here.</div>`;
  } else if (p.kind === 'search') {
    head.innerHTML = `<h3>Search <small>“${esc(p.q)}”</small></h3>${close}`;
    if (p.loading) { body.innerHTML = '<div class="empty">Searching…</div>'; return; }
    const re = new RegExp('(' + p.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    body.innerHTML = p.results.length ? `<div class="reply-count">${p.results.length}${p.results.length >= 100 ? '+' : ''} result${p.results.length === 1 ? '' : 's'}</div>` + p.results.map(r => { const c = S.channels.get(r.channel_id); const where = c ? (c.kind === 'dm' ? chLabel(c) : '#' + c.name) : ''; return `<div class="result" data-act="jump" data-cid="${r.channel_id}" data-id="${r.parent_id || r.id}" ${r.parent_id ? `data-pid="${r.parent_id}"` : ''}><div class="where"><b>${esc(where)}</b>${r.parent_id ? ' · in thread' : ''} · ${esc(nameOf(r.user_id))} · ${esc(fmtWhen(r.created_at))}</div><div class="text">${esc(plain(r.body)).replace(re, '<mark>$1</mark>')}</div></div>`; }).join('') : `<div class="empty">No messages match “${esc(p.q)}”.</div>`;
  } else if (p.kind === 'profile') {
    const u = p.uid; const pr = S.profiles.get(u) || {}; const st = statusOf(u);
    head.innerHTML = `<h3>Profile</h3>${close}`;
    body.innerHTML = `<div class="profile">${avatar(u, 'lg', true)}<h2>${esc(nameOf(u))}${u === S.uid ? ' <small style="font-weight:400;color:var(--text-3)">(you)</small>' : ''}</h2><div class="st">${isOnline(u) ? '🟢 Active now' : 'Away'}${pr.role === 'admin' ? ' · Admin' : ''}</div>${st.e || st.t ? `<p style="margin-top:10px">${esc(st.e)} ${esc(st.t)}</p>` : ''}${pr.created_at ? `<p class="st" style="font-size:13px">Joined ${esc(new Date(ms(pr.created_at)).toLocaleDateString([], { month: 'long', year: 'numeric' }))}</p>` : ''}<div style="margin-top:16px;display:flex;gap:8px;justify-content:center">${u === S.uid ? `<button class="btn" data-act="status">Set a status</button>` : ''}${pr.approved ? `<button class="btn primary" data-act="dm" data-uid="${u}">💬 Message</button>` : ''}</div></div>`;
  } else if (p.kind === 'activity') {
    const items = S.notifs.slice(0, 100);
    head.innerHTML = `<h3>Activity <small>Mentions, replies & reactions</small></h3><button class="icon-btn" data-act="sound" title="${S.sound ? 'Turn notification sounds off' : 'Turn notification sounds on'}">${S.sound ? '🔔' : '🔕'}</button>${close}`;
    body.innerHTML = items.length ? items.map(n => {
      const c = S.channels.get(n.channel_id); const where = c ? (c.kind === 'dm' ? 'a direct message' : '#' + c.name) : 'a channel';
      const what = n.kind === 'mention' ? `<b>${esc(nameOf(n.actor_id))}</b> mentioned you in <b>${esc(where)}</b>` : n.kind === 'reply' ? `<b>${esc(nameOf(n.actor_id))}</b> replied to a thread in <b>${esc(where)}</b>` : `<b>${esc(nameOf(n.actor_id))}</b> reacted ${esc(n.emoji || '')} to your message in <b>${esc(where)}</b>`;
      const pv = previews.get(n.message_id);
      return `<button class="act ${!(p.seenIds || new Set()).has(n.id) ? 'new' : ''}" data-act="actJump" data-cid="${n.channel_id}" data-mid="${n.message_id}" data-pid="${n.parent_id || ''}"><span class="kind">${n.kind === 'mention' ? '＠' : n.kind === 'reply' ? '💬' : esc(n.emoji || '☺')}</span>${avatar(n.actor_id, 'md')}<div style="flex:1;min-width:0"><div class="what">${what} · ${esc(fmtWhen(n.created_at))}</div><div class="prev">${pv === undefined ? '<span style="color:var(--text-3)">…</span>' : esc(pv) || '<span style="color:var(--text-3)">(message not available)</span>'}</div></div></button>`;
    }).join('') : `<div class="empty">Nothing here yet.<br>When someone @mentions you, replies to your thread, or reacts to your message, it shows up here.</div>`;
    loadPreviews(items);
  }
}
const previews = new Map();
async function loadPreviews(items) {
  const ids = [...new Set(items.map(n => n.message_id).filter(id => id && !previews.has(id)))]; if (!ids.length) return;
  ids.forEach(id => previews.set(id, undefined));
  const { data } = await sb.from('messages').select('id, body, attachments, deleted_at').in('id', ids.slice(0, 100));
  ids.forEach(id => previews.set(id, ''));
  (data || []).forEach(m => previews.set(m.id, m.deleted_at ? 'This message was deleted.' : plain(m.body) || ((m.attachments || []).length ? '📎 ' + m.attachments.map(a => a.name).join(', ') : '')));
  if (S.panel && S.panel.kind === 'activity') renderPanel();
}
async function loadPins() {
  const cid = S.cur;
  const { data } = await sb.from('messages').select('*').eq('channel_id', cid).eq('pinned', true).is('deleted_at', null).order('created_at', { ascending: false }).limit(100);
  if (S.panel && S.panel.kind === 'pins' && S.cur === cid) { S.panel.items = data || []; renderPanel(); }
}
async function openThread(pid, refresh) {
  const cid = S.cur;
  if (!refresh || !S.thread) S.thread = { cid, pid, parent: findMsg(pid) || null, replies: [], loaded: false };
  S.panel = { kind: 'thread' }; $('#panel').hidden = false; $('#main').classList.add('with-panel');
  renderThread(); if (!refresh) renderThreadComposer();
  const [par, reps] = await Promise.all([
    S.thread.parent ? Promise.resolve({ data: S.thread.parent }) : sb.from('messages').select('*, reactions(emoji, user_id)').eq('id', pid).maybeSingle(),
    sb.from('messages').select('*, reactions(emoji, user_id)').eq('parent_id', pid).order('created_at', { ascending: true }).limit(500),
  ]);
  if (!S.thread || S.thread.pid !== pid) return;
  if (par.data) S.thread.parent = normMsg(par.data);
  const pending = S.thread.replies.filter(r => r.pendingLocal);
  S.thread.replies = [...(reps.data || []).map(r => normMsg(r)), ...pending]; S.thread.loaded = true;
  renderThread();
  S.notifs.filter(n => !n.read && n.parent_id === pid).forEach(n => { n.read = true; });
}
function renderThread() {
  const t = S.thread; if (!t || !$('#panel')) return;
  const c = S.channels.get(t.cid);
  $('#panelHead').innerHTML = `<h3>Thread <small>${c ? esc(c.kind === 'dm' ? chLabel(c) : '#' + c.name) : ''}</small></h3><button class="icon-btn" data-act="closePanel" title="Close">✕</button>`;
  const body = $('#panelBody'); const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  body.innerHTML = (t.parent ? listHTML([t.parent], { inThread: true }) : '<div class="empty">Loading…</div>') + `<div class="reply-count">${t.replies.length} ${t.replies.length === 1 ? 'reply' : 'replies'}</div>` + (t.loaded ? listHTML(t.replies, { inThread: true }) : '<div class="empty">Loading replies…</div>');
  if (atBottom || body.dataset.tid !== t.pid) body.scrollTop = body.scrollHeight;
  body.dataset.tid = t.pid; hydrateMedia(body);
  if (S.editing) { const ta = body.querySelector('textarea[data-edit]'); if (ta) ta.focus(); }
}
function renderThreadComposer() {
  const wrap = $('#panelComposer'); wrap.className = 'composer-wrap'; wrap.style.padding = '0 16px 14px'; const t = S.thread; if (!t) return;
  if (!isMember(t.cid)) { wrap.innerHTML = '<div class="readonly">Join the channel to reply.</div>'; return; }
  const comp = makeComposer(wrap, { placeholder: 'Reply…', typingKey: 't:' + t.pid, channelId: t.cid, onSend: (text, mn, f) => sendMessage(text, mn, t.pid, f) });
  setTimeout(() => comp.focus(), 0);
}

/* ================= search ================= */
async function runSearch(q) {
  q = q.trim(); if (!q) return;
  openPanel({ kind: 'search', q, loading: true, results: [] });
  const pattern = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
  const { data, error } = await sb.from('messages').select('*').ilike('body', pattern).is('deleted_at', null).order('created_at', { ascending: false }).limit(100);
  if (!S.panel || S.panel.kind !== 'search' || S.panel.q !== q) return;
  if (error) toast('Search failed: ' + errMsg(error));
  S.panel = { kind: 'search', q, loading: false, results: data || [] }; renderPanel();
}
function jump(cid, id, pid) { if (!S.channels.has(cid)) { toast('That conversation is no longer available.'); return; } S.jumpTo = id; S.jumpThread = pid || null; if (cid !== S.cur) openChannel(cid); else renderMessages(); }

/* ================= modals & popovers ================= */
function modal(title, inner, footer, onMount) {
  closeModal(); const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'overlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><header><h3>${esc(title)}</h3><button class="icon-btn" data-close>✕</button></header><div class="mb">${inner}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  ov.addEventListener('mousedown', e => { if (e.target === ov || e.target.closest('[data-close]')) closeModal(); });
  document.body.appendChild(ov); onMount && onMount(ov); const f = ov.querySelector('input:not([type=checkbox]),textarea'); if (f) setTimeout(() => f.focus(), 0); return ov;
}
function closeModal() { const o = $('#overlay'); if (o) o.remove(); }
function confirmModal(title, text, okLabel, onOk) { modal(title, `<p style="margin:0 0 8px">${esc(text)}</p>`, `<button class="btn" data-close>Cancel</button><button class="btn primary" style="background:var(--danger);border-color:var(--danger)" id="okBtn">${esc(okLabel)}</button>`, ov => { ov.querySelector('#okBtn').onclick = () => { closeModal(); onOk(); }; }); }
function closePop() { document.querySelectorAll('.popover').forEach(p => p.remove()); document.querySelectorAll('.actions.open').forEach(a => a.classList.remove('open')); }
function popover(anchor, html, onMount) {
  closePop(); const p = document.createElement('div'); p.className = 'popover'; p.innerHTML = html; document.body.appendChild(p);
  const r = anchor.getBoundingClientRect(); const pw = p.offsetWidth, ph = p.offsetHeight; let top = r.bottom + 6; if (top + ph > innerHeight - 8) top = r.top - ph - 6;
  p.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + 'px'; p.style.top = Math.max(8, top) + 'px'; onMount && onMount(p); return p;
}
function menu(anchor, items) { popover(anchor, `<div class="menu">${items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('')}</div>`, p => p.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; closePop(); items[+b.dataset.i].run(); })); }
function emojiPicker(anchor, onPick) { popover(anchor, `<div class="emoji-grid">${EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>`, p => p.addEventListener('click', ev => { const b = ev.target.closest('button[data-e]'); if (b) { closePop(); onPick(b.dataset.e); } })); }
document.addEventListener('mousedown', e => { if (!e.target.closest('.popover') && !e.target.closest('[data-act="reactPick"],[data-act="msgMenu"],[data-f="emoji"],[data-act="wsMenu"],[data-act="chMenu"],[data-act="account"]')) closePop(); });
function textModal(title, label, value, max, onSave, multiline) {
  modal(title, `<div class="field"><label>${esc(label)}</label>${multiline ? `<textarea id="tv" rows="4" maxlength="${max}">${esc(value)}</textarea>` : `<input id="tv" maxlength="${max}" value="${esc(value)}">`}</div>`, `<button class="btn" data-close>Cancel</button><button class="btn primary" id="tvSave">Save</button>`, ov => {
    const go = () => { const v = ov.querySelector('#tv').value.trim(); closeModal(); onSave(v); };
    ov.querySelector('#tvSave').onclick = go; ov.querySelector('#tv').addEventListener('keydown', e => { if (e.key === 'Enter' && !multiline) go(); });
  });
}
function createChannelModal() {
  modal('Create a channel', `<div class="field"><label>Name</label><input id="chName" maxlength="80" placeholder="e.g. plan-budget"><div class="err" id="chErr"></div></div><div class="field"><label>Description <small>(optional)</small></label><input id="chDesc" maxlength="250" placeholder="What's this channel about?"></div><label class="toggle"><input type="checkbox" id="chPriv"><span><b>Make private</b><br><small style="color:var(--text-2)">Only people you invite can see and join it.</small></span></label>`,
    `<button class="btn" data-close>Cancel</button><button class="btn primary" id="chCreate">Create</button>`, ov => {
      const name = ov.querySelector('#chName'), err = ov.querySelector('#chErr');
      name.addEventListener('input', () => { const v = name.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, ''); if (v !== name.value) name.value = v; err.textContent = ''; });
      const go = async () => {
        const n = name.value.replace(/^[-_]+|[-_]+$/g, ''); if (!n) { err.textContent = 'Give the channel a name.'; return; }
        const btn = ov.querySelector('#chCreate'); btn.disabled = true;
        const { data, error } = await sb.rpc('create_channel', { p_name: n, p_description: ov.querySelector('#chDesc').value.trim(), p_private: ov.querySelector('#chPriv').checked });
        btn.disabled = false;
        if (error) { err.textContent = /duplicate|unique/i.test(errMsg(error)) ? 'That name is already taken.' : errMsg(error); return; }
        closeModal(); await ensureChannel(data); openChannel(data);
      };
      ov.querySelector('#chCreate').onclick = go; name.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
}
async function ensureChannel(id) {
  if (!S.channels.has(id)) { const { data } = await sb.from('channels').select('*').eq('id', id).maybeSingle(); if (data) S.channels.set(id, data); }
  const { data: mem } = await sb.from('channel_members').select('*').eq('channel_id', id); (mem || []).forEach(addMemberRow); renderSidebar();
}
function browseModal() {
  const draw = (ov, f = '') => {
    const list = [...S.channels.values()].filter(c => c.kind !== 'dm' && !c.archived && c.name.includes(f.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
    ov.querySelector('#chList').innerHTML = list.length ? list.map(c => { const n = memberIds(c.id).length; return `<div class="list-row"><div class="grow"><b>${c.kind === 'private' ? '🔒' : '#'} ${esc(c.name)}</b>${isMember(c.id) ? ' <span style="color:var(--accent);font-size:12px;font-weight:600">✓ Joined</span>' : ''}<small>${n} member${n === 1 ? '' : 's'}${c.description ? ' · ' + esc(c.description) : ''}</small></div>${c.auto_join ? '' : (isMember(c.id) ? `<button class="btn" data-act="leave" data-id="${c.id}">Leave</button>` : `<button class="btn primary" data-act="join" data-id="${c.id}">Join</button>`)}<button class="btn" data-act="open" data-id="${c.id}">View</button></div>`; }).join('') : `<div class="empty">No channels found.</div>`;
  };
  modal('Browse channels', `<div class="field"><input id="chFilter" placeholder="Search by channel name"></div><div id="chList"></div>`, `<button class="btn primary" id="newCh">＋ Create channel</button>`, ov => { draw(ov); ov.querySelector('#chFilter').addEventListener('input', e => draw(ov, e.target.value)); ov.querySelector('#newCh').onclick = createChannelModal; ov._redraw = () => draw(ov, ov.querySelector('#chFilter').value); });
}
function peoplePicker(title, filter, onPick, hint) {
  const draw = (ov, f = '') => {
    const list = approvedPeople().filter(filter).filter(p => p.display_name.toLowerCase().includes(f.toLowerCase())).sort((a, b) => a.id === S.uid ? -1 : b.id === S.uid ? 1 : a.display_name.localeCompare(b.display_name));
    ov.querySelector('#pList').innerHTML = list.length ? list.map(p => personRow(p.id).replace('data-act="profile"', 'data-pick="1"')).join('') : `<div class="empty">${hint || 'No one found.'}</div>`;
  };
  modal(title, `<div class="field"><input id="pFilter" placeholder="Find a teammate"></div><div id="pList" style="margin:0 -22px"></div>`, '', ov => {
    draw(ov); ov.querySelector('#pFilter').addEventListener('input', e => draw(ov, e.target.value));
    ov.querySelector('#pList').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) { closeModal(); onPick(b.dataset.uid); } });
  });
}
function newDM() { peoplePicker('New message', () => true, openDM, 'No approved teammates yet. Invite people to sign up, then approve them.'); }
async function openDM(uid) {
  closeModal(); const { data, error } = await sb.rpc('get_or_create_dm', { p_other: uid });
  if (error) { toast("Couldn't open conversation: " + errMsg(error)); return; }
  closePanel(true); await ensureChannel(data); openChannel(data);
}
function statusModal() {
  const st = statusOf(S.uid); let emo = st.e || '💬';
  modal('Set a status', `<div class="field" style="display:flex;gap:8px"><button class="btn" id="stEmoji" style="font-size:20px;padding:4px 10px">${esc(emo)}</button><input id="stText" maxlength="100" placeholder="What's your status?" value="${esc(st.t)}"></div><div style="display:flex;flex-wrap:wrap;gap:6px">${[['📅', 'In a meeting'], ['🚌', 'Commuting'], ['🤒', 'Out sick'], ['🌴', 'On vacation'], ['🏠', 'Working remotely'], ['🎯', 'Focusing']].map(([e, t]) => `<button class="btn" data-pe="${e}" data-pt="${t}">${e} ${t}</button>`).join('')}</div>`,
    `<button class="btn" id="stClear">Clear status</button><button class="btn primary" id="stSave">Save</button>`, ov => {
      const save = async (e, t) => { closeModal(); const { error } = await sb.from('profiles').update({ status_emoji: e, status_text: t }).eq('id', S.uid); if (error) toast("Couldn't save status"); };
      ov.querySelector('#stEmoji').onclick = ev => emojiPicker(ev.currentTarget, e => { emo = e; ov.querySelector('#stEmoji').textContent = e; });
      ov.querySelectorAll('[data-pe]').forEach(b => b.onclick = () => { emo = b.dataset.pe; ov.querySelector('#stEmoji').textContent = emo; ov.querySelector('#stText').value = b.dataset.pt; });
      ov.querySelector('#stSave').onclick = () => { const t = ov.querySelector('#stText').value.trim(); save(t ? emo : '', t); };
      ov.querySelector('#stClear').onclick = () => save('', '');
    });
}
function peopleAdminModal() {
  const draw = ov => {
    const all = [...S.profiles.values()].sort((a, b) => (a.approved - b.approved) || a.display_name.localeCompare(b.display_name));
    ov.querySelector('#plist').innerHTML = all.map(p => `<div class="list-row">${avatar(p.id, 'md')}<div class="grow"><b>${esc(p.display_name)}</b>${p.id === S.uid ? ' <small style="display:inline">(you)</small>' : ''}${!p.approved ? '<span class="tag pending">Pending</span>' : p.role === 'admin' ? '<span class="tag admin">Admin</span>' : ''}<small>Signed up ${esc(new Date(ms(p.created_at)).toLocaleDateString())}</small></div>
      ${!p.approved ? `<button class="btn primary" data-adm="approve" data-uid="${p.id}">Approve</button>` : p.id === S.uid ? '' : `<button class="btn" data-adm="${p.role === 'admin' ? 'demote' : 'promote'}" data-uid="${p.id}">${p.role === 'admin' ? 'Remove admin' : 'Make admin'}</button><button class="btn danger" data-adm="remove" data-uid="${p.id}">Remove</button>`}</div>`).join('');
  };
  modal('People', `<p style="margin:0 0 10px;color:var(--text-2);font-size:14px">New sign-ups wait here until you approve them. To invite someone, send them this page's address and ask them to create an account.</p><div id="plist"></div>`, '', ov => {
    draw(ov); ov._redraw = () => draw(ov);
    ov.querySelector('#plist').addEventListener('click', async e => {
      const b = e.target.closest('[data-adm]'); if (!b) return; const u = b.dataset.uid, a = b.dataset.adm; const p = S.profiles.get(u);
      const args = a === 'approve' ? [true, 'member'] : a === 'promote' ? [true, 'admin'] : a === 'demote' ? [true, 'member'] : [false, 'member'];
      b.disabled = true;
      const { error } = await sb.rpc('set_member_access', { p_user: u, p_approved: args[0], p_role: args[1] });
      if (error) { toast(errMsg(error)); b.disabled = false; return; }
      if (p) { p.approved = args[0]; p.role = args[1]; } draw(ov); renderSidebar();
      toast(a === 'approve' ? `${nameOf(u)} can now use the workspace` : a === 'remove' ? `${nameOf(u)} no longer has access` : 'Role updated');
    });
  });
}
function accountMenu(anchor) {
  menu(anchor, [
    { label: 'Set a status', run: statusModal },
    { label: 'Edit display name', run: () => textModal('Display name', 'Name shown to your team', S.me.display_name, 60, async v => { if (!v) return; const { error } = await sb.from('profiles').update({ display_name: v }).eq('id', S.uid); if (error) toast(errMsg(error)); }) },
    { label: 'Change password', run: () => modal('Change password', `<div class="field"><label>New password <small>(at least 8 characters)</small></label><input id="np" type="password" minlength="8" autocomplete="new-password"></div>`, `<button class="btn" data-close>Cancel</button><button class="btn primary" id="npSave">Save</button>`, ov => { ov.querySelector('#npSave').onclick = async () => { const v = ov.querySelector('#np').value; if (v.length < 8) { toast('Use at least 8 characters.'); return; } const { error } = await sb.auth.updateUser({ password: v }); if (error) toast(errMsg(error)); else { closeModal(); toast('Password changed'); } }; }) },
    { label: S.sound ? 'Turn sounds off 🔕' : 'Turn sounds on 🔔', run: () => setSound(!S.sound) },
    '-',
    { label: 'Sign out', danger: true, run: signOut },
  ]);
}
function switcher() {
  const all = [...sidebarChannels(), ...sidebarDMs(), ...[...S.channels.values()].filter(c => c.kind === 'public' && !c.archived && !isMember(c.id))]; let sel = 0;
  const draw = (ov, f = '') => { const list = all.filter(c => chLabel(c).toLowerCase().includes(f.toLowerCase())).slice(0, 12); sel = Math.min(sel, Math.max(0, list.length - 1)); ov._list = list; ov.querySelector('#swList').innerHTML = list.map((c, i) => `<button class="switch-item ${i === sel ? 'sel' : ''}" data-act="open" data-id="${c.id}">${c.kind === 'dm' ? avatar(dmOther(c.id), 'sm') : `<b style="width:20px;text-align:center">${c.kind === 'private' ? '🔒' : '#'}</b>`} ${esc(chLabel(c))}${isUnread(c) ? ' <b>●</b>' : ''}</button>`).join('') || '<div class="empty">No matches</div>'; };
  modal('Jump to…', `<div class="field"><input id="swF" placeholder="Channel or person"></div><div id="swList"></div>`, '', ov => {
    const inp = ov.querySelector('#swF'); draw(ov); inp.addEventListener('input', () => { sel = 0; draw(ov, inp.value); });
    inp.addEventListener('keydown', e => { const n = (ov._list || []).length; if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(n, 1); draw(ov, inp.value); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + n) % Math.max(n, 1); draw(ov, inp.value); } else if (e.key === 'Enter' && n) { closeModal(); openChannel(ov._list[sel].id); } });
  });
}
async function markAllNotifsRead() {
  if (!unreadNotifs()) return; S.notifs.forEach(n => n.read = true); renderSidebar();
  await sb.from('notifications').update({ read: true }).eq('user_id', S.uid).eq('read', false);
}

/* ================= click handling ================= */
document.addEventListener('click', async e => {
  if (!S.booted) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  switch (a) {
    case 'toggleSide': $('#app').classList.toggle('side-open'); break;
    case 'open': closeModal(); if (id) openChannel(id); break;
    case 'browse': browseModal(); break;
    case 'createCh': createChannelModal(); break;
    case 'chMenu': menu(b, [{ label: 'Create a new channel', run: createChannelModal }, { label: 'Browse channels', run: browseModal }]); break;
    case 'wsMenu': menu(b, [{ label: 'Set a status', run: statusModal }, { label: 'Browse channels', run: browseModal }, { label: 'New direct message', run: newDM }, { label: 'Jump to… (Ctrl/⌘ K)', run: switcher }, ...(isAdmin() ? ['-', { label: 'Manage people & approvals', run: peopleAdminModal }, { label: 'Rename workspace', run: () => textModal('Rename workspace', 'Workspace name', S.ws.name, 60, async v => { if (!v) return; const { error } = await sb.from('workspace').update({ name: v }).eq('id', 1); if (error) toast(errMsg(error)); }) }] : [])]); break;
    case 'account': accountMenu(b); break;
    case 'people': peopleAdminModal(); break;
    case 'newDM': newDM(); break;
    case 'dm': openDM(b.dataset.uid); break;
    case 'status': statusModal(); break;
    case 'profile': if (b.dataset.uid) openPanel({ kind: 'profile', uid: b.dataset.uid }); break;
    case 'details': openPanel({ kind: 'details' }); break;
    case 'pins': openPanel({ kind: 'pins' }); break;
    case 'activity': { const seen = new Set(S.notifs.filter(n => n.read).map(n => n.id)); if (S.thread) closePanel(true); openPanel({ kind: 'activity', seenIds: seen }); markAllNotifsRead(); $('#app').classList.remove('side-open'); break; }
    case 'actJump': { const pid = b.dataset.pid; jump(b.dataset.cid, pid || b.dataset.mid, pid); break; }
    case 'sound': setSound(!S.sound); renderPanel(); break;
    case 'closePanel': closePanel(); break;
    case 'star': { const m = myMember(S.cur); if (!m) break; m.starred = !m.starred; renderSidebar(); renderHeader(); const { error } = await sb.from('channel_members').update({ starred: m.starred }).match({ channel_id: S.cur, user_id: S.uid }); if (error) toast(errMsg(error)); break; }
    case 'editTopic': { const c = S.channels.get(S.cur); if (!c || c.kind === 'dm' || !isMember(c.id)) break; textModal('Edit topic', 'Topic', c.topic || '', 250, async v => { const { error } = await sb.from('channels').update({ topic: v }).eq('id', c.id); if (error) toast(errMsg(error)); }); break; }
    case 'editDesc': { const c = S.channels.get(S.cur); if (!c || !isMember(c.id)) break; textModal('Edit description', 'Description', c.description || '', 500, async v => { const { error } = await sb.from('channels').update({ description: v }).eq('id', c.id); if (error) toast(errMsg(error)); }, true); break; }
    case 'addPeople': { const c = S.channels.get(S.cur); if (!c) break; peoplePicker(`Add people to #${c.name}`, p => !memberIds(c.id).includes(p.id), async uid => { const { error } = await sb.rpc('add_channel_member', { p_channel: c.id, p_user: uid }); if (error) toast(errMsg(error)); else toast(`${nameOf(uid)} was added`); }, 'Everyone is already in this channel.'); break; }
    case 'join': { const { error } = await sb.from('channel_members').insert({ channel_id: id, user_id: S.uid }); if (error && !/duplicate/i.test(errMsg(error))) { toast(errMsg(error)); break; } addMemberRow({ channel_id: id, user_id: S.uid, last_read_at: iso(), starred: false }); const o = $('#overlay'); if (o && o._redraw) o._redraw(); else openChannel(id); renderAll(); break; }
    case 'leave': { const cid = id || S.cur; const { error } = await sb.from('channel_members').delete().match({ channel_id: cid, user_id: S.uid }); if (error) { toast(errMsg(error)); break; } const mm = S.members.get(cid); if (mm) mm.delete(S.uid); const o = $('#overlay'); if (o && o._redraw) o._redraw(); if (cid === S.cur) { closePanel(true); const c = S.channels.get(cid); if (c && c.kind === 'private') S.channels.delete(cid); S.cur = null; routeFromHash(true); } renderSidebar(); break; }
    case 'archive': confirmModal('Archive channel', 'Archiving hides this channel for everyone. Its messages are kept.', 'Archive', async () => { const { error } = await sb.rpc('archive_channel', { p_channel: S.cur }); if (error) toast(errMsg(error)); }); break;
    case 'older': loadMessages(S.cur, true); break;
    case 'toggleReact': toggleReact(id, b.dataset.emoji); break;
    case 'reactPick': { const act = b.closest('.actions'); emojiPicker(b, em => toggleReact(id, em)); if (act) act.classList.add('open'); break; }
    case 'thread': if (id) openThread(id); break;
    case 'msgMenu': {
      const m = findMsg(id); if (!m) break; const act = b.closest('.actions'); const inThread = !!m.parent_id;
      menu(b, [...(inThread ? [] : [{ label: 'Reply in thread', run: () => openThread(id) }]), { label: m.pinned ? 'Unpin message' : 'Pin to conversation', run: () => togglePin(id) }, { label: 'Copy text', run: () => { try { navigator.clipboard.writeText(plain(m.body)).then(() => toast('Copied'), () => toast("Couldn't copy")); } catch (er) { toast("Couldn't copy"); } } }, ...(m.user_id === S.uid ? [{ label: 'Edit message', run: () => startEdit(id) }] : []), ...(b.dataset.del === '1' ? ['-', { label: 'Delete message', danger: true, run: () => deleteMsg(id) }] : [])]);
      if (act) act.classList.add('open'); break;
    }
    case 'cancelEdit': S.editing = null; renderMessages(); if (S.thread) renderThread(); break;
    case 'saveEdit': saveEdit(); break;
    case 'jump': jump(b.dataset.cid, id, b.dataset.pid); break;
    case 'lightbox': { const path = b.dataset.path; const get = await signedUrls([path]); const u = get(path); if (!u) { toast('File unavailable'); break; } const dl = await signedUrls([path], true); modal(b.dataset.name || 'Image', `<div class="lightbox"><img src="${esc(u)}" alt="${esc(b.dataset.name || '')}"></div>`, `<a class="btn" href="${esc(dl(path) || u)}" target="_blank" rel="noopener noreferrer">Download ↓</a><button class="btn primary" data-close>Close</button>`); break; }
  }
});
document.addEventListener('input', e => { if (e.target.matches('textarea[data-edit]') && S.editing) S.editing.text = e.target.value; });
document.addEventListener('keydown', e => {
  if (!S.booted) return;
  if (e.target.matches('textarea[data-edit]')) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') { S.editing = null; renderMessages(); if (S.thread) renderThread(); } return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); switcher(); return; }
  if (e.key === 'Escape') { if ($('.popover')) closePop(); else if ($('#overlay')) closeModal(); else if (S.panel) closePanel(); }
});
