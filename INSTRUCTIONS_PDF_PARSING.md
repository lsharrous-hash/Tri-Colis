# Comment Parser les PDF Spoke → Excel

## La Solution : pdfplumber

**NE PAS utiliser `pdf-parse`** - il extrait le texte brut sans structure.

**Utiliser `pdfplumber`** - il extrait les tableaux correctement !

## Installation

```bash
npm install pdfplumber  # Non, c'est Python !
pip install pdfplumber
```

## Code Python qui fonctionne

```python
import pdfplumber

all_data = []

with pdfplumber.open('fichier.pdf') as pdf:
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            for row in table:
                # Ignorer les headers
                if row[0] == '#' or not row[0]:
                    continue
                all_data.append({
                    'orderNumber': row[0],
                    'address': row[1],
                    'estimatedTime': row[2],
                    'trackingNumber': row[3].replace('\n', '').replace(';', '').strip()
                })

print(f"Colis extraits: {len(all_data)}")
```

## Structure du PDF Spoke

| Colonne | Contenu | Exemple |
|---------|---------|---------|
| # | Numéro d'ordre | 1, 2, 3... |
| Address | Adresse complète | 19 Rue George Sand, Reims |
| Estimated Arrival Time | Heure | 02:32 |
| Notes | Code tracking | GFFR25335063469158; |

## Patterns de Tracking

- **GFFR** + 14 chiffres : `GFFR25335063469158`
- **CNFR** + 13 chiffres + HD : `CNFR9010443875341HD`
- **DOFR** + 13 chiffres + HD : `DOFR9010026821417HD`

## Nettoyage du Tracking

```javascript
function cleanTracking(notes) {
    if (!notes) return "";
    return notes
        .replace(/\n/g, '')  // Supprimer retours à la ligne
        .replace(/\s/g, '')  // Supprimer espaces
        .replace(/;$/g, '')  // Supprimer ; final
        .trim();
}
```

## Intégration dans Node.js

Option 1 : Exécuter Python depuis Node

```javascript
const { exec } = require('child_process');

function parsePDFWithPython(pdfPath) {
    return new Promise((resolve, reject) => {
        exec(`python3 parse_pdf.py "${pdfPath}"`, (error, stdout) => {
            if (error) reject(error);
            else resolve(JSON.parse(stdout));
        });
    });
}
```

Option 2 : Utiliser une lib Node comme `pdf2json`

## Fichier de Référence

Le fichier `louis0912_converti.xlsx` montre le résultat attendu :
- 123 colis extraits correctement
- Colonnes : #, Adresse, Heure, Code Tracking
- Trackings nettoyés (sans retours à la ligne ni ;)
