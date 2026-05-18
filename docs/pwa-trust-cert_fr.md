# Faire confiance au certificat auto-signé du Pi

Ce guide explique comment installer le certificat TLS du Pi en tant que racine de confiance sur un appareil personnel. Il fait disparaître l'avertissement « Non sécurisé » du navigateur et — surtout — corrige le problème de **l'icône PWA iOS sur l'écran d'accueil** (sans confiance, iOS rejette le téléchargement en arrière-plan de `apple-touch-icon` et affiche à la place un glyphe générique « première lettre du titre de la page »).

> **Pourquoi est-ce nécessaire ?**
> Le Pi sert HTTPS avec un certificat auto-signé (aucune autorité de certification externe). Les navigateurs et les systèmes d'exploitation traitent par défaut les certificats auto-signés comme non fiables. Pour le navigateur du Pi lui-même, le certificat est généré par le Pi et reconnu automatiquement ; pour tout autre appareil sur le LAN (votre téléphone, un portable, une tablette), la chaîne de certification ne se valide pas et les chemins OS de récupération sécurisée dont dépendent certaines fonctions (installation PWA, service workers, notifications push) refusent de fonctionner.
>
> La solution est une installation **unique, par appareil** du certificat du Pi en tant que racine de confiance. Après cela, l'OS traite le Pi comme une origine vérifiée — même effet qu'un vrai certificat Let's Encrypt, sans domaine public.

---

## Chemin rapide : depuis le panneau Paramètres de l'app

L'installation la plus rapide. Fonctionne sur iOS, Android, macOS, Windows et Linux :

1. Sur l'appareil à configurer, ouvrez l'URL du kiosque (p. ex. `https://<ip-du-pi>:8443`) et tapez sur **Continuer** malgré l'avertissement de sécurité du navigateur. (C'est précisément cet avertissement que ce guide fait disparaître — mais pour l'instant il faut l'accepter une fois pour charger la page.)
2. Ouvrez **Paramètres** dans l'app (icône engrenage dans le dock du bas).
3. Section 1 (Préférences locales) → descendez jusqu'au bloc **« Faire confiance à ce Pi sur cet appareil »** en bas.
4. Tapez sur **Télécharger le certificat**. Le fichier `pi-weather-cert.pem` est enregistré sur votre appareil.
5. Poursuivez avec les étapes spécifiques à la plateforme ci-dessous.

Le lien « Télécharger le certificat » pointe vers `/api/cert.pem` qui sert le fichier avec `Content-Type: application/x-x509-ca-cert` — iOS, Android et macOS reconnaissent tous ce type MIME et proposent d'installer le certificat en tant que profil / racine système.

---

## iOS / iPadOS (Safari + tout autre navigateur iOS)

1. Après avoir téléchargé `pi-weather-cert.pem`, iOS affiche une bannière : **« Profil téléchargé »**. Tapez dessus.
   - Si vous avez raté la bannière : **Réglages → Général → VPN et gestion des appareils → Profil téléchargé**.
2. Tapez **Installer** en haut à droite. Saisissez le code de l'appareil.
3. Confirmez tout avertissement « ce profil n'est pas signé par une AC reconnue » — c'est justement le but (le Pi est l'AC).
4. **Réglages → Général → Information → Réglages de confiance des certificats**.
5. Trouvez l'entrée pour votre Pi (nommée d'après le nom d'hôte du Pi ou `localhost`) et **activez le commutateur**.
6. Confirmez la boîte de dialogue « Avertissement ». Terminé.

Une fois la confiance activée :

- Rechargez l'URL du kiosque dans Safari — l'avertissement « Non sécurisé » a disparu.
- Supprimez l'icône existante sur l'écran d'accueil (appui long → Supprimer le clip Web).
- Ajoutez-la à nouveau à l'écran d'accueil (Partager → Ajouter à l'écran d'accueil).
- L'icône radar s'affiche maintenant correctement au lieu du « P ».

**Note un-certificat-par-Pi :** le certificat du Pi est généré avec l'adresse IP LAN et le nom d'hôte du Pi dans son Subject Alternative Name (SAN). Si vous avez plusieurs Pi, répétez les étapes une fois par Pi. Il n'y a pas d'AC centrale — chaque Pi est sa propre racine.

---

## Android (Chrome / Firefox / Samsung Internet)

Le processus d'installation d'AC d'Android est plus verrouillé que celui d'iOS — ce qui fonctionne dépend de la version d'Android et de la surcouche du fabricant.

### Android 14+ (Pixel / Android stock)

1. Après le téléchargement, ouvrez **Paramètres → Sécurité → Paramètres de sécurité avancés → Chiffrement et identifiants → Installer un certificat → Certificat d'autorité de certification**.
2. Tapez **Installer quand même** sur l'avertissement concernant les AC qui réduisent la sécurité.
3. Sélectionnez le fichier `pi-weather-cert.pem` téléchargé.
4. Confirmez le nom du certificat et **Installer**.

> Note : sur Android 7+ les apps doivent explicitement opter pour les AC ajoutées par l'utilisateur via leur configuration de sécurité réseau. Chrome et Firefox optent pour cela ; certaines apps non. Pour notre cas d'usage (installation PWA via navigateur), c'est l'opt-in de Chrome qui compte.

### Android 11-13

Même chemin qu'Android 14+, mais le menu se trouve sous **Paramètres → Biométrie et sécurité → Autres paramètres de sécurité → Installer à partir du stockage de l'appareil → Certificat d'autorité de certification**.

### Samsung One UI

Le chemin d'installation d'AC est **Paramètres → Biométrie et sécurité → Autres paramètres de sécurité → Installer à partir du stockage de l'appareil**, mais sur les versions récentes de One UI l'option est étiquetée **« Certificat utilisateur VPN et apps »** ou **« Certificat Wi-Fi »** selon l'usage prévu. Choisissez le chemin qui se termine par **« Certificat d'autorité de certification »**.

Après l'installation :

- Rechargez Chrome → avertissement « Non sécurisé » disparu.
- L'invite d'installation PWA apparaît dans la barre d'URL.
- Installez → l'icône radar apparaît sur l'écran d'accueil.

---

## macOS (Trousseau d'accès)

1. Double-cliquez sur le `pi-weather-cert.pem` téléchargé — **Trousseau d'accès** s'ouvre.
2. Confirmez l'ajout au trousseau **Système** (ou **login**, si vous ne voulez la confiance que pour votre utilisateur).
3. Trouvez le certificat dans la liste. Il porte le nom d'hôte du Pi ou `localhost`.
4. Double-cliquez dessus. Dans la section **Confiance**, définissez **« Lors de l'utilisation de ce certificat »** sur **« Toujours approuver »**.
5. Fermez la fenêtre — macOS demandera votre mot de passe pour mettre à jour le paramètre de confiance.

Après : Safari et Chrome n'affichent plus d'avertissement pour le Pi.

---

## Windows (Edge / Chrome / Firefox)

Edge et Chrome utilisent le magasin de certificats Windows ; Firefox a son propre magasin et nécessite une étape distincte.

### Edge / Chrome / IE

1. Double-cliquez sur le `pi-weather-cert.pem` téléchargé.
2. Cliquez sur **Installer le certificat**.
3. Choisissez **Ordinateur local** (à l'échelle du système) ou **Utilisateur actuel** (juste pour vous). Cliquez sur **Suivant**.
4. Choisissez **« Placer tous les certificats dans le magasin suivant »** → **Parcourir** → sélectionnez **« Autorités de certification racines de confiance »** → **OK** → **Suivant** → **Terminer**.
5. Confirmez l'avertissement de sécurité.

### Firefox

Firefox a son propre magasin de confiance indépendant de Windows.

1. **Préférences → Vie privée et sécurité → Certificats → Afficher les certificats**.
2. Onglet **Autorités** → **Importer**.
3. Sélectionnez `pi-weather-cert.pem`.
4. Cochez **« Confirmer cette AC pour identifier des sites Web »**. Cliquez sur **OK**.

> **Si Firefox 150+ refuse d'importer le certificat en tant qu'autorité** avec `MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY` : ton Pi roule encore le code de génération de certificat antérieur à v2.16.x qui utilisait un seul cert auto-signé comme racine ET cert serveur. Tire la dernière version du code serveur, puis force la régénération (efface `server/cert.pem` + `server/key.pem` et redémarre). Le serveur génère maintenant une vraie chaîne AC racine + leaf que Firefox accepte. Voir la section « Quand refaire cette opération » en bas pour le reste de l'histoire.

---

## Linux desktop (Chrome / Firefox)

La plupart des navigateurs de bureau sous Linux utilisent la base NSS partagée dans `~/.pki/nssdb`. L'outil `certutil` du paquet `libnss3-tools` (Debian/Ubuntu) ou `nss-tools` (Fedora) est le moyen le plus simple d'ajouter un certificat :

```bash
sudo apt install libnss3-tools     # Debian / Ubuntu
sudo dnf install nss-tools         # Fedora / RHEL

certutil -A -n "Pi Weather Station" \
  -t "C,," \
  -i pi-weather-cert.pem \
  -d sql:$HOME/.pki/nssdb
```

Firefox a sa propre base ; utilisez soit l'interface Firefox (voir la section Windows ci-dessus), soit passez `-d sql:$HOME/.mozilla/firefox/<profile>/`.

---

## Quand refaire cette opération

Depuis le refactor en chaîne de certificats v2.16.x, le Pi utilise **deux** certificats qui travaillent ensemble :

- **AC racine** (`ca-cert.pem`) — celui que tu installes dans le magasin de confiance. **Validité 10 ans**, CN `Pi Weather Station CA - <hostname>`. Le kiosque ne le régénère que si le hostname change — en pratique, jamais. C'est ce que sert `/api/cert.pem` et la seule chose à installer sur chaque appareil.
- **Cert serveur (leaf)** (`cert.pem`) — celui que le Pi présente dans la poignée de main TLS. **Validité 825 jours**, CN `Pi Weather Station - <hostname>`, signé par l'AC racine. Régénération automatique quand l'expiration < 30 jours ou que la configuration LAN change (nouvelle IP, nouveau hostname). Comme le leaf est signé par l'AC à laquelle tu fais déjà confiance, la rotation du leaf est **transparente** — aucune re-confiance par appareil nécessaire.

Concrètement : installe l'AC une fois par appareil. Le leaf peut tourner en arrière-plan sans casser ta confiance. La fenêtre de 10 ans de l'AC rend cela essentiellement « set and forget » pour la durée de vie du Pi.

### Anciens installs à un seul certificat (pré-v2.16.x)

Les installs qui ont roulé une version antérieure du serveur utilisaient un seul certificat qui était à la fois racine et leaf (le pattern « racine auto-signée qui sert aussi de cert serveur »). Le serveur détecte ce format au démarrage et force une régénération complète avec la nouvelle chaîne. Après ça :
- Tous les appareils déjà trustés afficheront « Non sécurisé » parce que l'identité du certificat a changé.
- Refais l'installation de confiance sur chaque appareil. À partir de là, les rotations du leaf ne nécessitent plus de re-confiance.

### Caveat Firefox 150

Firefox 150 applique RFC 5280 strictement : un certificat avec `basicConstraints=CA:TRUE` ne peut PAS être utilisé comme cert serveur leaf. L'ancien pattern à un seul cert échoue avec `MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY` sur Firefox 150. La nouvelle chaîne d'AC a `CA:TRUE` uniquement sur la racine (qui n'est jamais servie comme leaf) et `CA:FALSE` sur le leaf (que le serveur présente). Firefox 150 accepte ça proprement.

---

## Et si je ne veux simplement pas du problème d'icône ?

L'icône de repli « P sur fond noir » est purement esthétique. L'app elle-même fonctionne exactement de la même façon — mêmes données, mêmes contrôles, même mode PWA standalone si vous l'installez. Si l'icône vous laisse indifférent et que vous voulez sauter l'installation du certificat, c'est un choix tout à fait valable. La seule chose que vous manquerez est le glyphe radar sur l'écran d'accueil.
