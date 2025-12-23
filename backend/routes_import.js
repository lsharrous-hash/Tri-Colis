/**
 * Routes API pour l'import unifié
 * À intégrer dans index.js avec: app.use('/api', require('./routes_import'))
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
    parseFileWithPython,
    findSousTraitantForChauffeur,
    addChauffeurToMapping,
    addSousTraitant,
    getAllSousTraitants,
    filterDuplicates,
    generateExportExcel,
    generateExportFilename,
    loadChauffeursMapping
} = require('./importService');

// Configuration multer pour upload
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// ============================================================
// VARIABLES GLOBALES - Références vers les données de index.js
// ============================================================

let dataRef = {
    colis: [],
    tours: [],
    users: [],
    getNextColisId: () => 1,
    getNextTourId: () => 1,
    setNextColisId: (val) => {},
    setNextTourId: (val) => {},
    save: () => {}
};

/**
 * Initialise les références aux données globales
 * Appelé depuis index.js après require
 */
function initializeData(colis, tours, getNextColisId, setNextColisId, getNextTourId, setNextTourId, saveFn, users = []) {
    dataRef.colis = colis;
    dataRef.tours = tours;
    dataRef.users = users;
    dataRef.getNextColisId = getNextColisId;
    dataRef.setNextColisId = setNextColisId;
    dataRef.getNextTourId = getNextTourId;
    dataRef.setNextTourId = setNextTourId;
    dataRef.save = saveFn;
    console.log('[IMPORT ROUTES] Initialisé avec', colis.length, 'colis,', tours.length, 'tours et', users.length, 'users');
}

/**
 * Normalise un nom pour la comparaison
 */
function normalizeNameForSearch(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // Enlever les accents
        .replace(/[^a-z]/g, '');           // Garder que les lettres
}

/**
 * Cherche le sous-traitant d'un chauffeur dans les utilisateurs de l'app
 * @param {string} chauffeurName - Nom du chauffeur
 * @returns {string|null} Nom du sous-traitant ou null
 */
function findSousTraitantInUsers(chauffeurName) {
    if (!chauffeurName || !dataRef.users || dataRef.users.length === 0) {
        return null;
    }
    
    const normalizedSearch = normalizeNameForSearch(chauffeurName);
    console.log('[FIND ST] Recherche:', chauffeurName, '→ normalisé:', normalizedSearch);
    
    // Chercher un utilisateur dont le LOGIN correspond (pas name!)
    const found = dataRef.users.find(u => {
        const normalizedUser = normalizeNameForSearch(u.login);
        return normalizedUser === normalizedSearch;
    });
    
    if (found) {
        console.log('[FIND ST] Trouvé:', found.login, '→', found.sousTraitantName);
    } else {
        console.log('[FIND ST] Non trouvé parmi:', dataRef.users.slice(0, 10).map(u => u.login).join(', '));
    }
    
    return found ? found.sousTraitantName : null;
}

/**
 * Retourne tous les sous-traitants (combinés de users + mapping)
 */
function getAllSousTraitantsCombined() {
    // ST depuis les users de l'app
    const stFromUsers = dataRef.users
        .filter(u => u.sousTraitantName)
        .map(u => u.sousTraitantName);
    
    // ST depuis le mapping importService
    const stFromMapping = getAllSousTraitants();
    
    // Combiner et dédupliquer
    const all = [...new Set([...stFromUsers, ...stFromMapping])];
    return all.sort();
}

// ============================================================
// ROUTES
// ============================================================

/**
 * POST /api/import/unified
 * Import unifié de fichiers (PDF ou Excel)
 * 
 * Body (multipart):
 * - file: Fichier à importer
 * - date: Date de la tournée (YYYY-MM-DD)
 * - chauffeurAssignments: JSON optionnel pour assigner les chauffeurs inconnus
 *   Format: {"NomChauffeur": "NomSousTraitant", ...}
 */
router.post('/import/unified', upload.single('file'), async (req, res) => {
    const startTime = Date.now();
    
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'NO_FILE',
                message: 'Aucun fichier fourni'
            });
        }
        
        const { date, chauffeurAssignments } = req.body;
        const tourDate = date || new Date().toISOString().split('T')[0];
        
        console.log(`[IMPORT] Début import: ${req.file.originalname}, date: ${tourDate}`);
        
        // Parser le fichier
        let parseResult;
        try {
            parseResult = await parseFileWithPython(req.file.path, req.file.originalname);
        } catch (parseError) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                error: 'PARSE_ERROR',
                message: parseError.message
            });
        }
        
        console.log(`[IMPORT] Parse OK: ${parseResult.format}, ${parseResult.totalColis} colis, ${parseResult.chauffeurs.length} chauffeur(s)`);
        
        // Traiter les assignments de chauffeurs si fournis
        let assignments = {};
        if (chauffeurAssignments) {
            try {
                assignments = typeof chauffeurAssignments === 'string' 
                    ? JSON.parse(chauffeurAssignments) 
                    : chauffeurAssignments;
            } catch (e) {
                console.warn('[IMPORT] Erreur parsing chauffeurAssignments:', e.message);
            }
        }
        
        // Vérifier les chauffeurs inconnus
        const unknownChauffeurs = [];
        const chauffeursSousTraitants = {};
        
        for (const chauffeurData of parseResult.chauffeurs) {
            const chauffeurName = chauffeurData.name;
            
            // Vérifier si assignment fourni
            if (assignments[chauffeurName]) {
                // Ajouter au mapping
                addChauffeurToMapping(chauffeurName, assignments[chauffeurName]);
                chauffeursSousTraitants[chauffeurName] = assignments[chauffeurName];
            } else {
                // 1. Chercher d'abord dans les utilisateurs de l'app
                let st = findSousTraitantInUsers(chauffeurName);
                
                // 2. Si pas trouvé, chercher dans le mapping chauffeurs.json
                if (!st) {
                    st = findSousTraitantForChauffeur(chauffeurName);
                }
                
                if (st) {
                    chauffeursSousTraitants[chauffeurName] = st;
                } else {
                    unknownChauffeurs.push({
                        name: chauffeurName,
                        colisCount: chauffeurData.colis.length,
                        stats: countByType(chauffeurData.colis)
                    });
                }
            }
        }
        
        // Si des chauffeurs sont inconnus, retourner pour demander l'association
        if (unknownChauffeurs.length > 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                error: 'UNKNOWN_CHAUFFEURS',
                message: `${unknownChauffeurs.length} chauffeur(s) inconnu(s)`,
                unknownChauffeurs: unknownChauffeurs,
                sousTraitants: getAllSousTraitantsCombined(),
                existingChauffeurs: loadChauffeursMapping().chauffeurs,
                // Données pour réimport
                parseResult: {
                    format: parseResult.format,
                    totalColis: parseResult.totalColis,
                    stats: parseResult.stats,
                    chauffeurs: parseResult.chauffeurs.map(c => ({
                        name: c.name,
                        colisCount: c.colis.length,
                        stats: countByType(c.colis)
                    }))
                },
                filename: req.file.originalname,
                tourDate: tourDate
            });
        }
        
        // Tous les chauffeurs sont connus, procéder à l'import
        const importResults = [];
        let totalImported = 0;
        let totalDuplicates = 0;
        
        for (const chauffeurData of parseResult.chauffeurs) {
            const chauffeurName = chauffeurData.name;
            const sousTraitantName = chauffeursSousTraitants[chauffeurName];
            
            // Séparer les colis par type
            const gofoColisRaw = chauffeurData.colis.filter(c => c.type === 'gofo');
            const caniaoColisRaw = chauffeurData.colis.filter(c => c.type === 'cainiao');
            
            // Filtrer les doublons
            const existingColis = dataRef.colis.filter(c => c.date === tourDate);
            
            // Créer tournée Gofo si nécessaire
            if (gofoColisRaw.length > 0) {
                const { uniqueColis, duplicatesInDb, duplicatesInFile } = 
                    filterDuplicates(gofoColisRaw, tourDate, existingColis);
                
                if (uniqueColis.length > 0) {
                    const tourResult = createTour(
                        chauffeurName, 
                        sousTraitantName, 
                        tourDate, 
                        'gofo', 
                        uniqueColis,
                        chauffeurData.plage
                    );
                    importResults.push(tourResult);
                    totalImported += uniqueColis.length;
                }
                totalDuplicates += duplicatesInDb.length + duplicatesInFile.length;
            }
            
            // Créer tournée Cainiao si nécessaire
            if (caniaoColisRaw.length > 0) {
                const { uniqueColis, duplicatesInDb, duplicatesInFile } = 
                    filterDuplicates(caniaoColisRaw, tourDate, [...existingColis, ...dataRef.colis.filter(c => c.date === tourDate)]);
                
                if (uniqueColis.length > 0) {
                    const tourResult = createTour(
                        chauffeurName, 
                        sousTraitantName, 
                        tourDate, 
                        'cainiao', 
                        uniqueColis,
                        chauffeurData.plage
                    );
                    importResults.push(tourResult);
                    totalImported += uniqueColis.length;
                }
                totalDuplicates += duplicatesInDb.length + duplicatesInFile.length;
            }
        }
        
        // Sauvegarder
        dataRef.save();
        
        // Supprimer le fichier uploadé
        fs.unlinkSync(req.file.path);
        
        const elapsed = Date.now() - startTime;
        console.log(`[IMPORT] Terminé en ${elapsed}ms: ${totalImported} colis importés, ${totalDuplicates} doublons ignorés`);
        
        // Construire le message de résultat
        const gofoResults = importResults.filter(r => r.type === 'gofo');
        const caniaoResults = importResults.filter(r => r.type === 'cainiao');
        
        let message = 'Import réussi: ';
        const parts = [];
        if (gofoResults.length > 0) {
            const gofoCount = gofoResults.reduce((sum, r) => sum + r.colisCount, 0);
            parts.push(`${gofoResults.length} tournée(s) Gofo (${gofoCount} colis)`);
        }
        if (caniaoResults.length > 0) {
            const caniaoCount = caniaoResults.reduce((sum, r) => sum + r.colisCount, 0);
            parts.push(`${caniaoResults.length} tournée(s) Cainiao (${caniaoCount} colis)`);
        }
        message += parts.join(' + ');
        if (totalDuplicates > 0) {
            message += ` | ${totalDuplicates} doublons ignorés`;
        }
        
        res.json({
            success: true,
            message: message,
            format: parseResult.format,
            tours: importResults,
            totalImported: totalImported,
            totalDuplicates: totalDuplicates,
            gofoCount: gofoResults.reduce((sum, r) => sum + r.colisCount, 0),
            caniaoCount: caniaoResults.reduce((sum, r) => sum + r.colisCount, 0),
            elapsed: elapsed
        });
        
    } catch (error) {
        console.error('[IMPORT] Erreur:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            error: 'IMPORT_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/export/:chauffeur/:date/:type
 * Exporte les colis d'un chauffeur au format Excel
 * 
 * Params:
 * - chauffeur: Nom du chauffeur
 * - date: Date (YYYY-MM-DD)
 * - type: 'gofo', 'cainiao', ou 'mutualise'
 */
router.get('/export/:chauffeur/:date/:type', (req, res) => {
    try {
        const { chauffeur, date, type } = req.params;
        
        if (!['gofo', 'cainiao', 'mutualise'].includes(type)) {
            return res.status(400).json({
                error: 'INVALID_TYPE',
                message: 'Type doit être: gofo, cainiao, ou mutualise'
            });
        }
        
        // Récupérer les colis du chauffeur pour cette date
        const colisList = dataRef.colis.filter(c => 
            c.chauffeurName?.toLowerCase() === chauffeur.toLowerCase() &&
            c.date === date
        );
        
        if (colisList.length === 0) {
            return res.status(404).json({
                error: 'NO_COLIS',
                message: `Aucun colis trouvé pour ${chauffeur} le ${date}`
            });
        }
        
        // Générer le fichier Excel
        const buffer = generateExportExcel(chauffeur, date, type, colisList);
        const filename = generateExportFilename(chauffeur, type, date);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
        
    } catch (error) {
        console.error('[EXPORT] Erreur:', error);
        res.status(500).json({
            error: 'EXPORT_ERROR',
            message: error.message
        });
    }
});

/**
 * Normalise un nom de chauffeur pour le groupage
 * Enlève les suffixes c, m, g SEULEMENT si c'est clairement un suffixe ajouté
 */
function normalizeNameForGrouping(name) {
    if (!name) return 'Inconnu';
    let normalized = name.trim();
    
    // Liste de noms connus qui finissent par m, c ou g (ne pas les modifier)
    const namesEndingWithMCG = ['hakim', 'karim', 'brahim', 'ibrahim', 'selim', 'salim', 'nassim', 'eric', 'cedric', 'frederic', 'marc', 'luc', 'greg'];
    
    const lowerName = normalized.toLowerCase();
    
    // Si c'est un nom connu qui finit par m/c/g, ne pas enlever la lettre
    if (namesEndingWithMCG.some(n => lowerName === n || lowerName.startsWith(n))) {
        // Ne rien enlever, juste normaliser la casse
        if (normalized.length > 0) {
            normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
        }
        return normalized;
    }
    
    // Sinon, enlever le suffixe seulement si:
    // 1. Le nom fait plus de 5 caractères
    // 2. Après suppression il reste au moins 4 caractères
    if (normalized.length > 5) {
        const withoutSuffix = normalized.replace(/[cmg]$/i, '');
        if (withoutSuffix.length >= 4) {
            normalized = withoutSuffix;
        }
    }
    
    // Normaliser la casse
    if (normalized.length > 0) {
        normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
    }
    return normalized || 'Inconnu';
}

/**
 * GET /api/chauffeurs/summary/:date
 * Récupère le résumé des colis par chauffeur pour une date
 * (pour afficher la vue mutualisée)
 */
router.get('/chauffeurs/summary/:date', (req, res) => {
    try {
        const { date } = req.params;
        
        // Grouper les colis par chauffeur (avec normalisation du nom)
        const colisByDate = dataRef.colis.filter(c => c.date === date);
        const summary = {};
        
        for (const colis of colisByDate) {
            const rawName = colis.chauffeurName || 'Inconnu';
            const key = normalizeNameForGrouping(rawName);
            
            if (!summary[key]) {
                summary[key] = {
                    chauffeur: key,
                    sousTraitant: colis.sousTraitantName || 'N/A',
                    gofo: { count: 0, colis: [] },
                    cainiao: { count: 0, colis: [] },
                    total: 0
                };
            }
            
            const type = colis.type || (colis.trackingNumber?.startsWith('GFFR') ? 'gofo' : 'cainiao');
            
            if (type === 'gofo') {
                summary[key].gofo.count++;
                summary[key].gofo.colis.push(colis);
            } else {
                summary[key].cainiao.count++;
                summary[key].cainiao.colis.push(colis);
            }
            summary[key].total++;
        }
        
        res.json({
            date: date,
            chauffeurs: Object.values(summary).sort((a, b) => a.chauffeur.localeCompare(b.chauffeur)),
            totals: {
                gofo: Object.values(summary).reduce((sum, s) => sum + s.gofo.count, 0),
                cainiao: Object.values(summary).reduce((sum, s) => sum + s.cainiao.count, 0),
                total: colisByDate.length
            }
        });
        
    } catch (error) {
        console.error('[SUMMARY] Erreur:', error);
        res.status(500).json({
            error: 'SUMMARY_ERROR',
            message: error.message
        });
    }
});

/**
 * DELETE /api/chauffeurs/:name/colis
 * Supprime tous les colis d'un chauffeur pour une date donnée
 */
router.delete('/chauffeurs/:name/colis', (req, res) => {
    try {
        const { name } = req.params;
        const { date } = req.query;
        
        if (!name || !date) {
            return res.status(400).json({
                error: 'MISSING_PARAMS',
                message: 'Nom du chauffeur et date requis'
            });
        }
        
        // Normaliser le nom pour la recherche
        const normalizedName = normalizeNameForGrouping(name);
        
        // Trouver tous les colis du chauffeur pour cette date
        const colisToDelete = dataRef.colis.filter(c => {
            const colisNormalizedName = normalizeNameForGrouping(c.chauffeurName);
            return colisNormalizedName === normalizedName && c.date === date;
        });
        
        if (colisToDelete.length === 0) {
            return res.status(404).json({
                error: 'NO_COLIS',
                message: `Aucun colis trouvé pour ${name} le ${date}`
            });
        }
        
        // Récupérer les IDs des tournées concernées
        const tourIdsToCheck = new Set(colisToDelete.map(c => c.tourId));
        
        // Supprimer les colis
        const deletedCount = colisToDelete.length;
        for (let i = dataRef.colis.length - 1; i >= 0; i--) {
            const c = dataRef.colis[i];
            const colisNormalizedName = normalizeNameForGrouping(c.chauffeurName);
            if (colisNormalizedName === normalizedName && c.date === date) {
                dataRef.colis.splice(i, 1);
            }
        }
        
        // Supprimer les tournées qui n'ont plus de colis
        let toursDeleted = 0;
        for (const tourId of tourIdsToCheck) {
            const remainingColis = dataRef.colis.filter(c => c.tourId === tourId);
            if (remainingColis.length === 0) {
                const tourIndex = dataRef.tours.findIndex(t => t.id === tourId);
                if (tourIndex >= 0) {
                    dataRef.tours.splice(tourIndex, 1);
                    toursDeleted++;
                }
            } else {
                // Mettre à jour le compteur de la tournée
                const tour = dataRef.tours.find(t => t.id === tourId);
                if (tour) {
                    tour.colisCount = remainingColis.length;
                }
            }
        }
        
        // Sauvegarder
        dataRef.save();
        
        console.log(`[DELETE] ${deletedCount} colis et ${toursDeleted} tournées supprimés pour ${name} le ${date}`);
        
        res.json({
            success: true,
            message: `${deletedCount} colis supprimés pour ${name}`,
            deletedColis: deletedCount,
            deletedTours: toursDeleted
        });
        
    } catch (error) {
        console.error('[DELETE] Erreur:', error);
        res.status(500).json({
            error: 'DELETE_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /api/sous-traitants
 * Ajoute un nouveau sous-traitant
 */
router.post('/sous-traitants', (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || name.trim().length < 2) {
            return res.status(400).json({
                error: 'INVALID_NAME',
                message: 'Le nom du sous-traitant doit faire au moins 2 caractères'
            });
        }
        
        addSousTraitant(name.trim());
        
        res.json({
            success: true,
            message: `Sous-traitant "${name}" ajouté`,
            sousTraitants: getAllSousTraitantsCombined()
        });
        
    } catch (error) {
        res.status(500).json({
            error: 'ADD_ST_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/chauffeurs/list
 * Liste tous les chauffeurs existants (depuis users + mapping)
 */
router.get('/chauffeurs/list', (req, res) => {
    try {
        const chauffeurs = [];
        const seen = new Set();
        
        // 1. Chauffeurs depuis les users de l'app
        for (const user of dataRef.users) {
            if (user.sousTraitantName && user.login) {
                const key = user.login.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    chauffeurs.push({
                        name: user.login,
                        sousTraitant: user.sousTraitantName,
                        source: 'users'
                    });
                }
            }
        }
        
        // 2. Chauffeurs depuis le mapping chauffeurs.json
        const mapping = loadChauffeursMapping();
        for (const ch of mapping.chauffeurs) {
            const key = ch.name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                chauffeurs.push({
                    name: ch.name,
                    sousTraitant: ch.sousTraitant,
                    source: 'mapping'
                });
            }
        }
        
        // Trier par nom
        chauffeurs.sort((a, b) => a.name.localeCompare(b.name));
        
        res.json({
            chauffeurs,
            sousTraitants: getAllSousTraitantsCombined()
        });
        
    } catch (error) {
        console.error('[CHAUFFEURS LIST] Erreur:', error);
        res.status(500).json({
            error: 'LIST_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/sous-traitants
 * Liste tous les sous-traitants
 */
router.get('/sous-traitants', (req, res) => {
    res.json({
        sousTraitants: getAllSousTraitantsCombined()
    });
});

/**
 * POST /api/chauffeurs
 * Ajoute ou met à jour un chauffeur
 */
router.post('/chauffeurs', (req, res) => {
    try {
        const { name, sousTraitant } = req.body;
        
        if (!name || name.trim().length < 2) {
            return res.status(400).json({
                error: 'INVALID_NAME',
                message: 'Le nom du chauffeur doit faire au moins 2 caractères'
            });
        }
        
        if (!sousTraitant) {
            return res.status(400).json({
                error: 'MISSING_ST',
                message: 'Le sous-traitant est requis'
            });
        }
        
        addChauffeurToMapping(name.trim(), sousTraitant.trim());
        
        res.json({
            success: true,
            message: `Chauffeur "${name}" associé à "${sousTraitant}"`,
            chauffeurs: loadChauffeursMapping().chauffeurs
        });
        
    } catch (error) {
        res.status(500).json({
            error: 'ADD_CHAUFFEUR_ERROR',
            message: error.message
        });
    }
});

// ============================================================
// FONCTIONS HELPERS
// ============================================================

function countByType(colisList) {
    const stats = { gofo: 0, cainiao: 0 };
    for (const c of colisList) {
        if (c.type === 'gofo') stats.gofo++;
        else if (c.type === 'cainiao') stats.cainiao++;
    }
    return stats;
}

function createTour(chauffeurName, sousTraitantName, date, type, colisList, plage) {
    // Supprimer l'ancienne tournée si elle existe (même chauffeur + date + type)
    const existingIndex = dataRef.tours.findIndex(t =>
        t.chauffeurName?.toLowerCase() === chauffeurName.toLowerCase() &&
        t.date === date &&
        ((type === 'gofo' && t.isGofo) || (type === 'cainiao' && t.isCaniao))
    );
    
    if (existingIndex >= 0) {
        const oldTour = dataRef.tours[existingIndex];
        // Supprimer les colis de l'ancienne tournée
        // On doit modifier le tableau in-place
        for (let i = dataRef.colis.length - 1; i >= 0; i--) {
            if (dataRef.colis[i].tourId === oldTour.id) {
                dataRef.colis.splice(i, 1);
            }
        }
        dataRef.tours.splice(existingIndex, 1);
        console.log(`[IMPORT] Tournée ${type} existante remplacée pour ${chauffeurName}`);
    }
    
    // Créer la nouvelle tournée
    const tourId = dataRef.getNextTourId();
    dataRef.setNextTourId(tourId + 1);
    
    const newTour = {
        id: tourId,
        chauffeurName: chauffeurName,
        sousTraitantName: sousTraitantName,
        date: date,
        isGofo: type === 'gofo',
        isCaniao: type === 'cainiao',
        colisCount: colisList.length,
        plage: plage || null,
        createdAt: new Date().toISOString()
    };
    dataRef.tours.push(newTour);
    
    // Créer les colis
    for (const colisData of colisList) {
        const colisId = dataRef.getNextColisId();
        dataRef.setNextColisId(colisId + 1);
        
        dataRef.colis.push({
            id: colisId,
            tourId: tourId,
            date: date,
            chauffeurName: chauffeurName,
            sousTraitantName: sousTraitantName,
            type: type,
            orderNumber: colisData.orderNumber,
            trackingNumber: colisData.trackingNumber,
            address: colisData.address || '',
            city: colisData.city || '',
            postalCode: colisData.postalCode || '',
            scanned: false,
            scannedAt: null,
            scannedBy: null
        });
    }
    
    return {
        tourId: tourId,
        chauffeur: chauffeurName,
        sousTraitant: sousTraitantName,
        type: type,
        colisCount: colisList.length,
        plage: plage
    };
}

// Export du router et de la fonction d'initialisation
module.exports = router;
module.exports.initializeData = initializeData;
