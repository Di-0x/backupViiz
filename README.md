# BackupViiz

Outil web auto-hébergé pour concevoir et vérifier vos stratégies de backup **3-2-1** : éditeur graphique des chemins de sauvegarde, évaluation en temps réel, alertes de non-conformité, authentification par mot de passe ou passkeys.

## Démarrage rapide (Docker)

```bash
cp .env.example .env   # ajustez si besoin
docker compose up -d --build
```

Ouvrez <http://localhost:3000> et créez le premier compte (l'inscription est ouverte tant qu'aucun utilisateur n'existe).

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port d'écoute (dans docker-compose : port publié sur l'hôte) |
| `DATABASE_PATH` | `/data/backupviiz.db` | Fichier SQLite (volume `/data`) |
| `WEB_DIST` | `/app/public` | Dossier du frontend compilé |
| `ALLOW_REGISTRATION` | `false` | `true` pour autoriser d'autres inscriptions que la première |
| `TRUST_PROXY` | `false` | `true` derrière un reverse-proxy (en-têtes `X-Forwarded-*`) |
| `COOKIE_SECURE` | auto | Force l'attribut `Secure` des cookies |
| `WEBAUTHN_RP_ID` | dérivé de `Host` | Identifiant de partie de confiance des passkeys |
| `WEBAUTHN_ORIGIN` | dérivé de `Origin` | Origine attendue des passkeys |

## HTTPS et passkeys

Les passkeys (WebAuthn) exigent un contexte sécurisé : **HTTPS est obligatoire** hors `localhost`. Placez un reverse-proxy (Caddy, Traefik, nginx…) devant le conteneur, activez `TRUST_PROXY=true`, transmettez `Host` et `X-Forwarded-Proto`, et au besoin fixez `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`. Exemple Caddy :

```
backup.example.com {
  reverse_proxy backupviiz:3000
}
```

## Sauvegarde des données

Toutes les données vivent dans le volume nommé `backupviiz-data` (`/data`, base SQLite en mode WAL). Oui, un outil de backup qui doit être sauvegardé : l'ironie est assumée. Sauvegarde à chaud, par exemple :

```bash
docker compose exec backupviiz node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/backupviiz.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker run --rm -v backupviiz_backupviiz-data:/data -v "$PWD":/out alpine cp /data/backup.db /out/
```

Ou arrêtez le conteneur et archivez le volume : `docker run --rm -v backupviiz_backupviiz-data:/data -v "$PWD":/out alpine tar czf /out/backupviiz-data.tgz -C /data .`
Pensez à appliquer la règle 3-2-1 à cette sauvegarde. Les stratégies peuvent aussi être exportées en JSON depuis l'interface.

## Développement

Node.js >= 22.13 requis.

```bash
npm ci
npm run dev        # serveur (3000) + vite (5173, proxy /api)
npm run typecheck
npm test
npm run build      # web -> web/dist, serveur -> server/dist
```

Structure : `shared/` (types, schémas et moteur d'évaluation), `server/` (Fastify + SQLite), `web/` (React + Vite). Le serveur est bundlé par tsup ; seules ses dépendances externes sont installées dans l'image finale (non-root, `tini`, healthcheck `/api/health`).

## CI

`.github/workflows/ci.yml` : typecheck, tests, build, puis build de l'image Docker et test de démarrage.
