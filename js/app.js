import { FIREBASE_CONFIG, isConfigured } from './config.js';

const root = document.getElementById('root');

if (!isConfigured) {
  renderSetupGuide();
} else {
  boot();
}

/* ---------------------------------------------------------------------- */
/* SETUP GUIDE (shown until FIREBASE_CONFIG is filled in)                 */
/* ---------------------------------------------------------------------- */
function renderSetupGuide(){
  root.innerHTML = `
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
    <div class="card" style="max-width:640px;padding:36px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
        <div style="width:36px;height:36px;border-radius:9px;background:var(--ink);color:var(--accent);display:flex;align-items:center;justify-content:center;font-family:'Barlow Semi Condensed';font-weight:800;font-size:20px;">+</div>
        <div class="font-display" style="font-size:22px;font-weight:700;">Estoque+ precisa ser configurado</div>
      </div>
      <p style="color:var(--ink-soft);font-size:14px;line-height:1.6;margin-bottom:16px;">
        Este Mini-ERP usa <b>Firebase</b> (Authentication + Firestore) como banco de dados.
        Antes de usar, edite o objeto <code class="font-mono" style="background:#F1EFE8;padding:2px 6px;border-radius:5px;">FIREBASE_CONFIG</code> no topo do arquivo <code class="font-mono" style="background:#F1EFE8;padding:2px 6px;border-radius:5px;">index.html</code> com as chaves do seu projeto.
      </p>
      <ol style="font-size:13.5px;color:var(--ink);line-height:2;padding-left:20px;">
        <li>Crie um projeto em <b>console.firebase.google.com</b></li>
        <li>Ative o login com <b>Google</b> em Authentication → Sign-in method</li>
        <li>Crie um <b>Firestore Database</b> (modo produção, qualquer região)</li>
        <li>Em Configurações do projeto → Seus apps → Web, copie a config</li>
        <li>Cole no topo deste arquivo, salve e recarregue a página</li>
        <li>Publique as regras do arquivo <b>firestore.rules</b> incluído no projeto</li>
      </ol>
      <p style="font-size:12.5px;color:var(--muted);margin-top:16px;">Consulte o <b>README.md</b> incluído para o passo a passo completo, com prints do que preencher em cada tela.</p>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------- */
/* APP BOOTSTRAP                                                          */
/* ---------------------------------------------------------------------- */
async function boot(){
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
  const fsMod   = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);
  const provider = new authMod.GoogleAuthProvider();

  const F = {
    doc: fsMod.doc, getDoc: fsMod.getDoc, setDoc: fsMod.setDoc, addDoc: fsMod.addDoc,
    updateDoc: fsMod.updateDoc, deleteDoc: fsMod.deleteDoc, collection: fsMod.collection,
    onSnapshot: fsMod.onSnapshot, query: fsMod.query, orderBy: fsMod.orderBy,
    where: fsMod.where, runTransaction: fsMod.runTransaction, serverTimestamp: fsMod.serverTimestamp,
    increment: fsMod.increment, limit: fsMod.limit
  };

  /* ---------------- GLOBAL STATE ---------------- */
  const S = {
    user: null,          // firebase auth user
    profile: null,       // {name,email,photoURL,role,active}
    products: [],
    movements: [],
    users: [],
    view: 'dashboard',
    unsub: [],
    filters: { prodSearch:'', prodSort:'name-asc', movType:'all', movProduct:'all', repFrom:'', repTo:'' },
    charts: {},
  };

  // ---- Sessão única: cada login gera um ID aleatório e grava no próprio
  // perfil (users/{uid}.sessionId). Se esse campo mudar pra outro valor (ou
  // seja, alguém logou em outro lugar), essa aba se desconecta sozinha.
  let mySessionId = null;
  let sessionClaimed = false;
  function newSessionId(){
    return (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now()+'-'+Math.random().toString(36).slice(2));
  }

  const ROLE_LABEL = { admin:'Administrador', gerente:'Gerente', operador:'Operador', pendente:'Pendente' };
  const PERMS = {
    admin:    { viewProducts:true, editProducts:true, deleteProducts:true, registerMov:true, viewReports:true, manageUsers:true },
    gerente:  { viewProducts:true, editProducts:true, deleteProducts:false, registerMov:true, viewReports:true, manageUsers:false },
    operador: { viewProducts:true, editProducts:false, deleteProducts:false, registerMov:true, viewReports:false, manageUsers:false },
    pendente: { viewProducts:false, editProducts:false, deleteProducts:false, registerMov:false, viewReports:false, manageUsers:false },
  };
  const can = (perm) => S.profile && PERMS[S.profile.role] && PERMS[S.profile.role][perm];

  /* ---------------- UTILITIES ---------------- */
  const fmtBRL = (n) => (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const fmtNum = (n) => (Number(n)||0).toLocaleString('pt-BR');
  const fmtDate = (ts) => {
    if(!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  };
  const fmtDateOnly = (ts) => {
    if(!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('pt-BR');
  };
  const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => Math.random().toString(36).slice(2,10);

  /* ---------------- ICONS (inline SVG, stroke-based) ---------------- */
  const ICON_PATHS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    products: '<path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z"/><path d="M3 7.5v9L12 21l9-4.5v-9"/><path d="M12 12v9"/>',
    movements: '<path d="M4 7h13"/><path d="M14 3l3 4-3 4"/><path d="M20 17H7"/><path d="M10 21l-3-4 3-4"/>',
    reports: '<path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/>',
    users: '<circle cx="8.5" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.2 14.3c2.6.3 4.3 2.4 4.3 5.7"/>',
    camera: '<rect x="3" y="7" width="18" height="13" rx="2.2"/><path d="M8 7l1.6-2.4A1.6 1.6 0 0 1 10.9 4h2.2c.5 0 .97.26 1.24.66L15.9 7"/><circle cx="12" cy="13.5" r="3.6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    edit: '<path d="M4 20h4L18.6 9.4a2 2 0 0 0 0-2.8L17.4 5.4a2 2 0 0 0-2.8 0L4 16v4Z"/><path d="M13.5 6.5l4 4"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    arrowDown: '<path d="M12 4v15"/><path d="M6 13l6 6 6-6"/>',
    arrowUp: '<path d="M12 20V5"/><path d="M6 11l6-6 6 6"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>',
    x: '<path d="M5 5l14 14"/><path d="M19 5 5 19"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    box: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    boxCheck: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/><path d="M9 12.5l1.6 1.6L15 10"/>',
    truck: '<rect x="1" y="6" width="13" height="11" rx="1.2"/><path d="M14 10h4l4 4v3h-8z"/><circle cx="6" cy="19.5" r="1.8"/><circle cx="17.5" cy="19.5" r="1.8"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    clipboardCheck: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 13l2 2 4-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3 10h18"/>',
    route: '<circle cx="6" cy="6" r="2.3"/><circle cx="18" cy="18" r="2.3"/><path d="M6 8.3V13a4 4 0 0 0 4 4h4"/>',
    forklift: '<path d="M3 17h4v-8"/><path d="M7 9h3l3 4"/><rect x="13" y="13" width="6" height="4" rx=".8"/><circle cx="8" cy="19.5" r="1.6"/><circle cx="16.5" cy="19.5" r="1.6"/><path d="M3 6v11"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M16 7l3 3"/><path d="M13 10l2.5 2.5"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3Z"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v3"/>',
    warehouse: '<path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H4a1 1 0 0 1-1-1V10.5Z"/><path d="M9 21v-4h6v4"/>',
  };
  function icon(name, size=16, strokeWidth=2){
    return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]||''}</svg>`;
  }

  /* ---------------- IMAGE HELPERS (product photo) ---------------- */
  // Redimensiona a imagem no navegador e devolve um data-URL JPEG compacto,
  // para guardarmos a foto direto no documento do Firestore sem precisar
  // configurar o Firebase Storage.
  function resizeImageFile(file, maxSize=480, quality=0.74){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if(width > height){ if(width > maxSize){ height = Math.round(height * (maxSize/width)); width = maxSize; } }
          else { if(height > maxSize){ width = Math.round(width * (maxSize/height)); height = maxSize; } }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.readAsDataURL(file);
    });
  }

  function toast(msg, type='default'){
    let host = document.getElementById('toast-host');
    if(!host){
      host = document.createElement('div');
      host.id = 'toast-host';
      host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px;max-width:360px;';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (type==='error'?'error':type==='success'?'success':'');
    el.style.justifyContent = 'space-between';
    const span = document.createElement('span'); span.textContent = msg;
    const close = document.createElement('span');
    close.textContent = '✕'; close.style.cssText = 'cursor:pointer;opacity:.7;margin-left:10px;';
    close.onclick = () => el.remove();
    el.appendChild(span); el.appendChild(close);
    host.appendChild(el);
    const duration = type==='error' ? 12000 : 3200;
    setTimeout(()=>{ if(!el.isConnected) return; el.style.opacity='0'; el.style.transition='.25s'; setTimeout(()=>el.remove(),250); }, duration);
  }

  function closeModal(){
    const m = document.getElementById('modal-root');
    if(m) m.remove();
  }
  function openModal(html){
    closeModal();
    const wrap = document.createElement('div');
    wrap.id = 'modal-root';
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal-box">${html}</div>`;
    wrap.addEventListener('mousedown', (e)=>{ if(e.target === wrap) closeModal(); });
    document.body.appendChild(wrap);
  }

  function stockStatus(p){
    const min = Number(p.minStock)||0;
    const cur = Number(p.currentStock)||0;
    if(cur <= 0) return {label:'ESGOTADO', cls:'tag-danger'};
    if(cur <= min) return {label:'BAIXO', cls:'tag-warn'};
    return {label:'OK', cls:'tag-ok'};
  }

  /* ---------------- AUTH FLOW ---------------- */
  function renderAuthError(user, err){
    const code = err && err.code ? err.code : '';
    let hint = 'Verifique se as regras do Firestore (firestore.rules) foram publicadas corretamente no console do Firebase.';
    if(code === 'permission-denied' || /permission/i.test(err && err.message || '')){
      hint = 'O Firestore recusou a gravação do seu perfil (permission-denied). Publique o conteúdo do arquivo <b>firestore.rules</b> em Firestore Database → Regras, no console do Firebase.';
    } else if(code === 'unavailable'){
      hint = 'Não foi possível falar com o Firestore agora. Confira sua conexão e tente de novo.';
    }
    root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div class="card" style="max-width:460px;padding:32px;">
        <div class="tag tag-danger" style="margin-bottom:14px;">FALHA AO PREPARAR SUA CONTA</div>
        <div class="font-display" style="font-size:19px;font-weight:700;margin-bottom:8px;">Login funcionou, mas algo travou depois</div>
        <p style="color:var(--ink-soft);font-size:13.5px;line-height:1.6;">${hint}</p>
        <div style="background:#F6F5F0;border-radius:8px;padding:10px 12px;margin-top:12px;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--ink-soft);word-break:break-word;">
          ${escapeHtml(code || (err && err.message) || 'erro desconhecido')}
        </div>
        <div style="display:flex;gap:8px;margin-top:20px;">
          <button class="btn btn-accent" onclick="location.reload()">Tentar novamente</button>
          <button class="btn btn-ghost" onclick="window.__signOut()">Sair</button>
        </div>
      </div>
    </div>`;
  }

  authMod.onAuthStateChanged(auth, async (user) => {
    S.unsub.forEach(u=>u()); S.unsub = [];
    if(!user){ S.user=null; S.profile=null; renderLogin(); return; }
    S.user = user;
    try{
      await ensureUserProfile(user);
      // Reivindica esta aba como a sessão ativa: sobrescreve o sessionId no
      // Firestore. Qualquer outra aba/dispositivo já logado com esse mesmo
      // usuário vai perceber (via listenUsers) que o sessionId mudou e vai
      // se desconectar sozinho.
      mySessionId = newSessionId();
      sessionClaimed = false;
      await F.updateDoc(F.doc(db,'users',user.uid), { sessionId: mySessionId, lastLoginAt: F.serverTimestamp() });
      sessionClaimed = true;
      listenUsers();   // needed to know own profile/role live
      listenProducts();
      listenMovements();
      renderShell();
    }catch(err){
      console.error('Erro ao preparar perfil do usuário:', err);
      renderAuthError(user, err);
    }
  });

  // Login: popup como via principal, com fallback para redirect. Agora que o
  // authDomain é o próprio domínio do app (proxiado via vercel.json), tanto o
  // popup quanto o redirect deixam de sofrer com bloqueio de storage entre
  // domínios diferentes — o que causava o "missing initial state" antes.
  // setPersistence roda uma única vez aqui embaixo (fora do clique) para não
  // atrasar a chamada de signInWithPopup: um `await` logo antes dela pode
  // fazer o Firefox descartar o gesto de clique do usuário e bloquear o popup.
  authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(()=>{});

  let signInInFlight = false; // trava contra duplo clique: um 2º popup cancela o 1º e gera erro falso
  window.__signIn = async () => {
    if(signInInFlight) return;
    signInInFlight = true;
    const btn = document.getElementById('btn-google-signin');
    if(btn) btn.disabled = true;
    try{
      await authMod.signInWithPopup(auth, provider);
    } catch(e){
      const fallback = ['auth/popup-blocked','auth/cancelled-popup-request'];
      if(e.code === 'auth/popup-closed-by-user'){
        // Usuário fechou o popup por conta própria — não é erro, não precisa de toast.
        return;
      }
      if(fallback.includes(e.code)){
        try{ await authMod.signInWithRedirect(auth, provider); return; }
        catch(e2){ toast('Não foi possível entrar: '+ (e2.code||e2.message), 'error'); return; }
      }
      let msg;
      if(e && e.code === 'auth/unauthorized-domain'){
        msg = `O domínio "${location.hostname}" não está autorizado no Firebase. Adicione em Authentication > Configurações > Domínios autorizados.`;
      } else {
        msg = 'Não foi possível entrar: ' + (e.code||e.message);
      }
      toast(msg, 'error');
    } finally {
      signInInFlight = false;
      if(btn) btn.disabled = false;
    }
  };
  window.__signOut = () => {
    openModal(`
      <div style="padding:28px;text-align:center;">
        <div class="empty-icon" style="background:var(--out-soft);color:var(--out);margin-bottom:16px;">${icon('logout',20)}</div>
        <div class="font-display" style="font-size:18px;font-weight:700;margin-bottom:8px;">Sair da conta?</div>
        <p style="color:var(--ink-soft);font-size:13.5px;line-height:1.6;margin:0 0 22px;">Você precisará entrar novamente com sua conta Google para acessar o sistema.</p>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-ghost" style="flex:1;justify-content:center;" onclick="window.__closeModal()">Cancelar</button>
          <button class="btn btn-danger" style="flex:1;justify-content:center;" onclick="window.__confirmSignOut()">${icon('logout',14)} Sair</button>
        </div>
      </div>
    `);
  };
  window.__closeModal = () => closeModal();
  window.__confirmSignOut = async () => {
    closeModal();
    await authMod.signOut(auth);
  };

  // Captura o resultado quando o login cai no fallback de redirect.
  authMod.getRedirectResult(auth).then((result)=>{
    if(result && result.user) toast('Login realizado com sucesso.', 'success');
  }).catch((e)=>{
    console.error('Erro no login por redirecionamento:', e);
    let msg = 'Não foi possível concluir o login: ' + (e && (e.code||e.message));
    if(e && e.code === 'auth/unauthorized-domain'){
      msg = `O domínio "${location.hostname}" não está autorizado no Firebase. Adicione em Authentication > Configurações > Domínios autorizados.`;
    }
    toast(msg, 'error');
  });

  async function ensureUserProfile(user){
    const ref = F.doc(db, 'users', user.uid);
    const snap = await F.getDoc(ref);
    if(snap.exists()) return;
    // decide role: first user ever -> admin
    const usersSnap = await F.getDoc(F.doc(db,'meta','counters')).catch(()=>null);
    let isFirst = false;
    await F.runTransaction(db, async (tx) => {
      const counterRef = F.doc(db,'meta','counters');
      const counterSnap = await tx.get(counterRef);
      const count = counterSnap.exists() ? (counterSnap.data().userCount||0) : 0;
      isFirst = count === 0;
      tx.set(counterRef, { userCount: count + 1 }, { merge:true });
      tx.set(ref, {
        name: user.displayName || user.email,
        email: user.email,
        photoURL: user.photoURL || '',
        role: isFirst ? 'admin' : 'pendente',
        active: isFirst,
        createdAt: F.serverTimestamp(),
      });
    });
    if(isFirst) toast('Bem-vindo! Você é o administrador inicial do sistema.', 'success');
  }

  /* ---------------- FIRESTORE LISTENERS ---------------- */
  function listenUsers(){
    const qUsers = F.query(F.collection(db,'users'), F.orderBy('createdAt','asc'));
    const un = F.onSnapshot(qUsers, (snap) => {
      S.users = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      const mine = S.users.find(u => u.id === S.user.uid);
      // Se já reivindicamos a sessão e o servidor mostra um sessionId
      // diferente do nosso, é porque o mesmo usuário logou em outro
      // dispositivo/navegador depois de nós — encerramos esta sessão aqui.
      if(sessionClaimed && mine && mine.sessionId && mine.sessionId !== mySessionId){
        sessionClaimed = false;
        toast('Sua conta foi acessada em outro dispositivo ou navegador. Esta sessão foi encerrada.', 'error');
        authMod.signOut(auth);
        return;
      }
      S.profile = mine || { role:'pendente', active:false, name:S.user.displayName, email:S.user.email };
      renderShell();
    }, (err)=> toast('Erro ao carregar usuários: '+err.message,'error'));
    S.unsub.push(un);
  }
  function listenProducts(){
    const qP = F.query(F.collection(db,'products'), F.orderBy('name','asc'));
    const un = F.onSnapshot(qP, (snap) => {
      S.products = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderShell();
    }, (err)=> toast('Erro ao carregar produtos: '+err.message,'error'));
    S.unsub.push(un);
  }
  function listenMovements(){
    const qM = F.query(F.collection(db,'movements'), F.orderBy('createdAt','desc'), F.limit(500));
    const un = F.onSnapshot(qM, (snap) => {
      S.movements = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderShell();
    }, (err)=> toast('Erro ao carregar movimentações: '+err.message,'error'));
    S.unsub.push(un);
  }

  /* ---------------- ACTIONS: PRODUCTS ---------------- */
  window.__openProductModal = (id) => {
    const p = id ? S.products.find(x=>x.id===id) : null;
    let photoData = p && p.photo ? p.photo : '';
    openModal(`
      <form id="product-form" style="padding:22px;">
        <div class="font-display" style="font-size:19px;font-weight:700;margin-bottom:4px;">${p?'Editar produto':'Novo produto'}</div>
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:16px;">${p?('SKU '+escapeHtml(p.sku)):'Preencha os dados do item de estoque'}</div>

        <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:18px;">
          <div class="photo-drop" id="photo-drop">
            <div id="photo-drop-content">${photoData
              ? `<img src="${photoData}" alt="Foto do produto" />`
              : `<div class="photo-placeholder">${icon('camera',22)}<span>Adicionar foto</span></div>`}</div>
          </div>
          <input type="file" id="photo-input" accept="image/*" style="display:none;" />
          <div style="flex:1;padding-top:2px;">
            <label class="field-label">Foto do produto</label>
            <div style="font-size:12px;color:var(--ink-soft);line-height:1.5;">Clique na área ao lado ou arraste uma imagem (JPG/PNG, até 5MB). A imagem é redimensionada automaticamente.</div>
            <button type="button" class="btn btn-ghost btn-sm" id="photo-remove-btn" style="margin-top:9px;${photoData?'':'display:none;'}">${icon('trash',13)} Remover foto</button>
          </div>
        </div>

        <div class="form-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div style="grid-column:1/-1;">
            <label class="field-label">Nome do produto</label>
            <input class="input" name="name" required value="${p?escapeHtml(p.name):''}" placeholder="Ex: Parafuso sextavado M6" />
          </div>
          <div>
            <label class="field-label">SKU / Código</label>
            <input class="input font-mono" name="sku" required value="${p?escapeHtml(p.sku):''}" placeholder="SKU-0001" />
          </div>
          <div>
            <label class="field-label">Categoria</label>
            <input class="input" name="category" value="${p?escapeHtml(p.category||''):''}" placeholder="Ferragens" />
          </div>
          <div>
            <label class="field-label">Unidade</label>
            <input class="input" name="unit" value="${p?escapeHtml(p.unit||'un'):'un'}" placeholder="un / kg / cx" />
          </div>
          <div>
            <label class="field-label">Estoque mínimo</label>
            <input class="input" name="minStock" type="number" min="0" step="1" value="${p?p.minStock:0}" />
          </div>
          <div>
            <label class="field-label">Preço de custo (R$)</label>
            <input class="input" name="costPrice" type="number" min="0" step="0.01" value="${p?p.costPrice:0}" />
          </div>
          <div>
            <label class="field-label">Preço de venda (R$)</label>
            <input class="input" name="salePrice" type="number" min="0" step="0.01" value="${p?p.salePrice:0}" />
          </div>
          ${!p ? `<div>
            <label class="field-label">Estoque inicial</label>
            <input class="input" name="initialStock" type="number" min="0" step="1" value="0" />
          </div>` : ''}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:22px;">
          <button type="button" class="btn btn-ghost" onclick="closeModalGlobal()">Cancelar</button>
          <button type="submit" class="btn btn-accent">${p?'Salvar alterações':'Cadastrar produto'}</button>
        </div>
      </form>
    `);
    window.closeModalGlobal = closeModal;

    /* --- Photo dropzone wiring --- */
    const dropZone = document.getElementById('photo-drop');
    const dropContent = document.getElementById('photo-drop-content');
    const photoInput = document.getElementById('photo-input');
    const removeBtn = document.getElementById('photo-remove-btn');

    function renderPhotoPreview(){
      dropContent.innerHTML = photoData
        ? `<img src="${photoData}" alt="Foto do produto" />`
        : `<div class="photo-placeholder">${icon('camera',22)}<span>Adicionar foto</span></div>`;
      removeBtn.style.display = photoData ? '' : 'none';
    }
    async function handleFile(file){
      if(!file) return;
      if(!file.type.startsWith('image/')){ toast('Selecione um arquivo de imagem.', 'error'); return; }
      if(file.size > 5*1024*1024){ toast('Imagem muito grande (máximo 5MB).', 'error'); return; }
      try{
        photoData = await resizeImageFile(file);
        renderPhotoPreview();
      }catch(err){ toast('Não foi possível processar a imagem: '+err.message, 'error'); }
    }
    dropZone.addEventListener('click', ()=> photoInput.click());
    photoInput.addEventListener('change', ()=> handleFile(photoInput.files[0]));
    dropZone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropZone.classList.add('drag'); });
    dropZone.addEventListener('dragleave', ()=> dropZone.classList.remove('drag'));
    dropZone.addEventListener('drop', (e)=>{
      e.preventDefault(); dropZone.classList.remove('drag');
      handleFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    removeBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      photoData = '';
      photoInput.value = '';
      renderPhotoPreview();
    });

    document.getElementById('product-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = {
        name: fd.get('name').trim(),
        sku: fd.get('sku').trim(),
        category: fd.get('category').trim(),
        unit: fd.get('unit').trim() || 'un',
        minStock: Number(fd.get('minStock'))||0,
        costPrice: Number(fd.get('costPrice'))||0,
        salePrice: Number(fd.get('salePrice'))||0,
        photo: photoData || '',
        updatedAt: F.serverTimestamp(),
      };
      // SKU/Código precisa ser único: comparação sem diferenciar maiúsculas/
      // minúsculas nem espaços, ignorando o próprio produto quando é edição.
      const skuKey = data.sku.trim().toLowerCase();
      const dup = S.products.some(x => x.id !== (p?p.id:null) && (x.sku||'').trim().toLowerCase() === skuKey);
      if(dup){
        toast('Já existe um produto com esse SKU/Código. Escolha um código único.', 'error');
        return;
      }
      try{
        if(p){
          await F.updateDoc(F.doc(db,'products',p.id), data);
          toast('Produto atualizado.', 'success');
        } else {
          data.currentStock = Number(fd.get('initialStock'))||0;
          data.active = true;
          data.createdAt = F.serverTimestamp();
          await F.addDoc(F.collection(db,'products'), data);
          toast('Produto cadastrado.', 'success');
        }
        closeModal();
      }catch(err){ toast('Erro ao salvar: '+err.message, 'error'); }
    });
  };

  window.__deleteProduct = async (id) => {
    if(!confirm('Excluir este produto? Esta ação não pode ser desfeita.')) return;
    try{ await F.deleteDoc(F.doc(db,'products',id)); toast('Produto excluído.', 'success'); }
    catch(err){ toast('Erro ao excluir: '+err.message, 'error'); }
  };

  /* ---------------- ACTIONS: MOVEMENTS ---------------- */
  window.__openMovementModal = (type) => {
    const options = S.products.map(p=>`<option value="${p.id}">${escapeHtml(p.sku)} · ${escapeHtml(p.name)} (estoque: ${fmtNum(p.currentStock)})</option>`).join('');
    openModal(`
      <form id="mov-form" style="padding:22px;">
        <div class="font-display" style="font-size:19px;font-weight:700;margin-bottom:4px;">
          ${type==='entrada'?'Registrar entrada':'Registrar saída'}
        </div>
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:16px;">
          ${type==='entrada'?'Compra, devolução ou ajuste que aumenta o estoque.':'Venda, perda ou ajuste que reduz o estoque.'}
        </div>
        ${S.products.length===0? `<div style="font-size:13px;color:var(--out);">Cadastre ao menos um produto antes de registrar movimentações.</div>` : `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label class="field-label">Produto</label>
            <select class="input" name="productId" required>${options}</select>
          </div>
          <div class="form-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="field-label">Quantidade</label>
              <input class="input" name="qty" type="number" min="1" step="1" required value="1" />
            </div>
            <div>
              <label class="field-label">Motivo</label>
              <select class="input" name="reason">
                ${type==='entrada'
                  ? '<option>Compra</option><option>Devolução</option><option>Ajuste de inventário</option>'
                  : '<option>Venda</option><option>Perda/Avaria</option><option>Ajuste de inventário</option>'}
              </select>
            </div>
          </div>
          <div>
            <label class="field-label">Observação (opcional)</label>
            <input class="input" name="note" placeholder="Nº do pedido, cliente, nota fiscal..." />
          </div>
        </div>`}
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:22px;">
          <button type="button" class="btn btn-ghost" onclick="closeModalGlobal()">Cancelar</button>
          ${S.products.length? `<button type="submit" class="btn ${type==='entrada'?'btn-accent':'btn-primary'}">Confirmar ${type}</button>`:''}
        </div>
      </form>
    `);
    window.closeModalGlobal = closeModal;
    const form = document.getElementById('mov-form');
    if(!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const productId = fd.get('productId');
      const qty = Math.max(1, Number(fd.get('qty'))||0);
      const reason = fd.get('reason');
      const note = (fd.get('note')||'').trim();
      const prodRef = F.doc(db,'products',productId);
      try{
        await F.runTransaction(db, async (tx) => {
          const snap = await tx.get(prodRef);
          if(!snap.exists()) throw new Error('Produto não encontrado.');
          const prod = snap.data();
          const cur = Number(prod.currentStock)||0;
          const delta = type==='entrada' ? qty : -qty;
          const newStock = cur + delta;
          if(newStock < 0) throw new Error(`Estoque insuficiente (disponível: ${cur}).`);
          tx.update(prodRef, { currentStock: newStock, updatedAt: F.serverTimestamp() });
          const movRef = F.doc(F.collection(db,'movements'));
          tx.set(movRef, {
            productId, productName: prod.name, sku: prod.sku,
            type, qty, reason, note,
            unitCost: Number(prod.costPrice)||0,
            unitSale: Number(prod.salePrice)||0,
            totalValue: (type==='entrada' ? (Number(prod.costPrice)||0) : (Number(prod.salePrice)||0)) * qty,
            userId: S.user.uid, userName: S.profile.name || S.user.displayName,
            createdAt: F.serverTimestamp(),
          });
        });
        toast(type==='entrada'?'Entrada registrada.':'Saída registrada.', 'success');
        closeModal();
      }catch(err){ toast('Erro: '+err.message, 'error'); }
    });
  };

  /* ---------------- ACTIONS: USERS ---------------- */
  window.__setUserRole = async (id, role) => {
    try{ await F.updateDoc(F.doc(db,'users',id), { role, active: role!=='pendente' }); toast('Permissão atualizada.', 'success'); }
    catch(err){ toast('Erro: '+err.message, 'error'); }
  };
  window.__toggleUserActive = async (id, active) => {
    try{ await F.updateDoc(F.doc(db,'users',id), { active }); toast(active?'Usuário ativado.':'Usuário desativado.', 'success'); }
    catch(err){ toast('Erro: '+err.message, 'error'); }
  };

  /* ---------------- EXPORT CSV ---------------- */
  window.__exportMovementsCsv = () => {
    const rows = [['Data','Tipo','SKU','Produto','Quantidade','Motivo','Valor total','Usuário','Observação']];
    filteredMovements().forEach(m => rows.push([
      fmtDate(m.createdAt), m.type, m.sku||'', m.productName||'', m.qty, m.reason||'',
      (m.totalValue||0).toFixed(2), m.userName||'', (m.note||'').replace(/\n/g,' ')
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `movimentacoes_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  /* ---------------- NAV ---------------- */
  window.__nav = (view) => { S.view = view; renderShell(); };
  window.__toggleSidebar = () => {
    const sb = document.querySelector('.app-sidebar');
    const ov = document.querySelector('.sidebar-overlay');
    if(sb) sb.classList.toggle('open');
    if(ov) ov.style.display = sb && sb.classList.contains('open') ? 'block' : 'none';
  };

  /* ---------------- FILTER HELPERS ---------------- */
  function filteredProducts(){
    const q = S.filters.prodSearch.toLowerCase();
    let list = !q ? S.products.slice() : S.products.filter(p => (p.name||'').toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q) || (p.category||'').toLowerCase().includes(q));
    const collator = new Intl.Collator('pt-BR', { sensitivity:'base' });
    const sorters = {
      'name-asc':    (a,b) => collator.compare(a.name||'', b.name||''),
      'name-desc':   (a,b) => collator.compare(b.name||'', a.name||''),
      'category-asc':(a,b) => collator.compare(a.category||'', b.category||'') || collator.compare(a.name||'', b.name||''),
      'sku-asc':     (a,b) => collator.compare(a.sku||'', b.sku||''),
      'stock-desc':  (a,b) => (b.currentStock||0) - (a.currentStock||0),
      'stock-asc':   (a,b) => (a.currentStock||0) - (b.currentStock||0),
    };
    list.sort(sorters[S.filters.prodSort] || sorters['name-asc']);
    return list;
  }
  function filteredMovements(){
    let list = S.movements;
    if(S.filters.movType!=='all') list = list.filter(m=>m.type===S.filters.movType);
    if(S.filters.movProduct!=='all') list = list.filter(m=>m.productId===S.filters.movProduct);
    if(S.filters.repFrom){ const from = new Date(S.filters.repFrom); list = list.filter(m=> m.createdAt && m.createdAt.toDate() >= from); }
    if(S.filters.repTo){ const to = new Date(S.filters.repTo); to.setHours(23,59,59,999); list = list.filter(m=> m.createdAt && m.createdAt.toDate() <= to); }
    return list;
  }

  /* ------------------------------------------------------------------ */
  /* RENDER: LOGIN                                                       */
  /* ------------------------------------------------------------------ */
  function renderLogin(){
    root.innerHTML = `
    <div class="login-wrap">
      <div class="login-side">
        <div class="side-glow"></div>
        <div class="sparks">
          <span class="spark" style="left:8%; animation-delay:0s;"></span>
          <span class="spark" style="left:20%; animation-delay:1.3s;"></span>
          <span class="spark" style="left:34%; animation-delay:2.6s;"></span>
          <span class="spark" style="left:48%; animation-delay:.7s;"></span>
          <span class="spark" style="left:62%; animation-delay:3.4s;"></span>
          <span class="spark" style="left:76%; animation-delay:2s;"></span>
          <span class="spark" style="left:88%; animation-delay:4.2s;"></span>
        </div>
        <div class="login-brandbar">
          <div class="login-logo">${icon('warehouse',24,1.8)}</div>
          <div>
            <div class="font-display login-brand">Estoque<span>+</span></div>
            <div class="login-brand-sub">Sistema de gestão de estoque<br>simples, eficiente e inteligente.</div>
          </div>
        </div>

        <div class="illu">
          <div class="illu-shelf">
            <div class="shelf-bar sb-1"></div>
            <div class="shelf-bar sb-2"></div>
            <div class="shelf-bar sb-3"></div>
            <div class="shelf-bar sb-4"></div>
            <div class="shelf-leg sl-1"></div>
            <div class="shelf-leg sl-2"></div>
            <div class="ibox ib-1">${icon('box',20,1.6)}</div>
            <div class="ibox ib-2"></div>
            <div class="ibox ib-3">${icon('box',16,1.6)}</div>
            <div class="ibox ib-4"></div>
          </div>
          <div class="illu-board">
            <div class="board-clip"></div>
            <div class="board-title">${icon('reports',13,2.2)}<span>Relatório</span></div>
            ${[0,1,2,3].map(()=>`<div class="board-row"><span class="board-bar"></span><span class="board-check">${icon('check',11,3)}</span></div>`).join('')}
          </div>
          <div class="illu-chart">
            <div class="chart-bar cb-1"></div>
            <div class="chart-bar cb-2"></div>
            <div class="chart-bar cb-3"></div>
            <div class="chart-bar cb-4"></div>
            <div class="chart-bar cb-5"></div>
          </div>
          <div class="ibox-big">${icon('box',34,1.4)}</div>
          <div class="float-badge fb-1">${icon('box',22,1.6)}</div>
          <div class="float-badge fb-2">${icon('reports',22,1.6)}</div>
          <div class="float-badge fb-3">${icon('check',22,2)}</div>
          <div class="value-pill">${icon('reports',14,2)}<span>+18% este mês</span></div>
        </div>

        <div class="dots-pattern"></div>
      </div>

      <div class="login-panel">
        <div class="login-card">
          <div class="login-logo login-logo-center">${icon('warehouse',26,1.8)}</div>
          <div class="font-display" style="font-size:25px;font-weight:700;text-align:center;color:#fff;">Bem-vindo de volta!</div>
          <div style="color:#9AA3B0;font-size:13.5px;margin:6px 0 30px;text-align:center;">Entre com sua conta Google para acessar seu painel</div>

          <button id="btn-google-signin" onclick="window.__signIn()" class="btn-enter">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4c-7.7 0-14.3 4.4-17.7 10.7z"/><path fill="#4CAF50" d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.3C29.4 35.4 26.9 36 24 36c-5.3 0-9.8-3.4-11.3-8.1l-6.5 5C9.5 39.5 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.5 5.3C39.9 37 44 31.4 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>
            Entrar com Google
          </button>

          <div style="font-size:11.5px;color:#7A8290;margin-top:22px;text-align:center;line-height:1.6;">Ao entrar, sua conta fica pendente de aprovação por um administrador.</div>
          <div style="font-size:11px;color:#5E6570;margin-top:8px;text-align:center;line-height:1.6;">Se o login não completar, permita pop-ups para este site ou desative a proteção contra rastreamento do navegador.</div>

          <div class="login-foot">© 2026 Estoque+. Todos os direitos reservados.</div>
        </div>
      </div>
    </div>
    <style>
      .login-wrap{min-height:100vh;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);background:#0D0F13;}

      /* ---- Lado esquerdo: marca + ilustração ---- */
      .login-side{position:relative;overflow:hidden;padding:clamp(32px,50vw,72px);display:flex;flex-direction:column;justify-content:center;}
      .side-glow{position:absolute;inset:0;background:radial-gradient(ellipse 620px 520px at 24% 58%, rgba(240,160,32,.18), transparent 65%);animation:glowPulse 6s ease-in-out infinite;}
      @keyframes glowPulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.55;transform:scale(1.08);}}

      /* Partículas douradas subindo lentamente no fundo do lado esquerdo */
      .sparks{position:absolute;inset:0;z-index:1;overflow:hidden;pointer-events:none;}
      .spark{position:absolute;bottom:-12px;width:4px;height:4px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px 2px rgba(240,160,32,.65);opacity:0;animation:sparkRise 8s ease-in infinite;}
      @keyframes sparkRise{
        0%{transform:translateY(0) scale(.6);opacity:0;}
        12%{opacity:.9;}
        80%{opacity:.4;}
        100%{transform:translateY(-620px) scale(1.15);opacity:0;}
      }

      .login-brandbar{position:relative;z-index:2;display:flex;align-items:center;gap:16px;margin-bottom:clamp(32px,4vw,56px);}
      .login-logo{position:relative;width:56px;height:56px;border-radius:14px;background:linear-gradient(160deg,#F5C878,var(--accent));color:#3D2A05;display:flex;align-items:center;justify-content:center;flex:none;box-shadow:0 10px 24px -8px rgba(240,160,32,.55);}
      .login-logo::after{content:'';position:absolute;inset:0;border-radius:inherit;animation:logoPulseRing 2.6s ease-out infinite;}
      @keyframes logoPulseRing{
        0%{box-shadow:0 0 0 0 rgba(240,160,32,.5);}
        70%{box-shadow:0 0 0 16px rgba(240,160,32,0);}
        100%{box-shadow:0 0 0 0 rgba(240,160,32,0);}
      }
      .login-logo-center{margin:0 auto 22px;}
      .login-brand{font-size:clamp(26px,2.6vw,32px);font-weight:800;color:#fff;line-height:1;}
      .login-brand span{color:var(--accent);}
      .login-brand-sub{font-size:13.5px;color:#8D95A2;margin-top:8px;line-height:1.5;}

      /* Ilustração ampliada: mais elementos, mais espaço, mais profundidade */
      .illu{position:relative;z-index:2;width:100%;max-width:600px;height:clamp(340px,38vw,460px);margin:0 auto;}
      .illu-shelf{position:absolute;left:0;bottom:10px;width:min(340px,52%);height:82%;}
      .shelf-leg{position:absolute;bottom:0;width:8px;height:88%;background:#2A2F38;border-radius:3px;}
      .sl-1{left:10px;}
      .sl-2{right:10px;}
      .shelf-bar{position:absolute;left:10px;right:10px;height:8px;background:#2A2F38;border-radius:3px;}
      .sb-1{top:2%;} .sb-2{top:34%;} .sb-3{top:66%;} .sb-4{top:98%;}
      .ibox{position:absolute;border-radius:8px;display:flex;align-items:center;justify-content:center;}
      .ib-1{left:34px;top:20px;width:92px;height:80px;background:linear-gradient(160deg,#3A4049,#2A2F38);color:#8B93A0;border:1px solid #3A4049;box-shadow:0 10px 20px -10px rgba(0,0,0,.5);}
      .ib-2{right:26px;top:12px;width:76px;height:92px;background:linear-gradient(160deg,#3A4049,#2A2F38);border:1px solid #3A4049;box-shadow:0 10px 20px -10px rgba(0,0,0,.5);}
      .ib-3{left:82px;top:158px;width:100px;height:82px;background:linear-gradient(160deg,#3A4049,#2A2F38);color:#8B93A0;border:1px solid #3A4049;box-shadow:0 10px 20px -10px rgba(0,0,0,.5);}
      .ib-4{right:18px;top:170px;width:60px;height:66px;background:linear-gradient(160deg,#343A43,#262B33);border:1px solid #3A4049;}
      .ibox-big{position:absolute;left:18px;bottom:6px;width:168px;height:142px;border-radius:12px;background:linear-gradient(160deg,#F5C878 0%,var(--accent) 55%,#C7811A 100%);box-shadow:0 22px 40px -14px rgba(240,160,32,.5);display:flex;align-items:center;justify-content:center;color:rgba(61,42,5,.5);}
      .illu-board{position:absolute;right:4%;bottom:18%;width:min(210px,32%);background:#1B1F26;border:1px solid #30363F;border-radius:12px;padding:26px 16px 18px;box-shadow:0 22px 42px -18px rgba(0,0,0,.65);transform:rotate(-2deg);}
      .board-clip{position:absolute;top:-10px;left:50%;transform:translateX(-50%);width:40px;height:18px;border-radius:6px;background:#454C57;}
      .board-title{display:flex;align-items:center;gap:6px;color:var(--accent);font-family:'Barlow Semi Condensed',sans-serif;font-weight:700;font-size:13px;margin-bottom:14px;letter-spacing:.02em;}
      .board-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:13px;}
      .board-bar{flex:1;height:7px;border-radius:3px;background:#3A4049;}
      .board-check{color:var(--accent);flex:none;display:flex;}
      .illu-chart{position:absolute;left:6%;top:4%;width:150px;height:74px;background:#1B1F26;border:1px solid #30363F;border-radius:12px;display:flex;align-items:flex-end;gap:9px;padding:14px 16px;box-shadow:0 18px 36px -18px rgba(0,0,0,.6);}
      .chart-bar{flex:1;border-radius:3px 3px 0 0;background:linear-gradient(180deg,var(--accent),#C7811A);}
      .cb-1{height:35%;opacity:.55;} .cb-2{height:55%;opacity:.7;} .cb-3{height:40%;opacity:.6;} .cb-4{height:80%;} .cb-5{height:100%;}
      .float-badge{position:absolute;width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);animation:cardFloat 6s ease-in-out infinite;backdrop-filter:blur(2px);}
      .fb-1{top:16%;right:22%;animation-delay:.4s;}
      .fb-2{bottom:14%;right:-2%;animation-delay:1.6s;}
      .fb-3{top:44%;left:-2%;animation-delay:2.6s;}
      @keyframes cardFloat{0%,100%{transform:translateY(0);}50%{transform:translateY(-10px);}}
      .value-pill{position:absolute;left:6%;bottom:-2%;display:flex;align-items:center;gap:7px;background:rgba(15,143,99,.14);border:1px solid rgba(15,143,99,.4);color:#4FD69C;font-size:12px;font-weight:700;padding:8px 14px;border-radius:999px;box-shadow:0 14px 26px -14px rgba(0,0,0,.5);}

      .dots-pattern{position:relative;z-index:2;margin-top:clamp(28px,4vw,48px);width:120px;height:34px;background-image:radial-gradient(rgba(240,160,32,.55) 1.6px, transparent 1.6px);background-size:14px 14px;opacity:.8;}

      /* ---- Lado direito: card de login ---- */
      .login-panel{display:flex;align-items:center;justify-content:center;padding:24px;background:#12151A;}
      .login-card{width:100%;max-width:410px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:40px 38px;box-shadow:0 30px 60px -30px rgba(0,0,0,.7);}
      .btn-enter{position:relative;overflow:hidden;width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:14px;font-size:14.5px;font-weight:700;font-family:'Inter',sans-serif;color:#241804;background:linear-gradient(160deg,#F5C878,var(--accent));border:none;border-radius:10px;cursor:pointer;box-shadow:0 12px 26px -12px rgba(240,160,32,.55);transition:.15s ease;}
      .btn-enter::before{content:'';position:absolute;top:0;left:-60%;width:45%;height:100%;background:linear-gradient(120deg,transparent,rgba(255,255,255,.6),transparent);transform:skewX(-20deg);animation:btnShine 4.5s ease-in-out infinite;}
      @keyframes btnShine{0%{left:-60%;}35%{left:130%;}100%{left:130%;}}
      .btn-enter:hover{filter:brightness(1.06);transform:translateY(-1px);}
      .btn-enter:active{transform:translateY(0);}
      .login-foot{margin-top:30px;padding-top:20px;border-top:1px solid rgba(255,255,255,.07);font-size:11.5px;color:#5E6570;text-align:center;}

      /* ---- Responsividade: telas médias mantêm ilustração menor, telas pequenas escondem ---- */
      @media (max-width:1150px){
        .illu{max-width:460px;}
        .ib-1,.ib-2,.ib-3{display:none;}
      }
      @media (max-width:900px){
        .login-wrap{grid-template-columns:1fr;}
        .login-side{display:none;}
      }
      @media (max-width:420px){
        .login-panel{padding:14px;}
        .login-card{padding:30px 22px;border-radius:16px;}
      }
      @media (prefers-reduced-motion: reduce){
        .side-glow, .spark, .login-logo::after, .btn-enter::before, .float-badge{animation:none !important;}
      }
    </style>`;
  }

  /* ------------------------------------------------------------------ */
  /* RENDER: SHELL (sidebar + topbar + view)                             */
  /* ------------------------------------------------------------------ */
  function renderShell(){
    if(!S.user) { renderLogin(); return; }
    if(!S.profile){
      root.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:var(--ink-soft);">Carregando...</div>`;
      return;
    }
    if(S.profile.role==='pendente' || S.profile.active===false){
      root.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">
        <div class="card" style="max-width:420px;padding:32px;text-align:center;">
          <div class="tag tag-warn" style="margin-bottom:14px;">AGUARDANDO APROVAÇÃO</div>
          <div class="font-display" style="font-size:20px;font-weight:700;margin-bottom:8px;">Sua conta ainda não foi liberada</div>
          <p style="color:var(--ink-soft);font-size:13.5px;line-height:1.6;">Olá, ${escapeHtml(S.profile.name||'')}. Um administrador precisa definir seu nível de permissão antes que você possa acessar o sistema.</p>
          <button onclick="window.__signOut()" class="btn btn-ghost" style="margin-top:18px;">Sair</button>
        </div>
      </div>`;
      return;
    }

    const NAV = [
      {id:'dashboard', label:'Painel', icon:'dashboard', show:true},
      {id:'products', label:'Produtos', icon:'products', show:can('viewProducts')},
      {id:'movements', label:'Movimentações', icon:'movements', show:can('registerMov') || can('viewProducts')},
      {id:'reports', label:'Relatórios', icon:'reports', show:can('viewReports')},
      {id:'users', label:'Usuários', icon:'users', show:can('manageUsers')},
    ];

    root.innerHTML = `
    <div class="app-shell">
      <div class="sidebar-overlay" style="display:none;" onclick="window.__toggleSidebar()"></div>
      <aside class="app-sidebar" style="width:230px;background:var(--ink);padding:18px 12px;display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;gap:10px;padding:6px 8px 22px;">
          <div style="width:30px;height:30px;border-radius:8px;background:var(--accent);color:var(--accent-ink);display:flex;align-items:center;justify-content:center;font-family:'Barlow Semi Condensed';font-weight:800;font-size:17px;">+</div>
          <div class="font-display" style="color:#fff;font-size:18px;font-weight:700;">Estoque+</div>
        </div>
        <nav style="display:flex;flex-direction:column;gap:3px;flex:1;overflow-y:auto;">
          ${NAV.filter(n=>n.show).map(n=>`
            <div class="sidebar-link ${S.view===n.id?'active':''}" onclick="window.__nav('${n.id}')">
              ${icon(n.icon,16)}${n.label}
            </div>`).join('')}
        </nav>
        <div style="border-top:1px solid #333A44;padding-top:12px;margin-top:8px;flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:9px;padding:6px 8px;">
            ${S.profile.photoURL?`<img src="${S.profile.photoURL}" style="width:30px;height:30px;border-radius:50%;">`:`<div style="width:30px;height:30px;border-radius:50%;background:#3A414C;"></div>`}
            <div style="min-width:0;">
              <div style="color:#fff;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(S.profile.name||'')}</div>
              <div style="color:#8B93A0;font-size:11px;">${ROLE_LABEL[S.profile.role]}</div>
            </div>
          </div>
          <button onclick="window.__signOut()" class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:8px;background:#2A3038;color:#C7CCD4;border-color:#3A414C;">${icon('logout',14)} Sair</button>
        </div>
      </aside>

      <main class="app-main">
        <header class="app-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 24px;border-bottom:1px solid var(--line);background:var(--surface);position:sticky;top:0;z-index:10;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            <button onclick="window.__toggleSidebar()" class="btn btn-ghost btn-sm" style="display:none;" id="menu-btn">☰</button>
            <div style="min-width:0;">
              <div class="font-display" style="font-size:19px;font-weight:700;line-height:1.2;">${viewTitle(S.view)}</div>
              <div class="view-subtitle">${viewSubtitle(S.view)}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">${headerActions(S.view)}</div>
        </header>
        <div class="app-main-pad" style="padding:24px;max-width:1280px;">
          ${renderView(S.view)}
        </div>
      </main>
    </div>
    <style>
      @media (max-width:880px){ #menu-btn{display:inline-flex !important;} }
      @media (max-width:640px){
        .app-header{padding:12px 16px !important;}
        .app-main-pad{padding:16px !important;}
      }
      @media (max-width:420px){
        .app-header{padding:10px 12px !important;}
        .app-main-pad{padding:12px !important;}
      }
    </style>
    `;
    afterRenderHooks();
  }

  function viewTitle(v){
    return {dashboard:'Painel geral', products:'Produtos', movements:'Movimentações de estoque', reports:'Relatórios', users:'Usuários e permissões'}[v] || '';
  }
  function viewSubtitle(v){
    return {
      dashboard:'Visão geral do estoque, alertas e atividade recente',
      products:'Cadastre itens, defina preços e acompanhe níveis de estoque',
      movements:'Histórico de entradas e saídas registradas no sistema',
      reports:'Análises de período, custos e produtos mais movimentados',
      users:'Gerencie o acesso e o nível de permissão de cada pessoa',
    }[v] || '';
  }
  function headerActions(v){
    if(v==='products' && can('editProducts')) return `<button class="btn btn-accent btn-sm" onclick="window.__openProductModal()">${icon('plus',14)} Novo produto</button>`;
    if(v==='movements' && can('registerMov')) return `
      <button class="btn btn-ghost btn-sm" style="border-color:var(--in);color:var(--in);" onclick="window.__openMovementModal('entrada')">${icon('arrowDown',14)} Entrada</button>
      <button class="btn btn-ghost btn-sm" style="border-color:var(--out);color:var(--out);" onclick="window.__openMovementModal('saida')">${icon('arrowUp',14)} Saída</button>`;
    if(v==='reports') return `<button class="btn btn-ghost btn-sm" onclick="window.__exportMovementsCsv()">${icon('download',14)} Exportar CSV</button>`;
    return '';
  }

  function renderView(v){
    if(v==='products') return renderProducts();
    if(v==='movements') return renderMovements();
    if(v==='reports') return renderReports();
    if(v==='users') return renderUsers();
    return renderDashboard();
  }

  /* ---------------- VIEW: DASHBOARD ---------------- */
  function renderDashboard(){
    const totalProducts = S.products.length;
    const stockValue = S.products.reduce((s,p)=> s + (Number(p.currentStock)||0) * (Number(p.costPrice)||0), 0);
    const lowStock = S.products.filter(p => (Number(p.currentStock)||0) <= (Number(p.minStock)||0));
    const today = new Date(); today.setHours(0,0,0,0);
    const movToday = S.movements.filter(m => m.createdAt && m.createdAt.toDate() >= today);

    return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px;">
      ${statCard('Produtos cadastrados', fmtNum(totalProducts), 'Itens ativos no catálogo', null, 'box')}
      ${statCard('Valor em estoque', fmtBRL(stockValue), 'Baseado no custo unitário', null, 'reports')}
      ${statCard('Itens em estoque baixo', fmtNum(lowStock.length), lowStock.length? 'Requer atenção' : 'Tudo sob controle', lowStock.length?'var(--out)':'var(--in)', 'alert')}
      ${statCard('Movimentações hoje', fmtNum(movToday.length), 'Entradas e saídas', null, 'movements')}
    </div>
    <div class="charts-grid-2" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;" id="dash-charts-grid">
      <div class="card card-hoverable" style="padding:20px;">
        <div class="font-display" style="font-weight:700;font-size:15px;margin-bottom:2px;">Movimentações — últimos 14 dias</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Entradas x Saídas por dia</div>
        <div style="position:relative;height:260px;">
          <canvas id="chart-movs"></canvas>
        </div>
      </div>
      <div class="card card-hoverable" style="padding:20px;">
        <div class="font-display" style="font-weight:700;font-size:15px;margin-bottom:2px;">Estoque por categoria</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Quantidade total por categoria</div>
        <div style="position:relative;height:260px;">
          <canvas id="chart-cat"></canvas>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px;padding:0;">
      <div style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);">
        <div class="font-display" style="font-weight:700;font-size:15px;">Alertas de estoque baixo</div>
        <span class="tag tag-neutral">${lowStock.length} item(ns)</span>
      </div>
      ${lowStock.length===0 ? emptyState('Nenhum alerta no momento', 'Todos os produtos estão acima do estoque mínimo definido.') : `
      <div class="table-scroll"><table class="data-table" style="min-width:560px;">
        <thead><tr><th>SKU</th><th>Produto</th><th>Estoque atual</th><th>Mínimo</th><th>Status</th></tr></thead>
        <tbody>
          ${lowStock.slice(0,8).map(p=>{
            const st = stockStatus(p);
            return `<tr><td class="font-mono">${escapeHtml(p.sku)}</td><td>${escapeHtml(p.name)}</td><td class="font-mono">${fmtNum(p.currentStock)} ${escapeHtml(p.unit||'un')}</td><td class="font-mono">${fmtNum(p.minStock)}</td><td><span class="tag ${st.cls}">${st.label}</span></td></tr>`;
          }).join('')}
        </tbody>
      </table></div>`}
    </div>`;
  }
  function statCard(label, value, sub, color, iconName='box'){
    const badgeBg = color === 'var(--out)' ? '#FCEAE4' : color === 'var(--in)' ? '#E4F6EE' : '#F1EFE8';
    const badgeColor = color || 'var(--ink-soft)';
    return `<div class="card stat-card" style="padding:16px 18px;">
      <div class="stat-icon-badge" style="background:${badgeBg};color:${badgeColor};">${icon(iconName,17)}</div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;">${label}</div>
      <div class="stat-num" style="${color?`color:${color}`:''}">${value}</div>
      <div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">${sub}</div>
    </div>`;
  }
  function emptyState(title, sub, iconName='box'){
    return `<div style="padding:44px 20px;text-align:center;">
      <div class="empty-icon">${icon(iconName,20)}</div>
      <div style="font-weight:700;font-size:14px;">${title}</div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:4px;">${sub}</div>
    </div>`;
  }

  /* ---------------- VIEW: PRODUCTS ---------------- */
  function renderProducts(){
    const list = filteredProducts();
    return `
    <div class="card" style="padding:0;">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line);display:flex;gap:10px;flex-wrap:wrap;">
        <input class="input" id="prod-search" placeholder="Buscar por nome, SKU ou categoria..." style="max-width:340px;flex:1;min-width:180px;" value="${escapeHtml(S.filters.prodSearch)}" />
        <select class="input" id="prod-sort" style="max-width:220px;">
          <option value="name-asc" ${S.filters.prodSort==='name-asc'?'selected':''}>Nome (A-Z)</option>
          <option value="name-desc" ${S.filters.prodSort==='name-desc'?'selected':''}>Nome (Z-A)</option>
          <option value="category-asc" ${S.filters.prodSort==='category-asc'?'selected':''}>Categoria (A-Z)</option>
          <option value="sku-asc" ${S.filters.prodSort==='sku-asc'?'selected':''}>SKU / Código</option>
          <option value="stock-desc" ${S.filters.prodSort==='stock-desc'?'selected':''}>Estoque (maior primeiro)</option>
          <option value="stock-asc" ${S.filters.prodSort==='stock-asc'?'selected':''}>Estoque (menor primeiro)</option>
        </select>
      </div>
      ${list.length===0 ? emptyState('Nenhum produto encontrado', can('editProducts') ? 'Cadastre seu primeiro produto usando o botão "Novo produto".' : 'Ainda não há produtos cadastrados.', 'image') : `
      <div class="table-scroll"><table class="data-table" style="min-width:760px;">
        <thead><tr><th></th><th>Produto</th><th>Categoria</th><th>Estoque</th><th>Custo</th><th>Venda</th><th>Status</th>${can('editProducts')?'<th></th>':''}</tr></thead>
        <tbody>
          ${list.map(p=>{
            const st = stockStatus(p);
            return `<tr>
              <td style="width:1%;">${p.photo ? `<img class="prod-thumb" src="${p.photo}" alt="${escapeHtml(p.name)}" />` : `<div class="prod-thumb-placeholder">${icon('box',16)}</div>`}</td>
              <td>
                <div style="font-weight:600;">${escapeHtml(p.name)}</div>
                <div class="font-mono" style="font-size:11.5px;color:var(--muted);">${escapeHtml(p.sku)}</div>
              </td>
              <td>${escapeHtml(p.category||'—')}</td>
              <td class="font-mono">${fmtNum(p.currentStock)} ${escapeHtml(p.unit||'un')}</td>
              <td class="font-mono">${fmtBRL(p.costPrice)}</td>
              <td class="font-mono">${fmtBRL(p.salePrice)}</td>
              <td><span class="tag ${st.cls}">${st.label}</span></td>
              ${can('editProducts') ? `<td style="text-align:right;white-space:nowrap;">
                <button class="btn btn-ghost btn-sm" onclick="window.__openProductModal('${p.id}')">${icon('edit',13)} Editar</button>
                ${can('deleteProducts')?`<button class="btn btn-danger btn-sm" onclick="window.__deleteProduct('${p.id}')">${icon('trash',13)} Excluir</button>`:''}
              </td>`:''}
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>`}
    </div>`;
  }

  /* ---------------- VIEW: MOVEMENTS ---------------- */
  function renderMovements(){
    const list = filteredMovements();
    const prodOptions = S.products.map(p=>`<option value="${p.id}" ${S.filters.movProduct===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
    return `
    <div class="card" style="padding:0;">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line);display:flex;gap:10px;flex-wrap:wrap;">
        <select class="input" id="mov-type-filter" style="max-width:160px;">
          <option value="all" ${S.filters.movType==='all'?'selected':''}>Todos os tipos</option>
          <option value="entrada" ${S.filters.movType==='entrada'?'selected':''}>Entradas</option>
          <option value="saida" ${S.filters.movType==='saida'?'selected':''}>Saídas</option>
        </select>
        <select class="input" id="mov-product-filter" style="max-width:240px;">
          <option value="all">Todos os produtos</option>${prodOptions}
        </select>
      </div>
      ${list.length===0 ? emptyState('Nenhuma movimentação registrada', can('registerMov') ? 'Use os botões "Entrada" ou "Saída" no topo da página.' : 'Ainda não há movimentações.', 'movements') : `
      <div class="table-scroll"><table class="data-table" style="min-width:760px;">
        <thead><tr><th>Data</th><th>Tipo</th><th>Produto</th><th>Qtd.</th><th>Motivo</th><th>Valor</th><th>Usuário</th></tr></thead>
        <tbody>
          ${list.slice(0,200).map(m=>`
            <tr>
              <td class="font-mono" style="white-space:nowrap;">${fmtDate(m.createdAt)}</td>
              <td><span class="tag ${m.type==='entrada'?'pill-in':'pill-out'}">${m.type==='entrada'?'↓ ENTRADA':'↑ SAÍDA'}</span></td>
              <td style="font-weight:600;">${escapeHtml(m.productName||'')}</td>
              <td class="font-mono">${m.type==='entrada'?'+':'-'}${fmtNum(m.qty)}</td>
              <td>${escapeHtml(m.reason||'—')}</td>
              <td class="font-mono">${fmtBRL(m.totalValue)}</td>
              <td>${escapeHtml(m.userName||'—')}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>`;
  }

  /* ---------------- VIEW: REPORTS ---------------- */
  function renderReports(){
    const list = filteredMovements();
    const entradas = list.filter(m=>m.type==='entrada');
    const saidas = list.filter(m=>m.type==='saida');
    const totalEntradaVal = entradas.reduce((s,m)=>s+(m.totalValue||0),0);
    const totalSaidaVal = saidas.reduce((s,m)=>s+(m.totalValue||0),0);

    const topMap = {};
    list.forEach(m=>{ topMap[m.productName] = (topMap[m.productName]||0) + m.qty; });
    const top = Object.entries(topMap).sort((a,b)=>b[1]-a[1]).slice(0,8);

    return `
    <div class="card" style="padding:16px 18px;margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:end;">
      <div>
        <label class="field-label">De</label>
        <input class="input" type="date" id="rep-from" value="${S.filters.repFrom}" />
      </div>
      <div>
        <label class="field-label">Até</label>
        <input class="input" type="date" id="rep-to" value="${S.filters.repTo}" />
      </div>
      <button class="btn btn-ghost btn-sm" id="rep-clear">Limpar filtro</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:16px;">
      ${statCard('Total entradas', fmtNum(entradas.reduce((s,m)=>s+m.qty,0)), fmtBRL(totalEntradaVal)+' em custo', 'var(--in)')}
      ${statCard('Total saídas', fmtNum(saidas.reduce((s,m)=>s+m.qty,0)), fmtBRL(totalSaidaVal)+' em vendas', 'var(--out)')}
      ${statCard('Resultado do período', fmtBRL(totalSaidaVal-totalEntradaVal), 'Vendas − custo de entrada')}
    </div>
    <div class="charts-grid-2" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;">
      <div class="card card-hoverable" style="padding:20px;">
        <div class="font-display" style="font-weight:700;font-size:15px;margin-bottom:12px;">Entradas x Saídas no período</div>
        <div style="position:relative;height:260px;">
          <canvas id="chart-report-line"></canvas>
        </div>
      </div>
      <div class="card card-hoverable" style="padding:20px;">
        <div class="font-display" style="font-weight:700;font-size:15px;margin-bottom:12px;">Produtos mais movimentados</div>
        <div style="position:relative;height:260px;">
          <canvas id="chart-report-top"></canvas>
        </div>
      </div>
    </div>`;
  }

  /* ---------------- VIEW: USERS ---------------- */
  function renderUsers(){
    return `
    <div class="card" style="padding:0;">
      <div class="table-scroll"><table class="data-table" style="min-width:640px;">
        <thead><tr><th>Usuário</th><th>E-mail</th><th>Permissão</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${S.users.map(u=>`
            <tr>
              <td style="display:flex;align-items:center;gap:9px;">
                ${u.photoURL?`<img src="${u.photoURL}" style="width:26px;height:26px;border-radius:50%;">`:`<div style="width:26px;height:26px;border-radius:50%;background:#EEEDE8;"></div>`}
                <span style="font-weight:600;">${escapeHtml(u.name||'')}</span>
              </td>
              <td style="color:var(--ink-soft);">${escapeHtml(u.email||'')}</td>
              <td>
                <select class="input" style="max-width:160px;" onchange="window.__setUserRole('${u.id}', this.value)" ${u.id===S.user.uid?'disabled title="Você não pode alterar sua própria permissão"':''}>
                  ${['pendente','operador','gerente','admin'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}
                </select>
              </td>
              <td><span class="tag ${u.active?'tag-ok':'tag-neutral'}">${u.active?'ATIVO':'INATIVO'}</span></td>
              <td style="text-align:right;">
                ${u.id!==S.user.uid ? `<button class="btn btn-ghost btn-sm" onclick="window.__toggleUserActive('${u.id}', ${!u.active})">${u.active?'Desativar':'Ativar'}</button>` : `<span style="font-size:11px;color:var(--muted);">você</span>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
    <p style="font-size:12px;color:var(--muted);margin-top:12px;">
      <b>Operador</b>: registra entradas/saídas e vê produtos. <b>Gerente</b>: também cadastra/edita produtos e vê relatórios. <b>Administrador</b>: acesso total, incluindo gestão de usuários.
    </p>`;
  }

  /* ---------------- POST-RENDER HOOKS (bind inputs & charts) ---------------- */
  function afterRenderHooks(){
    const search = document.getElementById('prod-search');
    if(search) search.addEventListener('input', (e)=>{ S.filters.prodSearch = e.target.value; renderShell(); document.getElementById('prod-search').focus(); document.getElementById('prod-search').setSelectionRange(9999,9999); });
    const prodSort = document.getElementById('prod-sort');
    if(prodSort) prodSort.addEventListener('change', (e)=>{ S.filters.prodSort = e.target.value; renderShell(); });

    const mt = document.getElementById('mov-type-filter');
    if(mt) mt.addEventListener('change', (e)=>{ S.filters.movType = e.target.value; renderShell(); });
    const mp = document.getElementById('mov-product-filter');
    if(mp) mp.addEventListener('change', (e)=>{ S.filters.movProduct = e.target.value; renderShell(); });

    const rf = document.getElementById('rep-from');
    if(rf) rf.addEventListener('change', (e)=>{ S.filters.repFrom = e.target.value; renderShell(); });
    const rt = document.getElementById('rep-to');
    if(rt) rt.addEventListener('change', (e)=>{ S.filters.repTo = e.target.value; renderShell(); });
    const rc = document.getElementById('rep-clear');
    if(rc) rc.addEventListener('click', ()=>{ S.filters.repFrom=''; S.filters.repTo=''; renderShell(); });

    if(S.view==='dashboard') drawDashboardCharts();
    if(S.view==='reports') drawReportCharts();
  }

  /* ---------------- CHARTS ---------------- */
  let chartLibPromise = null;
  function loadChartLib(){
    if(window.Chart) return Promise.resolve();
    if(chartLibPromise) return chartLibPromise;
    chartLibPromise = new Promise((resolve,reject)=>{
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return chartLibPromise;
  }
  function destroyChart(key){ if(S.charts[key]){ S.charts[key].destroy(); delete S.charts[key]; } }

  async function drawDashboardCharts(){
    await loadChartLib();
    const days = [...Array(14)].map((_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(13-i)); d.setHours(0,0,0,0); return d; });
    const labels = days.map(d=>d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}));
    const ent = days.map(d=> S.movements.filter(m=>m.type==='entrada' && m.createdAt && sameDay(m.createdAt.toDate(),d)).reduce((s,m)=>s+m.qty,0));
    const sai = days.map(d=> S.movements.filter(m=>m.type==='saida' && m.createdAt && sameDay(m.createdAt.toDate(),d)).reduce((s,m)=>s+m.qty,0));

    const ctx1 = document.getElementById('chart-movs');
    if(ctx1){
      destroyChart('movs');
      S.charts.movs = new Chart(ctx1, { type:'line', data:{ labels, datasets:[
        {label:'Entradas', data:ent, borderColor:'#0F8F63', backgroundColor:'#0F8F6322', tension:.3, fill:true},
        {label:'Saídas', data:sai, borderColor:'#D9502F', backgroundColor:'#D9502F22', tension:.3, fill:true},
      ]}, options: baseChartOpts() });
    }
    const catMap = {};
    S.products.forEach(p=>{ const c = p.category||'Sem categoria'; catMap[c] = (catMap[c]||0) + (Number(p.currentStock)||0); });
    const ctx2 = document.getElementById('chart-cat');
    if(ctx2){
      destroyChart('cat');
      S.charts.cat = new Chart(ctx2, { type:'bar', data:{ labels:Object.keys(catMap), datasets:[{ label:'Estoque', data:Object.values(catMap), backgroundColor:'#F0A020' }] }, options: baseChartOpts(true) });
    }
  }
  async function drawReportCharts(){
    await loadChartLib();
    const list = filteredMovements();
    const dateKeys = {};
    list.forEach(m=>{ if(!m.createdAt) return; const k = fmtDateOnly(m.createdAt); dateKeys[k] = dateKeys[k] || {in:0,out:0}; if(m.type==='entrada') dateKeys[k].in += m.qty; else dateKeys[k].out += m.qty; });
    const labels = Object.keys(dateKeys).slice(-30);
    const ctx1 = document.getElementById('chart-report-line');
    if(ctx1){
      destroyChart('repLine');
      S.charts.repLine = new Chart(ctx1, { type:'line', data:{ labels, datasets:[
        {label:'Entradas', data:labels.map(l=>dateKeys[l].in), borderColor:'#0F8F63', tension:.25},
        {label:'Saídas', data:labels.map(l=>dateKeys[l].out), borderColor:'#D9502F', tension:.25},
      ]}, options: baseChartOpts() });
    }
    const topMap = {};
    list.forEach(m=>{ topMap[m.productName] = (topMap[m.productName]||0) + m.qty; });
    const top = Object.entries(topMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const ctx2 = document.getElementById('chart-report-top');
    if(ctx2){
      destroyChart('repTop');
      S.charts.repTop = new Chart(ctx2, { type:'bar', data:{ labels:top.map(t=>t[0]), datasets:[{label:'Unidades movimentadas', data:top.map(t=>t[1]), backgroundColor:'#1C2128'}] }, options: baseChartOpts(true) });
    }
  }
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function baseChartOpts(indexAxisY){
    return { responsive:true, maintainAspectRatio:false, indexAxis: indexAxisY? 'y':'x',
      plugins:{ legend:{ labels:{ font:{ family:'Inter', size:11 } } } },
      scales:{ x:{ grid:{ display:false } }, y:{ grid:{ color:'#EFEDE6' } } } };
  }

} // end boot()
