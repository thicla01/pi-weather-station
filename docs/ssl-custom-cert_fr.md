# Apporter son propre certificat SSL

Référence technique pour remplacer le certificat auto-signé généré par
défaut par un certificat émis par votre propre autorité (Let's Encrypt,
CA interne d'entreprise, ou commercial).

---

## Réponse courte

Remplacer les fichiers `server/cert.pem` et `server/key.pem`, mettre les
permissions à `chmod 600` sur la clé privée, et redémarrer le service.
Le serveur les charge tels quels au prochain démarrage — aucune
modification de code requise.

---

## Architecture du certificat (chaîne CA + leaf)

Le serveur entretient une chaîne à deux certificats dans `server/` :

| Fichier | Rôle | Durée | Sert le TLS ? |
|---|---|---|---|
| `ca-cert.pem` + `ca-key.pem` | Root CA auto-signée. `basicConstraints=CA:TRUE`, `keyUsage=keyCertSign,cRLSign`. C'est ce que l'utilisateur installe dans son trust store (téléphone, laptop). | 10 ans | Non |
| `cert.pem` + `key.pem` | Leaf serveur, signé par la CA. `basicConstraints=CA:FALSE`, `keyUsage=digitalSignature,keyEncipherment`, `extendedKeyUsage=serverAuth`, SAN qui couvre `localhost` + toutes les IPv4 LAN + hostname (`<host>` et `<host>.local`). | 825 jours | Oui (présenté dans le handshake avec la CA concaténée) |

Pourquoi deux fichiers ? Firefox 150 applique strictement RFC 5280 et rejette un cert avec `CA:TRUE` servi comme leaf (`MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY`). La séparation CA-racine / leaf-serveur résout cela.

Le serveur régénère uniquement le leaf quand la configuration réseau change (nouvelle IP DHCP, hostname différent, second interface), gardant `ca-cert.pem` intact — les clients qui ont déjà installé la CA restent automatiquement de confiance pour le nouveau leaf.

`GET /api/cert.pem` sert `ca-cert.pem` (l'artéfact à installer dans le trust store), pas le leaf.

---

## Fichiers à remplacer

Pour remplacer la chaîne auto-générée par votre propre certificat (Let's Encrypt, CA d'entreprise, mkcert) :

| Fichier | Contenu | Format |
|---|---|---|
| `server/cert.pem` | Votre certificat serveur (+ chaîne d'intermédiaires concaténés si nécessaire) | PEM (X.509) |
| `server/key.pem` | Clé privée non chiffrée correspondant à `cert.pem` | PEM (PKCS#1 ou PKCS#8) |
| `server/ca-cert.pem` *(optionnel)* | Le certificat de votre CA racine (Let's Encrypt ISRG Root X1, votre CA interne, etc.) — c'est ce que `/api/cert.pem` servira aux clients. À omettre si `cert.pem` contient déjà la chaîne complète (par exemple le `fullchain.pem` de Let's Encrypt). | PEM (X.509) |

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

# 3. Restreindre les permissions de la clé privée
chmod 600 ~/pi-weather-station/server/key.pem

# 4. Redémarrer le service
systemctl --user start pi-weather-server
```

Sur macOS, remplacer les commandes `systemctl --user` par
`launchctl kickstart -k "gui/$(id -u)/com.pi-weather-station"`.

---

## Trois cas d'usage typiques

| Scénario | Source du certificat |
|---|---|
| Domaine public + DNS dynamique | **Let's Encrypt** via certbot — ajouter un cron pour renouveler tous les ~60 jours |
| Environnement corporate | Certificat signé par la **CA interne** de l'entreprise (la CA doit être déjà déployée sur les machines clientes) |
| Réseau local sans domaine | **mkcert** crée une CA locale + cert pour `pi.lan` ou similaire ; la CA doit être installée sur chaque machine cliente |

---

## À savoir : auto-régénération du certificat

Le serveur a une logique d'auto-régénération définie dans
`server/index.js` (fonction `sslOptions`, environ ligne 130). Au
démarrage il évalue séparément deux conditions :

**Régénération de la CA** (`caNeedsRegen`) — déclenchée si :
- `ca-cert.pem` ou `ca-key.pem` est manquant
- Le subject CN de la CA ne correspond pas à `Pi Weather Station - <hostname>` (changement d'hostname machine)

**Régénération du leaf** (`leafNeedsRegen`) — déclenchée si :
- `cert.pem` ou `key.pem` est manquant
- Le cert expire dans moins de 30 jours
- Le SAN du cert ne couvre plus toutes les IPs LAN actuelles (changement DHCP, nouvel interface)
- Le subject CN du leaf ne correspond pas à `localhost`
- Le cert est un ancien format pré-V3 (single self-signed root avec `CA:TRUE`)
- La CA vient d'être régénérée (alors il faut re-signer le leaf)

Si seule la condition leaf se déclenche, le serveur régénère uniquement le leaf en utilisant la CA existante — les clients qui ont déjà la CA dans leur trust store ne voient aucun warning.

> ⚠ **Important** — si votre certificat custom expire et n'est pas
> renouvelé à temps, le serveur le remplacera au prochain redémarrage par
> un self-signed. Vous perdez alors le certificat custom (le fichier sur
> disque est écrasé).

### Recommandations selon le type de certificat

| Type de certificat | Recommandation |
|---|---|
| **Let's Encrypt (90 jours)** | Cron job qui renouvelle automatiquement avant expiration (certbot le fait nativement) |
| **Cert long terme (1-2 ans)** | Mettre une alerte calendrier 30 jours avant la date d'expiration |
| **Cert lifetime court (< 30 jours)** | Automatisation indispensable — script de renouvellement + restart du service |

---

## Désactiver l'auto-régénération

Définir `SKIP_CERT_AUTOGEN=true` dans l'environnement du serveur. Le
serveur saute alors toutes les vérifications d'auto-régénération (CA +
leaf) et utilise `cert.pem`, `key.pem` et `ca-cert.pem` (si présent)
tels quels. Si `cert.pem` ou `key.pem` est manquant alors que le drapeau
est actif, le serveur échoue bruyamment plutôt que de retomber sur une
chaîne auto-signée.

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
launchctl unload ~/Library/LaunchAgents/com.pi-weather-station.plist
launchctl load   ~/Library/LaunchAgents/com.pi-weather-station.plist
```

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
votre CA (au lieu de `CN=localhost` pour le self-signed) et les dates
de validité que vous attendez.
