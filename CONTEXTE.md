# Contexte du projet Tri-Colis

## Description
Application de tri de colis pour sous-traitants de livraison. Permet aux trieurs de scanner des colis et voir leur numéro d'ordre et le chauffeur assigné.

## Architecture
- **Backend** : Node.js + Express (port 3000)
- **Mobile** : React Native + Expo

## Fonctionnalités implémentées
- ✅ Import de tournées depuis PDF (format Spoke)
- ✅ Import de tournées depuis Excel (.xlsx)
- ✅ Scan de colis (QR code / code-barres)
- ✅ Saisie manuelle si code endommagé
- ✅ Affichage numéro d'ordre + chauffeur
- ✅ Extraction automatique du nom chauffeur depuis le nom de fichier
- ✅ Gestion multi sous-traitants
- ✅ Rôles : ADMIN, DISPATCHER, TRIEUR
- ✅ Suppression de tournées

## Mises à jour récentes
## Historique des itérations et correctifs (déc. 2025)

- Harmonisation du calcul des statistiques de colis (total/scanné/restant) pour n'afficher que le nombre de colis uniques (par trackingNumber/code), côté web ET mobile :
	- Ajout d'un endpoint `/api/colis` sur le backend pour retourner tous les colis d'une date donnée.
	- Sur le web (Dashboard), utilisation de `/api/colis` et déduplication côté frontend pour l'affichage des stats.
	- Sur le mobile (TriHomeScreen dans App.tsx), remplacement de l'appel `/api/stats/date` par `/api/colis?date=...` et déduplication côté frontend pour l'affichage du nombre de colis à trier.
	- Aucun changement sur la logique d'import ou le backend pour la déduplication : c'est purement une logique d'affichage.

- Correction d'un bug de démarrage backend : ajout d'un appel à `loadDataFromFile()` pour charger les données au lancement (sinon stats à 0).

- Correction de la gestion des props dans le composant mobile `DispatcherImportScreen` :
	- Renommage de la prop `user` en `userProp` pour éviter les conflits de scope et garantir l'accès dans toutes les fonctions internes.
	- Mise à jour de tous les accès et appels du composant pour utiliser `userProp`.
	- Correction de la déclaration de la fonction pour destructurer proprement les props.

- Itération pas à pas pour corriger les erreurs de portée et de nommage dans le code React Native (problèmes de `user` introuvable).

- Documentation de toutes les étapes et correctifs dans ce fichier pour assurer la traçabilité des évolutions.
- Backend `index.js` : endpoint `/api/tours` accepte `isCaniaoOnly=true` et renvoie uniquement les tournées CANIAO (sans filtre sous-traitant), avec logs d'accès.
- App mobile `App.tsx` : le chargement de la liste CANIAO appelle `/api/tours?isCaniaoOnly=true`; la liste principale exclut les tournées CANIAO.
- Endpoint de téléchargement `/api/dispatcher/tours/:id/download` : logs DEBUG ajoutés (session trouvée, utilisateur résolu, nom de fichier source) et envoi du fichier Excel original si présent (`sourceOriginalName/sourceFile`).
- Données actuelles : `data.json` contient 1 tournée (non CANIAO, Spoke). Les tournées CANIAO ont été supprimées pour vérifier le filtrage.
- Sessions : `sessions.json` persisté; tests avec token admin `token-admin-1765510904876-rdc1relu71` utilisés pour les requêtes protégées.

## Problèmes en cours à corriger

### 1. Extraction des adresses depuis PDF Spoke
**Fichier** : `backend/index.js` - fonction `parseSpokeColis()`
**Problème** : Les adresses ne sont pas extraites correctement, affiche "Adresse à vérifier"
**Attendu** : Extraire l'adresse réelle depuis le PDF (ex: "6 RUE DE TALLEYRAND Bubble coffee, Reims")

### 2. Format du PDF Spoke
Le PDF contient un tableau avec colonnes :
- # (numéro d'ordre : 1, 2, 3... 705)
- Address (adresse complète)
- Estimated Arrival Time (heure : 10:35, 11:01...)
- Notes (numéro tracking : CNFR9010444597926HD;)

Le texte extrait du PDF est "mélangé" car pdf-parse ne préserve pas la structure tableau.

### 3. Format Excel (Louis.xlsx)
- Colonne `data.waybillNo` : numéro de tracking
- Colonne `data.toStreet` : adresse
- Pas de numéro d'ordre → afficher "#"

## Fichiers importants

### backend/index.js
- `parseSpokeColis(textContent)` : Parse les PDF Spoke → à améliorer pour extraire les adresses
- `parseExcelColis(filePath)` : Parse les fichiers Excel → fonctionne bien
- Routes API : `/api/scan`, `/api/tours/import`, etc.

### mobile/App.tsx
- `TriScanScreen` : Écran de scan avec caméra + saisie manuelle
- `API_BASE_URL` : À configurer avec l'IP du serveur

## Commandes utiles

```bash
# Lancer le backend
cd backend
node index.js

# Lancer l'app mobile
cd mobile
npx expo start
```

## Tests à effectuer
1. Importer un PDF Spoke (ex: reims1112cifr.pdf)
2. Scanner le tracking CNFR9010444597926HD
3. Vérifier : numéro d'ordre = 256, chauffeur = Reims, adresse = 6 RUE DE TALLEYRAND...
