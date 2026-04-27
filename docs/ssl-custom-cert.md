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

## Fichiers à remplacer

| Fichier | Contenu | Format |
|---|---|---|
| `server/cert.pem` | Certificat (+ chaîne d'intermédiaires concaténés si nécessaire) | PEM (X.509) |
| `server/key.pem` | Clé privée non chiffrée | PEM (PKCS#1 ou PKCS#8) |

> **Note** : si votre certificat est livré en **PKCS#12 (`.pfx`/`.p12`)**, il faut
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
`server/index.js` autour de la ligne 95 : si `cert.pem` n'existe pas ou
est expiré au démarrage, il génère automatiquement un certificat
self-signed pour qu'au moins HTTPS soit fonctionnel.

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

## Désactiver l'auto-régénération (optionnel)

Si vous préférez que le serveur échoue plutôt que de tomber en fallback
self-signed (par exemple en environnement où un cert non-conforme est
inacceptable), commenter le bloc `try/catch` qui appelle
`openssl req -x509` dans `server/index.js` autour de la ligne 95.

> **Note** : c'est un changement de code local, donc à reproduire à
> chaque `git pull` qui modifierait ce fichier. Une alternative plus propre
> serait d'ajouter une variable d'environnement `SKIP_CERT_AUTOGEN=true` —
> petite amélioration à proposer en pull request si ce besoin est
> récurrent.

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
