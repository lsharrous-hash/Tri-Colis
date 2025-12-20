# 🔧 CORRECTIONS DÉDUPLICATION COLIS - index.js

## PROBLÈME
Les compteurs de colis incluent les doublons (même trackingNumber compté plusieurs fois).

## SOLUTION
Utiliser une fonction de déduplication partout où on compte les colis.

---

## ÉTAPE 1 : Ajouter la fonction helper (après les autres fonctions, vers ligne 100)

Ajoute cette fonction quelque part en haut du fichier, après les `require` :

```javascript
// ==============================
// HELPER - Déduplication des colis
// ==============================
function getUniqueColisCount(colisList) {
  const getKey = (c) => c.trackingNumber || `id-${c.id}`;
  const uniqueColis = [...new Map(colisList.map(c => [getKey(c), c])).values()];
  return {
    total: uniqueColis.length,
    scanned: uniqueColis.filter(c => c.scannedAt || c.scanned).length,
    uniqueColis: uniqueColis
  };
}
```

---

## ÉTAPE 2 : Corriger la route `/api/dispatcher/tours/:id` (ligne 1598-1604)

### AVANT (ligne 1598-1604) :
```javascript
  const colis = COLIS.filter((c) => c.tourId === tourId);

  res.json({
    tour,
    colis,
    colisCount: colis.length
  });
```

### APRÈS :
```javascript
  const colis = COLIS.filter((c) => c.tourId === tourId);
  const { total, scanned } = getUniqueColisCount(colis);

  res.json({
    tour,
    colis,
    colisCount: total,
    scannedCount: scanned
  });
```

---

## ÉTAPE 3 : Corriger la route `/api/tours` pour enrichir les tournées (ligne 748-751)

### AVANT (ligne 748-751) :
```javascript
  res.json({
    tours: filtered,
    count: filtered.length
  });
```

### APRÈS :
```javascript
  // Enrichir chaque tournée avec le colisCount dédupliqué
  const toursWithCount = filtered.map(tour => {
    const tourColis = COLIS.filter(c => c.tourId === tour.id);
    const { total, scanned } = getUniqueColisCount(tourColis);
    return {
      ...tour,
      colisCount: total,
      scannedCount: scanned
    };
  });

  res.json({
    tours: toursWithCount,
    count: toursWithCount.length
  });
```

---

## ÉTAPE 4 : Corriger la route `/api/dispatcher/tours` (ligne 1578-1581)

### AVANT (ligne 1578-1581) :
```javascript
  res.json({
    tours: filtered,
    count: filtered.length
  });
```

### APRÈS :
```javascript
  // Enrichir chaque tournée avec le colisCount dédupliqué
  const toursWithCount = filtered.map(tour => {
    const tourColis = COLIS.filter(c => c.tourId === tour.id);
    const { total, scanned } = getUniqueColisCount(tourColis);
    return {
      ...tour,
      colisCount: total,
      scannedCount: scanned
    };
  });

  res.json({
    tours: toursWithCount,
    count: toursWithCount.length
  });
```

---

## ÉTAPE 5 : Corriger le cas sans date dans `/api/stats/date` (ligne 485-492)

### AVANT (ligne 485-492) :
```javascript
  if (!date) {
    const scannedColis = COLIS.filter((c) => c.scannedAt || c.scpiStatus).length;
    return res.json({
      date: null,
      totalColis: COLIS.length,
      scannedColis,
      remainingColis: COLIS.length - scannedColis
    });
  }
```

### APRÈS :
```javascript
  if (!date) {
    const { total, scanned } = getUniqueColisCount(COLIS);
    return res.json({
      date: null,
      totalColis: total,
      scannedColis: scanned,
      remainingColis: total - scanned
    });
  }
```

---

## RÉSUMÉ DES MODIFICATIONS

| Ligne | Route | Modification |
|-------|-------|--------------|
| ~100 | (nouveau) | Ajouter fonction `getUniqueColisCount()` |
| 485-492 | `/api/stats/date` (sans date) | Utiliser `getUniqueColisCount(COLIS)` |
| 748-751 | `/api/tours` | Enrichir tournées avec count dédupliqué |
| 1578-1581 | `/api/dispatcher/tours` | Enrichir tournées avec count dédupliqué |
| 1598-1604 | `/api/dispatcher/tours/:id` | Utiliser `getUniqueColisCount(colis)` |

---

## TEST

Après les modifications :
1. Redémarre le serveur : `node index.js`
2. Vérifie que les compteurs affichent le bon nombre (sans doublons)
