// ===== SİSTEM =====
function beep(freq=800,dur=0.1){try{const a=new(window.AudioContext||window.webkitAudioContext)();const o=a.createOscillator();const g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=freq;o.type='sine';g.gain.setValueAtTime(0.3,a.currentTime);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+dur);o.start();o.stop(a.currentTime+dur)}catch(e){}}

function toast(msg,type){
  const c=document.getElementById('toast-container');
  if(!c)return;
  const t=document.createElement('div');
  t.className='toast '+(type||'info');
  t.textContent=msg;
  c.appendChild(t);
  if(type==='success')beep(1200,0.15);
  else if(type==='error')beep(300,0.2);
  else if(type==='warning')beep(600,0.15);
  else beep(800,0.1);
  requestAnimationFrame(()=>{requestAnimationFrame(()=>t.classList.add('show'))});
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),400)},4000);
}

let token=localStorage.getItem('plamtr_token')||'';
let user=null;
let ws=null;
let currentRoom='genel1';

async function api(method,path,body){
  const headers={'Content-Type':'application/json'};
  if(token)headers['x-token']=token;
  const r=await fetch('/api'+path,{method,headers,body:body?JSON.stringify(body):undefined});
  const d=await r.json();
  if(d.error)throw new Error(d.error);
  return d;
}

// ===== SPLASH =====
setTimeout(()=>{document.getElementById('splash').style.display='none';if(token)initApp();else showAuthForm('login');},1800);

// ===== AUTH FORMS =====
function showAuthForm(which){
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  ['login-form','register-form','forgot-form'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  document.getElementById('about-screen').classList.add('hidden');
  document.getElementById('tab-login').classList.toggle('active',which==='login');
  document.getElementById('tab-register').classList.toggle('active',which==='register');
  document.getElementById(which==='forgot'?'forgot-form':which+'-form').classList.remove('hidden');
}
function showForgot(){document.getElementById('auth-screen').classList.remove('hidden');['login-form','register-form'].forEach(id=>document.getElementById(id).classList.add('hidden'));document.getElementById('forgot-form').classList.remove('hidden');document.getElementById('about-screen').classList.add('hidden')}
function showAbout(){document.getElementById('auth-screen').classList.remove('hidden');['login-form','register-form','forgot-form'].forEach(id=>document.getElementById(id).classList.add('hidden'));document.getElementById('about-screen').classList.remove('hidden')}

function togglePass(id,btn){
  const inp=document.getElementById(id);
  if(inp.type==='password'){inp.type='text';btn.textContent='🙈'}
  else{inp.type='password';btn.textContent='👁️'}
}

// ===== REGISTER =====
async function checkUsername(){
  const v=document.getElementById('reg-username').value.trim().toLowerCase();
  const h=document.getElementById('reg-username-hint');
  if(!v){h.textContent='';return}
  if(v.length<3){h.textContent='❌ Çok kısa';return}
  try{
    const d=await api('GET','/check-username?u='+encodeURIComponent(v));
    h.textContent=d.taken?'❌ Bu isim alınmış':'✅ Bu isim müsait';
  }catch(e){}
}
function showCustomQuestion(){
  document.getElementById('custom-question-wrap').classList.toggle('hidden',document.getElementById('reg-question').value!=='custom');
}
function checkStrength(){
  const pw=document.getElementById('reg-password').value;
  const len=pw.length>=8&&pw.length<=20;
  const upper=/[A-Z]/.test(pw);
  const lower=/[a-z]/.test(pw);
  const num=/[0-9]/.test(pw);
  const score=[len,upper,lower,num].filter(Boolean).length;
  const fill=document.getElementById('strength-fill');
  const txt=document.getElementById('strength-text');
  const colors=['#b71c1c','#e65100','#f9a825','#0a8f3c'];
  const labels=['Zayıf','Orta','İyi','Güçlü'];
  fill.style.width=(score*25)+'%';
  fill.style.background=colors[score-1]||colors[0];
  txt.textContent=score===0?'':labels[score-1];
  txt.style.color=colors[score-1];
  document.getElementById('rule-len').classList.toggle('ok',len);
  document.getElementById('rule-upper').classList.toggle('ok',upper);
  document.getElementById('rule-lower').classList.toggle('ok',lower);
  document.getElementById('rule-num').classList.toggle('ok',num);
}
async function doRegister(){
  const username=document.getElementById('reg-username').value.trim().toLowerCase();
  const email=document.getElementById('reg-email').value.trim();
  const questionId=document.getElementById('reg-question').value;
  const questionText=questionId==='custom'?document.getElementById('reg-custom-question').value.trim():'';
  const answer=document.getElementById('reg-answer').value.trim();
  const pw=document.getElementById('reg-password').value;
  const pw2=document.getElementById('reg-password2').value;
  if(!username){toast('Kullanıcı adı gerekli!','warning');return}
  if(!answer){toast('Güvenlik sorusunun cevabı gerekli!','warning');return}
  if(pw.length<8||pw.length>20){toast('Şifre 8-20 karakter olmalı!','warning');return}
  if(!/[A-Z]/.test(pw)){toast('Şifre büyük harf içermeli!','warning');return}
  if(!/[a-z]/.test(pw)){toast('Şifre küçük harf içermeli!','warning');return}
  if(!/[0-9]/.test(pw)){toast('Şifre rakam içermeli!','warning');return}
  if(pw!==pw2){toast('Şifreler eşleşmiyor!','warning');return}
  try{
    const d=await api('POST','/register',{fullName:username,username,email,questionId,questionText,answer,password:pw});
    token=d.token;user=d.user;
    localStorage.setItem('plamtr_token',token);
    toast('Kayıt başarılı! 200 coin kazandın 🪙','success');
    initApp();
  }catch(e){toast('Kayıt başarısız: '+e.message,'error')}
}

// ===== LOGIN =====
async function doLogin(){
  const username=document.getElementById('login-username').value.trim().toLowerCase();
  const password=document.getElementById('login-password').value;
  if(!username||!password){toast('Kullanıcı adı ve şifre gerekli!','warning');return}
  try{
    const d=await api('POST','/login',{username,password});
    token=d.token;user=d.user;
    localStorage.setItem('plamtr_token',token);
    toast('Giriş başarılı! Yönlendiriliyorsun…','success');
    initApp();
  }catch(e){toast('Giriş başarısız: '+e.message,'error')}
}

// ===== FORGOT =====
async function forgotQuestion(){
  const u=document.getElementById('forgot-username').value.trim().toLowerCase();
  try{
    const d=await api('POST','/forgot/question',{username:u});
    document.getElementById('forgot-q-text').textContent='🔑 '+d.question;
    document.getElementById('forgot-answer-wrap').classList.remove('hidden');
  }catch(e){toast(e.message,'error')}
}
async function forgotEmail(){
  const u=document.getElementById('forgot-username').value.trim().toLowerCase();
  try{
    await api('POST','/forgot/email',{username:u});
    document.getElementById('forgot-info').textContent='📧 Kod e-postana gönderildi.';
    document.getElementById('forgot-code-wrap').classList.remove('hidden');
  }catch(e){toast(e.message,'error')}
}
async function submitForgotAnswer(){
  const u=document.getElementById('forgot-username').value.trim().toLowerCase();
  const a=document.getElementById('forgot-answer').value.trim();
  try{
    await api('POST','/forgot/answer',{username:u,answer:a});
    document.getElementById('forgot-code-wrap').classList.remove('hidden');
    toast('Cevap doğru! Kodu gir.','success');
  }catch(e){toast('Cevap yanlış!','error')}
}
async function doResetPw(){
  const u=document.getElementById('forgot-username').value.trim().toLowerCase();
  const code=document.getElementById('forgot-code').value.trim();
  const pw=document.getElementById('forgot-newpw').value;
  try{
    await api('POST','/forgot/reset',{username:u,code,password:pw});
    toast('Şifre sıfırlandı! Giriş yap.','success');
    showAuthForm('login');
  }catch(e){toast(e.message,'error')}
}

// ===== APP INIT =====
function initApp(){
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateProfile();
  connectWS();
  loadHistory();
  showPanel('chat');
}
function updateProfile(){
  document.getElementById('profile-name').textContent=user.displayName;
  document.getElementById('profile-username').textContent='@'+user.username;
  document.getElementById('profile-coins').textContent='🪙 '+user.coins+' Coin';
  document.getElementById('profile-vip').textContent=user.vip?'👑 VIP':'👤 Normal';
}
function connectWS(){
  ws=new WebSocket('ws://localhost:3000/ws/'+token);
  ws.onmessage=async(e)=>{
    const d=JSON.parse(e.data);
    if(d.type==='message')addMessage(d);
    if(d.type==='online')document.getElementById('online-count').textContent='🟢 '+d.count+' çevrimiçi';
    if(d.type==='call_offer'){await handleCallOffer(d)}
    if(d.type==='call_answer'){const pc=peerConnections[d.from];if(pc)await pc.setRemoteDescription(new RTCSessionDescription(d.answer))}
    if(d.type==='ice_candidate'){const pc=peerConnections[d.from];if(pc)await pc.addIceCandidate(new RTCIceCandidate(d.candidate))}
  };
}
async function loadHistory(){
  try{
    const d=await api('GET','/history?room='+currentRoom);
    document.getElementById('chat-messages').innerHTML='';
    d.messages.forEach(m=>addMessage(m,true));
  }catch(e){}
}
function addMessage(m,noScroll){
  const el=document.createElement('div');
  const isOwn=m.userId===user.id;
  el.className='msg '+(isOwn?'own':'other');
  const name=isOwn?user.displayName:(m.displayName||m.username);
  const time=new Date(m.ts).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
  el.innerHTML='<div class="msg-name">'+name+'</div><div class="msg-text"></div><div class="msg-time">'+time+'</div>';
  el.querySelector('.msg-text').textContent=m.text;
  if(!noScroll)beep(880,0.08);
  const box=document.getElementById('chat-messages');
  box.appendChild(el);
  box.scrollTop=box.scrollHeight;
}
function sendMessage(){
  const inp=document.getElementById('msg-input');
  const text=inp.value.trim();
  if(!text)return;
  api('POST','/message',{room:currentRoom,text}).then(()=>{
    inp.value='';
  }).catch(e=>toast(e.message,'error'));
}
function switchRoom(room){
  currentRoom=room;
  document.querySelectorAll('.room-btn').forEach(b=>b.classList.toggle('active',b.dataset.room===room));
  const titles={genel1:'#genel1 — Genel Sohbet 1',genel2:'#genel2 — Genel Sohbet 2',genel3:'#genel3 — Genel Sohbet 3'};
  document.getElementById('chat-title').textContent='💬 '+(titles[room]||room);
  loadHistory();
}

// ===== PANELS =====
function showPanel(name,btn){
  document.querySelectorAll('.panel').forEach(p=>p.classList.add('hidden'));
  document.getElementById('panel-'+name).classList.remove('hidden');
  document.querySelectorAll('.sidebar-tab').forEach(t=>t.classList.remove('active'));
  if(btn)btn.classList.add('active');
  else{
    const tabs={chat:0,friends:1,groups:2,profile:3,shop:4,settings:5};
    document.querySelectorAll('.sidebar-tab')[tabs[name]]?.classList.add('active');
  }
}

// ===== FRIENDS =====
async function addFriend(){
  const u=document.getElementById('friend-username').value.trim().toLowerCase();
  try{await api('POST','/friend/add',{username:u});toast('Arkadaş eklendi!','success');document.getElementById('friend-username').value='';loadFriends()}catch(e){toast(e.message,'error')}
}
async function loadFriends(){
  try{
    const d=await api('GET','/friends');
    document.getElementById('friends-list').innerHTML=d.friends.map(f=>'<div style="padding:8px 0;border-bottom:1px solid #21262d">'+f.displayName+' <span style="color:#8b949e">(@'+f.username+')</span></div>').join('');
  }catch(e){}
}

// ===== GROUPS =====
async function createGroup(){
  const name=document.getElementById('group-name').value.trim();
  try{await api('POST','/group/create',{name});toast('Grup oluşturuldu!','success');document.getElementById('group-name').value='';}catch(e){toast(e.message,'error')}
}
async function inviteToGroup(){
  const u=document.getElementById('group-invite-username').value.trim().toLowerCase();
  try{await api('POST','/group/invite',{username:u});toast('Davet gönderildi!','success');document.getElementById('group-invite-username').value='';}catch(e){toast(e.message,'error')}
}

// ===== SHOP =====
async function buyItem(type,id){
  try{await api('POST','/buy',{type,id});toast('Satın alındı!','success');updateProfile()}catch(e){toast(e.message,'error')}
}

// ===== SETTINGS =====
function toggleTheme(){
  const t=document.getElementById('profile-theme').value;
  document.body.classList.toggle('light',t==='light');
  api('POST','/settings',{theme:t});
}
function toggleFilter(){api('POST','/settings',{filter:document.getElementById('profile-filter').checked})}

// ===== PROFILE EDIT =====
function showProfileEdit(){
  const bio=prompt('Bio:',user.bio||'');
  if(bio!==null)api('POST','/profile',{bio}).then(()=>{user.bio=bio;updateProfile();toast('Profil güncellendi!','success')});
}

// ===== CALLS =====
let peerConnections={};let localStream=null;let callInProgress=false;
async function startCall(userId,type){
  callInProgress=true;
  const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  peerConnections[userId]=pc;
  try{
    localStream=await navigator.mediaDevices.getUserMedia({video:type==='video',audio:true});
  }catch(e){toast('Kamera/mikrofon izni gerekli!','error');callInProgress=false;return}
  if(localStream){
    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  }
  const offer=await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({type:'call_offer',to:userId,callType:type,offer:pc.localDescription}));
}
async function handleCallOffer(d){
  const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  peerConnections[d.from]=pc;
  if(d.callType==='audio'||d.callType==='video'){
    try{
      localStream=await navigator.mediaDevices.getUserMedia({video:d.callType==='video',audio:true});
      localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    }catch(e){}
  }
  await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
  const answer=await pc.createAnswer();
  await pc.setLocalDescription(answer);
  ws.send(JSON.stringify({type:'call_answer',to:d.from,answer:pc.localDescription}));
}
function endCall(){
  for(const id in peerConnections){peerConnections[id].close();delete peerConnections[id]}
  if(localStream)localStream.getTracks().forEach(t=>t.stop());
  callInProgress=false;
}

// ===== ADMIN =====
async function checkAdmin(){
  try{const d=await api('GET','/admin/check');return d.admin}catch(e){return false}
}
async function adminLookup(){
  const u=document.getElementById('admin-username').value.trim().toLowerCase();
  try{
    const d=await api('POST','/admin/lookup',{username:u});
    document.getElementById('admin-result').innerHTML='<p><b>'+d.user.displayName+'</b> (@'+d.user.username+')</p><p>Coin: '+d.user.coins+' | VIP: '+(d.user.vip?'✅':'❌')+'</p><p>Yasaklı: '+(d.user.banned?'⛔':'Hayır')+'</p><div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px"><button class="btn-sm" onclick="adminBan(\''+d.user.username+'\')">⛔ Yasakla</button><button class="btn-sm" onclick="adminVip(\''+d.user.username+'\',true)">👑 VIP</button><button class="btn-sm" onclick="adminCoins(\''+d.user.username+'\')">🪙 Coin</button></div>';
  }catch(e){toast(e.message,'error')}
}
async function adminBan(u){const r=prompt('Sebebi:')||'Admin yasağı';await api('POST','/admin/ban',{username:u,reason:r});toast('Yasaklandı','success')}
async function adminVip(u,s){await api('POST','/admin/vip',{username:u,set:s});toast(s?'VIP verildi':'VIP alındı','success')}
async function adminCoins(u){const a=parseInt(prompt('Coin (+/-):')||'0');await api('POST','/admin/coins',{username:u,amount:a});toast('Coin güncellendi','success')}

// ===== LOGOUT =====
function doLogout(){
  token='';user=null;
  localStorage.removeItem('plamtr_token');
  if(ws)ws.close();
  showAuthForm('login');
}

// Enter ile mesaj gönder
document.getElementById('msg-input').addEventListener('keydown',(e)=>{if(e.key==='Enter')sendMessage()});

// İlk yükleme
if(token){
  fetch('/api/me',{headers:{'x-token':token}}).then(r=>r.json()).then(d=>{
    if(d.user){user=d.user;initApp()}else showAuthForm('login');
  }).catch(()=>showAuthForm('login'));
}else showAuthForm('login');