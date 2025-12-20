# INSTRUCTIONS POUR CLAUDE VS CODE

## Problème actuel

L'application Tri-Colis a du mal à parser les fichiers PDF Spoke. La bibliothèque `pdf-parse` extrait le texte en vrac sans préserver la structure du tableau, ce qui cause des erreurs dans l'extraction des adresses et numéros d'ordre.

## Solution à implémenter

### Objectif
Convertir automatiquement le PDF en données structurées AVANT de le traiter, comme si c'était un Excel.

### Structure des PDF Spoke

Les PDF Spoke contiennent un tableau avec 4 colonnes :
- **#** : Numéro d'ordre (1, 2, 3... N)
- **Address** : Adresse complète de livraison
- **Estimated Arrival Time** : Heure (format HH:MM)
- **Notes** : Numéro de tracking (ex: GFFR25335063469158; ou CNFR9010443875341HD;)

Exemple de ligne :
```
1 | 19 Rue George Sand, Reims, Marne | 02:32 | GFFR25335063469158;
```

### Pattern des numéros de tracking

Les trackings suivent ces formats :
- `GFFR` + 14 chiffres (ex: GFFR25335063469158)
- `CNFR` + 13 chiffres + `HD` (ex: CNFR9010443875341HD)
- `DOFR` + 13 chiffres + `HD` (ex: DOFR9010026821417HD)

Regex : `/([A-Z]{2,4}FR\d{10,20}(?:HD)?)/gi`

### Approche recommandée

Puisque `pdf-parse` ne préserve pas la structure, utiliser une approche **ligne par ligne** :

1. Le PDF extrait ressemble à ça (texte brut) :
```
1 19 Rue George Sand, Reims, Reims, Marne 02:32 GFFR25335063469158;
2 67 Rue De Salzbourg, Reims, Reims, Marne 02:34 GFFR25335010286971;
```

2. Parser chaque "bloc" avec ce pattern :
```
^(\d+)\s+(.+?)\s+(\d{2}:\d{2})\s+([A-Z]{2,4}FR\d+(?:HD)?);?$
```

### Code à modifier

**Fichier** : `backend/index.js`
**Fonction** : `parseSpokeColis(textContent)`

### Nouvelle logique de parsing

```javascript
function parseSpokeColis(textContent) {
  const colisForTour = [];
  
  // Normaliser les sauts de ligne et espaces
  let text = textContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Pattern pour une ligne complète : numéro adresse heure tracking
  // Le numéro d'ordre est au début, suivi de l'adresse, puis l'heure HH:MM, puis le tracking
  const linePattern = /^(\d{1,3})\s+(.+?)\s+(\d{2}:\d{2})\s+([A-Z]{2,4}FR\d{10,20}(?:HD)?);?/gm;
  
  let match;
  while ((match = linePattern.exec(text)) !== null) {
    const orderNumber = parseInt(match[1], 10);
    const address = match[2].trim();
    const time = match[3];
    const tracking = match[4].toUpperCase();
    
    colisForTour.push({
      orderNumber: orderNumber,
      address: address,
      trackingNumber: tracking,
      estimatedTime: time
    });
  }
  
  // Si le pattern ligne par ligne ne fonctionne pas, fallback sur l'ancienne méthode
  if (colisForTour.length === 0) {
    // Extraire tous les trackings et assigner des numéros séquentiels
    const trackingRegex = /([A-Z]{2,4}FR\d{10,20}(?:HD)?)/gi;
    const allTracking = text.match(trackingRegex) || [];
    const uniqueTracking = [...new Set(allTracking.map(t => t.toUpperCase()))];
    
    for (let i = 0; i < uniqueTracking.length; i++) {
      colisForTour.push({
        orderNumber: i + 1,
        address: "Adresse non extraite",
        trackingNumber: uniqueTracking[i],
      });
    }
  }
  
  return colisForTour;
}
```

### Alternative : Utiliser tabula-js (meilleur mais nécessite Java)

Si Java est installé sur le serveur, `tabula-js` peut extraire les tableaux PDF parfaitement :

```bash
npm install tabula-js
```

```javascript
const tabula = require('tabula-js');

async function parsePdfWithTabula(filePath) {
  const table = await tabula(filePath).extractCsv();
  // table contient les données structurées du tableau
  return table;
}
```

### Tests à effectuer

1. Importer le fichier `louis0912test.pdf`
2. Vérifier que les 123 colis sont extraits
3. Scanner le tracking `GFFR25335063469158` → doit retourner :
   - Numéro d'ordre : 1
   - Adresse : 19 Rue George Sand, Reims, Reims, Marne
   - Chauffeur : Louis (extrait du nom de fichier)

### Fichier de test

Le PDF `louis0912test.pdf` contient 123 colis avec le format Spoke standard.

## Résumé

1. Modifier `parseSpokeColis()` dans `backend/index.js`
2. Utiliser le pattern ligne par ligne pour extraire : numéro, adresse, heure, tracking
3. Tester avec le PDF fourni
4. Si ça ne marche pas, envisager `tabula-js` (nécessite Java)
