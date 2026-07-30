/* ============================================================================
   CONFIGURAÇÃO DO FIREBASE
   Edite apenas este arquivo para conectar o app a um projeto Firebase.

   COMO CONFIGURAR (leia com atenção):
   1. Crie um projeto em https://console.firebase.google.com
   2. Ative "Authentication" > método "Google"
   3. Crie um banco "Firestore Database" (modo produção)
   4. Em "Configurações do projeto" > "Seus apps" > Web, copie o objeto de
      configuração e cole abaixo em FIREBASE_CONFIG.
   5. Publique as regras de segurança do arquivo firestore.rules (fornecido
      junto a este projeto) no console do Firestore.
   6. Se for publicar em um domínio diferente de *.firebaseapp.com (ex: Vercel,
      Netlify), veja o vercel.json incluído — ele proxia as rotas de auth para
      evitar bloqueios de login em navegadores como Firefox/Safari.
   7. O primeiro usuário que fizer login com Google vira automaticamente
      administrador. Os próximos ficam "pendentes" até serem aprovados.
   ============================================================================ */

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAcEx_Ff5_XJfHMaxkfTjpsllvCYYOhcm8",
  // authDomain aponta para o domínio do próprio app (não mais *.firebaseapp.com).
  // O vercel.json proxia /__/auth/* e /__/firebase/* para o Firebase por trás dos
  // panos, então o navegador nunca enxerga isso como cross-origin — é isso que
  // elimina os erros "missing initial state" / popup bloqueado no Firefox.
  authDomain: "mini-erp-de-estoques-e-vendas.vercel.app",
  projectId: "estoqueteste-143a6",
  storageBucket: "estoqueteste-143a6.firebasestorage.app",
  messagingSenderId: "739016859286",
  appId: "1:739016859286:web:10dbf5d6910d58885b2cb7"
};

export const isConfigured = FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.includes("COLE_AQUI");
