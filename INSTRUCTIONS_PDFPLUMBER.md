# 🚨 INSTRUCTIONS OBLIGATOIRES : Remplacer pdf-parse par pdfplumber

## LE PROBLÈME

Le parsing PDF avec `pdf-parse` (Node.js) **NE FONCTIONNE PAS** pour les fichiers Spoke/CANIAO.

**Résultat actuel (CASSÉ) :**
```
Adresse: "AVENUE DU GÉNÉRAL BONAPARTE, Reims, 5110004:26"
Heure: NaN
```
L'heure est collée à l'adresse ! ❌

**Résultat attendu (CORRECT) :**
```
Adresse: "AVENUE DU GÉNÉRAL BONAPARTE, Reims, 51100"
Heure: "04:26"
```

---

## LA SOLUTION

Utiliser **pdfplumber** (Python) qui extrait correctement les tableaux PDF.

---

## ÉTAPE 1 : Installer pdfplumber

```bash
pip install pdfplumber
```

---

## ÉTAPE 2 : Créer le fichier `backend/parse_pdf.py`

Créer ce fichier dans le dossier `backend/` :

```python
#!/usr/bin/env python3
"""
Script de parsing PDF Spoke/CANIAO pour Tri-Colis
Appelé par Node.js via exec()
"""
import pdfplumber
import json
import sys

def clean_tracking(text):
    """Nettoyer le code tracking"""
    if not text:
        return ""
    return text.replace('\n', '').replace(' ', '').replace(';', '').strip()

def parse_spoke_pdf(pdf_path):
    """
    Parser un PDF Spoke/CANIAO
    Retourne une liste de colis avec: orderNumber, address, estimatedTime, trackingNumber
    """
    colis = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    # Ignorer les headers et lignes vides
                    if not row or not row[0] or row[0] == '#':
                        continue
                    
                    # Ignorer la ligne "Lieu d'arrivée" (fin du PDF)
                    if len(row) > 1 and row[1] and "Lieu d'arrivée" in str(row[1]):
                        continue
                    
                    # Ignorer si pas de tracking (ligne invalide)
                    if len(row) < 4 or not row[3]:
                        continue
                    
                    try:
                        colis.append({
                            "orderNumber": str(row[0]).strip(),
                            "address": str(row[1]).strip() if row[1] else "",
                            "estimatedTime": str(row[2]).strip() if row[2] else "",
                            "trackingNumber": clean_tracking(row[3])
                        })
                    except Exception:
                        pass  # Ignorer les lignes mal formées
    
    return colis

# Point d'entrée
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Chemin du PDF requis"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    try:
        result = parse_spoke_pdf(pdf_path)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
```

---

## ÉTAPE 3 : Modifier index.js

### 3.1 - Supprimer l'ancien import pdf-parse

SUPPRIMER cette ligne si elle existe :
```javascript
const pdfParse = require('pdf-parse');  // ❌ SUPPRIMER
```

### 3.2 - Ajouter la fonction parsePDFWithPython

Ajouter cette fonction en haut du fichier (après les autres require) :

```javascript
const { exec } = require('child_process');

/**
 * Parser un PDF Spoke/CANIAO avec pdfplumber (Python)
 * @param {string} pdfPath - Chemin vers le fichier PDF
 * @returns {Promise<Array>} - Liste des colis
 */
function parsePDFWithPython(pdfPath) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'parse_pdf.py');
        const command = `python3 "${scriptPath}" "${pdfPath}"`;
        
        exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error('Erreur Python:', stderr);
                reject(new Error('Erreur parsing PDF: ' + error.message));
                return;
            }
            
            try {
                const result = JSON.parse(stdout);
                
                if (result.error) {
                    reject(new Error(result.error));
                } else {
                    console.log(`PDF parsé avec succès: ${result.length} colis`);
                    resolve(result);
                }
            } catch (e) {
                console.error('Stdout:', stdout);
                reject(new Error('Erreur parsing JSON: ' + e.message));
            }
        });
    });
}
```

### 3.3 - Modifier la route d'import CANIAO

Remplacer l'ancien code qui utilise `pdfParse` par :

```javascript
// Route import CANIAO (PDF)
app.post("/api/dispatcher/import-caniao", upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'NO_FILE', message: 'Aucun fichier fourni' });
        }
        
        const pdfPath = req.file.path;
        console.log('Import CANIAO:', pdfPath);
        
        // ✅ Parser avec Python/pdfplumber
        const colisData = await parsePDFWithPython(pdfPath);
        
        if (!colisData || colisData.length === 0) {
            return res.status(400).json({ error: 'EMPTY_PDF', message: 'Aucun colis trouvé dans le PDF' });
        }
        
        console.log(`${colisData.length} colis extraits du PDF`);
        
        // Exemple de structure de chaque colis:
        // {
        //   orderNumber: "1",
        //   address: "19 Rue George Sand, Reims, Reims, Marne",
        //   estimatedTime: "02:32",
        //   trackingNumber: "GFFR25335063469158"
        // }
        
        // ... reste du code pour créer la tournée et les colis ...
        
    } catch (error) {
        console.error('Erreur import CANIAO:', error);
        res.status(500).json({ 
            error: 'IMPORT_ERROR', 
            message: 'Erreur lors de l\'import CANIAO : ' + error.message 
        });
    }
});
```

---

## ÉTAPE 4 : Désinstaller pdf-parse

```bash
npm uninstall pdf-parse
```

---

## ÉTAPE 5 : Redémarrer le serveur

```bash
node index.js
```

---

## VÉRIFICATION

Après ces modifications, l'import d'un PDF Spoke/CANIAO doit :

1. ✅ Extraire le numéro d'ordre (#) correctement
2. ✅ Extraire l'adresse SANS l'heure collée
3. ✅ Extraire l'heure séparément
4. ✅ Extraire le tracking nettoyé (sans \n ni ;)

**Exemple de sortie attendue :**
```json
[
  {
    "orderNumber": "1",
    "address": "19 Rue George Sand, Reims, Reims, Marne",
    "estimatedTime": "02:32",
    "trackingNumber": "GFFR25335063469158"
  },
  {
    "orderNumber": "2",
    "address": "67 Rue De Salzbourg, Reims, Reims, Marne",
    "estimatedTime": "02:34",
    "trackingNumber": "GFFR25335010286971"
  }
]
```

---

## RÉSUMÉ DES FICHIERS

| Fichier | Action |
|---------|--------|
| `backend/parse_pdf.py` | CRÉER (nouveau fichier Python) |
| `backend/index.js` | MODIFIER (ajouter parsePDFWithPython, supprimer pdfParse) |
| `backend/package.json` | pdf-parse sera supprimé par npm uninstall |

---

## ⚠️ IMPORTANT

- NE PAS utiliser `pdf-parse` pour les PDF Spoke/CANIAO
- TOUJOURS utiliser `parsePDFWithPython()` pour ces fichiers
- Le script Python `parse_pdf.py` doit être dans le même dossier que `index.js`
- Python 3 doit être installé sur le serveur
