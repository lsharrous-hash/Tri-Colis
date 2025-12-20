// importSpoke.js
const fs = require("fs");
const path = require("path");

// Chemin vers le fichier texte issu de Spoke
const SPOKE_FILE_PATH = path.join(__dirname, "tour-lucas.txt");

// Fonction de parsing d'une ligne Spoke
function parseSpokeLine(line) {
  // Exemple de ligne :
  // 1 3 Allée des sources, MUIZON 00:12 GFFR25335017538026;
  //
  // On utilise une regex :
  // ^(\d+)           -> numéro d'ordre (#)
  // \s+              -> espaces
  // (.+?)            -> adresse (lazy)
  // \s+(\d{2}:\d{2}) -> heure type 00:12
  // \s+(GFFR[0-9]+)  -> numéro GFFR
  // ;?               -> ; optionnel
  const regex = /^(\d+)\s+(.+?)\s+(\d{2}:\d{2})\s+(GFFR[0-9]+);?/;

  const match = line.match(regex);
  if (!match) {
    return null;
  }

  const orderNumber = parseInt(match[1], 10);
  const address = match[2].trim();
  const estimatedTime = match[3];
  const trackingNumber = match[4];

  return {
    orderNumber,
    address,
    estimatedTime,
    trackingNumber,
  };
}

// Fonction principale : lit le fichier et construit un tableau de colis
function importSpokeFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean); // retire les lignes vides

  const colis = [];
  const skipped = [];

  for (const line of lines) {
    const parsed = parseSpokeLine(line);
    if (parsed) {
      colis.push(parsed);
    } else {
      // On ignore les lignes d'entête / durée totale / etc.
      skipped.push(line);
    }
  }

  return { colis, skipped };
}

// Si on lance ce fichier directement : node importSpoke.js
if (require.main === module) {
  const { colis, skipped } = importSpokeFile(SPOKE_FILE_PATH);

  console.log("Colis importés :", colis.length);
  console.log(colis.slice(0, 5)); // affiche les 5 premiers pour contrôle

  console.log("\nLignes ignorées (entêtes, etc.) :");
  console.log(skipped.slice(0, 10));
}

// On exporte la fonction pour pouvoir l'utiliser plus tard dans index.js
module.exports = {
  importSpokeFile,
};
