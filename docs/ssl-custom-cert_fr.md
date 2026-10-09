# Apporter son propre certificat SSL

Référence technique pour remplacer le certificat auto-signé généré par
défaut par un certificat émis par votre propre autorité (Let's Encrypt,
CA interne d'entreprise, ou commercial).

---

## Réponse courte

Définir `SKIP_CERT_AUTOGEN=true` dans l'environnement du serveur (voir
[Désactiver l'auto-régénération](#désactiver-lauto-régénération)),
remplacer les fichiers `server/cert.pem` et `server/key.pem`, mettre les
permissions à `chmod 600` sur la clé privée, et redémarrer le service —
aucune modification de code requise. Sans cette variable, le serveur
juge que votre certificat doit être régénéré (CN/SAN différents de ce
qu'il génère) et écrase les deux fichiers au prochain démarrage. Si vous
ne fournissez pas votre propre `ca-cert.pem`, déplacer celui qui a été
auto-généré (voir [Fichiers à remplacer](#fichiers-à-remplacer)).

---

## Architecture du certificat (chaîne CA + leaf)

Le serveur entretient une chaîne à deux certificats dans `server/` :

| Fichier | Rôle | Durée | Sert le TLS ? |
|---|---|---|---|
| `ca-cert.pem` + `ca-key.pem` | Root CA auto-signée. `basicConstraints=CA:TRUE`, `keyUsage=keyCertSign,cRLSign`. C'est ce que l'utilisateur installe dans son trust store (téléphone, laptop). | 10 ans | Non |
| `cert.pem` + `key.pem` | Leaf serveur, signé par la CA. `basicConstraints=CA:FALSE`, `keyUsage=digitalSignature,keyEncipherment`, `extendedKeyUsage=serverAuth`, SAN qui couvre `localhost` + toutes les IPv4 LAN + hostname (`<host>` et `<host>.local`). | 825 jours | Oui (présenté dans le handshake avec la CA concaténée) |

Pourquoi deux fichiers ? Firefox 150 applique strictement RFC 5280 et rejette un cert avec `CA:TRUE` servi comme leaf (`MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY`). La séparation CA-racine / leaf-serveur résout cela.

Le serveur régénère uniquement le leaf quand la configuration réseau change (nouvelle IP DHCP, second interface), gardant `ca-cert.pem` intact — les clients qui ont déjà installé la CA restent automatiquement de confiance pour le nouveau leaf. Un changement de hostname régénère cependant aussi la CA (son CN contient le hostname) : les clients doivent alors la réinstaller.

`GET /api/cert.pem` sert `ca-cert.pem` (l'artéfact à installer dans le trust store), pas le leaf.

---

## Fichiers à remplacer

Pour remplacer la chaîne auto-générée par votre propre certificat (Let's Encrypt, CA d'entreprise, mkcert) :

| Fichier | Contenu | Format |
|---|---|---|
| `server/cert.pem` | Votre certificat serveur (+ chaîne d'intermédiaires concaténés si nécessaire) | PEM (X.509) |
| `server/key.pem` | Clé privée non chiffrée correspondant à `cert.pem` | PEM (PKCS#1 ou PKCS#8) |
| `server/ca-cert.pem` *(optionnel)* | Le certificat de votre CA racine (Let's Encrypt ISRG Root X1, votre CA interne, etc.) — c'est ce que `/api/cert.pem` servira aux clients. À omettre si `cert.pem` contient déjà la chaîne complète (par exemple le `fullchain.pem` de Let's Encrypt) — mais déplacer alors les fichiers auto-générés `server/ca-cert.pem` et `server/ca-key.pem` (les renommer, par ex. en `*.bak`) : tant que l'ancienne CA auto-signée est sur le disque, elle est concaténée à votre chaîne servie et c'est elle que `/api/cert.pem` distribue. Sans elle, `/api/cert.pem` se rabat sur `cert.pem` (un certificat reconnu publiquement n'exige de toute façon aucune installation côté client). | PEM (X.509) |

Vous devez aussi définir `SKIP_CERT_AUTOGEN=true` dans l'environnement
du serveur (voir [Désactiver l'auto-régénération](#désactiver-lauto-régénération)
plus bas) — sans ça, la logique d'auto-régénération du serveur détecte
que les fichiers ne correspondent pas au pattern attendu (CN, SAN,
séparation CA/leaf) et les écrase par une nouvelle chaîne auto-signée
au prochain redémarrage. Avec la variable d'environnement définie, le
serveur utilise les fichiers tels quels et ne génère rien ; aucun
fichier `ca-key.pem` placeholder n'est requis.

> **Note PKCS#12** : si votre certificat est livré en **PKCS#12 (`.pfx`/`.p12`)**, il faut
> d'abord le convertir en PEM. Voir la section [Conversion de format](#conversion-de-format) plus bas.

---

## Procédure

Sur le Pi (ou la machine où le serveur tourne) :

```bash
# 1. Arrêter le service
systemctl --user stop pi-weather-server

# 2. Copier les nouveaux fichiers
cp /chemin/vers/votre-cert.pem  ~/pi-weather-station/server/cert.pem
cp /chemin/vers/votre-key.pem   ~/pi-weather-station/server/key.pem
# Vous ne fournissez pas de ca-cert.pem ? Déplacer la CA auto-générée :
# mv ~/pi-weather-station/server/ca-cert.pem ~/pi-weather-station/server/ca-cert.pem.bak
# mv ~/pi-weather-station/server/ca-key.pem  ~/pi-weather-station/server/ca-key.pem.bak

# 3. Restreindre les permissions de la clé privée
chmod 600 ~/pi-weather-station/server/key.pem

# 4. Désactiver l'auto-régénération (une fois — voir « Désactiver l'auto-régénération »)
mkdir -p ~/.config/systemd/user/pi-weather-server.service.d
cat > ~/.config/systemd/user/pi-weather-server.service.d/byo-cert.conf <<'EOF'
[Service]
Environment=SKIP_CERT_AUTOGEN=true
EOF
systemctl --user daemon-reload

# 5. Démarrer le service
systemctl --user start pi-weather-server
```

Sur macOS, arrêter l'agent avec
`launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.pi-weather-station.plist`,
remplacer l'étape 4 par la modification du plist décrite dans
[macOS (agent launchd)](#macos-agent-launchd), puis le redémarrer avec
`launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.pi-weather-station.plist`.
`launchctl kickstart -k "gui/$(id -u)/com.pi-weather-station"` redémarre
le serveur sans relire un plist modifié — il ne suffit que pour les
renouvellements de certificat ultérieurs, une fois la clé
`SKIP_CERT_AUTOGEN` en place.

---

## Trois cas d'usage typiques

| Scénario | Source du certificat |
|---|---|
| Domaine public + DNS dynamique | **Let's Encrypt** via certbot — ajouter un cron pour renouveler tous les ~60 jours, avec un deploy hook qui copie les fichiers renouvelés dans `server/` et redémarre le service (voir [Recommandations selon le type de certificat](#recommandations-selon-le-type-de-certificat)) |
| Environnement corporate | Certificat signé par la **CA interne** de l'entreprise (la CA doit être déjà déployée sur les machines clientes) |
| Réseau local sans domaine | **mkcert** crée une CA locale + cert pour `pi.lan` ou similaire ; la CA doit être installée sur chaque machine cliente |

---

## À savoir : auto-régénération du certificat

Le serveur a une logique d'auto-régénération définie dans
`server/index.js` (fonction `sslOptions`). Au démarrage il évalue
séparément deux conditions :

**Régénération de la CA** (`caNeedsRegen`) — déclenchée si :
- `ca-cert.pem` ou `ca-key.pem` est manquant
- Le subject CN de la CA ne correspond pas à `Pi Weather Station CA - <hostname>` (ou `Pi Weather Station CA` sans hostname utilisable) — changement d'hostname machine

**Régénération du leaf** (`leafNeedsRegen`) — déclenchée si :
- `cert.pem` ou `key.pem` est manquant
- Le cert expire dans moins de 30 jours
- Le SAN du cert ne couvre plus toutes les IPs LAN actuelles (changement DHCP, nouvel interface)
- Le subject CN du leaf ne correspond pas à `Pi Weather Station - <hostname>` (ou `Pi Weather Station` sans hostname utilisable)
- Le cert est un ancien format pré-V3 (single self-signed root avec `CA:TRUE`)
- La CA vient d'être régénérée (alors il faut re-signer le leaf)

Si seule la condition leaf se déclenche, le serveur régénère uniquement le leaf en utilisant la CA existante — les clients qui ont déjà la CA dans leur trust store ne voient aucun warning.

> ⚠ **Important** — sans `SKIP_CERT_AUTOGEN=true`, un certificat custom
> est écrasé dès le premier redémarrage, pas seulement à son expiration :
> son CN (et habituellement son SAN) ne correspond pas à ce que le
> serveur génère, donc les vérifications ci-dessus se déclenchent et les
> fichiers sur disque sont remplacés par une nouvelle chaîne auto-signée.
> Avec la variable définie, le serveur ne régénère jamais rien — un
> certificat expiré continue d'être servi tel quel jusqu'à ce que vous le
> renouveliez et redémarriez ; le renouvellement repose entièrement sur vous.

### Recommandations selon le type de certificat

| Type de certificat | Recommandation |
|---|---|
| **Let's Encrypt (90 jours)** | certbot renouvelle automatiquement avant expiration, mais seulement sous `/etc/letsencrypt` — ajouter un `--deploy-hook` qui copie `fullchain.pem` / `privkey.pem` vers `server/cert.pem` / `server/key.pem`, les attribue (`chown`) à l'utilisateur du service (ils appartiennent à root), applique `chmod 600` à la clé et redémarre le service (le serveur ne lit le certificat qu'au démarrage) |
| **Cert long terme (1-2 ans)** | Mettre une alerte calendrier 30 jours avant la date d'expiration |
| **Cert lifetime court (< 30 jours)** | Automatisation indispensable — script de renouvellement + restart du service |

---

## Désactiver l'auto-régénération

Définir `SKIP_CERT_AUTOGEN=true` dans l'environnement du serveur. Le
serveur saute alors toutes les vérifications d'auto-régénération (CA +
leaf) et utilise `cert.pem`, `key.pem` et `ca-cert.pem` (si présent)
tels quels. Si `cert.pem` ou `key.pem` est manquant alors que le drapeau
est actif, le serveur journalise une erreur et ne retombe pas sur une
chaîne auto-signée : il démarre en HTTP clair sur `127.0.0.1:8080`
uniquement (le kiosque local fonctionne, l'accès distant reste coupé)
jusqu'à ce que les fichiers soient fournis et le service redémarré.

### Linux (service systemd utilisateur)

Créer un drop-in pour que le changement survive aux `git pull` :

```bash
mkdir -p ~/.config/systemd/user/pi-weather-server.service.d
cat > ~/.config/systemd/user/pi-weather-server.service.d/byo-cert.conf <<'EOF'
[Service]
Environment=SKIP_CERT_AUTOGEN=true
EOF
systemctl --user daemon-reload
systemctl --user restart pi-weather-server
```

### macOS (agent launchd)

Éditer `~/Library/LaunchAgents/com.pi-weather-station.plist` et ajouter
la clé dans le `<dict>` qui suit `<key>EnvironmentVariables</key>` :

```xml
<key>EnvironmentVariables</key>
<dict>
    <key>SKIP_CERT_AUTOGEN</key>
    <string>true</string>
    <!-- les clés existantes (ALLOW_REMOTE, NODE_ENV, etc.) restent telles quelles -->
</dict>
```

Puis recharger :

```bash
launchctl bootout   "gui/$(id -u)" ~/Library/LaunchAgents/com.pi-weather-station.plist 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.pi-weather-station.plist
```

> ⚠ Relancer `bash deploy/install.sh` (ce que la fenêtre de mise à jour
> demande dès qu'un fichier de déploiement installé diffère de sa copie
> en amont — ce qui sera toujours le cas de ce plist modifié) reconstruit
> ce plist depuis le gabarit du dépôt — en ne gardant que `NODE_ENV`,
> `ALLOW_REMOTE` et `DEBUG` — et recharge aussitôt l'agent. Sans
> `SKIP_CERT_AUTOGEN`, le serveur écrase alors `cert.pem` / `key.pem`
> (et `ca-cert.pem`) par une nouvelle chaîne auto-signée dès ce
> démarrage. Sauvegarder vos fichiers de certificat avant de relancer
> l'installeur ; ensuite, les restaurer, rajouter la clé
> `SKIP_CERT_AUTOGEN` et recharger l'agent avec `bootout` / `bootstrap`.
> (Le drop-in Linux `byo-cert.conf` survit à `install.sh`.)

### Vérification

Le serveur affiche `SKIP_CERT_AUTOGEN=true — using existing certificate files as-is, no auto-regeneration` au démarrage quand le drapeau est pris en compte.

---

## Conversion de format

Si votre certificat est livré dans un format autre que PEM, voici les
conversions courantes :

### Depuis PKCS#12 (`.pfx` / `.p12`)

```bash
# Extraire la clé privée
openssl pkcs12 -in cert.pfx -nocerts -nodes -out key.pem

# Extraire le certificat (et la chaîne)
openssl pkcs12 -in cert.pfx -nokeys -out cert.pem
```

### Depuis DER (binaire)

```bash
openssl x509 -in cert.der -inform DER -out cert.pem -outform PEM
```

### Si la clé privée est chiffrée

Le serveur Node ne supporte pas les clés chiffrées sans modification de
code. Pour la déchiffrer :

```bash
openssl rsa -in key-encrypted.pem -out key.pem
# (mot de passe demandé)
```

---

## Vérifier que le bon certificat est servi

Après redémarrage, valider depuis n'importe quelle machine cliente :

```bash
# Voir le certificat servi
openssl s_client -connect <pi-ip>:8443 -servername <hostname> < /dev/null \
  | openssl x509 -noout -issuer -subject -dates

# Tester avec curl
curl -v https://<pi-ip>:8443/api/is-local
```

La commande `openssl s_client` doit afficher l'`issuer` correspondant à
votre CA (au lieu de `CN=Pi Weather Station CA - <hostname>` pour la
chaîne auto-générée) et les dates de validité que vous attendez.
