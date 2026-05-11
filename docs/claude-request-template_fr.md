# Modèle de demande à Claude — tâches complexes

Ce modèle aide à structurer une demande qui requiert une analyse ou un travail
de moyenne/grande complexité, pour que Claude puisse démarrer sans avoir à
poser de questions de clarification.

**Quand l'utiliser :** conception d'une nouvelle fonctionnalité, refactor
non-trivial, investigation de bug touchant plusieurs fichiers, choix
d'architecture. **Pas nécessaire pour** une question rapide ou un correctif
d'une ligne.

**Sections prioritaires** si tu manques de temps : 1, 2, 6, 8.

---

```markdown
# Demande : <titre court>

## 1. Contexte
<En 2-4 phrases : où on en est, pourquoi cette demande arrive maintenant.
Ex : "v2.12.0 vient d'être publiée. Je veux préparer la suite côté alertes ECCC Phase B."
Inclure le ou les commits / PRs / fichiers déjà touchés s'il y a lieu.>

## 2. Objectif
<Une phrase. Le résultat concret attendu.
Ex : "Concevoir l'architecture pour afficher les alertes ECCC sur la carte radar."
Si c'est exploratoire, le dire : "Je veux des options, pas une implémentation.">

## 3. Contraintes & non-négociables
- <Ex : Pas de nouveau service externe>
- <Ex : Doit fonctionner sur Bullseye 32-bit>
- <Ex : Aucune clé API supplémentaire>
- <Ex : Pas de changement à AppContext.js>

## 4. Hors-périmètre (à NE PAS faire)
- <Ex : Ne pas toucher au composant Settings>
- <Ex : Ne pas refactorer proxyCtrl.js même si tentant>

## 5. Entrées / références
- Fichiers pertinents : <chemin:ligne si possible>
- Docs : <docs/xxx.md>
- PRs / commits : <#102, 6c20f95>
- Liens externes : <URL spec, doc API>

## 6. Livrable attendu
<Cocher ce qui s'applique :>
- [ ] Analyse + recommandation (pas de code)
- [ ] Plan d'implémentation étapé
- [ ] Code prêt à committer
- [ ] PR ouverte
- [ ] Comparaison d'options (1/2/3 + reco)

Format : <Ex : "réponse en français, options numérotées, max 200 mots par option">

## 7. Critères de succès
<Comment je saurai que c'est bon ?
Ex : "Le build passe + l'alerte s'affiche sur la carte sans clignotement + traduction FR/EN/ES.">

## 8. Niveau d'autonomie
<Un des trois :>
- 🟢 Go autonome — décide et exécute, je relirai à la fin
- 🟡 Plan d'abord — propose, j'approuve, puis tu exécutes
- 🔴 Étape par étape — confirme à chaque sous-tâche

## 9. Notes / pistes déjà explorées
<Ce que tu as déjà essayé ou écarté, pour éviter que je refasse le tour.
Ex : "J'ai regardé l'option WebSocket — abandonné, trop lourd pour le Pi.">
```

---

## Règles d'usage pratiques

- Les sections **1, 2, 6, 8** sont les plus rentables. Si tu n'as le temps
  que pour quatre sections, ce sont celles-là.
- La section **4 (hors-périmètre)** sauve beaucoup de temps : elle empêche
  Claude de partir en refactor surprise.
- La section **8 (autonomie)** : à omettre si tes préférences habituelles
  s'appliquent (Claude les a en mémoire). À remplir explicitement seulement
  si tu veux changer le défaut pour cette demande.
- Pour les très petites demandes (bug d'une ligne, question rapide), oublie
  le modèle — il est conçu pour les tâches de moyenne/grande complexité.

## Versions

- 🇫🇷 Français — ce document
- 🇬🇧 English — [`claude-request-template_en.md`](claude-request-template_en.md)
- 🇪🇸 Español — [`claude-request-template_es.md`](claude-request-template_es.md)
