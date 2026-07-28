# Estoque+ · Mini-ERP de Estoque e Vendas

Aplicação web completa para controle de estoque: cadastro de produtos, entradas e saídas,
relatórios e níveis de permissão. Usa **Firebase** (Authentication com Google + Firestore)
como backend e roda como **um único arquivo HTML** — sem servidor, sem build.

## Arquivos

- `index.html` — a aplicação inteira (interface + lógica + integração com Firebase)
- `firestore.rules` — regras de segurança prontas para publicar no Firestore
- `README.md` — este guia

## 1. Criar o projeto no Firebase

1. Acesse **console.firebase.google.com** e clique em **Adicionar projeto**.
2. Dê um nome (ex: `estoque-mais`) e conclua a criação.
3. No menu lateral, vá em **Build > Authentication** → aba **Sign-in method** →
   ative o provedor **Google**.
4. Vá em **Build > Firestore Database** → **Criar banco de dados** → escolha
   **modo produção** e a região mais próxima de você.
5. Ainda no Firestore, aba **Regras**, apague o conteúdo padrão e cole o
   conteúdo do arquivo `firestore.rules` deste projeto. Clique em **Publicar**.

## 2. Conectar o app ao seu projeto

1. No console, clique no ícone de engrenagem → **Configurações do projeto**.
2. Em **Seus aplicativos**, clique no ícone **`</>`** (Web) e registre um app
   (não precisa marcar "Firebase Hosting").
3. Copie o objeto `firebaseConfig` mostrado na tela.
4. Abra `index.html` em um editor de texto, localize o bloco `FIREBASE_CONFIG`
   perto do topo do `<script type="module">` e substitua pelos seus valores:

```js
const FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

5. Salve o arquivo.

## 3. Rodar localmente

Basta abrir `index.html` no navegador. Alguns navegadores restringem
`type="module"` em arquivos abertos via `file://`; se isso acontecer, rode um
servidor local simples na pasta do arquivo:

```bash
python3 -m http.server 8080
# depois acesse http://localhost:8080
```

## 4. Publicar (Firebase Hosting — opcional, grátis)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # aponte a pasta pública para onde está o index.html
firebase deploy
```

Você também pode publicar em qualquer hospedagem estática (Vercel, Netlify,
GitHub Pages etc.) — o app não depende de backend próprio, só do Firebase.

**Importante:** em Authentication > Settings > Domínios autorizados, adicione o
domínio onde o app vai rodar (ex: `seuapp.web.app` ou `localhost`), senão o
login com Google será bloqueado.

## Como funcionam os níveis de permissão

O primeiro usuário que fizer login com o Google vira automaticamente
**Administrador**. Todos os seguintes entram como **Pendente** e ficam numa
tela de espera até um administrador definir o papel deles em **Usuários**.

| Papel | Ver produtos | Cadastrar/editar produtos | Excluir produtos | Registrar entrada/saída | Ver relatórios | Gerenciar usuários |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Administrador** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Gerente** | ✅ | ✅ | — | ✅ | ✅ | — |
| **Operador** | ✅ | — | — | ✅ | — | — |
| **Pendente** | — | — | — | — | — | — |

## Estrutura de dados no Firestore

- `users/{uid}` → `{ name, email, photoURL, role, active, createdAt }`
- `products/{id}` → `{ sku, name, category, unit, minStock, currentStock, costPrice, salePrice, active, createdAt, updatedAt }`
- `movements/{id}` → `{ productId, productName, sku, type ('entrada'|'saida'), qty, reason, note, unitCost, unitSale, totalValue, userId, userName, createdAt }`
- `meta/counters` → contador interno usado só para decidir quem é o primeiro admin

Toda movimentação é gravada com uma **transação atômica** que atualiza o
estoque do produto e cria o registro de movimento ao mesmo tempo — evita
condição de corrida quando dois usuários lançam movimentos simultaneamente, e
impede saída maior que o estoque disponível.

## Funcionalidades

- Login com conta Google (Firebase Authentication)
- Aprovação de novos usuários com 3 níveis de permissão + status pendente
- Cadastro completo de produtos: SKU, categoria, unidade, custo, preço de
  venda, estoque mínimo e estoque atual
- Registro de entradas e saídas com motivo, observação e transação atômica
- Painel com indicadores (valor em estoque, alertas de estoque baixo,
  movimentações do dia) e gráficos (Chart.js)
- Relatórios por período com exportação para CSV
- Alertas visuais de estoque baixo/esgotado
- Interface responsiva (funciona em celular)

## Personalização

- Cores, tipografia e o estilo das "etiquetas" (tags) ficam no `<style>` no
  topo do `index.html`, em variáveis CSS (`--accent`, `--in`, `--out` etc.).
- Para adicionar novos campos a produtos ou movimentações, edite o formulário
  correspondente (`__openProductModal` / `__openMovementModal`) e os campos
  salvos no Firestore logo abaixo.
