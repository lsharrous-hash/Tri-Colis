// index.js - VERSION CORRIGÉE
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { importSpokeFile } = require("./importSpoke");
const { execSync, exec } = require("child_process");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==============================
// API COLIS - pour stats uniques côté frontend
app.get('/api/colis', (req, res) => {
  const { date } = req.query;
  let filteredColis = COLIS;
  if (date) {
    // On récupère les tournées de la date
    const toursForDate = TOURS.filter((t) => t.date === date);
    const tourIdsForDate = new Set(toursForDate.map((t) => t.id));
    filteredColis = COLIS.filter((c) => tourIdsForDate.has(c.tourId));
  }
  res.json(filteredColis);
});
// Fonction pour extraire le nom du chauffeur du nom de fichier
// ==============================
function extractChauffeurFromFilename(filename) {
  // Décoder le nom de fichier (au cas où il est URL-encodé)
  let name = decodeURIComponent(filename);
  
  // Enlever l'extension (.pdf, .txt, .xlsx, etc.)
  name = path.basename(name, path.extname(name));
  
  // Enlever les suffixes comme (1), (2), _2_, __2__, etc.
  name = name.replace(/[\s_]*\(\d+\)[\s_]*/g, '');
  name = name.replace(/__\d+__/g, '');
  name = name.replace(/_\d+_/g, '');
  
  // Enlever les suffixes de type de colis (cifr, gffr, cnfr, dofr, etc.)
  name = name.replace(/[_\-]?(cifr|gffr|cnfr|dofr|colis)$/i, '');
  
  // Enlever les chiffres à la fin (dates comme 1112, 1211, 11-12, etc.)
  name = name.replace(/[\-_]?\d{2,}[\-_]?\d*$/g, '');
  
  // Enlever les underscores et tirets en fin
  name = name.replace(/[_\-\s]+$/g, '');
  
  // Enlever les underscores et tirets au début
  name = name.replace(/^[_\-\s]+/g, '');
  
  // Mettre en majuscule la première lettre, le reste en minuscules
  if (name.length > 0) {
    name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  
  return name || "Inconnu";
}

// ==============================
// FUZZY MATCHING - pour rapprocher les noms de chauffeurs
// ==============================
function levenshteinDistance(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  const matrix = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[s1.length][s2.length];
}

function normalizeDriverName(name) {
  if (!name) return '';
  let normalized = name.toString().trim().toLowerCase();
  
  // Enlever les suffixes comme _jnr, _JNR, -jnr, " jnr", etc.
  // Le pattern gère: espace, tiret, underscore avant le suffixe
  normalized = normalized.replace(/[\s_\-]*(jnr|transport|livraison|chauffeur)[\s_\-]*$/i, '');
  
  // Enlever les chiffres à la fin
  normalized = normalized.replace(/[\d]+$/, '');
  
  // Enlever les caractères spéciaux à la fin
  normalized = normalized.replace(/[_\-\s]+$/, '');
  
  // Enlever les caractères spéciaux au début
  normalized = normalized.replace(/^[_\-\s]+/, '');
  
  console.log(`normalizeDriverName: "${name}" -> "${normalized}"`);
  return normalized;
}

function areDriverNamesMatching(name1, name2, threshold = 2) {
  const n1 = normalizeDriverName(name1);
  const n2 = normalizeDriverName(name2);
  
  console.log('DEBUG', 'Comparing driver names', { name1, name2, n1, n2 });
  
  // Exact match après normalisation
  if (n1 === n2) return true;
  
  // Un nom contient l'autre
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // Levenshtein distance pour les petites erreurs
  const distance = levenshteinDistance(n1, n2);
  const maxLen = Math.max(n1.length, n2.length);
  
  // Tolérance: distance <= threshold ET distance < 30% de la longueur max
  return distance <= threshold && distance < maxLen * 0.3;
}

// Fonction pour trouver les chauffeurs mutualisables
function findMutualizedDrivers(date, sousTraitant) {
  console.log('=== FIND MUTUALIZED DRIVERS ===');
  console.log('Input: date=', date, 'sousTraitant=', sousTraitant);
  
  // Récupérer les tournées optimisées (dispatcher import avec isOptimized)
  const optimizedTours = TOURS.filter(t => 
    t.date === date && 
    t.isDispatcherImport === true &&
    t.isOptimized === true &&
    (sousTraitant ? t.sousTraitantName === sousTraitant : true)
  );
  
  // Récupérer les tournées ajoutées manuellement (dispatcher import sans isOptimized)
  const manualDispatcherTours = TOURS.filter(t => 
    t.date === date && 
    t.isDispatcherImport === true &&
    !t.isOptimized &&
    (sousTraitant ? t.sousTraitantName === sousTraitant : true)
  );
  
  console.log('Optimized tours:', optimizedTours.length);
  console.log('Manual dispatcher tours:', manualDispatcherTours.length);
  
  // Récupérer les tournées Gofo (non-Cainiao, non-dispatcher) pour cette date
  const gofoTours = TOURS.filter(t => 
    t.date === date && 
    !t.isCaniao &&
    !t.isDispatcherImport
  );
  
  console.log('All Gofo tours for date:', gofoTours.length);
  console.log('Gofo tours:', gofoTours.map(t => ({ name: t.chauffeurName, st: t.sousTraitantName })));
  
  // Si un sous-traitant est spécifié (dispatcher), filtrer les Gofo
  const filteredGofoTours = sousTraitant 
    ? gofoTours.filter(t => t.sousTraitantName === sousTraitant)
    : gofoTours;
  
  console.log('Filtered Gofo tours:', filteredGofoTours.length);
  
  // Récupérer les tournées Cainiao pour cette date (toujours toutes)
  const caniaoTours = TOURS.filter(t => 
    t.date === date && 
    t.isCaniao === true
  );
  
  console.log('Cainiao tours:', caniaoTours.length);
  console.log('Cainiao tours:', caniaoTours.map(t => ({ name: t.chauffeurName, isCaniao: t.isCaniao })));
  
  // Créer un map des chauffeurs avec leurs colis
  const driversMap = new Map();
  
  // 1. D'abord ajouter les tournées OPTIMISÉES (prioritaires)
  for (const tour of optimizedTours) {
    const normalizedName = normalizeDriverName(tour.chauffeurName);
    const displayName = tour.chauffeurName.trim();
    const tourColisCount = tour.colisCount || COLIS.filter(c => c.tourId === tour.id).length;
    
    // Utiliser les compteurs mémorisés s'ils existent
    const gofoCount = tour.originalGofoCount || 0;
    const caniaoCount = tour.originalCaniaoCount || 0;
    
    console.log('Adding OPTIMIZED tour:', displayName, 'colis:', tourColisCount, 'gofo:', gofoCount, 'cainiao:', caniaoCount);
    
    driversMap.set(normalizedName, {
      name: displayName,
      normalizedName: normalizedName,
      sousTraitant: tour.sousTraitantName,
      gofoTourIds: [],
      caniaoTourIds: [],
      optimizedTourId: tour.id,
      gofoColisCount: gofoCount,
      caniaoColisCount: caniaoCount,
      optimizedColisCount: tourColisCount,
      isOptimized: true,
      isDispatcherImport: true
    });
  }
  
  // 1b. Ajouter les tournées AJOUTÉES MANUELLEMENT par le dispatcher
  for (const tour of manualDispatcherTours) {
    const normalizedName = normalizeDriverName(tour.chauffeurName);
    const displayName = tour.chauffeurName.trim();
    const tourColisCount = tour.colisCount || COLIS.filter(c => c.tourId === tour.id).length;
    
    console.log('Adding MANUAL DISPATCHER tour:', displayName, 'colis:', tourColisCount);
    
    // Si déjà dans le map (même nom normalisé), additionner
    if (driversMap.has(normalizedName)) {
      const existing = driversMap.get(normalizedName);
      existing.optimizedColisCount = (existing.optimizedColisCount || 0) + tourColisCount;
    } else {
      driversMap.set(normalizedName, {
        name: displayName,
        normalizedName: normalizedName,
        sousTraitant: tour.sousTraitantName,
        gofoTourIds: [],
        caniaoTourIds: [],
        dispatcherTourId: tour.id,
        gofoColisCount: 0,
        caniaoColisCount: 0,
        optimizedColisCount: tourColisCount,
        isOptimized: false,
        isDispatcherImport: true
      });
    }
  }
  
  // 2. Ajouter les chauffeurs Gofo (si pas déjà optimisé)
  for (const tour of filteredGofoTours) {
    const normalizedName = normalizeDriverName(tour.chauffeurName);
    const displayName = tour.chauffeurName.trim();
    
    // Skip si déjà optimisé
    if (driversMap.has(normalizedName) && driversMap.get(normalizedName).isOptimized) {
      console.log('Skip Gofo tour (already optimized):', displayName);
      continue;
    }
    
    // Calculer colisCount si absent
    const tourColisCount = tour.colisCount || COLIS.filter(c => c.tourId === tour.id).length;
    
    console.log('DEBUG', 'Processing Gofo tour', { chauffeur: tour.chauffeurName, normalized: normalizedName, colisCount: tourColisCount });
    
    if (!driversMap.has(normalizedName)) {
      driversMap.set(normalizedName, {
        name: displayName,
        normalizedName: normalizedName,
        sousTraitant: tour.sousTraitantName,
        gofoTourIds: [],
        caniaoTourIds: [],
        gofoColisCount: 0,
        caniaoColisCount: 0,
        gofoCreatedBy: tour.createdBy || null  // Qui a importé la tournée Gofo
      });
    }
    
    const driver = driversMap.get(normalizedName);
    driver.gofoTourIds.push(tour.id);
    driver.gofoColisCount += tourColisCount;
    // Si plusieurs tournées, garder le createdBy de la première
    if (!driver.gofoCreatedBy && tour.createdBy) {
      driver.gofoCreatedBy = tour.createdBy;
    }
  }
  
  // Matcher les chauffeurs Cainiao avec fuzzy matching
  for (const tour of caniaoTours) {
    const normalizedCaniaoName = normalizeDriverName(tour.chauffeurName);
    let matched = false;
    
    // Calculer colisCount si absent (pour les anciennes tournées)
    const tourColisCount = tour.colisCount || COLIS.filter(c => c.tourId === tour.id).length;
    
    console.log('DEBUG', 'Processing Cainiao tour', { chauffeur: tour.chauffeurName, normalized: normalizedCaniaoName, colisCount: tourColisCount });
    
    // Chercher un match dans les chauffeurs existants (par nom normalisé)
    for (const [existingNormName, driver] of driversMap.entries()) {
      if (existingNormName === normalizedCaniaoName || areDriverNamesMatching(tour.chauffeurName, driver.name)) {
        // Si le chauffeur est déjà optimisé, on skip (les colis sont déjà dans la tournée optimisée)
        if (driver.isOptimized) {
          console.log('Skip Cainiao (driver already optimized):', tour.chauffeurName);
          matched = true;
          break;
        }
        console.log('DEBUG', 'Match found!', { cainiao: tour.chauffeurName, gofo: driver.name });
        driver.caniaoTourIds.push(tour.id);
        driver.caniaoColisCount += tourColisCount;
        matched = true;
        break;
      }
    }
    
    // Si pas de match, créer une nouvelle entrée (chauffeur Cainiao uniquement)
    if (!matched) {
      console.log('No match for Cainiao:', tour.chauffeurName);
      const displayName = tour.chauffeurName.charAt(0).toUpperCase() + tour.chauffeurName.slice(1).toLowerCase();
      driversMap.set(normalizedCaniaoName, {
        name: displayName,
        normalizedName: normalizedCaniaoName,
        sousTraitant: null,  // Pas de sous-traitant connu (pas de match Gofo)
        gofoTourIds: [],
        caniaoTourIds: [tour.id],
        gofoColisCount: 0,
        caniaoColisCount: tourColisCount
      });
    }
  }
  
  console.log('=== FINAL DRIVERS MAP ===');
  const result = Array.from(driversMap.values());
  result.forEach(d => console.log(`Driver: ${d.name}, Gofo: ${d.gofoColisCount}, Cainiao: ${d.caniaoColisCount}`));
  
  return result;
}

// Fonction pour récupérer les colis mutualisés d'un chauffeur
function getMutualizedColisForDriver(driverName, date, sousTraitant) {
  const drivers = findMutualizedDrivers(date, sousTraitant);
  const driver = drivers.find(d => areDriverNamesMatching(d.name, driverName));
  
  if (!driver) return [];
  
  const allTourIds = [...driver.gofoTourIds, ...driver.caniaoTourIds];
  const colis = COLIS.filter(c => allTourIds.includes(c.tourId));
  
  // Trier par source (Gofo d'abord) puis par tracking
  colis.sort((a, b) => {
    const tourA = TOURS.find(t => t.id === a.tourId);
    const tourB = TOURS.find(t => t.id === b.tourId);
    const isACainiao = tourA?.isCaniao ? 1 : 0;
    const isBCainiao = tourB?.isCaniao ? 1 : 0;
    if (isACainiao !== isBCainiao) return isACainiao - isBCainiao;
    return (a.trackingNumber || '').localeCompare(b.trackingNumber || '');
  });
  
  return colis;
}

// ==============================
// Dossiers et fichiers
// ==============================
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Utiliser /data pour le stockage persistant sur Render, sinon le dossier local
const IS_PRODUCTION = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
const DATA_DIR = IS_PRODUCTION ? '/data' : __dirname;

// Créer le dossier /data s'il n'existe pas (en production)
if (IS_PRODUCTION && !fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.log('Note: /data directory may already exist or be managed by Render');
  }
}

const DATA_FILE = path.join(DATA_DIR, "data.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const CHAUFFEURS_FILE = path.join(DATA_DIR, "chauffeurs.json");
const LOG_FILE = path.join(__dirname, "logs.txt"); // Logs restent locaux

// ==============================
// Multer pour upload
// ==============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || ".txt";
    cb(null, "tour-" + uniqueSuffix + ext);
  },
});
const upload = multer({ storage });

// ==============================
// PARSING PDF AVEC PYTHON/PDFPLUMBER
// ==============================
/**
 * Parser un PDF Spoke/CANIAO avec pdfplumber (Python)
 * @param {string} pdfPath - Chemin vers le fichier PDF
 * @returns {Promise<Array>} - Liste des colis
 */
function parsePDFWithPython(pdfPath) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'parse_pdf.py');
        const command = `python "${scriptPath}" "${pdfPath}"`;
        
        exec(command, { maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
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

/**
 * Parser un PDF Spoke (tournée optimisée) avec pdfplumber (Python)
 * Utilise parse_spoke.py qui extrait les tables avec colonnes #, Address, Notes
 * @param {string} pdfPath - Chemin vers le fichier PDF
 * @returns {Promise<Array>} - Liste des colis avec orderNumber, trackingNumber, address
 */
function parseSpokePDFWithPython(pdfPath) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'parse_spoke.py');
        const command = `python "${scriptPath}" "${pdfPath}"`;
        
        exec(command, { maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                console.error('Erreur Python parse_spoke:', stderr);
                reject(new Error('Erreur parsing PDF Spoke: ' + error.message));
                return;
            }
            
            try {
                const result = JSON.parse(stdout);
                
                if (result.error) {
                    reject(new Error(result.error));
                } else {
                    console.log(`PDF Spoke parsé avec succès: ${result.length} colis`);
                    resolve(result);
                }
            } catch (e) {
                console.error('Stdout:', stdout);
                reject(new Error('Erreur parsing JSON: ' + e.message));
            }
        });
    });
}

// ==============================
// STOCKAGE EN MÉMOIRE
// ==============================

let TOURS = [];
let COLIS = [];
let NEXT_TOUR_ID = 1;
let NEXT_COLIS_ID = 1;

// Backup des tournées originales de l'admin (pour réinitialisation)
// Structure: { date_chauffeur_sousTraitant: { tour: {...}, colis: [...] } }
let ADMIN_TOUR_BACKUPS = {};

// Association colis → chauffeur original (persiste même après suppression)
// Structure: { trackingNumber: { chauffeur, sousTraitant, address } }
let ORIGINAL_COLIS_MAPPING = {};

// Mapping chauffeur → sous-traitant (pour auto-dispatch admin)
// Structure: { chauffeurs: [{name, sousTraitant, normalized}], sousTraitants: [string] }
let CHAUFFEURS_MAPPING = { chauffeurs: [], sousTraitants: [] };

// Charger les données au démarrage
loadDataFromFile();

let USERS = [];
let SESSIONS = {};

// ==============================
// LOGGING AMÉLIORÉ
// ==============================
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    level,
    message,
    ...data
  };
  
  if (level === 'ERROR') {
    console.error(JSON.stringify(logData));
  } else {
    console.log(JSON.stringify(logData));
  }

  try {
    const line = JSON.stringify(logData) + "\n";
    fs.appendFileSync(LOG_FILE, line);
    // Garder le fichier de logs à une taille raisonnable (~1MB)
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > 1_000_000) {
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      const lastPart = content.slice(-500_000);
      fs.writeFileSync(LOG_FILE, lastPart, 'utf8');
    }
  } catch (e) {
    // Ne pas casser si problème de log fichier
  }
}

// ==============================
// Persistance JSON améliorée
// ==============================
function saveDataToFile() {
  try {
    const data = {
      tours: TOURS,
      colis: COLIS,
      nextTourId: NEXT_TOUR_ID,
      nextColisId: NEXT_COLIS_ID,
      adminTourBackups: ADMIN_TOUR_BACKUPS,
      originalColisMapping: ORIGINAL_COLIS_MAPPING,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    log('INFO', 'Données sauvegardées', { colisCount: COLIS.length, toursCount: TOURS.length });
    return true;
  } catch (e) {
    log('ERROR', 'Erreur sauvegarde données', { error: e.message });
    return false;
  }
}

function loadDataFromFile() {
  if (!fs.existsSync(DATA_FILE)) {
    log('INFO', 'Aucun fichier data.json, démarrage vide');
    return;
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);

    TOURS = data.tours || [];
    COLIS = data.colis || [];
    NEXT_TOUR_ID = data.nextTourId || 1;
    NEXT_COLIS_ID = data.nextColisId || 1;
    ADMIN_TOUR_BACKUPS = data.adminTourBackups || {};
    ORIGINAL_COLIS_MAPPING = data.originalColisMapping || {};

    log('INFO', 'Données chargées', { 
      colisCount: COLIS.length, 
      toursCount: TOURS.length,
      backupsCount: Object.keys(ADMIN_TOUR_BACKUPS).length,
      lastSaved: data.lastSaved 
    });
  } catch (e) {
    log('ERROR', 'Erreur chargement données', { error: e.message });
  }
}

function saveUsersToFile() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(USERS, null, 2), "utf8");
    log('INFO', 'Utilisateurs sauvegardés', { userCount: USERS.length });
  } catch (e) {
    log('ERROR', 'Erreur sauvegarde utilisateurs', { error: e.message });
  }
}

function loadUsersFromFile() {
  if (!fs.existsSync(USERS_FILE)) {
    log('WARN', 'Aucun fichier users.json, création utilisateurs par défaut');
    createDefaultUsers();
    return;
  }

  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    USERS = JSON.parse(raw);
    log('INFO', 'Utilisateurs chargés', { userCount: USERS.length });
  } catch (e) {
    log('ERROR', 'Erreur chargement utilisateurs', { error: e.message });
    createDefaultUsers();
  }
}

// ==============================
// BACKUP DES TOURNÉES ADMIN
// ==============================
function createAdminTourBackup(tour, colis, createdByRole) {
  // Créer un backup seulement si c'est un admin qui importe
  if (createdByRole !== 'ADMIN') return;
  
  const normalizedName = normalizeDriverName(tour.chauffeurName);
  const backupKey = `${tour.date}_${normalizedName}_${tour.sousTraitantName}`;
  
  // Sauvegarder le backup (écraser si existe déjà)
  ADMIN_TOUR_BACKUPS[backupKey] = {
    tour: { ...tour },
    colis: colis.map(c => ({ ...c })),
    createdAt: new Date().toISOString()
  };
  
  log('INFO', 'Backup admin créé', { 
    backupKey, 
    chauffeur: tour.chauffeurName, 
    colisCount: colis.length 
  });
}

// ← NOUVEAU : Persistance des sessions
function saveSessionsToFile() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(SESSIONS, null, 2), "utf8");
  } catch (e) {
    log('ERROR', 'Erreur sauvegarde sessions', { error: e.message });
  }
}

function loadSessionsFromFile() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    return;
  }
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, "utf8");
    SESSIONS = JSON.parse(raw);
    log('INFO', 'Sessions chargées', { sessionCount: Object.keys(SESSIONS).length });
  } catch (e) {
    log('ERROR', 'Erreur chargement sessions', { error: e.message });
  }
}

// ==============================
// MAPPING CHAUFFEURS → SOUS-TRAITANTS
// ==============================
function saveChauffeursToFile() {
  try {
    fs.writeFileSync(CHAUFFEURS_FILE, JSON.stringify(CHAUFFEURS_MAPPING, null, 2), "utf8");
    log('INFO', 'Mapping chauffeurs sauvegardé', { 
      chauffeurCount: CHAUFFEURS_MAPPING.chauffeurs.length,
      sousTraitantCount: CHAUFFEURS_MAPPING.sousTraitants.length
    });
  } catch (e) {
    log('ERROR', 'Erreur sauvegarde chauffeurs', { error: e.message });
  }
}

function loadChauffeursFromFile() {
  if (!fs.existsSync(CHAUFFEURS_FILE)) {
    log('INFO', 'Aucun fichier chauffeurs.json, création initiale');
    // Initialiser avec les sous-traitants existants
    initChauffeursFromUsers();
    return;
  }
  try {
    const raw = fs.readFileSync(CHAUFFEURS_FILE, "utf8");
    const loaded = JSON.parse(raw);
    
    // Vérifier que le fichier n'est pas vide ou corrompu
    if (!loaded.chauffeurs) loaded.chauffeurs = [];
    if (!loaded.sousTraitants) loaded.sousTraitants = [];
    
    CHAUFFEURS_MAPPING = loaded;
    
    // Si le fichier était vide mais qu'on a des users DISPATCHER, ajouter leurs ST
    if (CHAUFFEURS_MAPPING.sousTraitants.length === 0) {
      const stFromUsers = USERS
        .filter(u => u.role === 'DISPATCHER' && u.sousTraitantName)
        .map(u => u.sousTraitantName)
        .filter((v, i, a) => a.indexOf(v) === i);
      
      if (stFromUsers.length > 0) {
        CHAUFFEURS_MAPPING.sousTraitants = stFromUsers;
        saveChauffeursToFile();
        log('INFO', 'Sous-traitants ajoutés depuis users', { sousTraitants: stFromUsers });
      }
    }
    
    log('INFO', 'Mapping chauffeurs chargé', { 
      chauffeurCount: CHAUFFEURS_MAPPING.chauffeurs.length,
      sousTraitantCount: CHAUFFEURS_MAPPING.sousTraitants.length
    });
  } catch (e) {
    log('ERROR', 'Erreur chargement chauffeurs', { error: e.message });
    // Ne pas réinitialiser si erreur de parsing - garder les données en mémoire
    if (CHAUFFEURS_MAPPING.chauffeurs.length === 0) {
      initChauffeursFromUsers();
    }
  }
}

function initChauffeursFromUsers() {
  // Extraire les sous-traitants uniques depuis les utilisateurs DISPATCHER
  const sousTraitants = USERS
    .filter(u => u.role === 'DISPATCHER' && u.sousTraitantName)
    .map(u => u.sousTraitantName)
    .filter((v, i, a) => a.indexOf(v) === i); // unique
  
  CHAUFFEURS_MAPPING = {
    chauffeurs: [],
    sousTraitants: sousTraitants
  };
  
  saveChauffeursToFile();
  log('INFO', 'Mapping chauffeurs initialisé depuis users', { sousTraitants });
}

// Trouver le sous-traitant d'un chauffeur (avec fuzzy matching)
function findSousTraitantForChauffeur(chauffeurName) {
  if (!chauffeurName) return null;
  
  const normalized = normalizeDriverName(chauffeurName);
  
  // Recherche exacte d'abord
  const exactMatch = CHAUFFEURS_MAPPING.chauffeurs.find(c => 
    c.normalized === normalized || 
    normalizeDriverName(c.name) === normalized
  );
  
  if (exactMatch) {
    return exactMatch.sousTraitant;
  }
  
  // Recherche fuzzy
  for (const c of CHAUFFEURS_MAPPING.chauffeurs) {
    if (areDriverNamesMatching(chauffeurName, c.name)) {
      return c.sousTraitant;
    }
  }
  
  return null;
}

// Obtenir tous les sous-traitants (depuis les users ET le mapping)
function getAllSousTraitants() {
  const fromUsers = USERS
    .map(u => u.sousTraitantName)
    .filter((name) => name && name !== 'CANIAO');
  
  const fromMapping = CHAUFFEURS_MAPPING.sousTraitants || [];
  
  return [...new Set([...fromUsers, ...fromMapping])]
    .filter(Boolean)
    .sort();
}

// Vérifier si un tracking number existe déjà pour une date donnée
function trackingExistsForDate(trackingNumber, date) {
  if (!trackingNumber || !date) return false;
  const normalizedTracking = trackingNumber.toUpperCase().trim();
  return COLIS.some(c => 
    c.trackingNumber && 
    c.trackingNumber.toUpperCase().trim() === normalizedTracking && 
    c.date === date
  );
}

// Filtrer les colis pour exclure les doublons (même jour)
// Retourne { uniqueColis: [], duplicates: [], duplicatesInFile: [] }
function filterDuplicateTrackings(colisArray, date) {
  // Construire le set des trackings existants pour cette date
  const existingTrackings = new Set(
    COLIS
      .filter(c => c.date === date && c.trackingNumber)
      .map(c => c.trackingNumber.toUpperCase().trim())
  );
  
  console.log(`[DOUBLONS] Date: ${date}, Trackings existants dans BDD: ${existingTrackings.size}`);
  
  const uniqueColis = [];
  const duplicates = []; // Déjà dans la BDD
  const duplicatesInFile = []; // Doublons dans le fichier lui-même
  const seenInFile = new Set();
  
  for (const colis of colisArray) {
    // Essayer plusieurs propriétés pour le tracking
    const tracking = (colis.trackingNumber || colis.code || colis.tracking || '').toUpperCase().trim();
    
    if (!tracking || tracking.length < 5) {
      console.log(`[DOUBLONS] Colis ignoré - tracking invalide:`, colis);
      continue;
    }
    
    // Vérifier si déjà dans la BDD
    if (existingTrackings.has(tracking)) {
      duplicates.push(tracking);
      continue;
    }
    
    // Vérifier si doublon dans le fichier lui-même
    if (seenInFile.has(tracking)) {
      duplicatesInFile.push(tracking);
      continue;
    }
    
    seenInFile.add(tracking);
    // S'assurer que le colis a bien trackingNumber défini
    uniqueColis.push({
      ...colis,
      trackingNumber: tracking
    });
  }
  
  console.log(`[DOUBLONS] Résultat: ${colisArray.length} total → ${uniqueColis.length} uniques, ${duplicates.length} doublons BDD, ${duplicatesInFile.length} doublons fichier`);
  
  return { uniqueColis, duplicates, duplicatesInFile };
}

// Ajouter ou mettre à jour un chauffeur dans le mapping
function addOrUpdateChauffeur(chauffeurName, sousTraitant) {
  const normalized = normalizeDriverName(chauffeurName);
  
  // Chercher si existe déjà
  const existingIndex = CHAUFFEURS_MAPPING.chauffeurs.findIndex(c => 
    c.normalized === normalized || normalizeDriverName(c.name) === normalized
  );
  
  if (existingIndex >= 0) {
    // Mettre à jour
    CHAUFFEURS_MAPPING.chauffeurs[existingIndex] = {
      name: chauffeurName,
      normalized: normalized,
      sousTraitant: sousTraitant,
      updatedAt: new Date().toISOString()
    };
  } else {
    // Ajouter
    CHAUFFEURS_MAPPING.chauffeurs.push({
      name: chauffeurName,
      normalized: normalized,
      sousTraitant: sousTraitant,
      createdAt: new Date().toISOString()
    });
  }
  
  // S'assurer que le sous-traitant est dans la liste
  if (!CHAUFFEURS_MAPPING.sousTraitants.includes(sousTraitant)) {
    CHAUFFEURS_MAPPING.sousTraitants.push(sousTraitant);
  }
  
  saveChauffeursToFile();
  
  log('INFO', 'Chauffeur ajouté/mis à jour', { chauffeur: chauffeurName, sousTraitant });
}

async function createDefaultUsers() {
  const defaultPassword = "1234";
  const hash = await bcrypt.hash(defaultPassword, 10);

  USERS = [
    {
      login: "admin",
      role: "ADMIN",
      passwordHash: hash,
      sousTraitantName: null,
    },
    {
      login: "dispatcheur",
      role: "DISPATCHER",
      passwordHash: hash,
      sousTraitantName: "Sous-traitant A",
    },
    {
      login: "trieur",
      role: "TRIEUR",
      passwordHash: hash,
      sousTraitantName: null,
    },
  ];

  saveUsersToFile();
  log('INFO', 'Utilisateurs par défaut créés');
}

// ==============================
// Authentification
// ==============================
function generateToken(user) {
  // Token aléatoire sécurisé (32 bytes = 64 caractères hex)
  const token = crypto.randomBytes(32).toString('hex');
  
  SESSIONS[token] = {
    token: token,
    userId: user.id,
    login: user.login,
    username: user.login,
    role: user.role,
    sousTraitantName: user.sousTraitantName || null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // Expire dans 24h
  };
  
  saveSessionsToFile();
  return token;
}

function authMiddleware(requiredRoles) {
  return (req, res, next) => {
    let token = null;

    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring("Bearer ".length);
    } else if (req.query && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Token manquant",
      });
    }

    const session = SESSIONS[token];
    if (!session) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Token invalide ou expiré",
      });
    }

    if (requiredRoles && !requiredRoles.includes(session.role)) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Accès refusé pour ce rôle",
      });
    }

    req.user = session;
    next();
  };
}

function requireAdmin(req, res, next) {
  return authMiddleware(["ADMIN"])(req, res, next);
}

// ==============================
// Initialisation
// ==============================
loadUsersFromFile();
loadDataFromFile();
loadSessionsFromFile();
loadChauffeursFromFile(); // Mapping chauffeur → sous-traitant

// ==============================
// Pages web
// ==============================
//app.get("/", (req, res) => {
 // res.sendFile(path.join(__dirname, "import-tour.html"));
//});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/dispatcher", (req, res) => {
  res.sendFile(path.join(__dirname, "dispatcher.html"));
});

// ==============================
// API LOGS (dernières lignes)
// ==============================
app.get("/api/logs", (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return res.json({ lines: [], count: 0 });
    }
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const n = Math.min(parseInt(req.query.n || "200", 10) || 200, 1000);
    const tail = lines.slice(-n);
    res.json({ lines: tail, count: tail.length });
  } catch (e) {
    res.status(500).json({ error: "LOG_READ_ERROR", message: e.message });
  }
});

// ==============================
// API LOGIN
// ==============================
app.post("/api/login", async (req, res) => {
  const { login, password } = req.body || {};

  if (!login || !password) {
    return res.status(400).json({
      error: "BAD_REQUEST",
      message: "login et password sont obligatoires",
    });
  }

  const user = USERS.find((u) => u.login.toLowerCase() === login.toLowerCase());
  if (!user) {
    log('WARN', 'Tentative de connexion échouée', { login });
    return res.status(401).json({
      error: "INVALID_CREDENTIALS",
      message: "Identifiants incorrects",
    });
  }

  let passwordOK = false;

  try {
    if (user.passwordHash) {
      passwordOK = await bcrypt.compare(password, user.passwordHash);
    } else if (user.password) {
      if (user.password === password) {
        const hash = await bcrypt.hash(password, 10);
        user.passwordHash = hash;
        delete user.password;
        saveUsersToFile();
        passwordOK = true;
      }
    }
  } catch (e) {
    log('ERROR', 'Erreur vérification mot de passe', { error: e.message });
    return res.status(500).json({
      error: "AUTH_ERROR",
      message: "Erreur interne lors de la vérification du mot de passe.",
    });
  }

  if (!passwordOK) {
    log('WARN', 'Mot de passe incorrect', { login });
    return res.status(401).json({
      error: "INVALID_CREDENTIALS",
      message: "Identifiants incorrects",
    });
  }

  const token = generateToken(user);
  
  log('INFO', 'Connexion réussie', { login, role: user.role });

  res.json({
    user: {
      id: user.id,
      login: user.login,
      role: user.role,
      sousTraitantName: user.sousTraitantName || null,
    },
    token,
  });
});

// ==============================
// API STATS
// ==============================
app.get("/api/stats/date", (req, res) => {
  const { date } = req.query;

  log('INFO', 'Stats demandées', { date, totalColisInDB: COLIS.length });

  // Si pas de date, retourner le total de tous les colis (dédoublonnés)
  if (!date) {
    // Dédoublonner par tracking
    const uniqueTrackings = new Map();
    for (const c of COLIS) {
      const tracking = c.trackingNumber?.toUpperCase();
      if (!tracking) continue;
      
      // Garder le colis avec le scan le plus récent si déjà existant
      if (!uniqueTrackings.has(tracking)) {
        uniqueTrackings.set(tracking, c);
      } else {
        const existing = uniqueTrackings.get(tracking);
        // Si le nouveau est scanné et pas l'ancien, ou scan plus récent
        if (c.scannedAt && (!existing.scannedAt || c.scannedAt > existing.scannedAt)) {
          uniqueTrackings.set(tracking, c);
        }
      }
    }
    
    const uniqueColis = Array.from(uniqueTrackings.values());
    const scannedColis = uniqueColis.filter((c) => c.scannedAt).length;
    
    return res.json({
      date: null,
      totalColis: uniqueColis.length,
      scannedColis,
      remainingColis: uniqueColis.length - scannedColis
    });
  }

  // Trouver les tournées pour cette date (y compris les tournées CANIAO)
  const toursForDate = TOURS.filter((t) => t.date === date);
  const tourIdsForDate = new Set(toursForDate.map((t) => t.id));

  // Récupérer les colis des tournées de cette date
  const colisForDate = COLIS.filter((c) => tourIdsForDate.has(c.tourId));
  
  // Dédoublonner par tracking pour cette date
  const uniqueTrackings = new Map();
  for (const c of colisForDate) {
    const tracking = c.trackingNumber?.toUpperCase();
    if (!tracking) continue;
    
    // Garder le colis avec le scan le plus récent si déjà existant
    if (!uniqueTrackings.has(tracking)) {
      uniqueTrackings.set(tracking, c);
    } else {
      const existing = uniqueTrackings.get(tracking);
      // Si le nouveau est scanné et pas l'ancien, ou scan plus récent
      if (c.scannedAt && (!existing.scannedAt || c.scannedAt > existing.scannedAt)) {
        uniqueTrackings.set(tracking, c);
      }
    }
  }
  
  const uniqueColis = Array.from(uniqueTrackings.values());
  const totalColis = uniqueColis.length;

  // Compter les colis scannés (uniques)
  const scannedColis = uniqueColis.filter((c) => c.scannedAt).length;

  log('INFO', 'Stats calculées', { 
    date, 
    totalColis, 
    scannedColis, 
    toursCount: toursForDate.length,
    rawColisCount: colisForDate.length,
    uniqueColisCount: uniqueColis.length
  });

  res.json({
    date,
    totalColis,
    scannedColis,
    remainingColis: totalColis - scannedColis
  });
});

// ==============================
// API STATS - Colis non scannés
// ==============================
app.get("/api/stats/unscanned", authMiddleware(["ADMIN", "DISPATCHER"]), (req, res) => {
  try {
    const { date, sousTraitant } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "Date requise" });
    }
    
    // Filtrer par sous-traitant si dispatcher
    const filterSousTraitant = req.user.role === "DISPATCHER" ? req.user.sousTraitantName : sousTraitant;
    
    // Trouver les tournées pour cette date
    let toursForDate = TOURS.filter((t) => t.date === date);
    if (filterSousTraitant) {
      toursForDate = toursForDate.filter(t => t.sousTraitantName === filterSousTraitant);
    }
    const tourIdsForDate = new Set(toursForDate.map((t) => t.id));
    
    // Récupérer les colis des tournées de cette date
    const colisForDate = COLIS.filter((c) => tourIdsForDate.has(c.tourId));
    
    // Dédoublonner par tracking
    const uniqueTrackings = new Map();
    for (const c of colisForDate) {
      const tracking = c.trackingNumber?.toUpperCase();
      if (!tracking) continue;
      
      if (!uniqueTrackings.has(tracking)) {
        uniqueTrackings.set(tracking, c);
      } else {
        const existing = uniqueTrackings.get(tracking);
        if (c.scannedAt && (!existing.scannedAt || c.scannedAt > existing.scannedAt)) {
          uniqueTrackings.set(tracking, c);
        }
      }
    }
    
    // Filtrer les colis NON scannés
    const unscannedColis = Array.from(uniqueTrackings.values()).filter(c => !c.scannedAt);
    
    // Enrichir avec infos de la tournée
    const result = unscannedColis.map(c => {
      const tour = TOURS.find(t => t.id === c.tourId);
      return {
        trackingNumber: c.trackingNumber,
        address: c.address || '',
        chauffeur: tour?.chauffeurName || 'Inconnu',
        sousTraitant: tour?.sousTraitantName || '-',
        tourType: tour?.isCaniao ? 'Cainiao' : 'Gofo'
      };
    });
    
    log('INFO', 'Colis non scannés', { date, count: result.length });
    
    res.json({
      success: true,
      date,
      sousTraitant: filterSousTraitant || null,
      count: result.length,
      colis: result
    });
    
  } catch (err) {
    log('ERROR', 'Erreur colis non scannés', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API STATS - Rapport de suivi des scans
// ==============================
app.get("/api/stats/scan-report", authMiddleware(["ADMIN", "DISPATCHER"]), (req, res) => {
  try {
    const { date, sousTraitant } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "Date requise" });
    }
    
    // Filtrer par sous-traitant si dispatcher
    const filterSousTraitant = req.user.role === "DISPATCHER" ? req.user.sousTraitantName : sousTraitant;
    
    // Trouver les tournées pour cette date
    let toursForDate = TOURS.filter((t) => t.date === date);
    if (filterSousTraitant) {
      toursForDate = toursForDate.filter(t => t.sousTraitantName === filterSousTraitant);
    }
    const tourIdsForDate = new Set(toursForDate.map((t) => t.id));
    
    // Récupérer les colis des tournées de cette date
    const colisForDate = COLIS.filter((c) => tourIdsForDate.has(c.tourId));
    
    // Dédoublonner par tracking - garder le dernier scan
    const uniqueTrackings = new Map();
    for (const c of colisForDate) {
      const tracking = c.trackingNumber?.toUpperCase();
      if (!tracking) continue;
      
      if (!uniqueTrackings.has(tracking)) {
        uniqueTrackings.set(tracking, c);
      } else {
        const existing = uniqueTrackings.get(tracking);
        if (c.scannedAt && (!existing.scannedAt || c.scannedAt > existing.scannedAt)) {
          uniqueTrackings.set(tracking, c);
        }
      }
    }
    
    const uniqueColis = Array.from(uniqueTrackings.values());
    const scannedColis = uniqueColis.filter(c => c.scannedAt);
    const unscannedColis = uniqueColis.filter(c => !c.scannedAt);
    
    // Rapport des scans avec dernier scanneur
    const scannedReport = scannedColis.map(c => {
      const tour = TOURS.find(t => t.id === c.tourId);
      return {
        trackingNumber: c.trackingNumber,
        address: c.address || '',
        chauffeur: tour?.chauffeurName || 'Inconnu',
        lastScannedBy: c.scannedBy || 'Inconnu',
        lastScannedAt: c.scannedAt,
        tourType: tour?.isCaniao ? 'Cainiao' : 'Gofo'
      };
    }).sort((a, b) => new Date(b.lastScannedAt) - new Date(a.lastScannedAt)); // Plus récent en premier
    
    // Rapport des non-scannés
    const unscannedReport = unscannedColis.map(c => {
      const tour = TOURS.find(t => t.id === c.tourId);
      return {
        trackingNumber: c.trackingNumber,
        address: c.address || '',
        chauffeur: tour?.chauffeurName || 'Inconnu',
        sousTraitant: tour?.sousTraitantName || '-',
        tourType: tour?.isCaniao ? 'Cainiao' : 'Gofo'
      };
    });
    
    // Stats par scanneur
    const scannerStats = {};
    for (const c of scannedColis) {
      const scanner = c.scannedBy || 'Inconnu';
      if (!scannerStats[scanner]) {
        scannerStats[scanner] = 0;
      }
      scannerStats[scanner]++;
    }
    
    log('INFO', 'Rapport de scan', { 
      date, 
      totalUnique: uniqueColis.length,
      scanned: scannedColis.length,
      unscanned: unscannedColis.length
    });
    
    res.json({
      success: true,
      date,
      sousTraitant: filterSousTraitant || null,
      summary: {
        totalUnique: uniqueColis.length,
        scanned: scannedColis.length,
        unscanned: unscannedColis.length,
        progressPercent: uniqueColis.length > 0 ? Math.round((scannedColis.length / uniqueColis.length) * 100) : 0
      },
      scannerStats,
      scannedColis: scannedReport,
      unscannedColis: unscannedReport
    });
    
  } catch (err) {
    log('ERROR', 'Erreur rapport scan', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API SCAN
// ==============================
app.post("/api/scan", async (req, res) => {
  const { trackingNumber, date } = req.body || {};

  if (!trackingNumber) {
    return res.status(400).json({
      error: "MISSING_TRACKING_NUMBER",
      message: "trackingNumber est requis",
    });
  }

  // Nettoyer le numéro scanné : enlever HD, espaces, points-virgules
  let searchNumber = trackingNumber.toUpperCase().trim();
  searchNumber = searchNumber.replace(/\s+/g, ''); // Enlever les espaces
  searchNumber = searchNumber.replace(/;+/g, '');  // Enlever les ;
  
  // Extraire la partie principale (sans suffixe HD)
  const searchBase = searchNumber.replace(/HD$/i, '');
  
  log('INFO', 'Scan demandé', { 
    original: trackingNumber, 
    searchNumber, 
    searchBase,
    date 
  });

  // Fonction pour comparer les codes
  const matchesCode = (colis) => {
    let colisNum = (colis.code || colis.numeroColis || colis.trackingNumber || "").toUpperCase().trim();
    colisNum = colisNum.replace(/\s+/g, '').replace(/;+/g, '');
    const colisBase = colisNum.replace(/HD$/i, '');
    
    // Comparer les deux versions (avec et sans HD)
    return colisNum === searchNumber || 
           colisBase === searchBase ||
           colisNum === searchBase ||
           colisBase === searchNumber;
  };

  // PRIORITÉ 1: Recherche dans les tournées DISPATCHER
  let found = COLIS.find((c) => {
    const tour = TOURS.find(t => t.id === c.tourId);
    const isDispatcherTour = tour && tour.isDispatcherImport === true;
    return isDispatcherTour && matchesCode(c);
  });

  if (found) {
    log('INFO', 'Colis trouvé dans tournée dispatcher (priorité)', { 
      trackingNumber: searchNumber,
      tourId: found.tourId
    });
  }

  // PRIORITÉ 2: Recherche dans les tournées NORMALES admin (non-CANIAO, non-dispatcher)
  if (!found) {
    found = COLIS.find((c) => {
      const tour = TOURS.find(t => t.id === c.tourId);
      const isNormalAdminTour = tour && !tour.isCaniao && !tour.isDispatcherImport;
      return isNormalAdminTour && matchesCode(c);
    });

    if (found) {
      log('INFO', 'Colis trouvé dans tournée normale admin', { 
        trackingNumber: searchNumber,
        tourId: found.tourId
      });
    }
  }

  // Si date fournie et colis trouvé, vérifier la date aussi
  if (found && date) {
    const tour = TOURS.find(t => t.id === found.tourId);
    if (tour && tour.date && tour.date !== date) {
      // Chercher un autre colis avec la bonne date (même priorité)
      const tourType = tour.isDispatcherImport ? 'dispatcher' : (!tour.isCaniao ? 'normal' : null);
      
      const foundWithDate = COLIS.find((c) => {
        const t = TOURS.find(t => t.id === c.tourId);
        if (!t || t.date !== date) return false;
        
        if (tourType === 'dispatcher') {
          return t.isDispatcherImport === true && matchesCode(c);
        } else if (tourType === 'normal') {
          return !t.isCaniao && !t.isDispatcherImport && matchesCode(c);
        }
        return false;
      });
      
      if (foundWithDate) {
        found = foundWithDate;
      }
    }
  }

  // PRIORITÉ 3: Si non trouvé, recherche dans les tournées CANIAO (fallback)
  if (!found) {
    found = COLIS.find((c) => {
      const tour = TOURS.find(t => t.id === c.tourId);
      const isCanaioTour = tour && tour.isCaniao === true;
      return isCanaioTour && matchesCode(c);
    });

    if (found) {
      log('INFO', 'Colis trouvé dans CANIAO (fallback)', { 
        trackingNumber: searchNumber,
        tourId: found.tourId
      });
    }
  }

  if (!found) {
    log('WARN', 'Colis non trouvé', { 
      trackingNumber: searchNumber, 
      searchBase,
      totalColis: COLIS.length 
    });
    return res.status(404).json({
      error: "COLIS_NOT_FOUND",
      message: "Colis introuvable dans les tournées importées",
    });
  }

  // Récupérer les infos de la tournée
  const tour = TOURS.find(t => t.id === found.tourId);

  // Marquer comme scanné et SAUVEGARDER
  found.scannedAt = new Date().toISOString();
  found.scannedBy = req.user?.login || 'unknown';
  found.scanned = true;
  
  const saved = saveDataToFile();
  if (!saved) {
    log('ERROR', 'Échec sauvegarde après scan', { trackingNumber: searchNumber });
  }

  log('INFO', 'Colis scanné avec succès', { 
    trackingNumber: searchNumber, 
    orderNumber: found.numeroOrdre || found.orderNumber || '#',
    chauffeur: tour ? tour.chauffeurName : 'N/A',
    isCaniao: tour ? tour.isCaniao : false,
    isDispatcherImport: tour ? tour.isDispatcherImport : false,
    saved 
  });

  // Calculer le numéro d'ordre à afficher
  const orderNum = found.numeroOrdre || found.orderNumber;
  const isDispatcherImport = tour && tour.isDispatcherImport === true;
  const isCaniao = tour && tour.isCaniao === true;
  
  // Règles d'affichage :
  // 1. Tournée dispatcher → toujours afficher le numéro
  // 2. Tournée CANIAO → toujours afficher "#"
  // 3. Tournée normale admin sans numéro → afficher "#"
  const displayOrder = isDispatcherImport ? (orderNum || "#") : (isCaniao ? "#" : (orderNum || "#"));

  // Réponse compatible avec le frontend
  res.json({
    trackingNumber: found.code || found.numeroColis || found.trackingNumber,
    orderNumber: displayOrder,
    chauffeurName: tour ? tour.chauffeurName : 'N/A',
    sousTraitantName: tour ? tour.sousTraitantName : 'N/A',
    tourName: tour ? (tour.tourneeName || `${tour.chauffeurName} - ${tour.date}`) : 'N/A',
    address: found.adresse || found.address,
    date: tour ? tour.date : (found.date || null),
    scannedAt: found.scannedAt,
    scannedBy: found.scannedBy,
    isCaniao: isCaniao,
    isDispatcherImport: isDispatcherImport
  });
});

// ==============================
// API TOURS
// ==============================
app.get("/api/tours", authMiddleware(null), (req, res) => {
  const { date, sousTraitant, isCaniaoOnly } = req.query;
  const user = req.user;

  // Cas CANIAO explicite : ignorer le filtre sous-traitant dispatcher pour qu'ils voient la liste CANIAO
  if (isCaniaoOnly === 'true') {
    let filtered = TOURS.filter((t) => t.isCaniao === true);

    // Admin peut encore filtrer par date
    if (date && typeof date === "string") {
      filtered = filtered.filter((t) => t.date === date);
    }

    log('INFO', 'Liste tournées demandée', { 
      role: user.role, 
      sousTraitant: user.sousTraitantName,
      filteredCount: filtered.length,
      isCaniaoOnly: true
    });

    return res.json({
      tours: filtered,
      count: filtered.length
    });
  }

  // Cas normal (non CANIAO)
  // D'abord exclure les tournées CANIAO si isCaniaoOnly est explicitement false
  let filtered = [...TOURS];
  if (isCaniaoOnly === 'false') {
    filtered = filtered.filter((t) => t.isCaniao !== true);
  }

  // Filtre par rôle pour dispatcher
  if (user.role === "DISPATCHER" && user.sousTraitantName) {
    filtered = filtered.filter((t) => t.sousTraitantName === user.sousTraitantName);
  }
  
  // Filtre par sous-traitant pour l'admin
  if (user.role === "ADMIN" && sousTraitant && sousTraitant !== "TOUS") {
    filtered = filtered.filter((t) => t.sousTraitantName === sousTraitant);
  }

  // Filtre par date
  if (date && typeof date === "string") {
    filtered = filtered.filter((t) => t.date === date);
  }

  log('INFO', 'Liste tournées demandée', { 
    role: user.role, 
    sousTraitant: user.sousTraitantName,
    filteredCount: filtered.length 
  });

  res.json({
    tours: filtered,
    count: filtered.length
  });
});

// ==============================
// API IMPORT CANIAO - Créer plusieurs tournées depuis un fichier CANIAO
// ==============================
app.post(
  "/api/tours/caniao",
  authMiddleware(["ADMIN"]),
  upload.single("file"),
  async (req, res) => {
    try {
      const uploaded = req.file;

      if (!uploaded) {
        return res.status(400).json({
          error: "NO_FILE",
          message: "Aucun fichier fourni",
        });
      }

      log('INFO', 'Import CANIAO démarré', { filename: uploaded.originalname });

      // Lire le PDF avec pdfplumber (même logique que les tournées normales)
      log('INFO', 'Parsing PDF CANIAO avec pdfplumber');
      const allColis = await parsePDFWithPython(uploaded.path);
      
      if (allColis.length === 0) {
        fs.unlinkSync(uploaded.path);
        return res.status(400).json({
          error: "NO_COLIS",
          message: "Aucun colis trouvé dans le fichier CANIAO"
        });
      }

      log('INFO', 'Colis CANIAO extraits', { totalColis: allColis.length });

      // Extraire les plages de chauffeurs depuis les numéros d'ordre
      // Les colis sont déjà parsés avec orderNumber, on doit détecter les plages
      const dataBuffer = fs.readFileSync(uploaded.path);
      const pdfParse = require("pdf-parse");
      const pdfData = await pdfParse(dataBuffer);
      const text = pdfData.text;
      
      // Nettoyer le texte : enlever retours à la ligne et espaces multiples
      const cleanedText = text
        .replace(/\r\n/g, ' ')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Trouver la section header (avant "Powered by Spoke" ou les 500 premiers caractères)
      const spokeIndex = cleanedText.indexOf('Powered by Spoke');
      const headerSection = spokeIndex > 0 ? cleanedText.substring(0, spokeIndex) : cleanedText.substring(0, 500);
      
      log('INFO', 'Header CANIAO nettoyé', { headerSection: headerSection.substring(0, 300) });
      
      const plages = [];
      const seenRanges = new Set();
      
      // Fonction pour ajouter une plage validée
      function addPlage(nom, debutStr, finStr) {
        const chauffeur = nom.trim();
        const debut = parseInt(debutStr, 10);
        const fin = parseInt(finStr, 10);
        const rangeKey = `${debut}-${fin}`;
        
        // Validation
        if (
          chauffeur.length >= 2 &&
          chauffeur.length < 50 &&
          !/^\d+$/.test(chauffeur) &&
          !seenRanges.has(rangeKey) &&
          debut < fin &&
          fin - debut < 500 &&
          !['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'déc', 'jan', 'fév', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov'].includes(chauffeur.toLowerCase())
        ) {
          const normalizedName = chauffeur.charAt(0).toUpperCase() + chauffeur.slice(1).toLowerCase();
          plages.push({
            chauffeur: normalizedName,
            debut: debut,
            fin: fin
          });
          seenRanges.add(rangeKey);
          log('INFO', 'Plage détectée', { chauffeur: normalizedName, debut, fin });
        }
      }
      
      // MÉTHODE 1: Format (Nom début-fin) - parenthèses autour du tout
      const regex1 = /\(([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\-_']*)\s*(\d+)\s*-\s*(\d+)\)?/gi;
      let match;
      while ((match = regex1.exec(headerSection)) !== null) {
        addPlage(match[1], match[2], match[3]);
      }
      
      // MÉTHODE 2: Format Nom (début-fin) ou Nom (début- fin) - nom avant parenthèse
      const regex2 = /([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\-_']*)\s*\(\s*(\d+)\s*-\s*(\d+)\s*\)/gi;
      while ((match = regex2.exec(headerSection)) !== null) {
        addPlage(match[1], match[2], match[3]);
      }
      
      // MÉTHODE 3: Format simplifié Nom début-fin (sans parenthèses du tout)
      const regex3 = /(?:^|[\s\)])([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\-_']*)\s+(\d+)\s*-\s*(\d+)(?=[\s\(]|$)/gi;
      while ((match = regex3.exec(headerSection)) !== null) {
        addPlage(match[1], match[2], match[3]);
      }
      
      // Trier les plages par numéro de début
      plages.sort((a, b) => a.debut - b.debut);

      log('INFO', 'Plages extraites', { count: plages.length, plages });

      // Utiliser la date fournie dans la requête, sinon extraire du nom de fichier, sinon date du jour
      let tourDate = req.body.date || new Date().toISOString().split('T')[0];
      
      // Si pas de date dans le body, essayer d'extraire du nom de fichier
      if (!req.body.date) {
        const dateMatch = uploaded.originalname.match(/(\d{1,2})[_\-](\d{1,2})/);
        if (dateMatch) {
          const day = dateMatch[1].padStart(2, '0');
          const month = dateMatch[2].padStart(2, '0');
          const year = new Date().getFullYear();
          tourDate = `${year}-${month}-${day}`;
        }
      }

      log('INFO', 'Date tournée CANIAO', { tourDate, source: req.body.date ? 'requête' : 'fichier/défaut' });

      // Vérifier si tous les chauffeurs sont connus
      const unknownChauffeurs = [];
      const chauffeursSousTraitants = {}; // Cache chauffeur → sous-traitant
      
      for (const plage of plages) {
        const { chauffeur } = plage;
        
        // Chercher le sous-traitant associé
        const foundST = findSousTraitantForChauffeur(chauffeur);
        
        if (foundST) {
          chauffeursSousTraitants[chauffeur] = foundST;
        } else {
          // Chauffeur inconnu
          if (!unknownChauffeurs.find(u => u.chauffeur === chauffeur)) {
            unknownChauffeurs.push({
              chauffeur: chauffeur,
              plage: `${plage.debut}-${plage.fin}`
            });
          }
        }
      }
      
      // Si des chauffeurs sont inconnus, demander l'association
      if (unknownChauffeurs.length > 0) {
        // Supprimer le fichier temporaire
        if (fs.existsSync(uploaded.path)) {
          fs.unlinkSync(uploaded.path);
        }
        
        // Préparer les infos pour le modal
        const existingChauffeurs = CHAUFFEURS_MAPPING.chauffeurs.map(c => ({
          name: c.name,
          sousTraitant: c.sousTraitant,
          normalized: c.normalized
        }));
        
        // Chercher les chauffeurs similaires pour chaque inconnu
        for (const unknown of unknownChauffeurs) {
          const newNormalized = normalizeDriverName(unknown.chauffeur);
          unknown.similarChauffeurs = existingChauffeurs.filter(c => {
            return c.normalized.includes(newNormalized.substring(0, 3)) ||
                   newNormalized.includes(c.normalized.substring(0, 3)) ||
                   levenshteinDistance(c.normalized, newNormalized) <= 3;
          });
        }
        
        return res.status(400).json({
          error: "UNKNOWN_CHAUFFEURS",
          message: `${unknownChauffeurs.length} chauffeur(s) inconnu(s). Veuillez les associer à leurs sous-traitants.`,
          unknownChauffeurs: unknownChauffeurs,
          sousTraitants: getAllSousTraitants(),
          existingChauffeurs: existingChauffeurs,
          // Infos pour ré-import après association
          filename: uploaded.originalname,
          tourDate: tourDate,
          plagesCount: plages.length,
          totalColis: allColis.length
        });
      }

      // Créer une tournée pour chaque plage (tous les chauffeurs sont connus)
      const createdTours = [];

      for (const plage of plages) {
        const { chauffeur, debut, fin } = plage;
        const sousTraitantName = chauffeursSousTraitants[chauffeur] || null;
        
        // Filtrer les colis de cette plage par numéro d'ordre
        const colisDePlage = allColis.filter(c => {
          const order = c.orderNumber;
          return order >= debut && order <= fin;
        });
        
        if (colisDePlage.length === 0) {
          log('WARN', 'Aucun colis pour plage', { chauffeur, debut, fin });
          continue;
        }

        // Filtrer les doublons pour cette plage
        const { uniqueColis, duplicates, duplicatesInFile } = filterDuplicateTrackings(colisDePlage, tourDate);
        
        if (uniqueColis.length === 0) {
          log('WARN', 'Tous les colis sont des doublons pour plage', { 
            chauffeur, debut, fin, 
            duplicatesCount: duplicates.length 
          });
          continue;
        }

        // Trier par numéro d'ordre
        uniqueColis.sort((a, b) => a.orderNumber - b.orderNumber);

        // Créer la tournée avec le sous-traitant associé
        const tourId = NEXT_TOUR_ID++;
        const newTour = {
          id: tourId,
          chauffeurName: chauffeur,
          sousTraitantName: sousTraitantName,  // Maintenant on assigne le sous-traitant !
          date: tourDate,
          isCaniao: true,
          colisCount: uniqueColis.length,
          createdAt: new Date().toISOString()
        };
        TOURS.push(newTour);

        // Créer les colis avec le sous-traitant
        const createdColis = [];
        for (const colisData of uniqueColis) {
          const colisId = NEXT_COLIS_ID++;
          const newColis = {
            id: colisId,
            tourId: tourId,
            date: tourDate,
            chauffeurName: chauffeur,
            sousTraitantName: sousTraitantName,  // Sous-traitant assigné !
            orderNumber: colisData.orderNumber,
            trackingNumber: colisData.trackingNumber,
            address: colisData.address || "",
            city: colisData.city || "",
            estimatedTime: colisData.estimatedTime || "",
            scanned: false,
            scannedAt: null,
            scannedBy: null
          };
          COLIS.push(newColis);
          createdColis.push(newColis);
        }

        const duplicatesTotal = duplicates.length + duplicatesInFile.length;
        createdTours.push({
          tour: newTour,
          colisCount: createdColis.length,
          plage: `${debut}-${fin}`,
          duplicatesIgnored: duplicatesTotal
        });

        // Créer le backup admin (le Cainiao PDF est toujours importé par l'admin)
        createAdminTourBackup(newTour, createdColis, 'ADMIN');

        log('INFO', 'Tournée CANIAO créée', { 
          chauffeur, 
          tourId, 
          colisCount: createdColis.length,
          duplicatesIgnored: duplicatesTotal,
          plage: `${debut}-${fin}`
        });
      }

      // Sauvegarder
      saveDataToFile();

      // Supprimer le fichier uploadé
      fs.unlinkSync(uploaded.path);

      // Calculer le total de doublons ignorés
      const totalDuplicatesIgnored = createdTours.reduce((sum, t) => sum + (t.duplicatesIgnored || 0), 0);
      const totalColisImported = createdTours.reduce((sum, t) => sum + t.colisCount, 0);
      
      let message = `${createdTours.length} tournées CANIAO créées: ${totalColisImported} colis`;
      if (totalDuplicatesIgnored > 0) {
        message += ` (${totalDuplicatesIgnored} doublons ignorés)`;
      }

      res.json({
        success: true,
        message: message,
        tours: createdTours,
        totalColisImported: totalColisImported,
        totalDuplicatesIgnored: totalDuplicatesIgnored
      });

    } catch (err) {
      log('ERROR', 'Erreur import CANIAO', { error: err.message, stack: err.stack });
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({
        error: "IMPORT_ERROR",
        message: "Erreur lors de l'import CANIAO : " + err.message
      });
    }
  }
);

// ==============================
// API IMPORT CANIAO EXCEL (uni-chauffeur) - AVEC AUTO-DISPATCH
// ==============================
app.post(
  "/api/tours/import/caniao-excel",
  authMiddleware(["ADMIN"]),
  upload.single("file"),
  async (req, res) => {
    try {
      const uploaded = req.file;
      let { date, sousTraitantName } = req.body;

      // Validation
      if (!uploaded) {
        return res.status(400).json({
          error: "NO_FILE",
          message: "Aucun fichier fourni",
        });
      }

      if (!date) {
        return res.status(400).json({
          error: "MISSING_DATE",
          message: "La date est requise",
        });
      }

      // Extraire le nom du chauffeur du nom de fichier
      const chauffeurName = extractChauffeurFromFilename(uploaded.originalname);
      
      // AUTO-DISPATCH : Si pas de sous-traitant spécifié, chercher dans le mapping
      if (!sousTraitantName || sousTraitantName.trim() === '') {
        const foundST = findSousTraitantForChauffeur(chauffeurName);
        
        if (foundST) {
          sousTraitantName = foundST;
          log('INFO', 'Cainiao Excel auto-dispatch: sous-traitant trouvé', { chauffeur: chauffeurName, sousTraitant: foundST });
        } else {
          // Chauffeur inconnu - chercher les chauffeurs similaires pour proposer une fusion
          const existingChauffeurs = CHAUFFEURS_MAPPING.chauffeurs.map(c => ({
            name: c.name,
            sousTraitant: c.sousTraitant,
            normalized: c.normalized
          }));
          
          // Chercher les chauffeurs potentiellement similaires (pour suggestion)
          const similarChauffeurs = existingChauffeurs.filter(c => {
            const newNormalized = normalizeDriverName(chauffeurName);
            return c.normalized.includes(newNormalized.substring(0, 3)) ||
                   newNormalized.includes(c.normalized.substring(0, 3)) ||
                   levenshteinDistance(c.normalized, newNormalized) <= 3;
          });
          
          // Supprimer le fichier temporaire
          if (fs.existsSync(uploaded.path)) {
            fs.unlinkSync(uploaded.path);
          }
          
          // Demander l'association
          return res.status(400).json({
            error: "UNKNOWN_CHAUFFEUR",
            message: `Chauffeur "${chauffeurName}" inconnu. Veuillez l'associer à un sous-traitant ou à un chauffeur existant.`,
            chauffeur: chauffeurName,
            filename: uploaded.originalname,
            needsAssociation: true,
            sousTraitants: getAllSousTraitants(),
            existingChauffeurs: existingChauffeurs,
            similarChauffeurs: similarChauffeurs
          });
        }
      }
      
      log('INFO', 'Import Cainiao Excel démarré', { 
        file: uploaded.originalname,
        chauffeur: chauffeurName,
        sousTraitant: sousTraitantName 
      });

      // Déterminer le type de fichier
      const ext = path.extname(uploaded.originalname).toLowerCase();
      let colisData = [];

      if (ext === '.pdf') {
        // Parser le PDF Cainiao
        log('INFO', 'Cainiao PDF détecté, utilisation de pdfplumber', { file: uploaded.originalname });
        colisData = await parsePDFWithPython(uploaded.path);
        
        // Supprimer le fichier temporaire
        if (fs.existsSync(uploaded.path)) {
          fs.unlinkSync(uploaded.path);
        }
      } else {
        // Lire le fichier Excel depuis le disque
        const fileBuffer = fs.readFileSync(uploaded.path);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        // Supprimer le fichier temporaire
        fs.unlinkSync(uploaded.path);

        if (jsonData.length < 2) {
          return res.status(400).json({
            error: "EMPTY_FILE",
            message: "Le fichier Excel est vide ou n'a pas de données"
          });
        }

        // Trouver les colonnes tracking et adresse
        const headers = jsonData[0].map(h => String(h || '').toLowerCase().trim());
        console.log('Cainiao Excel headers:', headers);

        // Chercher la colonne tracking (flexible)
        let trackingColIndex = headers.findIndex(h => 
          h.includes('tracking') || 
          h.includes('numero') || 
          h.includes('numéro') ||
          h.includes('colis') ||
          h.includes('package') ||
          h.includes('waybill')
        );

        // Chercher la colonne adresse (flexible)
        let addressColIndex = headers.findIndex(h => 
          h.includes('address') || 
          h.includes('adresse') || 
          h.includes('receiver') ||
          h.includes('destinataire') ||
          h.includes('detail') ||
          h.includes('street')
        );

        // Chercher la colonne ville (flexible)
        let cityColIndex = headers.findIndex(h => 
          h.includes('city') || 
          h.includes('ville') || 
          h.includes('town') ||
          h.includes('commune') ||
          h.includes('localité') ||
          h.includes('locality')
        );

        console.log('Tracking col index:', trackingColIndex, 'Address col index:', addressColIndex, 'City col index:', cityColIndex);

        if (trackingColIndex === -1) {
          return res.status(400).json({
            error: "MISSING_TRACKING_COLUMN",
            message: "Colonne tracking non trouvée. Attendu: 'Tracking No.', 'Numéro', 'Colis', 'waybill', etc."
          });
        }

        if (addressColIndex === -1) {
          return res.status(400).json({
            error: "MISSING_ADDRESS_COLUMN",
            message: "Colonne adresse non trouvée. Attendu: 'Receiver's Detail Address', 'Adresse', 'street', etc."
          });
        }

        // Extraire les colis
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          const tracking = String(row[trackingColIndex] || '').trim();
          const address = String(row[addressColIndex] || '').trim();
          const city = cityColIndex !== -1 ? String(row[cityColIndex] || '').trim() : '';

          if (tracking && tracking.length > 5) {
            colisData.push({
              trackingNumber: tracking.toUpperCase(),
              address: address,
              city: city
            });
          }
        }
      }

      console.log('Colis trouvés dans le fichier:', colisData.length);

      if (colisData.length === 0) {
        return res.status(400).json({
          error: "NO_COLIS",
          message: "Aucun colis trouvé dans le fichier"
        });
      }

      // Filtrer les doublons (déjà importés ce jour-là ou doublons dans le fichier)
      const { uniqueColis, duplicates, duplicatesInFile } = filterDuplicateTrackings(colisData, date);
      
      log('INFO', 'Filtrage doublons Cainiao', {
        total: colisData.length,
        unique: uniqueColis.length,
        duplicatesInDB: duplicates.length,
        duplicatesInFile: duplicatesInFile.length
      });

      if (uniqueColis.length === 0) {
        return res.status(400).json({
          error: "ALL_DUPLICATES",
          message: `Tous les ${colisData.length} colis sont déjà importés pour cette date.`,
          duplicatesCount: duplicates.length,
          duplicatesInFileCount: duplicatesInFile.length
        });
      }

      // Créer la tournée Cainiao avec les colis uniques
      const tourId = NEXT_TOUR_ID++;
      const newTour = {
        id: tourId,
        chauffeurName: chauffeurName,
        sousTraitantName: sousTraitantName,
        date: date,
        isCaniao: true,
        colisCount: uniqueColis.length,
        sourceFile: uploaded.filename,
        sourceOriginalName: uploaded.originalname,
        createdAt: new Date().toISOString(),
        createdBy: req.user.login
      };
      TOURS.push(newTour);

      // Créer les colis (uniquement les uniques)
      const createdColis = [];
      for (let i = 0; i < uniqueColis.length; i++) {
        const colisId = NEXT_COLIS_ID++;
        const newColis = {
          id: colisId,
          tourId: tourId,
          date: date,
          chauffeurName: chauffeurName,
          sousTraitantName: sousTraitantName,
          orderNumber: i + 1,
          trackingNumber: uniqueColis[i].trackingNumber,
          address: uniqueColis[i].address,
          city: uniqueColis[i].city || "",
          scanned: false,
          scannedAt: null,
          scannedBy: null
        };
        COLIS.push(newColis);
        createdColis.push(newColis);
      }

      // Créer le backup si c'est un admin qui importe
      if (req.user.role === 'ADMIN') {
        createAdminTourBackup(newTour, createdColis, req.user.role);
        
        // Mémoriser l'association chauffeur → sous-traitant pour les prochains imports
        const existingMapping = findSousTraitantForChauffeur(chauffeurName);
        if (!existingMapping) {
          addOrUpdateChauffeur(chauffeurName, sousTraitantName);
          log('INFO', 'Chauffeur mémorisé automatiquement (Cainiao Excel)', { chauffeur: chauffeurName, sousTraitant: sousTraitantName });
        }
      }

      // Sauvegarder
      saveDataToFile();

      log('INFO', 'Import Cainiao Excel réussi', {
        chauffeur: chauffeurName,
        tourId: tourId,
        colisCount: createdColis.length,
        duplicatesIgnored: duplicates.length + duplicatesInFile.length,
        user: req.user.login
      });

      // Construire le message
      let message = `Tournée Cainiao créée pour ${chauffeurName}: ${createdColis.length} colis`;
      if (duplicates.length > 0 || duplicatesInFile.length > 0) {
        message += ` (${duplicates.length + duplicatesInFile.length} doublons ignorés)`;
      }

      res.json({
        success: true,
        message: message,
        tour: newTour,
        colisCount: createdColis.length,
        duplicatesIgnored: duplicates.length,
        duplicatesInFileIgnored: duplicatesInFile.length,
        autoDispatched: !req.body.sousTraitantName || req.body.sousTraitantName.trim() === ''
      });

    } catch (err) {
      console.error('Erreur import Cainiao Excel:', err);
      log('ERROR', 'Erreur import Cainiao Excel', { error: err.message, stack: err.stack });
      // Supprimer le fichier temporaire en cas d'erreur
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({
        error: "IMPORT_ERROR",
        message: "Erreur lors de l'import Cainiao Excel : " + err.message
      });
    }
  }
);

// ==============================
// API IMPORT TOURNÉE (AMÉLIORÉ)
// ==============================
app.post(
  "/api/tours/import",
  authMiddleware(["ADMIN", "DISPATCHER"]),
  upload.single("file"),
  async (req, res) => {
    try {
      const uploaded = req.file;
      let { date, sousTraitantName } = req.body;

      // Validation
      if (!uploaded) {
        return res.status(400).json({
          error: "NO_FILE",
          message: "Aucun fichier fourni",
        });
      }

      if (!date) {
        return res.status(400).json({
          error: "MISSING_DATE",
          message: "La date est requise",
        });
      }

      // Extraire le nom du chauffeur du nom de fichier
      const chauffeurName = extractChauffeurFromFilename(uploaded.originalname);
      
      // AUTO-DISPATCH : Si ADMIN et pas de sous-traitant spécifié, chercher dans le mapping
      if (req.user.role === 'ADMIN' && (!sousTraitantName || sousTraitantName.trim() === '')) {
        const foundST = findSousTraitantForChauffeur(chauffeurName);
        
        if (foundST) {
          sousTraitantName = foundST;
          log('INFO', 'Auto-dispatch: sous-traitant trouvé', { chauffeur: chauffeurName, sousTraitant: foundST });
        } else {
          // Chauffeur inconnu - chercher les chauffeurs similaires pour proposer une fusion
          const existingChauffeurs = CHAUFFEURS_MAPPING.chauffeurs.map(c => ({
            name: c.name,
            sousTraitant: c.sousTraitant,
            normalized: c.normalized
          }));
          
          // Chercher les chauffeurs potentiellement similaires (pour suggestion)
          const similarChauffeurs = existingChauffeurs.filter(c => {
            const newNormalized = normalizeDriverName(chauffeurName);
            // Vérifier si le début ou la fin correspondent
            return c.normalized.includes(newNormalized.substring(0, 3)) ||
                   newNormalized.includes(c.normalized.substring(0, 3)) ||
                   levenshteinDistance(c.normalized, newNormalized) <= 3;
          });
          
          // Demander l'association
          return res.status(400).json({
            error: "UNKNOWN_CHAUFFEUR",
            message: `Chauffeur "${chauffeurName}" inconnu. Veuillez l'associer à un sous-traitant ou à un chauffeur existant.`,
            chauffeur: chauffeurName,
            filename: uploaded.originalname,
            needsAssociation: true,
            sousTraitants: getAllSousTraitants(),
            existingChauffeurs: existingChauffeurs,
            similarChauffeurs: similarChauffeurs
          });
        }
      } else if (req.user.role === 'DISPATCHER') {
        // DISPATCHER : utiliser son propre sous-traitant
        sousTraitantName = req.user.sousTraitantName;
      } else if (!sousTraitantName || sousTraitantName.trim() === '') {
        return res.status(400).json({
          error: "MISSING_SOUS_TRAITANT",
          message: "Le sous-traitant est requis",
        });
      }
      
      // Générer le nom de la tournée automatiquement
      const tourneeName = `${chauffeurName} - ${date}`;

      log('INFO', 'Import tournée démarré', { 
        file: uploaded.originalname,
        chauffeur: chauffeurName,
        sousTraitant: sousTraitantName 
      });

      // Lecture du fichier
      let colisForTour = [];
      const ext = path.extname(uploaded.originalname).toLowerCase();
      
      console.log('========================================');
      console.log('DEBUG IMPORT - Route /api/tours/import');
      console.log('Fichier:', uploaded.originalname);
      console.log('Extension détectée:', ext);
      console.log('Path:', uploaded.path);
      console.log('========================================');

      if (ext === ".pdf") {
        // Fichier PDF - utiliser pdfplumber (Python) pour extraire les tableaux
        log('INFO', 'PDF détecté, utilisation de pdfplumber', { file: uploaded.originalname });
        colisForTour = await parsePDFWithPython(uploaded.path);
      } else if (ext === ".xlsx" || ext === ".xls") {
        // Fichier Excel - utiliser le parsing Excel
        log('INFO', 'Fichier Excel détecté', { file: uploaded.originalname });
        colisForTour = parseExcelColis(uploaded.path);
      } else {
        // Fichier texte
        const textContent = fs.readFileSync(uploaded.path, "utf8");
        colisForTour = parseSpokeColis(textContent);
      }

      if (colisForTour.length === 0) {
        log('WARN', 'Aucun colis détecté dans le fichier', { file: uploaded.originalname });
        return res.status(400).json({
          error: "PARSE_ERROR",
          message: "Aucun colis détecté dans le fichier",
        });
      }

      // Filtrer les doublons (déjà importés ce jour-là ou doublons dans le fichier)
      const { uniqueColis, duplicates, duplicatesInFile } = filterDuplicateTrackings(colisForTour, date);
      
      log('INFO', 'Filtrage doublons Gofo', {
        total: colisForTour.length,
        unique: uniqueColis.length,
        duplicatesInDB: duplicates.length,
        duplicatesInFile: duplicatesInFile.length
      });

      if (uniqueColis.length === 0) {
        return res.status(400).json({
          error: "ALL_DUPLICATES",
          message: `Tous les ${colisForTour.length} colis sont déjà importés pour cette date.`,
          duplicatesCount: duplicates.length,
          duplicatesInFileCount: duplicatesInFile.length
        });
      }

      // Création de la tournée avec les colis uniques
      const newTourId = NEXT_TOUR_ID++;
      
      const newTour = {
        id: newTourId,
        date,
        chauffeurName,
        sousTraitantName,
        tourneeName,
        colisCount: uniqueColis.length,
        sourceFile: uploaded.filename,
        sourceOriginalName: uploaded.originalname,
        createdAt: new Date().toISOString(),
        createdBy: req.user.login
      };

      TOURS.push(newTour);

      // Création des colis (uniquement les uniques)
      for (const c of uniqueColis) {
        const newColis = {
          id: NEXT_COLIS_ID++,
          tourId: newTourId,
          date,
          chauffeurName,
          sousTraitantName,
          tourName: tourneeName,
          orderNumber: c.orderNumber,
          trackingNumber: c.trackingNumber,
          address: c.address,
          city: c.city || '',
          estimatedTime: c.estimatedTime || "",
          scannedAt: null,
          scannedBy: null
        };
        COLIS.push(newColis);
      }

      // Créer le backup si c'est un admin qui importe
      if (req.user.role === 'ADMIN') {
        const tourColis = COLIS.filter(c => c.tourId === newTourId);
        createAdminTourBackup(newTour, tourColis, req.user.role);
        
        // Mémoriser l'association chauffeur → sous-traitant pour les prochains imports
        const existingMapping = findSousTraitantForChauffeur(chauffeurName);
        if (!existingMapping) {
          addOrUpdateChauffeur(chauffeurName, sousTraitantName);
          log('INFO', 'Chauffeur mémorisé automatiquement', { chauffeur: chauffeurName, sousTraitant: sousTraitantName });
        }
      }

      // Sauvegarde
      saveDataToFile();

      log('INFO', 'Tournée importée avec succès', { 
        tourId: newTourId,
        colisCount: uniqueColis.length,
        duplicatesIgnored: duplicates.length + duplicatesInFile.length
      });

      // Construire le message de réponse
      let message = `Tournée créée: ${uniqueColis.length} colis`;
      if (duplicates.length > 0 || duplicatesInFile.length > 0) {
        message += ` (${duplicates.length + duplicatesInFile.length} doublons ignorés)`;
      }

      res.json({
        status: "ok",
        message: message,
        tour: newTour,
        colisCount: uniqueColis.length,
        duplicatesIgnored: duplicates.length,
        duplicatesInFileIgnored: duplicatesInFile.length,
        autoDispatched: req.body.sousTraitantName !== sousTraitantName // indique si auto-dispatch
      });
    } catch (e) {
      log('ERROR', 'Erreur import tournée', { error: e.message, stack: e.stack });
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Erreur interne lors de l'import",
      });
    }
  }
);

// ==============================
// Fonction de parsing spécifique pour CANIAO PDF
// ==============================
function parseCanaioColisFromPDF(textContent) {
  const colis = [];
  
  log('INFO', 'Parsing CANIAO PDF démarré', { textLength: textContent.length });
  
  // Normaliser les sauts de ligne
  let text = textContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Normaliser les codes tracking avec HD
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})\s+HD\s*;?/gi, '$1HD;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})HD\s*;/gi, '$1HD;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})H\s*D\s*;?/gi, '$1HD;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})H\s*\n\s*D\s*;?/gi, '$1HD;');
  
  // Format CANIAO ligne par ligne : numéro ordre adresse heure tracking
  // Exemple: "1 215, Rue Ledru Rollin, Reims, 51100 01:37 CNFR9010444203870HD;"
  const linePattern = /^(\d{1,3})\s+(.+?)\s+(\d{2}:\d{2})\s+([A-Z]{2,4}FR\d{10,20}(?:HD)?);?/gm;
  
  let match;
  let orderNumber = 0;
  
  while ((match = linePattern.exec(text)) !== null) {
    orderNumber = parseInt(match[1], 10);
    const address = match[2].trim();
    const time = match[3];
    const tracking = match[4].toUpperCase();
    
    colis.push({
      orderNumber: orderNumber,
      code: tracking,
      address: address,
      estimatedTime: time
    });
    
    console.log('DEBUG', 'Ligne CANIAO parsée', { orderNumber, address: address.substring(0, 50), tracking });
  }
  
  log('INFO', 'Pattern ligne par ligne CANIAO trouvé', { count: colis.length });
  
  // Si le pattern ligne par ligne ne fonctionne pas, fallback sur l'ancienne méthode
  if (colis.length === 0) {
    log('WARN', 'Pattern ligne par ligne CANIAO échoué, fallback sur méthode legacy');
    
    // Format legacy découvert dans caniao 09_12.pdf :
    // Ligne 1 : Adresse avec heure à la fin (ex: "1215, Rue Ledru Rollin, Reims, 5110001:37")
    // Ligne 2 : Code tracking (ex: "CNFR90104442038")
    // Ligne 3 : Numéro + HD; (ex: "70HD;")
    
    // Regex pour capturer : Code tracking suivi de \n puis numéro + HD;
    const trackingRegex = /([A-Z]{2,4}FR\d{10,15})\n(\d+)HD;/g;
    orderNumber = 0;
    
    while ((match = trackingRegex.exec(text)) !== null) {
      orderNumber++;
      const trackingCode = match[1] + match[2] + 'HD'; // Ex: CNFR9010444203870HD
      
      // Extraire l'adresse : chercher en arrière depuis le code tracking
      const beforeTracking = text.substring(Math.max(0, match.index - 200), match.index);
      
      // L'adresse se termine par l'heure (HH:MM) juste avant le code tracking
      const addressMatch = beforeTracking.match(/([^\n]+\d{2}:\d{2})\s*$/);
      let address = 'Adresse non trouvée';
      
      if (addressMatch) {
        // Nettoyer l'adresse
        address = addressMatch[1].trim().replace(/\s+/g, ' ');
        // Supprimer les numéros d'ordre du début si présents
        address = address.replace(/^\d+\s*,?\s*/, '');
      }
      
      colis.push({
        orderNumber: orderNumber,
        code: trackingCode,
        address: address
      });
    }
  }
  
  log('INFO', 'Parsing CANIAO terminé', { total: colis.length, sample: colis.slice(0, 3) });
  return colis;
}

// ==============================
// Fonction de parsing améliorée (TOUS FORMATS)
// ==============================
function parseSpokeColis(textContent) {
  const colisForTour = [];

  log('INFO', 'Parsing Spoke démarré', { textLength: textContent.length });

  // Normaliser les sauts de ligne et espaces
  let text = textContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Certains PDF concatènent la ville et l'horaire sans espace (ex: "Marne02:32").
  // On insère un espace avant l'heure pour rétablir le format attendu.
  text = text.replace(/([A-Za-zÀ-ÿ0-9])(\d{2}:\d{2})/g, '$1 $2');
  
  // Beaucoup de PDF Spoke exportent sur 3 lignes : adresse+heure, tracking, puis "HD;".
  // On regroupe ces lignes pour que le pattern ligne par ligne fonctionne à nouveau.
  text = text.replace(/(\d{2}:\d{2})\s*\n\s*([A-Z]{2,4}FR\d{10,20})\s*\n\s*HD;?/gi, '$1 $2HD;');
  text = text.replace(/(\d{2}:\d{2})\s*\n\s*([A-Z]{2,4}FR\d{10,20}HD);?/gi, '$1 $2;');
  
  // NORMALISER : coller le "HD" et les espaces dans les codes tracking
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})\s+H\s*D\s*;?/gi, '$1HD;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})HD\s*;/gi, '$1HD;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})H\s+D\s*;?/gi, '$1HD;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})H\s*\n\s*D\s*;?/gi, '$1HD;');
  
  // Pattern pour une ligne complète : numéro adresse heure tracking
  // Note: Dans ce PDF, il n'y a PAS de numéro d'ordre séparé. Le premier chiffre/groupe de chiffres
  // fait partie de l'adresse (numéro de rue). On utilisera des numéros séquentiels.
  // Format réel: "19 Rue George Sand, Reims, Reims, Marne 02:32 GFFR25335063469158;"
  // On capture: adresse complète, heure, tracking
  const linePattern = /^(\d+[^\d].+?)\s+(\d{2}:\d{2})\s*([A-Z]{2,4}FR\d{10,25}(?:HD)?);?/gm;
  
  let match;
  let sequentialOrder = 0;
  while ((match = linePattern.exec(text)) !== null) {
    sequentialOrder++;
    const address = match[1].trim();
    const time = match[2];
    const tracking = match[3].toUpperCase();
    
    colisForTour.push({
      orderNumber: sequentialOrder,
      address: address,
      trackingNumber: tracking,
      estimatedTime: time
    });
    
    console.log('DEBUG', 'Ligne Spoke parsée', { orderNumber: sequentialOrder, address: address.substring(0, 50), tracking });
  }
  
  log('INFO', 'Pattern ligne par ligne trouvé', { count: colisForTour.length });
  
  // Si le pattern ligne par ligne ne fonctionne pas, fallback sur l'ancienne méthode
  if (colisForTour.length === 0) {
    log('WARN', 'Pattern ligne par ligne échoué, fallback sur extraction basique');
    
    // Extraire tous les trackings et assigner des numéros séquentiels
    const trackingRegex = /([A-Z]{2,4}FR\d{10,20}(?:HD)?)/gi;
    const allTracking = text.match(trackingRegex) || [];
    const uniqueTracking = [...new Set(allTracking.map(t => t.toUpperCase()))];
    
    log('INFO', 'Numéros tracking trouvés (fallback)', { count: uniqueTracking.length, sample: uniqueTracking.slice(0, 5) });
    
    // Créer un map tracking -> {adresse, orderNumber}
    const trackingToData = {};
    
    // Essayer d'extraire contexte pour chaque tracking
    for (const tracking of uniqueTracking) {
      const trackingIndex = text.toUpperCase().indexOf(tracking);
      if (trackingIndex > 0) {
        // Prendre 300 caractères avant le tracking
        const before = text.substring(Math.max(0, trackingIndex - 300), trackingIndex);
        
        // Essayer d'extraire un numéro d'ordre et une adresse
        let orderNumber = null;
        let address = null;
        
        // Chercher une adresse dans le contexte
        const addressPatterns = [
          /(\d+[A-Za-z]?\s+(?:rue|avenue|boulevard|allée|place|impasse|chemin|passage|esplanade|quai|cours)[^,\n]{5,80}(?:,\s*[A-Za-zÀ-ÿ\s\-']{2,50})?(?:,\s*[A-Za-zÀ-ÿ]{2,30})?)/gi,
          /(\d+[A-Za-z]?,?\s*[A-Za-zÀ-ÿ\s\-']{5,60},\s*[A-Za-zÀ-ÿ]{2,30})/gi,
        ];
        
        for (const pattern of addressPatterns) {
          const matches = before.match(pattern);
          if (matches && matches.length > 0) {
            address = matches[matches.length - 1].trim();
            if (address.length > 10 && address.length < 200) {
              break;
            }
          }
        }
        
        if (address) {
          trackingToData[tracking] = {
            address: address,
            orderNumber: null // Sera assigné séquentiellement
          };
          console.log('DEBUG', 'Adresse trouvée (fallback)', { 
            address: address.substring(0, 70), 
            tracking
          });
        }
      }
    }
    
    // Construire la liste des colis avec les données trouvées
    for (let i = 0; i < uniqueTracking.length; i++) {
      const tracking = uniqueTracking[i];
      const data = trackingToData[tracking] || {};
      
      colisForTour.push({
        orderNumber: i + 1, // Numéro séquentiel en fallback
        address: data.address || "Adresse non extraite",
        trackingNumber: tracking,
      });
    }
  }

  log('INFO', 'Parsing Spoke terminé', { 
    total: colisForTour.length, 
    premier: colisForTour[0],
    dernier: colisForTour[colisForTour.length - 1]
  });

  return colisForTour;
}

// ==============================
// Fonction de parsing Excel (.xlsx)
// ==============================
function parseExcelColis(filePath) {
  const colisForTour = [];
  
  log('INFO', 'Parsing Excel démarré', { file: filePath });
  
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // Convertir en JSON
    const data = XLSX.utils.sheet_to_json(sheet);
    console.log('=== DEBUG EXCEL ===');
    console.log('Nombre de lignes:', data.length);
    console.log('Colonnes brutes:', JSON.stringify(Object.keys(data[0] || {})));
    console.log('Première ligne complète:', JSON.stringify(data[0]));
    // Afficher les codes de caractères des noms de colonnes pour détecter les caractères invisibles
    if (data[0]) {
      Object.keys(data[0]).forEach(key => {
        console.log(`Colonne "${key}" -> codes:`, [...key].map(c => c.charCodeAt(0)));
      });
    }
    log('INFO', 'Excel parsé', { lignes: data.length, colonnes: Object.keys(data[0] || {}) });

    // Définir les variantes acceptées pour chaque champ
    const trackingKeys = [
      'data.waybillNo', 'waybillNo', 'Numéro de suivi', 'Tracking', 'Numéro suivi', 'N° suivi', 'N° de suivi', 'N°', 'N° colis', 'Colis', 'AWB', 'AWB No', 'AWB Number', 'Numéro', 'Tracking Number', 'Tracking #', 'Waybill', 'Waybill Number', 'Code Tracking', 'Code tracking', 'code tracking', 'code Tracking', 'codeTracking', 'code_Tracking', 'code-tracking'
    ];
    const addressKeys = [
      'data.toStreet', 'toStreet', 'Adresse', 'Adress', 'Address', 'Adresse livraison', 'Adresse de livraison', 'Adresse client', 'Street', 'Delivery Address', 'Adresse destinataire', 'Adresse complète', 'Adresse complète livraison'
    ];
    const cityKeys = [
      'Ville', 'City', 'Ville livraison', 'Ville de livraison', 'Ville destinataire', 'Commune', 'Localité', 'Locality', 'Town', 'data.toCity', 'toCity', 'ville', 'city', 'data.tocity'
    ];

    // Fonction utilitaire pour trouver la première clé présente
    function findValue(row, keys) {
      // On mappe les clés du row en version normalisée (trim + lower)
      const normalizedRow = {};
      for (const k in row) {
        if (Object.hasOwn(row, k)) {
          normalizedRow[k.trim().toLowerCase()] = row[k];
        }
      }
      for (const key of keys) {
        const normKey = key.trim().toLowerCase();
        if (normalizedRow[normKey] && normalizedRow[normKey].toString().trim()) {
          return normalizedRow[normKey];
        }
      }
      return '';
    }

    // Parcourir les lignes
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const tracking = findValue(row, trackingKeys);
      const address = findValue(row, addressKeys) || 'Adresse non disponible';
      const city = findValue(row, cityKeys) || '';
      // Log les 3 premières lignes pour debug
      if (i < 3) {
        console.log(`=== Ligne ${i} ===`);
        console.log('Row brute:', JSON.stringify(row));
        console.log('Tracking trouvé:', tracking);
        console.log('Address trouvé:', address);
        console.log('City trouvé:', city);
      }
      if (tracking && tracking.toString().trim()) {
        colisForTour.push({
          orderNumber: "#",  // Pas de numéro d'ordre dans ce format
          trackingNumber: tracking.toString().trim().toUpperCase(),
          address: address.toString().trim(),
          city: city.toString().trim()
        });
      }
    }
    console.log('=== RÉSULTAT FINAL ===');
    console.log('Colis détectés:', colisForTour.length);

    log('INFO', 'Parsing Excel terminé', {
      total: colisForTour.length,
      premier: colisForTour[0],
      dernier: colisForTour[colisForTour.length - 1]
    });
  } catch (e) {
    log('ERROR', 'Erreur parsing Excel', { error: e.message });
  }
  
  return colisForTour;
}

// ==============================
// API SUPPRESSION TOURNÉE
// ==============================
app.delete("/api/tours/:id", authMiddleware(["ADMIN", "DISPATCHER"]), (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  
  const tourIndex = TOURS.findIndex((t) => t.id === tourId);
  if (tourIndex === -1) {
    return res.status(404).json({
      error: "TOUR_NOT_FOUND",
      message: "Tournée introuvable",
    });
  }

  const tour = TOURS[tourIndex];

  // Vérifier si c'est une tournée CANIAO
  if (tour.isCaniao === true && req.user.role !== "ADMIN") {
    return res.status(403).json({
      error: "FORBIDDEN",
      message: "Seul l'administrateur peut supprimer les tournées CANIAO",
    });
  }

  // Vérifier les droits pour DISPATCHER
  if (req.user.role === "DISPATCHER") {
    if (tour.sousTraitantName !== req.user.sousTraitantName) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Vous ne pouvez supprimer que vos propres tournées",
      });
    }
  }

  // Supprimer la tournée
  TOURS.splice(tourIndex, 1);

  // Supprimer les colis associés
  const removedColisCount = COLIS.filter((c) => c.tourId === tourId).length;
  COLIS = COLIS.filter((c) => c.tourId !== tourId);

  saveDataToFile();

  log('INFO', 'Tournée supprimée', { 
    tourId,
    tourName: tour.tourneeName,
    isCaniao: tour.isCaniao,
    deletedBy: req.user.login 
  });

  res.json({ 
    removedTour: tour,
    removedColis: removedColisCount
  });
});

// ==============================
// Gestion utilisateurs (ADMIN)
// ==============================
app.get("/api/users", requireAdmin, (req, res) => {
  const list = USERS.map((u) => ({
    login: u.login,
    role: u.role,
    sousTraitantName: u.sousTraitantName || null,
  }));
  res.json(list);
});

// Route publique pour obtenir la liste des sous-traitants (pour les dropdowns)
app.get("/api/sous-traitants", authMiddleware(), (req, res) => {
  // Combiner les sous-traitants des users ET du mapping chauffeurs
  const fromUsers = USERS
    .map(u => u.sousTraitantName)
    .filter((name) => name && name !== 'CANIAO');
  
  const fromMapping = CHAUFFEURS_MAPPING.sousTraitants || [];
  
  const allSousTraitants = [...new Set([...fromUsers, ...fromMapping])]
    .filter(Boolean)
    .sort();
  
  res.json({ sousTraitants: allSousTraitants });
});

// ==============================
// API GESTION SOUS-TRAITANTS (ADMIN)
// ==============================
app.post("/api/sous-traitants", requireAdmin, (req, res) => {
  const { name } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({
      error: "MISSING_NAME",
      message: "Le nom du sous-traitant est requis"
    });
  }
  
  const cleanName = name.trim();
  
  // Vérifier si existe déjà
  if (CHAUFFEURS_MAPPING.sousTraitants.includes(cleanName)) {
    return res.status(409).json({
      error: "ALREADY_EXISTS",
      message: "Ce sous-traitant existe déjà"
    });
  }
  
  // Ajouter
  CHAUFFEURS_MAPPING.sousTraitants.push(cleanName);
  saveChauffeursToFile();
  
  log('INFO', 'Sous-traitant créé', { name: cleanName, by: req.user.login });
  
  res.json({
    success: true,
    message: `Sous-traitant "${cleanName}" créé`,
    sousTraitant: cleanName
  });
});

app.delete("/api/sous-traitants/:name", requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  
  const index = CHAUFFEURS_MAPPING.sousTraitants.indexOf(name);
  if (index === -1) {
    return res.status(404).json({
      error: "NOT_FOUND",
      message: "Sous-traitant introuvable"
    });
  }
  
  // Vérifier qu'aucun chauffeur n'est assigné
  const chauffeursAssigned = CHAUFFEURS_MAPPING.chauffeurs.filter(c => c.sousTraitant === name);
  if (chauffeursAssigned.length > 0) {
    return res.status(400).json({
      error: "HAS_CHAUFFEURS",
      message: `Impossible de supprimer: ${chauffeursAssigned.length} chauffeur(s) assigné(s)`,
      chauffeurs: chauffeursAssigned.map(c => c.name)
    });
  }
  
  // Supprimer
  CHAUFFEURS_MAPPING.sousTraitants.splice(index, 1);
  saveChauffeursToFile();
  
  log('INFO', 'Sous-traitant supprimé', { name, by: req.user.login });
  
  res.json({
    success: true,
    message: `Sous-traitant "${name}" supprimé`
  });
});

// ==============================
// API GESTION CHAUFFEURS (ADMIN)
// ==============================
app.get("/api/chauffeurs", authMiddleware(["ADMIN", "DISPATCHER"]), (req, res) => {
  const { sousTraitant } = req.query;
  
  let chauffeurs = CHAUFFEURS_MAPPING.chauffeurs;
  
  // Filtrer par sous-traitant si demandé
  if (sousTraitant) {
    chauffeurs = chauffeurs.filter(c => c.sousTraitant === sousTraitant);
  }
  
  // Si DISPATCHER, ne montrer que ses chauffeurs
  if (req.user.role === 'DISPATCHER' && req.user.sousTraitantName) {
    chauffeurs = chauffeurs.filter(c => c.sousTraitant === req.user.sousTraitantName);
  }
  
  res.json({
    chauffeurs: chauffeurs,
    sousTraitants: getAllSousTraitants()
  });
});

app.post("/api/chauffeurs", requireAdmin, (req, res) => {
  const { name, sousTraitant } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({
      error: "MISSING_NAME",
      message: "Le nom du chauffeur est requis"
    });
  }
  
  if (!sousTraitant || !sousTraitant.trim()) {
    return res.status(400).json({
      error: "MISSING_SOUS_TRAITANT",
      message: "Le sous-traitant est requis"
    });
  }
  
  const cleanName = name.trim();
  const cleanST = sousTraitant.trim();
  
  // Vérifier si existe déjà
  const normalized = normalizeDriverName(cleanName);
  const existing = CHAUFFEURS_MAPPING.chauffeurs.find(c => c.normalized === normalized);
  
  if (existing) {
    return res.status(409).json({
      error: "ALREADY_EXISTS",
      message: `Ce chauffeur existe déjà (assigné à ${existing.sousTraitant})`
    });
  }
  
  // Ajouter
  addOrUpdateChauffeur(cleanName, cleanST);
  
  res.json({
    success: true,
    message: `Chauffeur "${cleanName}" assigné à "${cleanST}"`,
    chauffeur: {
      name: cleanName,
      normalized: normalized,
      sousTraitant: cleanST
    }
  });
});

app.put("/api/chauffeurs/:name", requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const { sousTraitant, newName } = req.body;
  
  const normalized = normalizeDriverName(name);
  const index = CHAUFFEURS_MAPPING.chauffeurs.findIndex(c => 
    c.normalized === normalized || normalizeDriverName(c.name) === normalized
  );
  
  if (index === -1) {
    return res.status(404).json({
      error: "NOT_FOUND",
      message: "Chauffeur introuvable"
    });
  }
  
  // Mettre à jour
  if (sousTraitant) {
    CHAUFFEURS_MAPPING.chauffeurs[index].sousTraitant = sousTraitant.trim();
  }
  if (newName) {
    CHAUFFEURS_MAPPING.chauffeurs[index].name = newName.trim();
    CHAUFFEURS_MAPPING.chauffeurs[index].normalized = normalizeDriverName(newName.trim());
  }
  CHAUFFEURS_MAPPING.chauffeurs[index].updatedAt = new Date().toISOString();
  
  saveChauffeursToFile();
  
  log('INFO', 'Chauffeur mis à jour', { 
    original: name, 
    newName: newName || name,
    sousTraitant: sousTraitant || CHAUFFEURS_MAPPING.chauffeurs[index].sousTraitant,
    by: req.user.login 
  });
  
  res.json({
    success: true,
    message: "Chauffeur mis à jour",
    chauffeur: CHAUFFEURS_MAPPING.chauffeurs[index]
  });
});

app.delete("/api/chauffeurs/:name", requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  
  const normalized = normalizeDriverName(name);
  const index = CHAUFFEURS_MAPPING.chauffeurs.findIndex(c => 
    c.normalized === normalized || normalizeDriverName(c.name) === normalized
  );
  
  if (index === -1) {
    return res.status(404).json({
      error: "NOT_FOUND",
      message: "Chauffeur introuvable"
    });
  }
  
  const removed = CHAUFFEURS_MAPPING.chauffeurs.splice(index, 1)[0];
  saveChauffeursToFile();
  
  log('INFO', 'Chauffeur supprimé', { name: removed.name, sousTraitant: removed.sousTraitant, by: req.user.login });
  
  res.json({
    success: true,
    message: `Chauffeur "${removed.name}" supprimé`,
    removed: removed
  });
});

// API pour trouver le sous-traitant d'un chauffeur (utilisé lors de l'import)
app.get("/api/chauffeurs/lookup/:name", authMiddleware(["ADMIN"]), (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const sousTraitant = findSousTraitantForChauffeur(name);
  
  res.json({
    chauffeur: name,
    sousTraitant: sousTraitant,
    found: sousTraitant !== null
  });
});

app.post("/api/users", requireAdmin, async (req, res) => {
  const { login, password, role, sousTraitantName } = req.body;

  if (!login || !password || !role) {
    return res.status(400).json({
      error: "MISSING_FIELDS",
      message: "login, password et role sont obligatoires",
    });
  }

  const allowedRoles = ["ADMIN", "DISPATCHER", "TRIEUR"];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({
      error: "INVALID_ROLE",
      message: `Role invalide. Roles possibles : ${allowedRoles.join(", ")}`,
    });
  }

  if (USERS.find((u) => u.login === login)) {
    return res.status(409).json({
      error: "LOGIN_EXISTS",
      message: "Ce login existe déjà",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = {
      login,
      role,
      // Admin ne peut pas avoir de sous-traitant
      sousTraitantName: role === 'ADMIN' ? null : (sousTraitantName || null),
      passwordHash,
    };

    USERS.push(newUser);
    saveUsersToFile();

    log('INFO', 'Utilisateur créé', { login, role });

    res.status(201).json({
      login: newUser.login,
      role: newUser.role,
      sousTraitantName: newUser.sousTraitantName,
    });
  } catch (e) {
    log('ERROR', 'Erreur création utilisateur', { error: e.message });
    res.status(500).json({
      error: "USER_CREATE_ERROR",
      message: "Erreur interne",
    });
  }
});

// Supprimer un utilisateur (ADMIN)
app.delete("/api/users/:login", requireAdmin, (req, res) => {
  const login = req.params.login;

  // Empêcher la suppression du seul ADMIN restant
  const admins = USERS.filter(u => u.role === 'ADMIN');
  const isTargetAdmin = USERS.find(u => u.login === login && u.role === 'ADMIN');
  if (isTargetAdmin && admins.length <= 1) {
    return res.status(400).json({
      error: "ONLY_ADMIN_PROTECTION",
      message: "Impossible de supprimer l'unique administrateur. Créez un autre ADMIN avant."
    });
  }

  const idx = USERS.findIndex((u) => u.login === login);
  if (idx === -1) {
    return res.status(404).json({
      error: "USER_NOT_FOUND",
      message: "Utilisateur introuvable",
    });
  }

  const removed = USERS.splice(idx, 1)[0];
  try {
    saveUsersToFile();
  } catch (e) {
    log('ERROR', 'Erreur sauvegarde après suppression utilisateur', { error: e.message, login });
  }

  log('INFO', 'Utilisateur supprimé', { login, deletedBy: req.user.login });

  res.json({
    login: removed.login,
    role: removed.role,
    sousTraitantName: removed.sousTraitantName || null,
  });
});

// Mettre à jour un utilisateur (ADMIN)
app.put("/api/users/:login", requireAdmin, async (req, res) => {
  const login = req.params.login;
  const { login: newLogin, role, sousTraitantName, password } = req.body || {};

  const user = USERS.find((u) => u.login === login);
  if (!user) {
    return res.status(404).json({
      error: "USER_NOT_FOUND",
      message: "Utilisateur introuvable",
    });
  }

  // Si le login change, vérifier unicité et mettre à jour
  if (newLogin && newLogin !== login) {
    if (USERS.find(u => u.login === newLogin)) {
      return res.status(409).json({
        error: "LOGIN_EXISTS",
        message: "Ce login existe déjà"
      });
    }
    user.login = newLogin;
  }

  // Mettre à jour rôle
  if (role) {
    const allowedRoles = ["ADMIN", "DISPATCHER", "TRIEUR"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        error: "INVALID_ROLE",
        message: `Role invalide. Roles possibles : ${allowedRoles.join(", ")}`,
      });
    }

    // Protection: empêcher qu'un admin change son propre rôle si c'est l'unique admin
    const isSelfUpdate = req.user && req.user.login === login;
    if (isSelfUpdate) {
      const currentUser = USERS.find(u => u.login === login);
      const admins = USERS.filter(u => u.role === 'ADMIN');
      const isCurrentAdmin = currentUser && currentUser.role === 'ADMIN';
      const roleBecomesNonAdmin = role !== 'ADMIN';
      if (isCurrentAdmin && roleBecomesNonAdmin && admins.length <= 1) {
        return res.status(400).json({
          error: "ONLY_ADMIN_PROTECTION",
          message: "Impossible de retirer le rôle ADMIN au seul administrateur. Créez un autre ADMIN avant."
        });
      }
    }
    user.role = role;
  }

  // Mettre à jour sous-traitant (chaîne ou null)
  if (typeof sousTraitantName !== "undefined") {
    // Admin ne peut pas avoir de sous-traitant
    const effectiveRole = role || user.role;
    user.sousTraitantName = effectiveRole === 'ADMIN' ? null : (sousTraitantName || null);
  }

  // Optionnel: changer le mot de passe
  if (password && typeof password === "string" && password.length > 0) {
    try {
      user.passwordHash = await bcrypt.hash(password, 10);
    } catch (e) {
      log('ERROR', 'Erreur hash mot de passe', { error: e.message, login });
      return res.status(500).json({
        error: "PASSWORD_HASH_ERROR",
        message: "Erreur interne lors du changement de mot de passe",
      });
    }
  }

  try {
    saveUsersToFile();
  } catch (e) {
    log('ERROR', 'Erreur sauvegarde après mise à jour utilisateur', { error: e.message, login });
  }

  log('INFO', 'Utilisateur mis à jour', { login: user.login, updatedBy: req.user.login });

  res.json({
    login: user.login,
    role: user.role,
    sousTraitantName: user.sousTraitantName || null,
  });
});

// ==============================
// ROUTE PROFIL - Modifier son propre mot de passe
// ==============================
app.put("/api/profile/password", authMiddleware(["ADMIN", "DISPATCHER", "TRIEUR"]), async (req, res) => {
  const { password } = req.body || {};
  const user = req.user;

  if (!password || typeof password !== "string" || password.length < 4) {
    return res.status(400).json({
      error: "INVALID_PASSWORD",
      message: "Le mot de passe doit faire au moins 4 caractères",
    });
  }

  // Trouver l'utilisateur dans la base
  const userRecord = USERS.find((u) => u.login === user.login);
  if (!userRecord) {
    return res.status(404).json({
      error: "USER_NOT_FOUND",
      message: "Utilisateur introuvable",
    });
  }

  try {
    userRecord.passwordHash = await bcrypt.hash(password, 10);
    saveUsersToFile();
    
    log('INFO', 'Mot de passe modifié', { login: user.login });
    
    res.json({
      success: true,
      message: "Mot de passe modifié avec succès",
    });
  } catch (e) {
    log('ERROR', 'Erreur modification mot de passe', { error: e.message, login: user.login });
    return res.status(500).json({
      error: "PASSWORD_HASH_ERROR",
      message: "Erreur lors du changement de mot de passe",
    });
  }
});

// ==============================
// ROUTES DISPATCHER (API MOBILE)
// ==============================

// Liste des tournées du dispatcher
app.get("/api/dispatcher/tours", authMiddleware(["DISPATCHER"]), (req, res) => {
  const { date } = req.query;
  const user = req.user;

  let filtered = TOURS.filter((t) => t.sousTraitantName === user.sousTraitantName);

  if (date && typeof date === "string") {
    filtered = filtered.filter((t) => t.date === date);
  }

  log('INFO', 'Dispatcher: liste tournées', { 
    dispatcher: user.login,
    sousTraitant: user.sousTraitantName,
    count: filtered.length 
  });

  res.json({
    tours: filtered,
    count: filtered.length
  });
});

// Détail d'une tournée du dispatcher
app.get("/api/dispatcher/tours/:id", authMiddleware(["DISPATCHER"]), (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const user = req.user;

  const tour = TOURS.find((t) => t.id === tourId && t.sousTraitantName === user.sousTraitantName);

  if (!tour) {
    return res.status(404).json({
      error: "TOUR_NOT_FOUND",
      message: "Tournée non trouvée ou accès non autorisé"
    });
  }

  const colis = COLIS.filter((c) => c.tourId === tourId);

  res.json({
    tour,
    colis,
    colisCount: colis.length
  });
});

// Téléchargement de tournée au format Excel (Dispatcher et Admin)
app.get("/api/dispatcher/tours/:id/download", (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  console.log("USERS au début:", USERS.length, "utilisateurs");
  // Récupérer le token depuis Authorization ou query, puis nettoyer
  let token = null;
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring("Bearer ".length);
  } else if (req.query && typeof req.query.token === "string") {
    token = req.query.token;
  }
  if (typeof token === "string") token = token.trim();

  log('INFO', 'Tentative de téléchargement', { 
    tourId, 
    hasToken: !!token,
    tokenLength: token ? token.length : 0,
    sessionsCount: Object.keys(SESSIONS).length
  });

  // Vérifier le token manuellement car on ne peut pas utiliser authMiddleware avec query params
  if (!token) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Token manquant"
    });
  }

  // Décoder le token et vérifier l'utilisateur (double stratégie: clé directe puis recherche par champ)
  let session = SESSIONS[token];
  if (!session) {
    session = Object.values(SESSIONS).find((s) => s && (s.token === token));
  }

  // DEBUG détaillé demandé
  console.log("=== DEBUG DOWNLOAD ===");
  console.log("Session:", session);
  console.log("Session userId:", session ? session.userId : null, "type:", session && session.userId != null ? typeof session.userId : null);
  console.log("USERS:", USERS);
  console.log("User found (==):", USERS.find(u => u.id == (session ? session.userId : null)));
  
  log('INFO', 'Recherche session', { 
    found: !!session,
    username: session ? session.username : null
  });
  
  if (!session) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Session invalide"
    });
  }

  // Trouver l'utilisateur en étant tolérant aux anciennes sessions (sans username/token)
  console.log("=== RECHERCHE USER ===");
  console.log("Session trouvée:", session);
  console.log("Recherche user avec userId:", session ? session.userId : null);
  console.log("Type de userId:", session && session.userId != null ? typeof session.userId : null);
  console.log("USERS array:", JSON.stringify(USERS, null, 2));
  const user = USERS.find(u => u.id == (session ? session.userId : null));
  console.log("User trouvé:", user);

  // DEBUG utilisateur résolu
  console.log("User resolved (strict):", user);

  // Fallback: si utilisateur introuvable, reconstruire depuis la session pour ne pas bloquer le téléchargement
  let effectiveUser = user;
  if (!effectiveUser && session) {
    effectiveUser = {
      id: session.userId != null ? parseInt(session.userId, 10) : undefined,
      login: session.username || session.login || 'unknown',
      role: session.role || 'DISPATCHER',
      sousTraitantName: session.sousTraitantName || null
    };
    console.log("User reconstructed from session:", effectiveUser);
  }
  if (!effectiveUser) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Utilisateur non trouvé"
    });
  }

  // Trouver la tournée
  const tour = TOURS.find((t) => t.id === tourId);
  if (!tour) {
    return res.status(404).json({
      error: "TOUR_NOT_FOUND",
      message: "Tournée non trouvée"
    });
  }

  // Vérifier les droits d'accès (sauf pour les tournées CANIAO qui sont accessibles à tous)
  if (effectiveUser.role === "DISPATCHER" && !tour.isCaniao && tour.sousTraitantName !== effectiveUser.sousTraitantName) {
    return res.status(403).json({
      error: "FORBIDDEN",
      message: "Accès refusé à cette tournée"
    });
  }

  // Si la tournée provient d'un Excel, renvoyer le fichier source tel quel
  const sourcePath = tour.sourceFile ? path.join(uploadsDir, tour.sourceFile) : null;
  const hasExcelSource = sourcePath && fs.existsSync(sourcePath) && /\.xlsx?$/i.test(sourcePath);
  if (hasExcelSource) {
    const downloadName = tour.sourceOriginalName || tour.sourceFile || `${tour.tourneeName || tour.chauffeurName || 'tournee'}.xlsx`;
    log('INFO', 'Tournée téléchargée (fichier source)', { tourId, user: effectiveUser.login, role: effectiveUser.role, source: tour.sourceFile });
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.sendFile(sourcePath);
  }

  // Récupérer les colis de la tournée
  const colis = COLIS.filter((c) => c.tourId === tourId);

  // Créer le fichier Excel
  const workbook = XLSX.utils.book_new();
  
  // Préparer les données pour Excel (format simplifié)
  const excelData = colis.map((c, index) => {
    const tracking = (c.trackingNumber || c.code || "").replace(/;$/, ''); // Retirer le point-virgule final
    const orderNum = c.orderNumber || (index + 1);
    const address = c.address || "";
    const time = c.estimatedTime || "";

    return {
      "#": orderNum,
      "Address": address,
      "Time": time,
      "Tracking": tracking
    };
  });

  // Créer la feuille
  const worksheet = XLSX.utils.json_to_sheet(excelData);

  // Définir la largeur des colonnes
  worksheet['!cols'] = [
    { wch: 5 },   // #
    { wch: 50 },  // Address
    { wch: 8 },   // Time
    { wch: 22 }   // Tracking
  ];

  // Ajouter la feuille au classeur
  XLSX.utils.book_append_sheet(workbook, worksheet, "Tournée");

  // Générer le nom du fichier
  const chauffeurClean = (tour.chauffeurName || 'tournee').toLowerCase().replace(/[^a-z0-9]/gi, '');
  const dateParts = tour.date.split('-'); // format: YYYY-MM-DD
  const day = dateParts[2];
  const month = dateParts[1];
  
  let filename;
  if (tour.isCaniao === true) {
    // Format CANIAO: nomduchauffeur_caniao_jj-mm
    filename = `${chauffeurClean}_caniao_${day}-${month}.xlsx`;
  } else {
    // Format normal: nomduchauffeur_jj-mm
    filename = `${chauffeurClean}_${day}-${month}.xlsx`;
  }

  // Générer le buffer Excel avec encodage UTF-8 correct
  const excelBuffer = XLSX.write(workbook, { 
    type: 'buffer', 
    bookType: 'xlsx',
    bookSST: false,
    compression: true
  });

  // Envoyer le fichier
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(excelBuffer);

  log('INFO', 'Tournée téléchargée', { 
    tourId, 
    user: effectiveUser.login, 
    role: effectiveUser.role,
    colisCount: colis.length 
  });
});

// Import tournée pour dispatcher
app.post("/api/dispatcher/tours/import", authMiddleware(["DISPATCHER"]), upload.single("file"), async (req, res) => {
  try {
    const uploaded = req.file;
    const { date, action, targetDriverName } = req.body;
    const user = req.user;

    if (!uploaded) {
      return res.status(400).json({
        error: "NO_FILE",
        message: "Aucun fichier envoyé"
      });
    }

    if (!date) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "La date est obligatoire"
      });
    }

    // Extraire le nom du chauffeur du nom de fichier
    let chauffeurName = extractChauffeurFromFilename(uploaded.originalname);
    
    // Si action=useName, utiliser le nom cible fourni
    if (action === 'useName' && targetDriverName) {
      chauffeurName = targetDriverName;
    }
    
    // Générer le nom de la tournée automatiquement
    const tourneeName = `${chauffeurName} - ${date}`;

    log('INFO', 'Import dispatcher démarré', { 
      file: uploaded.originalname,
      chauffeur: chauffeurName,
      tournee: tourneeName,
      action: action || 'check'
    });

    const filePath = uploaded.path;
    const fileName = uploaded.originalname.toLowerCase();
    let uniqueColis = [];

    if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      // Fichier Excel
      log('INFO', 'Dispatcher: fichier Excel détecté', { file: uploaded.originalname });
      const parsedColis = parseExcelColis(filePath);
      uniqueColis = parsedColis.map(c => ({
        tracking: c.trackingNumber,
        address: c.address,
        city: c.city || '',
        orderNumber: c.orderNumber
      }));
    } else if (fileName.endsWith(".pdf")) {
      log('INFO', 'Dispatcher: fichier PDF détecté', { file: uploaded.originalname });
      try {
        const parsedColis = await parseSpokePDFWithPython(filePath);
        uniqueColis = parsedColis.map(c => ({
          tracking: c.trackingNumber,
          address: c.address,
          city: c.city || '',
          orderNumber: c.orderNumber
        }));
      } catch (pdfErr) {
        console.error('Erreur parsing PDF:', pdfErr);
        // Fallback: extraire juste les trackings
        const pdfParse = require('pdf-parse');
        const fileBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(fileBuffer);
        const text = pdfData.text;
        
        const trackingPattern = /\b((?:GFFR|DOFR|CNFR|CIFR)[A-Z0-9]{10,})/gi;
        let orderNumber = 1;
        const seenTrackings = new Set();
        let match;
        
        while ((match = trackingPattern.exec(text)) !== null) {
          let tracking = match[1].toUpperCase()
            .replace(/HD$/, '')
            .replace(/H$/, '')
            .replace(/;$/, '')
            .trim();
          
          if (tracking && !seenTrackings.has(tracking) && tracking.length >= 14) {
            seenTrackings.add(tracking);
            uniqueColis.push({
              tracking: tracking,
              address: '',
              city: '',
              orderNumber: orderNumber++
            });
          }
        }
      }
    } else if (fileName.endsWith(".txt")) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsedColis = parseSpokeColis(raw);
      uniqueColis = parsedColis.map(c => ({
        tracking: c.trackingNumber,
        address: c.address,
        city: c.city || '',
        orderNumber: c.orderNumber
      }));
    } else {
      return res.status(400).json({
        error: "INVALID_FORMAT",
        message: "Format non supporté. Utilisez PDF, Excel (.xlsx) ou TXT."
      });
    }

    if (uniqueColis.length === 0) {
      return res.status(400).json({
        error: "NO_COLIS_FOUND",
        message: "Aucun colis trouvé dans le fichier"
      });
    }

    // ===== VÉRIFICATION DES NOMS DE CHAUFFEURS SIMILAIRES =====
    // Récupérer toutes les tournées existantes pour ce sous-traitant et cette date
    const existingTours = TOURS.filter(t => 
      t.date === date && 
      t.sousTraitantName === user.sousTraitantName
    );
    
    // Chercher un nom identique ou similaire
    const normalizedNewName = normalizeDriverName(chauffeurName);
    let exactMatch = null;
    let similarMatch = null;
    
    for (const tour of existingTours) {
      const normalizedExistingName = normalizeDriverName(tour.chauffeurName);
      
      // Vérifier nom identique (après normalisation)
      if (normalizedExistingName === normalizedNewName) {
        exactMatch = tour.chauffeurName;
        break;
      }
      
      // Vérifier nom similaire (Levenshtein)
      if (!similarMatch && areDriverNamesMatching(chauffeurName, tour.chauffeurName)) {
        similarMatch = tour.chauffeurName;
      }
    }
    
    // Si pas d'action spécifiée et qu'on trouve un match, demander confirmation
    if (!action || action === 'check') {
      if (exactMatch) {
        // Nom exactement identique trouvé
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(409).json({
          error: "EXACT_NAME_MATCH",
          message: `Une tournée pour "${exactMatch}" existe déjà pour cette date`,
          existingDriverName: exactMatch,
          newDriverName: chauffeurName,
          isExactMatch: true,
          options: [
            { action: 'replace', label: `Remplacer la tournée de ${exactMatch}` },
            { action: 'addNew', label: 'Ajouter comme nouvelle tournée séparée' }
          ]
        });
      }
      
      if (similarMatch) {
        // Nom similaire trouvé
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(409).json({
          error: "SIMILAR_NAME_MATCH",
          message: `Un chauffeur avec un nom similaire existe: "${similarMatch}"`,
          existingDriverName: similarMatch,
          newDriverName: chauffeurName,
          isExactMatch: false,
          options: [
            { action: 'useName', label: `Fusionner avec ${similarMatch}`, targetDriverName: similarMatch },
            { action: 'addNew', label: `Créer une nouvelle tournée pour ${chauffeurName}` }
          ]
        });
      }
    }
    
    // ===== ACTION: REMPLACER LA TOURNÉE EXISTANTE =====
    if (action === 'replace' && exactMatch) {
      // Supprimer les tournées existantes du chauffeur
      const toursToDelete = existingTours.filter(t => 
        normalizeDriverName(t.chauffeurName) === normalizedNewName
      );
      
      for (const tour of toursToDelete) {
        // Supprimer les colis
        const colisToDelete = COLIS.filter(c => c.tourId === tour.id);
        for (const colis of colisToDelete) {
          const idx = COLIS.findIndex(c => c.id === colis.id);
          if (idx !== -1) COLIS.splice(idx, 1);
        }
        // Supprimer la tournée
        const tourIdx = TOURS.findIndex(t => t.id === tour.id);
        if (tourIdx !== -1) TOURS.splice(tourIdx, 1);
      }
      
      log('INFO', 'Tournées remplacées', { 
        chauffeur: chauffeurName, 
        count: toursToDelete.length 
      });
    }
    
    // ===== VÉRIFICATION DES DOUBLONS (sauf si on remplace) =====
    if (action !== 'replace') {
      const remainingTours = TOURS.filter(t => 
        t.date === date && 
        t.sousTraitantName === user.sousTraitantName
      );
      
      const existingTrackings = new Set();
      for (const tour of remainingTours) {
        const tourColis = COLIS.filter(c => c.tourId === tour.id);
        for (const colis of tourColis) {
          if (colis.trackingNumber) {
            existingTrackings.add(colis.trackingNumber.toUpperCase().trim());
          }
        }
      }
      
      console.log('Trackings existants:', existingTrackings.size);
      
      // Vérifier les doublons
      const duplicates = [];
      for (const colis of uniqueColis) {
        const tracking = (colis.tracking || '').toUpperCase().trim();
        if (tracking && existingTrackings.has(tracking)) {
          duplicates.push(tracking);
        }
      }
      
      if (duplicates.length > 0) {
        console.log('Doublons trouvés:', duplicates.length);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(409).json({
          error: "DUPLICATE_TRACKINGS",
          message: `${duplicates.length} numéro(s) de tracking déjà présent(s) dans vos tournées`,
          duplicates: duplicates.slice(0, 20),
          totalDuplicates: duplicates.length
        });
      }
    }

    // ===== SI ACTION 'addNew', NUMÉROTER LE NOM DU CHAUFFEUR =====
    let finalChauffeurName = chauffeurName;
    if (action === 'addNew') {
      // Chercher les tournées existantes avec ce nom de base (ou avec numéro)
      const baseNamePattern = new RegExp(`^${chauffeurName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s+\\d+)?$`, 'i');
      
      const existingToursWithName = TOURS.filter(t => 
        t.date === date && 
        t.sousTraitantName === user.sousTraitantName &&
        baseNamePattern.test(t.chauffeurName)
      );
      
      if (existingToursWithName.length > 0) {
        // Trouver le plus grand numéro existant
        let maxNumber = 1;
        for (const tour of existingToursWithName) {
          const match = tour.chauffeurName.match(/\s+(\d+)$/);
          if (match) {
            const num = parseInt(match[1]);
            if (num >= maxNumber) maxNumber = num;
          }
        }
        // Ajouter le prochain numéro
        finalChauffeurName = `${chauffeurName} ${maxNumber + 1}`;
        log('INFO', 'Numérotation automatique', { 
          original: chauffeurName, 
          final: finalChauffeurName,
          existingCount: existingToursWithName.length
        });
      }
    }
    
    // Mettre à jour le nom de la tournée avec le nom final
    const finalTourneeName = `${finalChauffeurName} - ${date}`;

    const tourId = NEXT_TOUR_ID++;
    const newTour = {
      id: tourId,
      date,
      chauffeurName: finalChauffeurName,
      sousTraitantName: user.sousTraitantName,
      tourneeName: finalTourneeName,
      colisCount: uniqueColis.length,
      sourceFile: uploaded.filename,
      sourceOriginalName: uploaded.originalname,
      isDispatcherImport: true,
      createdAt: new Date().toISOString(),
      createdBy: req.user.login
    };

    TOURS.push(newTour);

    uniqueColis.forEach((c) => {
      COLIS.push({
        id: NEXT_COLIS_ID++,
        tourId,
        date,
        trackingNumber: c.tracking,
        orderNumber: c.orderNumber,
        chauffeurName: finalChauffeurName,
        sousTraitantName: user.sousTraitantName,
        tourName: finalTourneeName,
        address: c.address || "",
        city: c.city || "",
        scanned: false,
        scannedAt: null,
        scannedBy: null
      });
    });

    saveDataToFile();
    
    // Supprimer le fichier temporaire
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    log('INFO', 'Dispatcher: tournée importée', { 
      dispatcher: user.login,
      tourId,
      colisCount: uniqueColis.length 
    });

    res.status(201).json({
      message: "Tournée importée avec succès",
      tour: newTour,
      colisCount: uniqueColis.length
    });

  } catch (e) {
    log('ERROR', 'Erreur import dispatcher', { error: e.message });
    // Nettoyer le fichier temporaire en cas d'erreur
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      error: "IMPORT_ERROR",
      message: "Erreur lors de l'import: " + e.message
    });
  }
});

// ==============================
// SUPPRESSION TOURNÉE DISPATCHER
// ==============================
app.delete("/api/dispatcher/tours/:id", authMiddleware(["DISPATCHER"]), (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const user = req.user;

  if (isNaN(tourId)) {
    return res.status(400).json({ error: "ID invalide" });
  }

  // Trouver la tournée
  const tourIndex = TOURS.findIndex((t) => t.id === tourId);
  if (tourIndex === -1) {
    return res.status(404).json({ error: "Tournée non trouvée" });
  }

  const tour = TOURS[tourIndex];

  // Vérifier que la tournée appartient au sous-traitant du dispatcher
  if (tour.sousTraitantName !== user.sousTraitantName) {
    return res.status(403).json({ 
      error: "FORBIDDEN",
      message: "Vous ne pouvez supprimer que les tournées de votre entreprise" 
    });
  }

  // Supprimer les colis associés
  const colisCountBefore = COLIS.length;
  COLIS = COLIS.filter((c) => c.tourId !== tourId);
  const removedColisCount = colisCountBefore - COLIS.length;

  // Supprimer la tournée
  const removedTour = TOURS.splice(tourIndex, 1)[0];

  saveDataToFile();

  log('INFO', 'Dispatcher: tournée supprimée', { 
    dispatcher: user.login,
    tourId,
    removedColis: removedColisCount 
  });

  res.json({
    message: "Tournée supprimée",
    removedTour,
    removedColis: removedColisCount
  });
});

// ==============================
// GESTION DES UTILISATEURS (ADMIN)
// ==============================

// Liste des utilisateurs
app.get("/api/admin/users", authMiddleware(["ADMIN"]), (req, res) => {
  try {
    const usersWithoutPassword = USERS.map(u => ({
      id: u.id,
      login: u.login,
      role: u.role,
      sousTraitantName: u.sousTraitantName
    }));
    
    res.json({ users: usersWithoutPassword });
  } catch (err) {
    log('ERROR', 'Erreur récupération utilisateurs', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// Créer un utilisateur
app.post("/api/admin/users", authMiddleware(["ADMIN"]), async (req, res) => {
  try {
    const { login, password, role, sousTraitantName } = req.body;
    
    if (!login || !password || !role) {
      return res.status(400).json({ 
        error: "MISSING_FIELDS", 
        message: "Login, mot de passe et rôle requis" 
      });
    }
    
    // Vérifier si le login existe déjà
    if (USERS.find(u => u.login === login)) {
      return res.status(400).json({ 
        error: "LOGIN_EXISTS", 
        message: "Ce login existe déjà" 
      });
    }
    
    // Valider le rôle
    if (!["ADMIN", "DISPATCHER", "TRIEUR"].includes(role)) {
      return res.status(400).json({ 
        error: "INVALID_ROLE", 
        message: "Rôle invalide" 
      });
    }
    
    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Créer l'utilisateur
    const newUser = {
      id: USERS.length > 0 ? Math.max(...USERS.map(u => u.id)) + 1 : 1,
      login: login.trim(),
      role,
      sousTraitantName: sousTraitantName ? sousTraitantName.trim() : null,
      passwordHash
    };
    
    USERS.push(newUser);
    saveUsersToFile();
    
    log('INFO', 'Utilisateur créé', { login: newUser.login, role: newUser.role });
    
    res.json({ 
      success: true, 
      user: {
        id: newUser.id,
        login: newUser.login,
        role: newUser.role,
        sousTraitantName: newUser.sousTraitantName
      }
    });
  } catch (err) {
    log('ERROR', 'Erreur création utilisateur', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// Modifier un utilisateur
app.put("/api/admin/users/:id", authMiddleware(["ADMIN"]), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { login, password, role, sousTraitantName } = req.body;
    
    const user = USERS.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ 
        error: "USER_NOT_FOUND", 
        message: "Utilisateur non trouvé" 
      });
    }
    
    // Vérifier si le nouveau login existe déjà (si changé)
    if (login && login !== user.login && USERS.find(u => u.login === login)) {
      return res.status(400).json({ 
        error: "LOGIN_EXISTS", 
        message: "Ce login existe déjà" 
      });
    }
    
    // Valider le rôle si fourni
    if (role && !["ADMIN", "DISPATCHER", "TRIEUR"].includes(role)) {
      return res.status(400).json({ 
        error: "INVALID_ROLE", 
        message: "Rôle invalide" 
      });
    }
    
    // Mettre à jour les champs
    if (login) user.login = login.trim();
    if (role) user.role = role;
    if (sousTraitantName !== undefined) {
      user.sousTraitantName = sousTraitantName ? sousTraitantName.trim() : null;
    }
    if (password) {
      user.passwordHash = await bcrypt.hash(password, 10);
    }
    
    saveUsersToFile();
    
    log('INFO', 'Utilisateur modifié', { id: userId, login: user.login });
    
    res.json({ 
      success: true, 
      user: {
        id: user.id,
        login: user.login,
        role: user.role,
        sousTraitantName: user.sousTraitantName
      }
    });
  } catch (err) {
    log('ERROR', 'Erreur modification utilisateur', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// Supprimer un utilisateur
app.delete("/api/admin/users/:id", authMiddleware(["ADMIN"]), (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    
    const userIndex = USERS.findIndex(u => u.id === userId);
    if (userIndex === -1) {
      return res.status(404).json({ 
        error: "USER_NOT_FOUND", 
        message: "Utilisateur non trouvé" 
      });
    }
    
    const deletedUser = USERS[userIndex];
    
    // Empêcher la suppression de l'admin principal (id=1)
    if (deletedUser.id === 1) {
      return res.status(403).json({ 
        error: "FORBIDDEN", 
        message: "Impossible de supprimer l'administrateur principal" 
      });
    }
    
    USERS.splice(userIndex, 1);
    saveUsersToFile();
    
    log('INFO', 'Utilisateur supprimé', { id: userId, login: deletedUser.login });
    
    res.json({ success: true, message: "Utilisateur supprimé" });
  } catch (err) {
    log('ERROR', 'Erreur suppression utilisateur', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API MUTUALISATION - Liste des chauffeurs mutualisés
// ==============================
app.get("/api/mutualized/drivers", authMiddleware(["ADMIN", "DISPATCHER"]), (req, res) => {
  console.log('=== MUTUALIZED DRIVERS ROUTE CALLED ===');
  try {
    const { date, sousTraitant } = req.query;
    console.log('Date:', date, 'SousTraitant:', sousTraitant);
    
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "La date est requise" });
    }
    
    // Pour un dispatcher, filtrer par son sous-traitant
    const filterSousTraitant = req.user.role === "DISPATCHER" ? req.user.sousTraitantName : sousTraitant;
    console.log('FilterSousTraitant:', filterSousTraitant);
    
    const drivers = findMutualizedDrivers(date, filterSousTraitant);
    console.log('Drivers found:', drivers.length);
    console.log('Drivers detail:', JSON.stringify(drivers, null, 2));
    
    log('INFO', 'Liste chauffeurs mutualisés', { 
      date, 
      sousTraitant: filterSousTraitant,
      count: drivers.length 
    });
    
    res.json({
      success: true,
      date,
      sousTraitant: filterSousTraitant,
      drivers: drivers.map(d => ({
        name: d.name,
        sousTraitant: d.sousTraitant,
        gofoCount: d.gofoColisCount,
        caniaoCount: d.caniaoColisCount,
        totalCount: (d.isOptimized || d.isDispatcherImport) ? (d.optimizedColisCount || 0) : (d.gofoColisCount + d.caniaoColisCount),
        hasBoth: !d.isOptimized && !d.isDispatcherImport && d.gofoColisCount > 0 && d.caniaoColisCount > 0,
        isOptimized: d.isOptimized || false,
        isDispatcherImport: d.isDispatcherImport || false,
        gofoCreatedBy: d.gofoCreatedBy || null
      }))
    });
  } catch (err) {
    log('ERROR', 'Erreur liste chauffeurs mutualisés', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API MUTUALISATION - Détail des colis d'un chauffeur
// ==============================
app.get("/api/mutualized/driver/:name", authMiddleware(["ADMIN", "DISPATCHER"]), (req, res) => {
  try {
    const { name } = req.params;
    const { date, sousTraitant } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "La date est requise" });
    }
    
    const filterSousTraitant = req.user.role === "DISPATCHER" ? req.user.sousTraitantName : sousTraitant;
    
    const colis = getMutualizedColisForDriver(name, date, filterSousTraitant);
    
    log('INFO', 'Détail chauffeur mutualisé', { 
      chauffeur: name,
      date,
      colisCount: colis.length 
    });
    
    res.json({
      success: true,
      chauffeur: name,
      date,
      colisCount: colis.length,
      colis: colis.map(c => ({
        id: c.id,
        trackingNumber: c.trackingNumber,
        address: c.address,
        orderNumber: c.orderNumber || '',
        source: TOURS.find(t => t.id === c.tourId)?.isCaniao ? 'CANIAO' : 'GOFO'
      }))
    });
  } catch (err) {
    log('ERROR', 'Erreur détail chauffeur mutualisé', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API MUTUALISATION - Export Excel mutualisé
// ==============================
app.get("/api/mutualized/driver/:name/export", authMiddleware(["ADMIN", "DISPATCHER"]), (req, res) => {
  try {
    const { name } = req.params;
    const { date, sousTraitant, source } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "La date est requise" });
    }
    
    const filterSousTraitant = req.user.role === "DISPATCHER" ? req.user.sousTraitantName : sousTraitant;
    
    let colis = getMutualizedColisForDriver(name, date, filterSousTraitant);
    
    // Filtrer par source si spécifié (gofo ou cainiao uniquement)
    if (source === 'gofo') {
      colis = colis.filter(c => !c.isCaniao);
    } else if (source === 'cainiao') {
      colis = colis.filter(c => c.isCaniao === true);
    }
    
    if (colis.length === 0) {
      return res.status(404).json({ error: "NO_COLIS", message: "Aucun colis trouvé pour ce chauffeur" });
    }
    
    // Vérifier si ce chauffeur a une tournée optimisée (importée par dispatcher)
    const normalizedDriverName = normalizeDriverName(name);
    const hasOptimizedTour = TOURS.some(t => {
      if (t.date !== date) return false;
      if (!t.isDispatcherImport) return false;
      const normalizedTourName = normalizeDriverName(t.chauffeurName);
      return normalizedTourName === normalizedDriverName || areDriverNamesMatching(t.chauffeurName, name);
    });
    
    console.log('Export Excel - Driver:', name, 'isOptimized:', hasOptimizedTour);
    
    // Créer le fichier Excel
    const workbook = XLSX.utils.book_new();
    
    // Préparer les données - numéro d'ordre seulement si tournée optimisée
    let excelData;
    let colWidths;
    
    if (hasOptimizedTour) {
      // Tournée optimisée: inclure numéro d'ordre
      excelData = colis.map(c => ({
        'Numéro d\'ordre': c.orderNumber || '',
        'Adresse': c.address || '',
        'Ville': c.city || '',
        'Numéro de tracking': c.trackingNumber || ''
      }));
      colWidths = [
        { wch: 15 }, // Numéro d'ordre
        { wch: 50 }, // Adresse
        { wch: 20 }, // Ville
        { wch: 25 }  // Tracking
      ];
    } else {
      // Tournée non-optimisée: adresse, ville et tracking
      excelData = colis.map(c => ({
        'Adresse': c.address || '',
        'Ville': c.city || '',
        'Numéro de tracking': c.trackingNumber || ''
      }));
      colWidths = [
        { wch: 50 }, // Adresse
        { wch: 20 }, // Ville
        { wch: 25 }  // Tracking
      ];
    }
    
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Ajuster la largeur des colonnes
    worksheet['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Colis');
    
    // Générer le buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Formater la date pour le nom de fichier (JJ-MM)
    const dateParts = date.split('-');
    const formattedDate = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}` : date;
    
    // Nom du fichier: NomChauffeur JJ-MM [source].xlsx
    let fileName;
    if (source === 'gofo') {
      fileName = `${name} ${formattedDate} GOFO.xlsx`;
    } else if (source === 'cainiao') {
      fileName = `${name} ${formattedDate} CAINIAO.xlsx`;
    } else {
      fileName = `${name} ${formattedDate}.xlsx`;
    }
    
    log('INFO', 'Export Excel mutualisé', { 
      chauffeur: name,
      date,
      source: source || 'all',
      colisCount: colis.length,
      fileName
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
    
  } catch (err) {
    log('ERROR', 'Erreur export Excel mutualisé', { error: err.message, stack: err.stack });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API DISPATCHER - Import tournée optimisée (remplace Gofo + Cainiao)
// ==============================
app.post("/api/dispatcher/tour/optimized", authMiddleware(["ADMIN", "DISPATCHER"]), upload.single('file'), async (req, res) => {
  try {
    const { date, driverName, sousTraitantName } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: "MISSING_FILE", message: "Fichier PDF ou Excel requis" });
    }
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "Date requise" });
    }
    if (!driverName) {
      return res.status(400).json({ error: "MISSING_DRIVER", message: "Nom du chauffeur requis" });
    }
    
    // Utiliser le sous-traitant du dispatcher si pas spécifié
    const finalSousTraitant = req.user.role === "DISPATCHER" ? req.user.sousTraitantName : sousTraitantName;
    
    console.log('=== IMPORT TOURNÉE OPTIMISÉE ===');
    console.log('Driver:', driverName, 'Date:', date, 'SousTraitant:', finalSousTraitant);
    console.log('File:', file.originalname, 'Path:', file.path);
    
    const ext = path.extname(file.originalname).toLowerCase();
    let parsedColis = [];
    
    if (ext === '.xlsx' || ext === '.xls') {
      // Fichier Excel
      console.log('Parsing Excel file...');
      const fileBuffer = fs.readFileSync(file.path);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (jsonData.length < 2) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: "EMPTY_FILE", message: "Le fichier Excel est vide" });
      }
      
      // Chercher les colonnes
      const headers = jsonData[0].map(h => String(h || '').toLowerCase().trim());
      console.log('Excel headers:', headers);
      
      // Trouver colonne tracking
      let trackingColIndex = headers.findIndex(h => 
        h.includes('tracking') || h.includes('numero') || h.includes('numéro') || h.includes('colis')
      );
      
      // Trouver colonne adresse
      let addressColIndex = headers.findIndex(h => 
        h.includes('address') || h.includes('adresse') || h.includes('receiver') || h.includes('destinataire')
      );
      
      // Trouver colonne ordre (optionnel)
      let orderColIndex = headers.findIndex(h => 
        h.includes('ordre') || h.includes('order') || h.includes('n°') || h === '#'
      );
      
      if (trackingColIndex === -1) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: "MISSING_COLUMN", message: "Colonne tracking non trouvée" });
      }
      
      let orderNumber = 1;
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        const tracking = String(row[trackingColIndex] || '').trim().toUpperCase();
        const address = addressColIndex !== -1 ? String(row[addressColIndex] || '').trim() : '';
        const order = orderColIndex !== -1 ? parseInt(row[orderColIndex]) || orderNumber : orderNumber;
        
        if (tracking && tracking.length > 5) {
          parsedColis.push({
            orderNumber: order,
            trackingNumber: tracking,
            address: address
          });
          orderNumber++;
        }
      }
      
    } else if (ext === '.pdf') {
      // Fichier PDF Spoke - utiliser le parser Python spécialisé
      console.log('Parsing PDF Spoke avec pdfplumber...');
      
      try {
        parsedColis = await parseSpokePDFWithPython(file.path);
        console.log('Colis extraits via Python:', parsedColis.length);
      } catch (pythonErr) {
        console.error('Erreur parser Python Spoke:', pythonErr.message);
        
        // Fallback: essayer avec pdf-parse et extraction regex
        console.log('Fallback sur pdf-parse...');
        const pdfParse = require('pdf-parse');
        const fileBuffer = fs.readFileSync(file.path);
        const pdfData = await pdfParse(fileBuffer);
        const text = pdfData.text;
        
        console.log('PDF text length:', text.length);
        
        // Extraire tous les trackings du texte (GFFR, DOFR, CNFR, CIFR)
        const trackingPattern = /\b((?:GFFR|DOFR|CNFR|CIFR)[A-Z0-9]{10,})/gi;
        
        let orderNumber = 1;
        const seenTrackings = new Set();
        let match;
        
        while ((match = trackingPattern.exec(text)) !== null) {
          // Nettoyer le tracking (enlever HD, D;, ;)
          let tracking = match[1].toUpperCase()
            .replace(/HD$/, '')
            .replace(/H$/, '')
            .replace(/D;?$/, '')
            .replace(/;$/, '')
            .trim();
          
          if (tracking && !seenTrackings.has(tracking) && tracking.length >= 14) {
            seenTrackings.add(tracking);
            
            parsedColis.push({
              orderNumber: orderNumber++,
              trackingNumber: tracking,
              address: ''
            });
          }
        }
        
        console.log('Colis extraits (fallback):', parsedColis.length);
      }
    } else {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: "INVALID_FORMAT", message: "Format non supporté. Utilisez PDF ou Excel." });
    }
    
    // Supprimer le fichier temporaire
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    
    console.log('Colis parsés:', parsedColis.length);
    
    if (parsedColis.length === 0) {
      return res.status(400).json({ 
        error: "NO_COLIS", 
        message: "Aucun colis trouvé dans le PDF. Vérifiez le format du fichier." 
      });
    }
    
    // Normaliser le nom du chauffeur pour le matching
    const normalizedDriverName = normalizeDriverName(driverName);
    
    // Trouver les tournées existantes du chauffeur (Gofo + Cainiao)
    const existingTours = TOURS.filter(t => {
      if (t.date !== date) return false;
      const normalizedTourName = normalizeDriverName(t.chauffeurName);
      return normalizedTourName === normalizedDriverName || areDriverNamesMatching(t.chauffeurName, driverName);
    });
    
    console.log('Tournées existantes à remplacer:', existingTours.length);
    existingTours.forEach(t => console.log(' -', t.chauffeurName, t.isCaniao ? 'CANIAO' : 'GOFO'));
    
    // ===== MÉMORISER LES COMPTEURS GOFO/CAINIAO AVANT SUPPRESSION =====
    let originalGofoCount = 0;
    let originalCaniaoCount = 0;
    
    for (const tour of existingTours) {
      const tourColisCount = COLIS.filter(c => c.tourId === tour.id).length;
      if (tour.isCaniao) {
        originalCaniaoCount += tourColisCount;
      } else if (!tour.isOptimized) {
        originalGofoCount += tourColisCount;
      } else if (tour.isOptimized) {
        // Si c'est déjà une tournée optimisée, récupérer ses anciens compteurs
        originalGofoCount += tour.originalGofoCount || 0;
        originalCaniaoCount += tour.originalCaniaoCount || 0;
      }
    }
    
    console.log('Compteurs mémorisés - Gofo:', originalGofoCount, 'Cainiao:', originalCaniaoCount);
    
    // Supprimer les anciennes tournées et leurs colis
    const deletedTourIds = [];
    for (const tour of existingTours) {
      // Supprimer les colis de cette tournée
      const colisToDelete = COLIS.filter(c => c.tourId === tour.id);
      for (const colis of colisToDelete) {
        const idx = COLIS.findIndex(c => c.id === colis.id);
        if (idx !== -1) COLIS.splice(idx, 1);
      }
      // Supprimer la tournée
      const tourIdx = TOURS.findIndex(t => t.id === tour.id);
      if (tourIdx !== -1) {
        deletedTourIds.push(tour.id);
        TOURS.splice(tourIdx, 1);
      }
    }
    
    console.log('Tournées supprimées:', deletedTourIds.length);
    
    // Créer la nouvelle tournée optimisée
    const tourId = NEXT_TOUR_ID++;
    const newTour = {
      id: tourId,
      chauffeurName: driverName,
      sousTraitantName: finalSousTraitant,
      tourneeName: `${driverName}_optimized`,
      date: date,
      isCaniao: false,
      isDispatcherImport: true,
      isOptimized: true,
      colisCount: parsedColis.length,
      originalGofoCount: originalGofoCount,      // Compteur Gofo mémorisé
      originalCaniaoCount: originalCaniaoCount,  // Compteur Cainiao mémorisé
      sourceFile: file.filename,
      sourceOriginalName: file.originalname,
      createdAt: new Date().toISOString(),
      createdBy: req.user.login
    };
    TOURS.push(newTour);
    
    // Créer les colis
    const createdColis = [];
    for (const colisData of parsedColis) {
      const colisId = NEXT_COLIS_ID++;
      
      // Extraire la ville de l'adresse si pas déjà présente (format Spoke: "adresse, VILLE")
      let city = colisData.city || "";
      if (!city && colisData.address && colisData.address.includes(',')) {
        city = colisData.address.split(',').pop().trim();
      }
      
      const newColis = {
        id: colisId,
        tourId: tourId,
        date: date,
        chauffeurName: driverName,
        sousTraitantName: finalSousTraitant,
        tourName: `${driverName}_optimized`,
        orderNumber: colisData.orderNumber,
        trackingNumber: colisData.trackingNumber,
        address: colisData.address,
        city: city,
        scanned: false,
        scannedAt: null,
        scannedBy: null
      };
      COLIS.push(newColis);
      createdColis.push(newColis);
    }
    
    // Sauvegarder les données
    saveDataToFile();
    
    log('INFO', 'Tournée optimisée importée', {
      chauffeur: driverName,
      date,
      sousTraitant: finalSousTraitant,
      colisCount: createdColis.length,
      replacedTours: deletedTourIds.length,
      user: req.user.login
    });
    
    res.json({
      success: true,
      message: `Tournée optimisée importée pour ${driverName}`,
      tour: newTour,
      colisCount: createdColis.length,
      replacedTours: deletedTourIds.length
    });
    
  } catch (err) {
    console.error('Erreur import tournée optimisée:', err);
    log('ERROR', 'Erreur import tournée optimisée', { error: err.message, stack: err.stack });
    // Cleanup fichier temporaire
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur: " + err.message });
  }
});

// ==============================
// API DISPATCHER - Ajouter une nouvelle tournée (sans remplacement, avec vérification doublons)
// ==============================
app.post("/api/dispatcher/tour/add", authMiddleware(["ADMIN", "DISPATCHER"]), upload.single('file'), async (req, res) => {
  try {
    const { date, driverName, sousTraitantName } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: "MISSING_FILE", message: "Fichier PDF ou Excel requis" });
    }
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "Date requise" });
    }
    if (!driverName) {
      return res.status(400).json({ error: "MISSING_DRIVER", message: "Nom du chauffeur requis" });
    }
    
    // Utiliser le sous-traitant du dispatcher si pas spécifié
    const finalSousTraitant = req.user.role === "DISPATCHER" ? req.user.sousTraitantName : sousTraitantName;
    
    console.log('=== AJOUT NOUVELLE TOURNÉE ===');
    console.log('Driver:', driverName, 'Date:', date, 'SousTraitant:', finalSousTraitant);
    console.log('File:', file.originalname, 'Path:', file.path);
    
    const ext = path.extname(file.originalname).toLowerCase();
    let parsedColis = [];
    
    // ===== PARSING DU FICHIER =====
    if (ext === '.xlsx' || ext === '.xls') {
      // Fichier Excel
      console.log('Parsing Excel file...');
      const fileBuffer = fs.readFileSync(file.path);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (jsonData.length < 2) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: "EMPTY_FILE", message: "Le fichier Excel est vide" });
      }
      
      // Chercher les colonnes
      const headers = jsonData[0].map(h => String(h || '').toLowerCase().trim());
      console.log('Excel headers:', headers);
      
      // Trouver colonne tracking
      let trackingColIndex = headers.findIndex(h => 
        h.includes('tracking') || h.includes('numero') || h.includes('numéro') || h.includes('colis') || h.includes('waybill')
      );
      
      // Trouver colonne adresse
      let addressColIndex = headers.findIndex(h => 
        h.includes('address') || h.includes('adresse') || h.includes('street') || h.includes('receiver') || h.includes('destinataire')
      );
      
      // Trouver colonne ville
      let cityColIndex = headers.findIndex(h => 
        h.includes('city') || h.includes('ville') || h.includes('town') || h.includes('commune') || h.includes('tocity')
      );
      
      // Trouver colonne ordre (optionnel)
      let orderColIndex = headers.findIndex(h => 
        h.includes('ordre') || h.includes('order') || h.includes('n°') || h === '#'
      );
      
      if (trackingColIndex === -1) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: "MISSING_COLUMN", message: "Colonne tracking non trouvée" });
      }
      
      let orderNumber = 1;
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        const tracking = String(row[trackingColIndex] || '').trim().toUpperCase();
        const address = addressColIndex !== -1 ? String(row[addressColIndex] || '').trim() : '';
        const city = cityColIndex !== -1 ? String(row[cityColIndex] || '').trim() : '';
        const order = orderColIndex !== -1 ? parseInt(row[orderColIndex]) || orderNumber : orderNumber;
        
        if (tracking && tracking.length > 5) {
          parsedColis.push({
            orderNumber: order,
            trackingNumber: tracking,
            address: address,
            city: city
          });
          orderNumber++;
        }
      }
      
    } else if (ext === '.pdf') {
      // Fichier PDF Spoke - utiliser le parser Python spécialisé
      console.log('Parsing PDF Spoke avec pdfplumber...');
      
      try {
        parsedColis = await parseSpokePDFWithPython(file.path);
        console.log('Colis extraits via Python:', parsedColis.length);
      } catch (pythonErr) {
        console.error('Erreur parser Python Spoke:', pythonErr.message);
        
        // Fallback: essayer avec pdf-parse et extraction regex
        console.log('Fallback sur pdf-parse...');
        const pdfParse = require('pdf-parse');
        const fileBuffer = fs.readFileSync(file.path);
        const pdfData = await pdfParse(fileBuffer);
        const text = pdfData.text;
        
        const trackingPattern = /\b((?:GFFR|DOFR|CNFR|CIFR)[A-Z0-9]{10,})/gi;
        
        let orderNumber = 1;
        const seenTrackings = new Set();
        let match;
        
        while ((match = trackingPattern.exec(text)) !== null) {
          let tracking = match[1].toUpperCase()
            .replace(/HD$/, '')
            .replace(/H$/, '')
            .replace(/D;?$/, '')
            .replace(/;$/, '')
            .trim();
          
          if (tracking && !seenTrackings.has(tracking) && tracking.length >= 14) {
            seenTrackings.add(tracking);
            parsedColis.push({
              orderNumber: orderNumber++,
              trackingNumber: tracking,
              address: '',
              city: ''
            });
          }
        }
      }
    } else {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: "INVALID_FORMAT", message: "Format non supporté. Utilisez PDF ou Excel." });
    }
    
    // Supprimer le fichier temporaire
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    
    console.log('Colis parsés:', parsedColis.length);
    
    if (parsedColis.length === 0) {
      return res.status(400).json({ 
        error: "NO_COLIS", 
        message: "Aucun colis trouvé dans le fichier. Vérifiez le format." 
      });
    }
    
    // ===== VÉRIFICATION DES DOUBLONS =====
    // Récupérer tous les trackings existants pour ce sous-traitant et cette date
    const existingTours = TOURS.filter(t => 
      t.date === date && 
      t.sousTraitantName === finalSousTraitant
    );
    
    const existingTrackings = new Set();
    for (const tour of existingTours) {
      const tourColis = COLIS.filter(c => c.tourId === tour.id);
      for (const colis of tourColis) {
        if (colis.trackingNumber) {
          existingTrackings.add(colis.trackingNumber.toUpperCase().trim());
        }
      }
    }
    
    console.log('Trackings existants:', existingTrackings.size);
    
    // Vérifier les doublons
    const duplicates = [];
    for (const colis of parsedColis) {
      const tracking = colis.trackingNumber.toUpperCase().trim();
      if (existingTrackings.has(tracking)) {
        duplicates.push(tracking);
      }
    }
    
    if (duplicates.length > 0) {
      console.log('Doublons trouvés:', duplicates.length);
      return res.status(409).json({
        error: "DUPLICATE_TRACKINGS",
        message: `${duplicates.length} numéro(s) de tracking déjà présent(s) dans vos tournées`,
        duplicates: duplicates.slice(0, 20), // Limiter à 20 pour l'affichage
        totalDuplicates: duplicates.length
      });
    }
    
    // ===== CRÉATION DE LA TOURNÉE =====
    const tourId = NEXT_TOUR_ID++;
    const newTour = {
      id: tourId,
      chauffeurName: driverName,
      sousTraitantName: finalSousTraitant,
      tourneeName: `${driverName}_${date}`,
      date: date,
      isCaniao: false,
      isDispatcherImport: true,
      isOptimized: false, // Pas optimisé, juste ajouté
      colisCount: parsedColis.length,
      sourceFile: file.filename,
      sourceOriginalName: file.originalname,
      createdAt: new Date().toISOString(),
      createdBy: req.user.login
    };
    TOURS.push(newTour);
    
    // Créer les colis
    const createdColis = [];
    for (const colisData of parsedColis) {
      const colisId = NEXT_COLIS_ID++;
      
      // Extraire la ville de l'adresse si pas déjà présente
      let city = colisData.city || "";
      if (!city && colisData.address && colisData.address.includes(',')) {
        city = colisData.address.split(',').pop().trim();
      }
      
      const newColis = {
        id: colisId,
        tourId: tourId,
        date: date,
        chauffeurName: driverName,
        sousTraitantName: finalSousTraitant,
        tourName: newTour.tourneeName,
        orderNumber: colisData.orderNumber,
        trackingNumber: colisData.trackingNumber,
        address: colisData.address,
        city: city,
        scanned: false,
        scannedAt: null,
        scannedBy: null
      };
      COLIS.push(newColis);
      createdColis.push(newColis);
    }
    
    // Sauvegarder les données
    saveDataToFile();
    
    log('INFO', 'Nouvelle tournée ajoutée', {
      chauffeur: driverName,
      date,
      sousTraitant: finalSousTraitant,
      colisCount: createdColis.length,
      user: req.user.login
    });
    
    res.json({
      success: true,
      message: `Tournée ajoutée pour ${driverName} (${createdColis.length} colis)`,
      tour: newTour,
      colisCount: createdColis.length
    });
    
  } catch (err) {
    console.error('Erreur ajout tournée:', err);
    log('ERROR', 'Erreur ajout tournée', { error: err.message, stack: err.stack });
    // Cleanup fichier temporaire
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur: " + err.message });
  }
});

// ==============================
// API DISPATCHER - Supprimer tournées d'un chauffeur (avec mémorisation)
// ==============================
app.delete("/api/dispatcher/tour/:driverName", authMiddleware(["ADMIN", "DISPATCHER"]), (req, res) => {
  try {
    const { driverName } = req.params;
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "Date requise" });
    }
    
    const currentUserLogin = req.user.login;
    const sousTraitant = req.user.role === "DISPATCHER" ? req.user.sousTraitantName : null;
    
    console.log('=== DELETE DISPATCHER TOUR ===');
    console.log('Driver:', driverName, 'Date:', date, 'User:', currentUserLogin, 'SousTraitant:', sousTraitant);
    
    // Normaliser le nom pour le matching
    const normalizedDriverName = normalizeDriverName(driverName);
    
    // Trouver les tournées du chauffeur pour ce sous-traitant
    // EXCLURE les tournées Cainiao importées par l'admin (multi-chauffeur)
    const toursToDelete = TOURS.filter(t => {
      if (t.date !== date) return false;
      if (sousTraitant && t.sousTraitantName !== sousTraitant) return false;
      
      // Ne pas supprimer les tournées Cainiao créées par l'admin (import multi-chauffeur)
      if (t.isCaniao && t.createdBy !== currentUserLogin) return false;
      
      const normalizedTourName = normalizeDriverName(t.chauffeurName);
      return normalizedTourName === normalizedDriverName || areDriverNamesMatching(t.chauffeurName, driverName);
    });
    
    console.log('Tournées à supprimer:', toursToDelete.length);
    
    if (toursToDelete.length === 0) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Aucune tournée supprimable trouvée pour ce chauffeur (les tournées Cainiao admin ne peuvent pas être supprimées)" });
    }
    
    // Mémoriser l'association colis → chauffeur avant suppression
    let memorizedCount = 0;
    for (const tour of toursToDelete) {
      const tourColis = COLIS.filter(c => c.tourId === tour.id);
      for (const colis of tourColis) {
        if (colis.trackingNumber) {
          ORIGINAL_COLIS_MAPPING[colis.trackingNumber.toUpperCase()] = {
            chauffeur: tour.chauffeurName,
            sousTraitant: tour.sousTraitantName,
            address: colis.address,
            tourType: tour.isCaniao ? 'Cainiao' : 'Gofo',
            memorizedAt: new Date().toISOString()
          };
          memorizedCount++;
        }
      }
    }
    
    // Supprimer les tournées et leurs colis
    let deletedCount = 0;
    let deletedColisCount = 0;
    
    for (const tour of toursToDelete) {
      // Supprimer les colis
      const colisToDelete = COLIS.filter(c => c.tourId === tour.id);
      for (const colis of colisToDelete) {
        const idx = COLIS.findIndex(c => c.id === colis.id);
        if (idx !== -1) {
          COLIS.splice(idx, 1);
          deletedColisCount++;
        }
      }
      
      // Supprimer la tournée
      const tourIdx = TOURS.findIndex(t => t.id === tour.id);
      if (tourIdx !== -1) {
        TOURS.splice(tourIdx, 1);
        deletedCount++;
      }
    }
    
    saveDataToFile();
    
    log('INFO', 'Tournée supprimée par dispatcher', {
      chauffeur: driverName,
      date,
      toursDeleted: deletedCount,
      colisDeleted: deletedColisCount,
      memorizedColis: memorizedCount,
      user: currentUserLogin
    });
    
    res.json({
      success: true,
      message: `Tournée de ${driverName} supprimée`,
      deletedTours: deletedCount,
      deletedColis: deletedColisCount,
      memorizedColis: memorizedCount
    });
    
  } catch (err) {
    console.error('Erreur suppression tournée dispatcher:', err);
    log('ERROR', 'Erreur suppression tournée dispatcher', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API DISPATCHER - Supprimer TOUTES les tournées d'un coup
// ==============================
app.delete("/api/dispatcher/tours/all", authMiddleware(["DISPATCHER"]), (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "Date requise" });
    }
    
    const sousTraitant = req.user.sousTraitantName;
    const currentUserLogin = req.user.login;
    
    console.log('=== DELETE ALL DISPATCHER TOURS ===');
    console.log('Date:', date, 'SousTraitant:', sousTraitant, 'User:', currentUserLogin);
    
    // Trouver toutes les tournées du sous-traitant pour cette date
    // EXCLURE les tournées Cainiao créées par l'admin (import multi-chauffeur)
    const toursToDelete = TOURS.filter(t => {
      if (t.date !== date) return false;
      if (t.sousTraitantName !== sousTraitant) return false;
      // Ne pas supprimer les tournées Cainiao créées par l'admin
      if (t.isCaniao && t.createdBy !== currentUserLogin) return false;
      return true;
    });
    
    // Compter les tournées Cainiao admin qui sont protégées
    const protectedCaniaoTours = TOURS.filter(t => 
      t.date === date && 
      t.sousTraitantName === sousTraitant && 
      t.isCaniao && 
      t.createdBy !== currentUserLogin
    ).length;
    
    if (toursToDelete.length === 0) {
      if (protectedCaniaoTours > 0) {
        return res.status(400).json({ error: "ONLY_CANIAO", message: `Aucune tournée supprimable (${protectedCaniaoTours} tournée(s) Cainiao admin protégée(s))` });
      }
      return res.status(404).json({ error: "NOT_FOUND", message: "Aucune tournée trouvée" });
    }
    
    // Mémoriser l'association colis → chauffeur avant suppression
    let memorizedCount = 0;
    for (const tour of toursToDelete) {
      const tourColis = COLIS.filter(c => c.tourId === tour.id);
      for (const colis of tourColis) {
        if (colis.trackingNumber) {
          ORIGINAL_COLIS_MAPPING[colis.trackingNumber.toUpperCase()] = {
            chauffeur: tour.chauffeurName,
            sousTraitant: tour.sousTraitantName,
            address: colis.address,
            tourType: tour.isCaniao ? 'Cainiao' : 'Gofo',
            memorizedAt: new Date().toISOString()
          };
          memorizedCount++;
        }
      }
    }
    
    // Supprimer les tournées et leurs colis
    let deletedCount = 0;
    let deletedColisCount = 0;
    
    for (const tour of toursToDelete) {
      const colisToDelete = COLIS.filter(c => c.tourId === tour.id);
      for (const colis of colisToDelete) {
        const idx = COLIS.findIndex(c => c.id === colis.id);
        if (idx !== -1) {
          COLIS.splice(idx, 1);
          deletedColisCount++;
        }
      }
      
      const tourIdx = TOURS.findIndex(t => t.id === tour.id);
      if (tourIdx !== -1) {
        TOURS.splice(tourIdx, 1);
        deletedCount++;
      }
    }
    
    saveDataToFile();
    
    log('INFO', 'Toutes les tournées supprimées par dispatcher', {
      date,
      sousTraitant,
      toursDeleted: deletedCount,
      colisDeleted: deletedColisCount,
      memorizedColis: memorizedCount,
      user: currentUserLogin
    });
    
    res.json({
      success: true,
      message: `${deletedCount} tournée(s) supprimée(s)`,
      deletedTours: deletedCount,
      deletedColis: deletedColisCount,
      memorizedColis: memorizedCount
    });
    
  } catch (err) {
    console.error('Erreur suppression toutes tournées:', err);
    log('ERROR', 'Erreur suppression toutes tournées', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API DISPATCHER - Réinitialiser UNE tournée à partir du backup admin
// ==============================
app.post("/api/dispatcher/tour/:driverName/reset", authMiddleware(["DISPATCHER"]), (req, res) => {
  try {
    const { driverName } = req.params;
    const { date } = req.body;
    
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "Date requise" });
    }
    
    const sousTraitant = req.user.sousTraitantName;
    const normalizedDriverName = normalizeDriverName(driverName);
    
    console.log('=== RESET TOUR FROM BACKUP ===');
    console.log('Driver:', driverName, 'Date:', date, 'SousTraitant:', sousTraitant);
    
    // Chercher le backup correspondant
    const backupKey = `${date}_${normalizedDriverName}_${sousTraitant}`;
    const backup = ADMIN_TOUR_BACKUPS[backupKey];
    
    if (!backup) {
      return res.status(404).json({ error: "NO_BACKUP", message: "Aucune sauvegarde trouvée pour ce chauffeur" });
    }
    
    // Supprimer les tournées actuelles de ce chauffeur
    const existingTours = TOURS.filter(t => {
      if (t.date !== date) return false;
      if (t.sousTraitantName !== sousTraitant) return false;
      const norm = normalizeDriverName(t.chauffeurName);
      return norm === normalizedDriverName || areDriverNamesMatching(t.chauffeurName, driverName);
    });
    
    for (const tour of existingTours) {
      // Supprimer les colis
      const idx = COLIS.findIndex(c => c.tourId === tour.id);
      while (idx !== -1) {
        COLIS.splice(idx, 1);
      }
      COLIS = COLIS.filter(c => c.tourId !== tour.id);
      
      // Supprimer la tournée
      const tourIdx = TOURS.findIndex(t => t.id === tour.id);
      if (tourIdx !== -1) TOURS.splice(tourIdx, 1);
    }
    
    // Restaurer depuis le backup
    const newTourId = NEXT_TOUR_ID++;
    const restoredTour = {
      ...backup.tour,
      id: newTourId,
      restoredAt: new Date().toISOString(),
      restoredBy: req.user.login
    };
    TOURS.push(restoredTour);
    
    // Restaurer les colis
    const restoredColis = [];
    for (const colisBackup of backup.colis) {
      const newColisId = NEXT_COLIS_ID++;
      const newColis = {
        ...colisBackup,
        id: newColisId,
        tourId: newTourId,
        scanned: false,
        scannedAt: null,
        scannedBy: null
      };
      COLIS.push(newColis);
      restoredColis.push(newColis);
    }
    
    saveDataToFile();
    
    log('INFO', 'Tournée réinitialisée depuis backup', {
      chauffeur: driverName,
      date,
      colisCount: restoredColis.length,
      user: req.user.login
    });
    
    res.json({
      success: true,
      message: `Tournée de ${driverName} réinitialisée`,
      tour: restoredTour,
      colisCount: restoredColis.length
    });
    
  } catch (err) {
    console.error('Erreur réinitialisation tournée:', err);
    log('ERROR', 'Erreur réinitialisation tournée', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API DISPATCHER - Réinitialiser TOUTES les tournées depuis les backups
// ==============================
app.post("/api/dispatcher/tours/reset-all", authMiddleware(["DISPATCHER"]), (req, res) => {
  try {
    const { date, onlyDeleted } = req.body;
    
    if (!date) {
      return res.status(400).json({ error: "MISSING_DATE", message: "Date requise" });
    }
    
    const sousTraitant = req.user.sousTraitantName;
    
    console.log('=== RESET ALL TOURS FROM BACKUP ===');
    console.log('Date:', date, 'SousTraitant:', sousTraitant, 'OnlyDeleted:', onlyDeleted);
    
    // Trouver tous les backups pour cette date et ce sous-traitant
    const relevantBackups = Object.entries(ADMIN_TOUR_BACKUPS).filter(([key, backup]) => {
      return key.startsWith(`${date}_`) && backup.tour.sousTraitantName === sousTraitant;
    });
    
    if (relevantBackups.length === 0) {
      return res.status(404).json({ error: "NO_BACKUP", message: "Aucune sauvegarde trouvée pour cette date" });
    }
    
    // Si onlyDeleted, ne restaurer que les tournées qui n'existent plus
    let backupsToRestore = relevantBackups;
    
    if (onlyDeleted) {
      backupsToRestore = relevantBackups.filter(([key, backup]) => {
        const normalizedBackupName = normalizeDriverName(backup.tour.chauffeurName);
        // Vérifier si une tournée existe déjà pour ce chauffeur
        const existingTour = TOURS.find(t => {
          if (t.date !== date) return false;
          if (t.sousTraitantName !== sousTraitant) return false;
          const normalizedTourName = normalizeDriverName(t.chauffeurName);
          return normalizedTourName === normalizedBackupName || areDriverNamesMatching(t.chauffeurName, backup.tour.chauffeurName);
        });
        // Ne restaurer que si aucune tournée n'existe
        return !existingTour;
      });
      
      if (backupsToRestore.length === 0) {
        return res.status(400).json({ error: "NOTHING_TO_RESTORE", message: "Aucune tournée supprimée à restaurer" });
      }
    } else {
      // Mode "tout réinitialiser" : supprimer les tournées existantes d'abord
      const existingTours = TOURS.filter(t => t.date === date && t.sousTraitantName === sousTraitant && !t.isCaniao);
      for (const tour of existingTours) {
        COLIS = COLIS.filter(c => c.tourId !== tour.id);
      }
      TOURS = TOURS.filter(t => !(t.date === date && t.sousTraitantName === sousTraitant && !t.isCaniao));
    }
    
    // Restaurer les backups sélectionnés
    let restoredToursCount = 0;
    let restoredColisCount = 0;
    
    for (const [key, backup] of backupsToRestore) {
      const newTourId = NEXT_TOUR_ID++;
      const restoredTour = {
        ...backup.tour,
        id: newTourId,
        restoredAt: new Date().toISOString(),
        restoredBy: req.user.login
      };
      TOURS.push(restoredTour);
      restoredToursCount++;
      
      for (const colisBackup of backup.colis) {
        const newColisId = NEXT_COLIS_ID++;
        const newColis = {
          ...colisBackup,
          id: newColisId,
          tourId: newTourId,
          scanned: false,
          scannedAt: null,
          scannedBy: null
        };
        COLIS.push(newColis);
        restoredColisCount++;
      }
    }
    
    saveDataToFile();
    
    log('INFO', 'Tournées réinitialisées', {
      date,
      sousTraitant,
      onlyDeleted: !!onlyDeleted,
      toursRestored: restoredToursCount,
      colisRestored: restoredColisCount,
      user: req.user.login
    });
    
    res.json({
      success: true,
      message: `${restoredToursCount} tournée(s) réinitialisée(s)`,
      restoredTours: restoredToursCount,
      restoredColis: restoredColisCount,
      onlyDeleted: !!onlyDeleted
    });
    
  } catch (err) {
    console.error('Erreur réinitialisation toutes tournées:', err);
    log('ERROR', 'Erreur réinitialisation toutes tournées', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API - Récupérer le chauffeur original d'un colis (pour le tri)
// ==============================
app.get("/api/colis/:tracking/original", authMiddleware(["ADMIN", "DISPATCHER", "TRIEUR"]), (req, res) => {
  try {
    const { tracking } = req.params;
    const normalizedTracking = tracking.toUpperCase().trim();
    
    // Chercher dans le mapping des colis mémorisés
    const originalInfo = ORIGINAL_COLIS_MAPPING[normalizedTracking];
    
    if (originalInfo) {
      return res.json({
        success: true,
        found: true,
        trackingNumber: normalizedTracking,
        chauffeur: originalInfo.chauffeur,
        sousTraitant: originalInfo.sousTraitant,
        address: originalInfo.address,
        tourType: originalInfo.tourType,
        source: 'memory'
      });
    }
    
    // Sinon chercher dans les tournées actuelles
    const colis = COLIS.find(c => c.trackingNumber?.toUpperCase() === normalizedTracking);
    if (colis) {
      const tour = TOURS.find(t => t.id === colis.tourId);
      return res.json({
        success: true,
        found: true,
        trackingNumber: normalizedTracking,
        chauffeur: tour?.chauffeurName || 'Inconnu',
        sousTraitant: tour?.sousTraitantName || null,
        address: colis.address,
        tourType: tour?.isCaniao ? 'Cainiao' : 'Gofo',
        source: 'current'
      });
    }
    
    res.json({
      success: true,
      found: false,
      trackingNumber: normalizedTracking,
      message: 'Colis non trouvé'
    });
    
  } catch (err) {
    log('ERROR', 'Erreur récupération chauffeur original', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// API DISPATCHER - Lister les backups disponibles
// ==============================
app.get("/api/dispatcher/backups", authMiddleware(["DISPATCHER"]), (req, res) => {
  try {
    const { date } = req.query;
    const sousTraitant = req.user.sousTraitantName;
    
    // Filtrer les backups par sous-traitant et éventuellement par date
    const backups = Object.entries(ADMIN_TOUR_BACKUPS)
      .filter(([key, backup]) => {
        if (backup.tour.sousTraitantName !== sousTraitant) return false;
        if (date && !key.startsWith(`${date}_`)) return false;
        return true;
      })
      .map(([key, backup]) => ({
        key,
        chauffeur: backup.tour.chauffeurName,
        date: backup.tour.date,
        colisCount: backup.colis.length,
        createdAt: backup.createdAt,
        tourType: backup.tour.isCaniao ? 'Cainiao' : 'Gofo'
      }));
    
    res.json({
      success: true,
      date: date || null,
      sousTraitant,
      backups
    });
    
  } catch (err) {
    log('ERROR', 'Erreur liste backups', { error: err.message });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erreur serveur" });
  }
});

// ==============================
// DÉMARRAGE SERVEUR
// ==============================
app.listen(PORT, "0.0.0.0", () => {
  log('INFO', `🚀 Serveur démarré sur http://0.0.0.0:${PORT}`);
  log('INFO', `📊 État: ${TOURS.length} tournées, ${COLIS.length} colis`);
});
