/**
 * Module d'import unifié pour Trizee
 * Gère l'import de fichiers (PDF/Excel), la détection automatique,
 * l'attribution aux chauffeurs et la déduplication
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

// ============================================================
// PARSER PYTHON
// ============================================================

/**
 * Parse un fichier avec le parser Python unifié
 * @param {string} filePath - Chemin vers le fichier
 * @param {string} originalName - Nom original du fichier
 * @returns {Promise<Object>} Résultat du parsing
 */
function parseFileWithPython(filePath, originalName) {
    return new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, 'parse_import.py');
        
        // Essayer python3 puis python
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        
        const proc = spawn(pythonCmd, [pythonScript, filePath, originalName]);
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('close', (code) => {
            if (code !== 0) {
                console.error('[IMPORT] Erreur Python:', stderr);
                reject(new Error(`Erreur parsing: ${stderr || 'Code ' + code}`));
                return;
            }
            
            try {
                const result = JSON.parse(stdout);
                if (result.error) {
                    reject(new Error(result.error));
                } else {
                    resolve(result);
                }
            } catch (e) {
                reject(new Error(`Erreur JSON: ${e.message}`));
            }
        });
        
        proc.on('error', (err) => {
            // Fallback vers 'python' si python3 n'existe pas
            if (err.code === 'ENOENT' && pythonCmd === 'python3') {
                const proc2 = spawn('python', [pythonScript, filePath, originalName]);
                let stdout2 = '';
                let stderr2 = '';
                
                proc2.stdout.on('data', (data) => stdout2 += data.toString());
                proc2.stderr.on('data', (data) => stderr2 += data.toString());
                
                proc2.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`Erreur parsing: ${stderr2}`));
                        return;
                    }
                    try {
                        const result = JSON.parse(stdout2);
                        resolve(result);
                    } catch (e) {
                        reject(new Error(`Erreur JSON: ${e.message}`));
                    }
                });
                
                proc2.on('error', () => {
                    reject(new Error('Python non trouvé'));
                });
            } else {
                reject(err);
            }
        });
    });
}

// ============================================================
// GESTION DES CHAUFFEURS
// ============================================================

/**
 * Charge le mapping des chauffeurs depuis le fichier JSON
 */
function loadChauffeursMapping() {
    const filePath = path.join(__dirname, 'chauffeurs.json');
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return data;
        }
    } catch (e) {
        console.error('[IMPORT] Erreur chargement chauffeurs.json:', e.message);
    }
    return { chauffeurs: [], sousTraitants: [] };
}

/**
 * Sauvegarde le mapping des chauffeurs
 */
function saveChauffeursMapping(data) {
    const filePath = path.join(__dirname, 'chauffeurs.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Normalise un nom de chauffeur pour la comparaison
 */
function normalizeDriverName(name) {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z]/g, '');
}

/**
 * Cherche le sous-traitant associé à un chauffeur
 * @param {string} chauffeurName - Nom du chauffeur
 * @returns {string|null} Nom du sous-traitant ou null si non trouvé
 */
function findSousTraitantForChauffeur(chauffeurName) {
    const mapping = loadChauffeursMapping();
    const normalized = normalizeDriverName(chauffeurName);
    
    const found = mapping.chauffeurs.find(c => 
        normalizeDriverName(c.name) === normalized ||
        c.normalized === normalized
    );
    
    return found ? found.sousTraitant : null;
}

/**
 * Ajoute un nouveau chauffeur au mapping
 */
function addChauffeurToMapping(name, sousTraitant) {
    const mapping = loadChauffeursMapping();
    
    // Vérifier si déjà existant
    const normalized = normalizeDriverName(name);
    const existing = mapping.chauffeurs.find(c => c.normalized === normalized);
    
    if (existing) {
        // Mettre à jour le sous-traitant
        existing.sousTraitant = sousTraitant;
    } else {
        // Ajouter nouveau
        mapping.chauffeurs.push({
            name: name,
            normalized: normalized,
            sousTraitant: sousTraitant,
            createdAt: new Date().toISOString()
        });
    }
    
    // Ajouter le sous-traitant s'il n'existe pas
    if (!mapping.sousTraitants.includes(sousTraitant)) {
        mapping.sousTraitants.push(sousTraitant);
    }
    
    saveChauffeursMapping(mapping);
    return true;
}

/**
 * Ajoute un nouveau sous-traitant
 */
function addSousTraitant(name) {
    const mapping = loadChauffeursMapping();
    
    if (!mapping.sousTraitants.includes(name)) {
        mapping.sousTraitants.push(name);
        saveChauffeursMapping(mapping);
    }
    
    return true;
}

/**
 * Récupère la liste des sous-traitants
 */
function getAllSousTraitants() {
    const mapping = loadChauffeursMapping();
    return mapping.sousTraitants || [];
}

// ============================================================
// DÉDUPLICATION
// ============================================================

/**
 * Filtre les doublons de tracking pour une date donnée
 * @param {Array} colisList - Liste des colis à importer
 * @param {string} date - Date de la tournée (YYYY-MM-DD)
 * @param {Array} existingColis - Colis déjà en base pour cette date
 * @returns {Object} {uniqueColis, duplicatesInDb, duplicatesInFile}
 */
function filterDuplicates(colisList, date, existingColis = []) {
    const seenInFile = new Set();
    const existingTrackings = new Set(
        existingColis
            .filter(c => c.date === date)
            .map(c => c.trackingNumber)
    );
    
    const uniqueColis = [];
    const duplicatesInDb = [];
    const duplicatesInFile = [];
    
    for (const colis of colisList) {
        const tracking = colis.trackingNumber;
        
        if (!tracking) continue;
        
        // Doublon dans le fichier actuel
        if (seenInFile.has(tracking)) {
            duplicatesInFile.push(colis);
            continue;
        }
        
        // Doublon en base
        if (existingTrackings.has(tracking)) {
            duplicatesInDb.push(colis);
            continue;
        }
        
        seenInFile.add(tracking);
        uniqueColis.push(colis);
    }
    
    return { uniqueColis, duplicatesInDb, duplicatesInFile };
}

// ============================================================
// EXPORT EXCEL
// ============================================================

/**
 * Génère un fichier Excel pour un chauffeur
 * @param {string} chauffeurName - Nom du chauffeur
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {string} type - 'gofo', 'cainiao', ou 'mutualise'
 * @param {Array} colisList - Liste des colis
 * @returns {Buffer} Buffer du fichier Excel
 */
function generateExportExcel(chauffeurName, date, type, colisList) {
    // Créer le workbook
    const wb = XLSX.utils.book_new();
    
    // Filtrer par type si nécessaire
    let filteredColis = colisList;
    if (type === 'gofo') {
        filteredColis = colisList.filter(c => c.type === 'gofo' || c.trackingNumber?.startsWith('GFFR'));
    } else if (type === 'cainiao') {
        filteredColis = colisList.filter(c => c.type === 'cainiao' || c.trackingNumber?.startsWith('DOFR') || c.trackingNumber?.startsWith('CNFR'));
    }
    // 'mutualise' = tous les colis
    
    // Trier par numéro d'ordre si disponible
    filteredColis.sort((a, b) => {
        if (a.orderNumber && b.orderNumber) {
            return a.orderNumber - b.orderNumber;
        }
        return 0;
    });
    
    // Préparer les données
    const data = filteredColis.map(colis => ({
        'N° Ordre': colis.orderNumber || '',
        'Adresse': colis.address || '',
        'Ville': colis.city || '',
        'Code Postal': colis.postalCode || '',
        'Tracking': colis.trackingNumber || ''
    }));
    
    // Créer la feuille
    const ws = XLSX.utils.json_to_sheet(data);
    
    // Définir les largeurs de colonnes
    ws['!cols'] = [
        { wch: 10 },  // N° Ordre
        { wch: 50 },  // Adresse
        { wch: 20 },  // Ville
        { wch: 12 },  // Code Postal
        { wch: 20 }   // Tracking
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Colis');
    
    // Générer le buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
}

/**
 * Génère le nom du fichier d'export
 * @param {string} chauffeurName - Nom du chauffeur
 * @param {string} type - 'gofo', 'cainiao', ou 'mutualise'
 * @param {string} date - Date (YYYY-MM-DD)
 * @returns {string} Nom du fichier
 */
function generateExportFilename(chauffeurName, type, date) {
    const [year, month, day] = date.split('-');
    const formattedDate = `${day}_${month}`;
    const safeName = chauffeurName.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '');
    return `${safeName}-${type}-${formattedDate}.xlsx`;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    parseFileWithPython,
    loadChauffeursMapping,
    saveChauffeursMapping,
    normalizeDriverName,
    findSousTraitantForChauffeur,
    addChauffeurToMapping,
    addSousTraitant,
    getAllSousTraitants,
    filterDuplicates,
    generateExportExcel,
    generateExportFilename
};
