# BackupViiz — Spécification d'implémentation (contrat multi-agents)

Outil web (Docker) de gestion de stratégies de backup **3-2-1** : éditeur graphique de chemins de backup, évaluation temps réel, alertes de non-conformité, auth compte/mdp + passkeys. **UI en français.**

## Stack (figée)
- Monorepo npm workspaces : `shared/` (TS pur : types, moteur de règles, templates, validation), `server/` (Node 22, Fastify 5, `node:sqlite`, zod, @simplewebauthn/server), `web/` (Vite 6, React 18, TypeScript, @xyflow/react 12, zustand, react-router 6, @simplewebauthn/browser).
- Pas de lib UI lourde : CSS maison (custom properties, light/dark via `prefers-color-scheme`), icônes en SVG inline. Éditeur et React Flow chargés en lazy (code-splitting) ; le bundle initial (login + liste) doit rester < ~100 kB gzip.
- `shared` est consommé en source TS (`main: src/index.ts`). Imports relatifs **sans extension** dans shared/server/web (moduleResolution Bundler).
- Contrat de types : `shared/src/types.ts` (NE PAS modifier ; si besoin impératif, ajouter seulement, et le signaler dans le rapport final).
- Les dépendances sont déjà déclarées dans les package.json et installées à la racine. N'ajoute une dépendance que si indispensable (`npm i -w <pkg> <dep>`), et signale-le.
- Aucun commit/push par les agents : l'orchestrateur commit. Ne touche QUE tes fichiers (propriété ci-dessous).

## Règles 3-2-1 (moteur `shared/src/evaluate.ts`)
`evaluate(doc: StrategyDoc): Evaluation` — fonction pure, déterministe, rapide (O(N+E)).
Pour chaque noeud `kind:'source'` :
- Copies = la source (copie 1) + tous les noeuds `storage` **atteignables** par chemins orientés (edges `from→to`, cycles tolérés).
- **Règle 3** : copies ≥ 3. **Règle 2** : ≥ 2 `mediaType` distincts parmi source + copies. **Règle 1** : ≥ 1 copie `location:'offsite'`.
- Alertes (`Alert`, messages FR actionnables, ids déterministes ex. `${rule}:${sourceId}`) :
  - rule '3' / '2' / '1' → severity `error` quand violée (message précis : « Source "X" : 2 copies sur 3 requises — ajoutez un support »).
  - rule 'structure' : `error` « aucune source » n'existe pas (status `empty` à la place) ; `warning` : support non atteignable depuis une source (orphelin) ; `warning` : lien dont une extrémité est inconnue ; `info` : lien sans fréquence (`schedule`) ; `warning` : source sans aucun lien sortant ; `warning` : lien vers soi-même ; `warning` : doublon from→to.
  - rule 'immutable' : `info` « aucune copie immuable/air-gap (3-2-1-1-0) » si aucune source n'a de copie `immutable`.
- `status` : `empty` (0 source) | `violation` (≥1 error) | `warning` (≥1 warning) | `compliant`.
- Un `Evaluation` stable : tri des alertes (error > warning > info, puis id).
`shared/src/validate.ts` : schémas **zod** `strategyDocSchema`, `createStrategySchema`, `updateStrategySchema` (limites : ≤ 200 noeuds, ≤ 500 liens, label 1–80 car., notes ≤ 500, name 1–100, description ≤ 500, ids ≤ 64 car. `[A-Za-z0-9_-]`, intégrité référentielle des edges NON exigée — gérée comme alerte). Ajouter `zod` aux deps de `shared` si absent.
`shared/src/templates.ts` : `TEMPLATES: { id; name; description; doc: StrategyDoc }[]` — « Vide », « 3-2-1 classique (PC → NAS → Cloud) », « PME : serveur + NAS + bande + cloud immuable », « Non conforme (exemple) » (sert de démo d'alerte). Positions déjà agencées gauche→droite (x pas de ~260, y pas de ~140). Helper `instantiateTemplate(t)` qui régénère les ids uniques.

## API REST (JSON, cookie de session httpOnly `bv_session`, SameSite=Lax, Secure si HTTPS)
Erreurs : `{ error: { code, message, fields? } }` (type `ApiError`), codes HTTP corrects (400 validation, 401, 403, 404, 409, 429).
Toutes les routes sauf `/api/health`, `register`, `login`, `passkey/login/*` exigent `app.requireAuth`.

Auth (`server/src/routes/auth.ts`) :
- `GET /api/auth/config` → `{ registrationOpen: boolean }` (ouverte si 0 utilisateur ou `ALLOW_REGISTRATION=true`).
- `POST /api/auth/register` `{username, password}` (username 3–32 `[a-zA-Z0-9._-]`, password ≥ 10 car.) → 201 `User` + cookie. 403 si fermée.
- `POST /api/auth/login` `{username, password}` → `User` + cookie. Rate-limit (ex. 10/min/IP), comparaison à temps constant, même message pour user inconnu/mdp faux, hash factice pour égaliser le temps.
- `POST /api/auth/logout` → 204. `GET /api/auth/me` → `User` | 401.
- `POST /api/auth/password` `{currentPassword?, newPassword}` (change/définit le mdp, invalide les autres sessions).
- Mots de passe : `crypto.scrypt` (N=2^15, r=8, p=1, sel 16 o, format `scrypt$N$r$p$salt$hash` base64). Sessions : token 32 o aléatoires, cookie = token, DB = sha256, durée 14 j glissante, purge opportuniste. CSRF : cookie SameSite=Lax + rejet des requêtes mutantes dont `Origin` (si présent) ≠ host.

Passkeys (`server/src/routes/passkey.ts`, @simplewebauthn/server v13) — rpID/origin dérivés de l'en-tête `Host`/`Origin` de la requête (surchargeables par `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`), challenges stockés en table `webauthn_challenges` (TTL 5 min, usage unique, id dans cookie httpOnly `bv_wa`) :
- `POST /passkey/register/options` (auth) → options · `POST /passkey/register/verify` (auth) `{response, name?}` → `PasskeyInfo`.
- `POST /passkey/login/options` `{username?}` → options (si username omis : discoverable credentials / conditional UI) · `POST /passkey/login/verify` `{response}` → `User` + cookie.
- `GET /passkey` → `PasskeyInfo[]` · `PATCH /passkey/:id` `{name}` · `DELETE /passkey/:id` (refuser de supprimer le dernier moyen de connexion s'il n'y a pas de mot de passe → 409).
- `userVerification: 'preferred'`, `residentKey: 'preferred'`, mise à jour du `counter` et `last_used_at`.
- Inscription **passkey-only** autorisée : `POST /passkey/signup/options` `{username}` + `POST /passkey/signup/verify` `{response}` (crée le compte sans mot de passe, si inscription ouverte).

Stratégies (`server/src/routes/strategies.ts`), scoping strict par `user_id` (404 si pas propriétaire) :
- `GET /api/strategies` → `StrategySummary[]` (tri `updated_at` desc) · `POST` `{name, description?, doc?}` → 201 `Strategy` (doc par défaut vide) ·
- `GET /:id` → `Strategy` (avec `evaluation` calculée par `evaluate`) · `PUT /:id` `{name?, description?, doc?}` → `Strategy` (last-write-wins) · `DELETE /:id` → 204 · `POST /:id/duplicate` → 201 `Strategy` (« Copie de … ») ·
- `GET /:id/export` → JSON téléchargeable `{ version:1, name, description, doc }` · `POST /import` `{name?, description?, doc}` → 201 `Strategy`.
- Body limit 1 MB. Persistance : `db` de `server/src/db.ts` (schéma déjà créé, ne pas le modifier sans nécessité ; ajouts via `ALTER` idempotent autorisés dans le fichier propriétaire de la table).

Server divers : `GET /api/health` ; env : `PORT` (3000), `DATABASE_PATH` (`/data/backupviiz.db` en Docker), `ALLOW_REGISTRATION`, `TRUST_PROXY`, `COOKIE_SECURE` (auto), `WEBAUTHN_*`, `WEB_DIST`.

## Frontend (UI FR, a11y WCAG AA, clavier, responsive ≥ 360 px)
Routes : `/login` `/register` · `/` (liste des stratégies, cartes avec badge de conformité, créer via template, dupliquer, supprimer avec confirmation/undo, import/export) · `/s/:id` (éditeur, lazy) · `/account` (mot de passe, passkeys : ajouter/renommer/supprimer, déconnexion).
UX : chargement < 1 s, skeletons, aucun spinner bloquant, optimistic UI, toasts, sauvegarde **auto** debounced (1 s) avec indicateur « Enregistré / Enregistrement… / Erreur — réessayer », raccourcis (Ctrl/Cmd+Z/Y undo/redo, Suppr, Ctrl+D dupliquer, N ajouter source, S ajouter support…), dark mode auto, `prefers-reduced-motion`.
Passkey UX : sur `/login`, bouton « Se connecter avec une passkey » + conditional UI (`autocomplete="username webauthn"`) ; après un login mdp réussi sur un appareil compatible, proposer discrètement « Créer une passkey ».

### Éditeur (`web/src/editor/`) — découpé en 3 propriétaires
- **editor-canvas** : `StrategyEditorPage.tsx` (default export, route `/s/:id`), `store.ts` (zustand : doc, selection, undo/redo historique, dirty, evaluation recalculée par `evaluate` de shared à chaque changement, `highlightedNodeIds`), `Canvas.tsx` (React Flow : nœuds custom `SourceNode`/`StorageNode` avec icône par `mediaType`, pastille onsite/offsite, badge immuable, badge « copie n° » ; arêtes orientées avec label méthode/fréquence, animées ; minimap, controls, grille snap, fit-view ; création de lien par drag depuis les handles ; ajout par palette drag&drop **et** clic/double-clic fond ; menu contextuel ; auto-layout gauche→droite simple), `Toolbar.tsx` (nom éditable, indicateur sauvegarde, undo/redo, auto-layout, export PNG/SVG optionnel, bouton « Alertes » avec compteur), `Palette.tsx`, `useAutosave.ts`. Surlignage visuel des nœuds fautifs (liseré rouge/orange) piloté par `evaluation.alerts[].nodeIds` + hover d'une alerte.
- **editor-panels** : `web/src/editor/panels/` — composants **purs, pilotés par props** (aucune dépendance au store) :
  - `ComplianceBadge({ status, errorCount, warningCount, compact? })`
  - `ComplianceBar({ evaluation })` : trois pastilles **3 · 2 · 1** (copies / supports / offsite) agrégées, vert/rouge, avec tooltip.
  - `AlertsPanel({ evaluation, onHoverAlert(nodeIds|null), onSelectNodes(ids), onFocusNode? })` : liste groupée par sévérité, état « Conforme 3-2-1 ✓ », a11y `role="status"`/`aria-live="polite"`.
  - `SourceReport({ evaluation, nodes })` : par source, détail copies/supports/offsite avec cases ✓/✗.
  - `Inspector({ node?, edge?, nodes, onChangeNode(id, patch), onChangeEdge(id, patch), onDelete(kind,id) })` : formulaire (label, mediaType, location, immutable, notes ; edge : méthode (suggestions datalist), fréquence (suggestions), notes).
  - `mediaMeta.ts` : `MEDIA_META: Record<MediaType, {label; icon: ReactNode(SVG)}>`, `LOCATION_LABEL`, `METHOD_SUGGESTIONS`, `SCHEDULE_SUGGESTIONS` (exportés pour le canvas).
  Chaque composant a son CSS module/plain css dans le même dossier, utilise uniquement les tokens CSS de `web/src/styles/tokens.css` (propriété web-shell : `--bg --surface --text --muted --border --accent --ok --warn --err --radius --shadow`, + `--ok-bg --warn-bg --err-bg`).
- **web-shell** : `web/src/{main.tsx,App.tsx,router,api/client.ts,api/hooks,auth/*,pages/{Login,Register,Dashboard,Account},components/{Toast,ConfirmDialog,Skeleton,AppHeader},styles/*}`. `api/client.ts` expose `api.*` typé (fetch, credentials same-origin, parse `ApiError`, redirection 401 → /login). L'éditeur est importé via `React.lazy(() => import('./editor/StrategyEditorPage'))`. Le dashboard utilise `ComplianceBadge` de `editor/panels` (import direct) — en attendant sa livraison, un fallback local est toléré mais doit être remplacé.

## Docker / ops (agent "devops")
`Dockerfile` multi-stage (node:22-alpine : deps → build web+server → runtime non-root, `tini`, HEALTHCHECK `/api/health`, volume `/data`, EXPOSE 3000, image finale minimale avec `public/` + `dist/index.js`, **sans** devDependencies : le serveur est bundlé par tsup, seules les deps runtime externes sont installées via `npm ci --omit=dev -w server`). `docker-compose.yml` (volume nommé, env, restart unless-stopped, healthcheck, read_only fs + tmpfs si possible), `.dockerignore`, `.env.example`, `README.md` (FR : démarrage rapide, variables, HTTPS/reverse-proxy requis pour passkeys hors localhost, sauvegarde du volume `/data` — ironie assumée —, dev), `.github/workflows/ci.yml` (typecheck, test, build, docker build).

## Tests
Vitest. `shared` : couverture forte du moteur (cas limites : cycles, multi-sources, support orphelin, mêmes media types, offsite absent…). `server` : tests d'intégration via `app.inject()` avec `DATABASE_PATH=:memory:` (auth, passkey logique non-WebAuthn mockée, CRUD, isolation entre utilisateurs). `web` : tests composants clés (jsdom). E2E Playwright ensuite (orchestrateur).

## Propriété des fichiers
| Agent | Fichiers |
|---|---|
| shared-engine | `shared/**` (sauf `types.ts`) |
| server-auth | `server/src/auth/**`, `server/src/routes/{auth,passkey}.ts`, `server/test/auth*.test.ts` |
| server-strategies | `server/src/routes/strategies.ts`, `server/src/app.ts`, `server/src/db.ts`, `server/src/index.ts`, `server/test/strategies*.test.ts`, `server/test/helpers.ts` |
| web-shell | `web/{index.html,vite.config.ts}`, `web/src/**` hors `editor/` |
| editor-canvas | `web/src/editor/*.{ts,tsx,css}` (hors `panels/`) |
| editor-panels | `web/src/editor/panels/**` |
| devops | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `README.md`, `.github/**` |
