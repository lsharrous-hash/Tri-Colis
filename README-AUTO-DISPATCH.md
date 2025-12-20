# Mise à jour Auto-Dispatch Tri-Colis

## 🎯 Fonctionnalités ajoutées

### 1. Gestion des chauffeurs (page Gestion → onglet Chauffeurs)
L'admin peut maintenant **paramétrer les chauffeurs à l'avance** avant d'importer :
- Voir tous les chauffeurs groupés par sous-traitant
- Ajouter un nouveau chauffeur et l'associer à un sous-traitant
- Modifier l'association d'un chauffeur
- Supprimer un chauffeur
- Créer/supprimer des sous-traitants

### 2. Auto-dispatch à l'import Gofo ET Cainiao
L'admin peut importer des tournées **sans avoir à choisir un sous-traitant**. Le système détecte automatiquement le sous-traitant associé au chauffeur.

**Fonctionne pour :**
- 🔵 **Import Gofo** (PDF/Excel)
- 🟣 **Import Cainiao** (PDF/Excel - 1 chauffeur/fichier)

### 3. Protection contre les doublons (NOUVEAU)
Le système empêche maintenant l'import de colis déjà présents pour la même date :
- ✅ Vérifie les tracking numbers déjà importés ce jour-là
- ✅ Détecte les doublons dans le fichier lui-même
- ✅ Importe uniquement les colis uniques
- ✅ Affiche le nombre de doublons ignorés
- ✅ Fonctionne pour Admin ET Dispatcher
- ✅ Fonctionne pour Gofo ET Cainiao

## 📋 Comment ça fonctionne

### Paramétrage initial (une seule fois)
1. Aller dans **Gestion → onglet Chauffeurs**
2. Ajouter les sous-traitants (JNR, SPEEDY, etc.)
3. Ajouter les chauffeurs et les associer à leur sous-traitant

### Import quotidien
1. Aller sur **Import & Tournées**
2. **Gofo** : Glisser les fichiers PDF/Excel sans choisir de sous-traitant
3. **Cainiao** : Glisser les fichiers Excel/PDF (1 chauffeur/fichier) sans choisir de sous-traitant
4. **Chauffeur connu** → Attribution automatique
5. **Chauffeur inconnu** → Modal avec 2 options :
   - 🔗 **Chauffeur existant** : Si c'est le même chauffeur avec un nom différent
   - ➕ **Nouveau chauffeur** : Si c'est vraiment nouveau

## 📁 Fichiers modifiés

### backend/index.js
- Ajout du système de mapping chauffeur → sous-traitant
- Nouvelles API chauffeurs et sous-traitants
- Modification de `/api/tours/import` (Gofo) pour auto-dispatch
- Modification de `/api/tours/import/caniao-excel` pour auto-dispatch + support PDF
- Détection des chauffeurs similaires (fuzzy matching)
- Protection contre les doublons de tracking numbers

### backend/chauffeurs.json (créé automatiquement)
- Fichier de mapping chauffeur → sous-traitant
- **⚠️ NE PAS REMPLACER si le fichier existe déjà !** Il contient vos chauffeurs enregistrés.

### web/src/pages/Users.tsx (modifié)
- Ajout d'un système d'onglets : **Utilisateurs** | **Chauffeurs**
- Onglet Chauffeurs avec gestion complète

### web/src/pages/ToursImport.tsx (modifié)
- **Import Gofo** : Auto-dispatch, pas de sous-traitant obligatoire
- **Import Cainiao** : Auto-dispatch, accepte Excel ET PDF
- Modal d'association pour chauffeurs inconnus

## 🚀 Déploiement

1. **Remplacer les fichiers** (⚠️ ATTENTION : ne pas remplacer chauffeurs.json s'il existe !) :
   ```bash
   cp backend/index.js /chemin/vers/tri-colis/backend/
   cp web/src/pages/ToursImport.tsx /chemin/vers/tri-colis/web/src/pages/
   cp web/src/pages/Users.tsx /chemin/vers/tri-colis/web/src/pages/
   # NE PAS copier chauffeurs.json !
   ```

2. **Commit et push** :
   ```bash
   git add .
   git commit -m "feat: Auto-dispatch + doublons + gestion chauffeurs"
   git push
   ```

3. **Render** redéploiera automatiquement

## 🧪 Test

### Test 1 : Paramétrage des chauffeurs
1. Se connecter en admin
2. **Gestion → Chauffeurs**
3. Ajouter "JNR" comme sous-traitant
4. Ajouter "Lucas" associé à "JNR"

### Test 2 : Import Gofo auto-dispatch
1. **Import & Tournées**
2. Section "Import Gofo"
3. Importer `Lucas.pdf` sans choisir de sous-traitant
4. → Import automatique vers "JNR" ✅

### Test 3 : Import Cainiao auto-dispatch
1. **Import & Tournées**
2. Section "Import Cainiao (1 chauffeur/fichier)"
3. Importer `Lucas_cainiao.xlsx` sans choisir de sous-traitant
4. → Import automatique vers "JNR" ✅

### Test 4 : Chauffeur inconnu (Gofo ou Cainiao)
1. Importer `Mohammed.pdf`
2. Le modal apparaît
3. Choisir "Nouveau chauffeur" et associer à "JNR"
4. → Import réussi et mémorisation ✅

### Test 5 : Alias de chauffeur
1. Importer `LUCAS_REIMS.pdf`
2. Le modal apparaît avec "Lucas (JNR)" en suggestion
3. Choisir "Chauffeur existant" → sélectionner "Lucas"
4. → Import vers "JNR" et alias mémorisé ✅

### Test 6 : Protection doublons
1. Importer un fichier avec 100 colis
2. → Import réussi: 100 colis ✅
3. Réimporter le même fichier
4. → Message: "Tous les 100 colis sont déjà importés pour cette date" ⚠️

### Test 7 : Import partiel (doublons)
1. Importer un fichier avec 100 colis
2. Modifier le fichier pour ajouter 50 nouveaux colis (total 150)
3. Réimporter le fichier modifié
4. → Message: "50 colis (100 doublons ignorés)" ✅

## 📊 Résumé des zones d'import

| Zone | Formats | Sous-traitant | Auto-dispatch |
|------|---------|---------------|---------------|
| 🔵 Import Gofo | PDF, Excel | Optionnel | ✅ Oui |
| 🟣 Import Cainiao (PDF multi) | PDF | Non requis | ❌ Non (CANIAO fixe) |
| 🟣 Import Cainiao (1/fichier) | Excel, PDF | Optionnel | ✅ Oui |

Bonne utilisation ! 🚀
