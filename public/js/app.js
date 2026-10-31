let token = localStorage.getItem('plamtr_token');
let ws = null;
let user = null;
let currentRoom = 'genel1';
let currentChat = null; // 'dm:username' or 'group:id'
let onlineUsers = {};
let friends = [];
let pendingFriends = [];
let groups = [];
let keypair = null;
let peerConnections = {};

const ROOMS = ['genel1','genel2','genel3'];
const TG_CHANNEL = 'https://t.me/plamtr';

// splash -> auth
setTimeout(() => {
  document.getElementById('splash').classList.add('hidden');
  if (token) {
    document.getElementById('auth-screen').classList.add('hidden');
    initApp();
  } else {
    document.getElementById('auth-screen').classList.remove('hidden');
  }
}, 2000);

// tabs
document.getElementById('tab-login').onclick = () => switchAuthTab('login');
document.getElementById('tab-register').onclick = () => switchAuthTab('register');

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.getElementById('forgot-form').classList.add('hidden');
  document.getElementById('about-screen').classList.add('hidden');
}

function showAuthForm(name) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
  if (name === 'login') {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('tab-login').classList.add('active');
  } else if (name === 'register') {
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('tab-register').classList.add('active');
  }
}

function showCustomQuestion() {
  document.getElementById('custom-question-wrap').classList.toggle('hidden', document.getElementById('reg-question').value !== 'custom');
}

function showForgot() {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
  document.getElementById('forgot-form').classList.remove('hidden');
}

function showAbout() {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
  document.getElementById('about-screen').classList.remove('hidden');
}

// username check
async function checkUsername() {
  const v = document.getElementById('reg-username').value.trim().toLowerCase();
  const h = document.getElementById('reg-username-hint');
  if (!v) { h.textContent = ''; return; }
  if (!/^[a-z0-9_]{3,20}$/.test(v)) { h.textContent = '❌ 3-20 karakter, küçük harf/rakam/_'; return; }
  const r = await fetch('/api/username-check/' + encodeURIComponent(v));
  const d = await r.json();
  h.textContent = d.taken ? '❌ Bu kullanıcı adı alınmış' : '✅ Müsait';
}

// auth
async function doLogin() {
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  if (!username || !password) { alert('Kullanıcı adı ve şifre gerekli.'); return; }
  const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  token = d.token;
  keypair = d.keypair;
  user = d.user;
  localStorage.setItem('plamtr_token', token);
  document.getElementById('auth-screen').classList.add('hidden');
  initApp();
}

async function doRegister() {
  const fullName = document.getElementById('reg-fullname').value.trim();
  const username = document.getElementById('reg-username').value.trim().toLowerCase();
  const email = document.getElementById('reg-email').value.trim();
  const questionId = document.getElementById('reg-question').value;
  const questionText = questionId === 'custom' ? document.getElementById('reg-custom-question').value.trim() : '';
  const answer = document.getElementById('reg-answer').value.trim();
  const pw = document.getElementById('reg-password').value;
  const pw2 = document.getElementById('reg-password2').value;
  if (!fullName) { alert('Adını yaz.'); return; }
  if (!/^[a-z0-9_]{3,20}$/.test(username)) { alert('Kullanıcı adı 3-20 karakter, sadece küçük harf/rakam/_ olabilir.'); return; }
  if (pw !== pw2) { alert('Şifreler eşleşmiyor.'); return; }
  const r = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fullName,username,email,questionId,questionText,answer,password:pw}) });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  token = d.token;
  keypair = d.keypair;
  user = d.user;
  localStorage.setItem('plamtr_token', token);
  document.getElementById('auth-screen').classList.add('hidden');
  alert('✅ Kayıt başarılı! 200 coin kazandın!');
  initApp();
}

async function doLogout() {
  await fetch('/api/logout', { method:'POST', headers:{'x-token':token} });
  localStorage.removeItem('plamtr_token');
  location.reload();
}

// forgot password
let forgotData = {};
async function forgotQuestion() {
  const username = document.getElementById('forgot-username').value.trim().toLowerCase();
  if (!username) { alert('Kullanıcı adını yaz.'); return; }
  const r = await fetch('/api/user/' + encodeURIComponent(username));
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  const qId = d.user.recoveryQuestionId;
  const q = document.getElementById('forgot-q-text');
  if (qId === 'custom') q.textContent = d.user.recoveryQuestionText || 'Kendi sorun:';
  else q.textContent = d.user.recoveryQuestionId || 'Cevabını yaz';
  forgotData.username = username;
  document.getElementById('forgot-answer-wrap').classList.remove('hidden');
}

async function forgotEmail() {
  const username = document.getElementById('forgot-username').value.trim().toLowerCase();
  if (!username) { alert('Kullanıcı adını yaz.'); return; }
  const r = await fetch('/api/forgot', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,method:'email'}) });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  document.getElementById('forgot-info').textContent = '📧 Kod e-postana gönderildi: ' + d.email;
  forgotData = { username, code: d.code };
  document.getElementById('forgot-answer-wrap').classList.add('hidden');
  document.getElementById('forgot-code-wrap').classList.remove('hidden');
}

async function submitForgotAnswer() {
  const answer = document.getElementById('forgot-answer').value.trim();
  const r = await fetch('/api/forgot', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:forgotData.username,method:'question',answer}) });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  forgotData.code = d.code;
  document.getElementById('forgot-answer-wrap').classList.add('hidden');
  document.getElementById('forgot-code-wrap').classList.remove('hidden');
  document.getElementById('forgot-info').textContent = '📨 Kod gönderildi.';
}

async function doResetPw() {
  const code = document.getElementById('forgot-code').value.trim();
  const newPw = document.getElementById('forgot-newpw').value;
  if (!code || code.length !== 6) { alert('6 haneli kodu gir.'); return; }
  const r = await fetch('/api/resetpw', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:forgotData.username,code,newPassword:newPw}) });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  alert('✅ Şifren sıfırlandı! Giriş yapabilirsin.');
  showAuthForm('login');
}

// ---- APP ----
function initApp() {
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('chat-title').textContent = '#genel1';
  loadProfile();
  loadFriends();
  loadGroups();
  connectWS();
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type:'auth', token }));
  };
  ws.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      handleWS(d);
    } catch(ex) {}
  };
  ws.onclose = () => { setTimeout(connectWS, 2000); };
}

function handleWS(d) {
  if (d.type === 'auth_ok') {
    ws.send(JSON.stringify({ type:'join', room:'genel1' }));
    return;
  }
  if (d.type === 'joined') {
    document.getElementById('chat-messages').innerHTML = '';
    addSystemMsg('💬 ' + d.room + ' odasına katıldın');
    return;
  }
  if (d.type === 'message') {
    if (d.room === currentRoom || (d.room === 'dm' && d.from === user.id) || (d.room === 'dm' && d.to === user.id)) {
      addMessage(d);
    }
    return;
  }
  if (d.type === 'user_online') {
    onlineUsers[d.uid] = true;
    updateOnlineCount();
    return;
  }
  if (d.type === 'user_offline') {
    delete onlineUsers[d.uid];
    updateOnlineCount();
    return;
  }
  if (d.type === 'friend_request') {
    pendingFriends.push({ username: d.from, name: d.fromName });
    updateFriendsPanel();
    addSystemMsg('👤 ' + d.fromName + ' arkadaşlık isteği gönderdi');
    return;
  }
  if (d.type === 'friend_accepted') {
    loadFriends();
    addSystemMsg('✅ ' + d.from + ' arkadaşlık isteğini kabul etti');
    return;
  }
  if (d.type === 'group_invite') {
    addSystemMsg('📨 ' + d.from + ' seni "' + d.groupName + '" grubuna davet etti');
    return;
  }
  if (d.type === 'heavy_alert') {
    addSystemMsg('🚨 ' + d.displayName + ' ağır ihlal: ' + d.reasons.join(', '));
    return;
  }
  if (d.type === 'admin_broadcast') {
    addSystemMsg(d.message);
    return;
  }
  if (d.type === 'banned') {
    alert('⛔ Hesabın yasaklandı: ' + d.reason);
    doLogout();
    return;
  }
  if (d.type === 'warn') {
    addSystemMsg('⚠️ Uyarı: ' + d.reason);
    return;
  }
  if (d.type === 'call_offer' || d.type === 'call_answer' || d.type === 'ice_candidate') {
    handleCall(d);
    return;
  }
  if (d.type === 'typing') {
    // typing indicator
    return;
  }
  if (d.type === 'pong') {}
}

function updateOnlineCount() {
  const count = Object.keys(onlineUsers).length;
  document.getElementById('online-count').textContent = count + ' çevrimiçi';
}

function addSystemMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg system';
  el.textContent = text;
  document.getElementById('chat-messages').appendChild(el);
  el.scrollIntoView({ behavior:'smooth' });
}

function addMessage(d) {
  const el = document.createElement('div');
  const isOwn = d.from === user.id;
  el.className = 'msg ' + (isOwn ? 'own' : 'other');
  if (d.frame && d.frame !== 'none') el.style.border = '2px solid ' + getFrameColor(d.frame);
  let html = '';
  if (!isOwn) {
    const roleClass = d.role === 'admin' ? 'admin' : d.vip ? 'vip' : '';
    html += '<div class="name ' + roleClass + '">' + (d.displayName || d.username) + (d.vip ? ' 👑' : '') + (d.role === 'admin' ? ' 🔴ADMİN' : '') + '</div>';
  }
  html += '<div>' + d.text + '</div>';
  html += '<div class="time">' + formatTime(d.time) + '</div>';
  el.innerHTML = html;
  document.getElementById('chat-messages').appendChild(el);
  el.scrollIntoView({ behavior:'smooth' });
}

function getFrameColor(frame) {
  const colors = { gold:'#ffd700', rainbow:'linear-gradient(90deg,red,orange,yellow,green,blue,violet)', fire:'#ff4500', star:'#ff69b4' };
  return colors[frame] || '#888';
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

// send message
function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !ws) return;
  if (currentChat && currentChat.startsWith('dm:')) {
    ws.send(JSON.stringify({ type:'message', text, room:'dm', to:currentChat.slice(3) }));
  } else if (currentChat && currentChat.startsWith('group:')) {
    ws.send(JSON.stringify({ type:'message', text, room:currentChat.slice(6) }));
  } else {
    ws.send(JSON.stringify({ type:'message', text, room:currentRoom }));
  }
  input.value = '';
}

document.getElementById('msg-input').onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };

// sidebar navigation
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('panel-' + name).classList.remove('hidden');
}

function switchRoom(room) {
  currentRoom = room;
  currentChat = null;
  document.getElementById('chat-title').textContent = '#' + room;
  document.querySelectorAll('.room-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector('.room-btn[data-room="' + room + '"]');
  if (btn) btn.classList.add('active');
  document.getElementById('chat-messages').innerHTML = '';
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'join', room }));
}

function openDM(username, uid) {
  currentRoom = 'dm';
  currentChat = 'dm:' + uid;
  document.getElementById('chat-title').textContent = '💬 ' + username;
  document.getElementById('chat-messages').innerHTML = '';
  addSystemMsg('Özel sohbet: ' + username);
}

function openGroupChat(groupId, name) {
  currentRoom = 'group';
  currentChat = 'group:' + groupId;
  document.getElementById('chat-title').textContent = '👥 ' + name;
  document.getElementById('chat-messages').innerHTML = '';
  addSystemMsg('Grup: ' + name);
}

// profile
async function loadProfile() {
  const r = await fetch('/api/profile', { headers:{'x-token':token} });
  const d = await r.json();
  if (d.user) user = d.user;
  renderProfile();
}

function renderProfile() {
  document.getElementById('profile-name').textContent = user.displayName;
  document.getElementById('profile-username').textContent = '@' + user.username;
  document.getElementById('profile-bio').textContent = user.bio || 'Biyografi yok';
  document.getElementById('profile-coins').textContent = '🪙 ' + user.coins;
  document.getElementById('profile-vip').textContent = user.vip ? '👑 VIP' : 'Standart';
  const avatar = document.getElementById('profile-avatar');
  avatar.className = 'profile-avatar' + (user.vip ? ' vip' : '') + (user.role === 'admin' ? ' admin' : '');
  if (user.photo) avatar.style.backgroundImage = 'url(/api/file/' + user.photo.split('/').pop() + ')';
  else avatar.textContent = user.displayName[0].toUpperCase();
  document.getElementById('profile-theme').value = user.theme;
  document.getElementById('profile-filter').checked = user.filterOn;
  document.getElementById('profile-frame').value = user.frame || 'none';
}

async function saveProfile() {
  const displayName = document.getElementById('profile-dname').value.trim() || user.displayName;
  const bio = document.getElementById('profile-bio-edit').value.trim();
  const r = await fetch('/api/profile', { method:'PUT', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({displayName,bio}) });
  const d = await r.json();
  if (d.ok) { user = d.user; renderProfile(); alert('✅ Profil güncellendi.'); }
}

async function toggleTheme() {
  const theme = document.getElementById('profile-theme').value;
  await fetch('/api/profile', { method:'PUT', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({theme}) });
  document.body.className = theme === 'dark' ? '' : 'light';
}

async function toggleFilter() {
  const filterOn = document.getElementById('profile-filter').checked;
  await fetch('/api/profile', { method:'PUT', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({filterOn}) });
}

// friends
async function loadFriends() {
  const r = await fetch('/api/profile', { headers:{'x-token':token} });
  const d = await r.json();
  if (d.user) {
    user = d.user;
    friends = d.user.friends || [];
    pendingFriends = d.user.pendingFriends || [];
    updateFriendsPanel();
  }
}

function updateFriendsPanel() {
  const list = document.getElementById('friends-list');
  if (!list) return;
  let html = '';
  // pending
  for (const id of pendingFriends) {
    html += '<div class="user-item">';
    html += '<span class="status offline"></span>';
    html += '<span>Bekleyen istek #' + id.slice(0,6) + '</span>';
    html += '<button class="btn-sm" onclick="acceptFriend(\'' + id + '\')">✓</button>';
    html += '<button class="btn-sm" onclick="declineFriend(\'' + id + '\')">✗</button>';
    html += '</div>';
  }
  // friends
  for (const id of (friends || [])) {
    const online = onlineUsers[id];
    html += '<div class="user-item" onclick="openDM(\'' + (user?.username || '') + '\',\'' + id + '\')">';
    html += '<span class="status ' + (online ? 'online' : 'offline') + '"></span>';
    html += '<span>' + id.slice(0,8) + '...' + (online ? ' 🟢' : '') + '</span>';
    html += '</div>';
  }
  if (!html) html = '<p style="color:#888;font-size:13px">Henüz arkadaşın yok.</p>';
  list.innerHTML = html;
}

async function addFriend() {
  const username = document.getElementById('friend-username').value.trim().toLowerCase();
  if (!username) return;
  const r = await fetch('/api/friends/add', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({username}) });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  alert('✅ İstek gönderildi.');
}

async function acceptFriend(id) {
  await fetch('/api/friends/accept', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({id}) });
  loadFriends();
}

async function declineFriend(id) {
  await fetch('/api/friends/decline', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({id}) });
  loadFriends();
}

// groups
async function loadGroups() {
  const r = await fetch('/api/groups', { headers:{'x-token':token} });
  const d = await r.json();
  if (d.groups) groups = d.groups;
  updateGroupsPanel();
}

function updateGroupsPanel() {
  const list = document.getElementById('groups-list');
  if (!list) return;
  let html = '';
  for (const g of groups) {
    html += '<div class="user-item" onclick="openGroupChat(\'' + g.id + '\',\'' + g.name + '\')">';
    html += '<span>👥 ' + g.name + ' (' + g.members.length + ')</span>';
    html += '</div>';
  }
  if (!html) html = '<p style="color:#888;font-size:13px">Henüz grubun yok.</p>';
  list.innerHTML = html;
}

async function createGroup() {
  const name = document.getElementById('group-name').value.trim();
  if (!name) return;
  const r = await fetch('/api/groups', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({name}) });
  const d = await r.json();
  if (d.ok) { loadGroups(); alert('✅ Grup oluşturuldu.'); }
}

async function inviteToGroup() {
  const username = document.getElementById('group-invite-username').value.trim().toLowerCase();
  if (!username) return;
  const g = groups[0]; // ilk gruba davet et
  if (!g) { alert('Önce grup oluştur.'); return; }
  const r = await fetch('/api/groups/' + g.id + '/invite', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({username}) });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  alert('✅ Davet gönderildi.');
}

// shop
async function buyItem(kind, id) {
  const r = await fetch('/api/shop/buy', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({kind,id}) });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  user = d.user;
  renderProfile();
  alert('✅ Satın alındı! Kalan coin: ' + d.coins);
}

// upload
async function uploadFile() {
  const fileInput = document.getElementById('file-input');
  const file = fileInput.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/upload', { method:'POST', headers:{'x-token':token}, body:fd });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  ws.send(JSON.stringify({ type:'message', text:'📎 ' + d.name + ' (' + (d.size/1024).toFixed(1) + 'KB) - /api/file/' + d.file.split('/').pop(), room:currentRoom }));
  fileInput.value = '';
}

// photo upload
async function uploadPhoto() {
  const fi = document.getElementById('photo-input');
  const file = fi.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch('/api/photo', { method:'POST', headers:{'x-token':token}, body:fd });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  user = d.user; renderProfile(); alert('✅ Profil fotoğrafı güncellendi.');
}

async function uploadAnimated() {
  const fi = document.getElementById('animated-input');
  const file = fi.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch('/api/animatedphoto', { method:'POST', headers:{'x-token':token}, body:fd });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  user = d.user; renderProfile(); alert('✅ Hareketli profil güncellendi.');
}

async function uploadBackground() {
  const fi = document.getElementById('bg-input');
  const file = fi.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch('/api/background', { method:'POST', headers:{'x-token':token}, body:fd });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  user = d.user; renderProfile(); alert('✅ Arka plan güncellendi.');
}

// WebRTC calls
let localStream = null;
let callInProgress = false;

async function startCall(targetUid, mode) {
  if (callInProgress) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' });
    const pc = new RTCPeerConnection({ iceServers: [{ urls:'stun:stun.l.google.com:19302' }] });
    peerConnections[targetUid] = pc;
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type:'ice_candidate', to:targetUid, candidate:e.candidate }));
    };
    pc.ontrack = (e) => {
      const video = document.getElementById('call-video');
      if (video) video.srcObject = e.streams[0];
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type:'call_offer', to:targetUid, offer, mode }));
    callInProgress = true;
    document.getElementById('call-panel').classList.remove('hidden');
  } catch(e) { alert('Arama başlatılamadı: ' + e.message); }
}

async function handleCall(d) {
  if (d.type === 'call_offer') {
    if (!confirm(d.fromUser + ' seni arıyor (' + (d.mode || 'ses') + '). Kabul ediyor musun?')) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: d.mode === 'video' });
      const pc = new RTCPeerConnection({ iceServers: [{ urls:'stun:stun.l.google.com:19302' }] });
      peerConnections[d.from] = pc;
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      pc.onicecandidate = (e) => {
        if (e.candidate) ws.send(JSON.stringify({ type:'ice_candidate', to:d.from, candidate:e.candidate }));
      };
      pc.ontrack = (e) => {
        const video = document.getElementById('call-video');
        if (video) video.srcObject = e.streams[0];
      };
      await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type:'call_answer', to:d.from, answer }));
      callInProgress = true;
      document.getElementById('call-panel').classList.remove('hidden');
    } catch(e) { alert('Arama hatası: ' + e.message); }
  }
  if (d.type === 'call_answer') {
    const pc = peerConnections[d.from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
  }
  if (d.type === 'ice_candidate') {
    const pc = peerConnections[d.from];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
  }
}

function endCall() {
  for (const id in peerConnections) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  callInProgress = false;
  document.getElementById('call-panel').classList.add('hidden');
  const video = document.getElementById('call-video');
  if (video) video.srcObject = null;
}

// admin panel
async function checkAdmin() {
  const r = await fetch('/api/admin/check', { headers:{'x-token':token} });
  const d = await r.json();
  return d.admin;
}

async function adminLookup() {
  const username = document.getElementById('admin-username').value.trim().toLowerCase();
  if (!username) return;
  const r = await fetch('/api/admin/lookup', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({username}) });
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  const u = d.user;
  document.getElementById('admin-result').innerHTML = `
    <p><b>${u.displayName}</b> (@${u.username})</p>
    <p>Role: ${u.role} | Coin: ${u.coins} | VIP: ${u.vip ? '✅' : '❌'}</p>
    <p>Yasaklı: ${u.banned ? '⛔ ' + u.banReason : 'Hayır'}</p>
    <p>Uyarı: ${(u.warnings||[]).length}</p>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:10px">
      <button class="btn-sm" onclick="adminBan('${u.username}')">⛔ Yasakla</button>
      <button class="btn-sm" onclick="adminUnban('${u.username}')">✅ Yasağı Kaldır</button>
      <button class="btn-sm" onclick="adminWarn('${u.username}')">⚠️ Uyar</button>
      <button class="btn-sm" onclick="adminVip('${u.username}',true)">👑 VIP Ver</button>
      <button class="btn-sm" onclick="adminVip('${u.username}',false)">👑 VIP Al</button>
      <button class="btn-sm" onclick="adminCoins('${u.username}')">🪙 Coin Ekle</button>
      <button class="btn-sm" onclick="adminDelete('${u.username}')">🗑️ Hesap Sil</button>
    </div>
  `;
}

async function adminBan(username) {
  const reason = prompt('Yasaklama sebebi:') || 'Admin yasağı';
  await fetch('/api/admin/ban', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({username,reason}) });
  alert('⛔ ' + username + ' yasaklandı.');
}

async function adminUnban(username) {
  await fetch('/api/admin/unban', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({username}) });
  alert('✅ Yasağı kaldırıldı.');
}

async function adminWarn(username) {
  const reason = prompt('Uyarı sebebi:') || 'Uyarı';
  await fetch('/api/admin/warn', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({username,reason}) });
  alert('⚠️ Uyarı gönderildi.');
}

async function adminVip(username, set) {
  await fetch('/api/admin/vip', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({username,set}) });
  alert(set ? '👑 VIP verildi.' : '👑 VIP alındı.');
}

async function adminCoins(username) {
  const amount = parseInt(prompt('Kaç coin ekle? (+/-):') || '0');
  if (!amount) return;
  await fetch('/api/admin/coins', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({username,amount}) });
  alert('🪙 Coin güncellendi.');
}

async function adminDelete(username) {
  if (!confirm(username + ' hesabını silmek istediğine emin misin?')) return;
  await fetch('/api/admin/deleteuser', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({username}) });
  alert('🗑️ Hesap silindi.');
}

async function adminBroadcast() {
  const message = document.getElementById('admin-broadcast-msg').value.trim();
  if (!message) return;
  await fetch('/api/admin/broadcast', { method:'POST', headers:{'Content-Type':'application/json','x-token':token}, body:JSON.stringify({message}) });
  document.getElementById('admin-broadcast-msg').value = '';
  alert('📢 Mesaj herkese gönderildi.');
}