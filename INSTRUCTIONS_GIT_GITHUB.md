# 🚀 INSTRUCTIONS : Configurer Git et GitHub pour tri-colis

## OBJECTIF

Mettre en place le versionnage du projet pour pouvoir :
- Sauvegarder des versions du code
- Revenir en arrière si quelque chose casse
- Avoir une copie en ligne sur GitHub

---

## ÉTAPE 1 : Initialiser Git

Dans le dossier racine du projet `tri-colis`, exécuter :

```bash
git init
```

---

## ÉTAPE 2 : Créer le fichier `.gitignore`

Créer un fichier `.gitignore` à la racine du projet avec ce contenu :

```
# Dépendances
node_modules/
.pnp/
.pnp.js

# Fichiers de build
dist/
build/
.expo/

# Fichiers d'environnement
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*

# Données locales (ne pas versionner)
sessions.json
uploads/
*.tmp

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Python
__pycache__/
*.pyc
```

---

## ÉTAPE 3 : Premier commit

Sauvegarder l'état actuel du projet :

```bash
git add .
git commit -m "Version initiale - application tri-colis fonctionnelle"
```

---

## ÉTAPE 4 : Créer le repository sur GitHub

1. Aller sur https://github.com
2. Cliquer sur le bouton **"+"** en haut à droite → **"New repository"**
3. Nom du repo : `tri-colis`
4. Laisser en **Private** (ou Public si tu veux)
5. **NE PAS** cocher "Add a README file"
6. Cliquer sur **"Create repository"**

---

## ÉTAPE 5 : Lier le projet local à GitHub

Remplacer `TON_USERNAME` par le nom d'utilisateur GitHub réel :

```bash
git remote add origin https://github.com/TON_USERNAME/tri-colis.git
git branch -M main
git push -u origin main
```

Si demandé, entrer les identifiants GitHub.

---

## UTILISATION QUOTIDIENNE

### Sauvegarder une nouvelle version

Après chaque modification importante :

```bash
git add .
git commit -m "Description de ce qui a été fait"
git push
```

**Exemples de messages de commit :**
- `"Ajout import PDF avec pdfplumber"`
- `"Correction bug encodage UTF-8"`
- `"Refonte design écran login"`

---

### Voir l'historique des versions

```bash
git log --oneline
```

Affiche quelque chose comme :
```
a1b2c3d Version initiale
e4f5g6h Ajout import PDF
i7j8k9l Correction bug login
```

---

### Annuler les modifications non sauvegardées

Si tu as fait des modifications qui cassent tout et tu n'as pas encore commit :

```bash
git checkout .
```

→ Revient au dernier commit (dernière sauvegarde)

---

### Revenir à une version précédente

1. D'abord, voir l'historique :
```bash
git log --oneline
```

2. Copier l'identifiant du commit voulu (ex: `a1b2c3d`)

3. Revenir à cette version :
```bash
git checkout a1b2c3d .
```

4. Si c'est bon, sauvegarder :
```bash
git add .
git commit -m "Retour à la version stable"
git push
```

---

## COMMANDES RÉSUMÉ

| Action | Commande |
|--------|----------|
| Sauvegarder | `git add . && git commit -m "message" && git push` |
| Voir historique | `git log --oneline` |
| Annuler modifs non sauvées | `git checkout .` |
| Voir les fichiers modifiés | `git status` |
| Revenir à un commit | `git checkout <id> .` |

---

## ⚠️ IMPORTANT

- **Toujours faire un commit AVANT de faire des modifications risquées**
- Les fichiers dans `.gitignore` ne seront jamais sauvegardés (c'est voulu)
- `sessions.json` et `uploads/` ne sont pas versionnés car ce sont des données locales

---

## EN CAS DE PROBLÈME

Si Git demande de configurer l'identité :

```bash
git config --global user.email "ton@email.com"
git config --global user.name "TonNom"
```

Si erreur d'authentification GitHub, utiliser un **Personal Access Token** :
1. GitHub → Settings → Developer settings → Personal access tokens
2. Générer un token avec les droits `repo`
3. Utiliser ce token comme mot de passe
