# Brancher restic à BackupViiz

BackupViiz peut afficher l'état **réel** de vos sauvegardes restic (date du dernier snapshot, échec éventuel) et lever une alerte « fraîcheur » si une sauvegarde est trop ancienne. Une machine envoie son état avec un jeton API ; le jeton ne donne accès à rien d'autre.

## Mise en place

1. **Créer un jeton** : page « Mon compte » > « Jetons API » > nommez-le (par exemple le nom de la machine) > « Créer un jeton ». Copiez-le tout de suite : il n'est affiché qu'une fois. Il se révoque depuis la même page.
2. **Repérer la stratégie et le nœud** : l'identifiant de la stratégie est dans l'adresse de l'éditeur (`/s/<id>`). Le nœud est désigné soit par son identifiant (`BACKUPVIIZ_NODE`), soit par le champ « Nom de machine » (hostname) du nœud (`BACKUPVIIZ_HOST`, insensible à la casse). Si deux nœuds ont le même hostname, le serveur répond 409 : utilisez alors `BACKUPVIIZ_NODE`.
3. **Installer le script** `scripts/restic-report.sh` sur la machine (POSIX sh, nécessite `curl` et `restic`).
4. **Définir les variables** :

| Variable | Rôle |
|---|---|
| `BACKUPVIIZ_URL` | URL de BackupViiz (ex. `https://backup.example.com`) |
| `BACKUPVIIZ_TOKEN` | jeton `bvk_…` |
| `BACKUPVIIZ_STRATEGY` | identifiant de la stratégie |
| `BACKUPVIIZ_NODE` ou `BACKUPVIIZ_HOST` | nœud ciblé (défaut : `hostname`) |
| `RESTIC_SNAPSHOTS_ARGS` | arguments de `restic snapshots` (défaut : `--latest 1`) |
| `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`… | déjà utilisées par restic |

Le jeton n'est jamais affiché ni passé en argument de `curl` (il ne figure pas dans `ps`). Stockez-le dans un fichier lisible par root seul.

## Utilisation

Mode wrapper : exécute la commande, puis reporte `ok` ou `failed` selon son code de sortie (qui est conservé) :

```sh
restic-report.sh -- restic backup /donnees
```

Mode simple : lit les snapshots existants et reporte `ok` (ou `failed` si restic est illisible) :

```sh
restic-report.sh
```

Le script envoie la sortie de `restic snapshots --json`; le serveur n'en retient que la date la plus récente (dernier succès) et le nombre de snapshots. En cas d'échec, l'ancienne date de dernier succès est conservée.

### Exemple cron

```cron
0 2 * * * . /etc/backupviiz.env && /opt/backupviiz/restic-report.sh -- restic backup /donnees >>/var/log/restic.log 2>&1
```

avec `/etc/backupviiz.env` (chmod 600) contenant des lignes `export VAR=valeur`.

### Exemple systemd

`/etc/systemd/system/restic-backup.service` :

```ini
[Service]
Type=oneshot
EnvironmentFile=/etc/backupviiz.env
ExecStart=/opt/backupviiz/restic-report.sh -- restic backup /donnees
```

`/etc/systemd/system/restic-backup.timer` :

```ini
[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
[Install]
WantedBy=timers.target
```

Activez avec `systemctl enable --now restic-backup.timer` (ici `EnvironmentFile` : lignes `VAR=valeur`, sans `export`).

### Windows (PowerShell)

Sans le script, avec l'API directement :

```powershell
$snap = restic snapshots --json --latest 1 | ConvertFrom-Json
$status = if ($LASTEXITCODE -eq 0) { 'ok' } else { 'failed' }
$body = @{ tool = 'restic'; status = $status; snapshots = @($snap) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "$env:BACKUPVIIZ_URL/api/ingest/$env:BACKUPVIIZ_STRATEGY/by-hostname/$env:COMPUTERNAME" `
  -Headers @{ Authorization = "Bearer $env:BACKUPVIIZ_TOKEN" } -ContentType 'application/json' -Body $body
```

## Fraîcheur et `staleAfterHours`

Chaque nœud peut définir `staleAfterHours` (délai maximal toléré). Si le dernier succès reporté est plus ancien, ou si le dernier statut est `failed` depuis plus longtemps, BackupViiz lève l'alerte « fraîcheur ». Choisissez un délai un peu supérieur à la période de vos sauvegardes (ex. 26 h pour une sauvegarde quotidienne).

## Vérifier que la sauvegarde est vraiment exploitable

Un snapshot récent ne prouve pas qu'il est restaurable. Périodiquement :

```sh
restic check                       # intégrité du dépôt (ajoutez --read-data-subset=5% pour échantillonner)
restic restore latest --target /tmp/test-restore --include /chemin/important
```

Comparez le contenu restauré, puis renseignez la date du test de restauration sur le nœud dans BackupViiz.

## Dépannage

| Code HTTP | Cause |
|---|---|
| 401 | jeton invalide ou révoqué |
| 404 | stratégie ou nœud introuvable (vérifiez l'hostname) |
| 409 | hostname ambigu : utilisez `BACKUPVIIZ_NODE` |
| 413 | corps > 2 Mo : réduisez `RESTIC_SNAPSHOTS_ARGS` (`--latest 1`) |
| 429 | plus de 60 envois par minute pour ce jeton |
