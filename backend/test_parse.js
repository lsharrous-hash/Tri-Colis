const fs = require('fs');

// Charger la fonction parseSpokeColis
const textContent = fs.readFileSync('./test_spoke.txt', 'utf8');

// Fonction log simple
function log(level, message, data = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...data }, null, 2));
}

// Copier la fonction parseSpokeColis ici
function parseSpokeColis(textContent) {
  const colisForTour = [];
  const seenTracking = new Set();

  log('INFO', 'Parsing Spoke démarré', { textLength: textContent.length });

  // NORMALISER : coller le "HD" qui est séparé par un espace
  let normalizedText = textContent.replace(/([A-Z]{2,4}FR\d{10,20})\s+HD\s*;?/gi, '$1HD');
  normalizedText = normalizedText.replace(/([A-Z]{2,4}FR\d{10,20})HD\s*;/gi, '$1HD');

  // Extraire TOUS les numéros de tracking dans l'ordre d'apparition
  const trackingRegex = /[A-Z]{2,4}FR\d{10,20}[A-Z]{0,4}/gi;
  const allTracking = normalizedText.match(trackingRegex) || [];
  const uniqueTracking = [...new Set(allTracking.map(t => t.toUpperCase()))];
  
  log('INFO', 'Numéros tracking trouvés', { count: uniqueTracking.length, sample: uniqueTracking.slice(0, 5) });

  // Créer un map tracking -> {adresse, orderNumber}
  const trackingToData = {};
  
  // Stratégie: Extraire les lignes avec un pattern numéro # adresse heure tracking
  // Format Spoke: "256 6 RUE DE TALLEYRAND Bubble coffee, Reims, Marne 11:01 CNFR9010444597926HD"
  const lines = normalizedText.split('\n');
  
  for (const line of lines) {
    // Pattern : NUMÉRO # au début (optionnel) + ADRESSE + HEURE + TRACKING
    // Chercher un tracking dans cette ligne
    const trackingMatch = line.match(/([A-Z]{2,4}FR\d{10,20}[A-Z]{0,4})/i);
    if (trackingMatch) {
      const tracking = trackingMatch[1].toUpperCase();
      
      // Chercher le numéro d'ordre (nombre au début, avant l'adresse)
      const orderMatch = line.match(/^\s*(\d+)\s+/);
      const orderNumber = orderMatch ? parseInt(orderMatch[1], 10) : null;
      
      // Chercher l'adresse: entre le numéro et l'heure (HH:MM)
      // Pattern: "256 6 RUE DE TALLEYRAND Bubble coffee, Reims, Marne 11:01 TRACKING"
      let addressMatch = line.match(/^\s*\d+\s+(.+?)\s+\d{1,2}:\d{2}\s+[A-Z]{2,4}FR/i);
      
      // Autre pattern si le précédent ne match pas
      if (!addressMatch) {
        addressMatch = line.match(/(.+?)\s+\d{1,2}:\d{2}\s+[A-Z]{2,4}FR/i);
      }
      
      if (addressMatch && addressMatch[1]) {
        let address = addressMatch[1].trim();
        // Nettoyer l'adresse : enlever les numéros au début s'ils sont là
        address = address.replace(/^\d+\s+/, '').trim();
        
        if (address.length > 5 && address.length < 200) {
          trackingToData[tracking] = {
            address: address,
            orderNumber: orderNumber
          };
          log('DEBUG', 'Ligne parsée', { 
            orderNumber, 
            address: address.substring(0, 50), 
            tracking 
          });
        }
      }
    }
  }
  
  // Méthode de secours: Si pas trouvé, chercher le contexte autour du tracking
  for (const tracking of uniqueTracking) {
    if (!trackingToData[tracking]) {
      // Chercher le tracking dans le texte et regarder ce qu'il y a avant
      const trackingIndex = normalizedText.toUpperCase().indexOf(tracking);
      if (trackingIndex > 0) {
        // Prendre 500 caractères avant le tracking (pour capturer l'adresse complète)
        const before = normalizedText.substring(Math.max(0, trackingIndex - 500), trackingIndex);
        
        // Chercher une adresse complète
        const addressPatterns = [
          // Pattern complet avec plusieurs lignes: numéro rue, entité, ville
          /(\d+[A-Za-z]?\s+(?:rue|avenue|boulevard|allée|place|impasse|chemin|passage|esplanade|quai|cours)[^,\n]{5,80}(?:,\s*[A-Za-zÀ-ÿ\s\-']{2,50})?(?:,\s*[A-Za-zÀ-ÿ]{2,30})?)/gi,
          // Pattern simple : numéro + texte + ville
          /(\d+[A-Za-z]?,?\s*[A-Za-zÀ-ÿ\s\-']{5,60},\s*[A-Za-zÀ-ÿ]{2,30})/gi,
        ];
        
        for (const pattern of addressPatterns) {
          const matches = before.match(pattern);
          if (matches && matches.length > 0) {
            // Prendre la dernière adresse trouvée (la plus proche du tracking)
            let address = matches[matches.length - 1].trim();
            if (address.length > 10 && address.length < 200) {
              trackingToData[tracking] = {
                address: address,
                orderNumber: null
              };
              log('DEBUG', 'Adresse trouvée (contexte)', { address: address.substring(0, 50), tracking });
              break;
            }
          }
        }
      }
    }
  }

  log('INFO', 'Adresses trouvées', { count: Object.keys(trackingToData).length });

  // Construire la liste des colis avec les données trouvées
  let lastOrderNumber = 0;
  for (let i = 0; i < uniqueTracking.length; i++) {
    const tracking = uniqueTracking[i];
    const data = trackingToData[tracking] || {};
    
    // Si on a un numéro d'ordre, l'utiliser; sinon utiliser l'index
    let orderNumber = data.orderNumber;
    if (!orderNumber) {
      lastOrderNumber++;
      orderNumber = lastOrderNumber;
    } else {
      lastOrderNumber = orderNumber;
    }
    
    const address = data.address || "Adresse à vérifier";
    
    colisForTour.push({
      orderNumber: orderNumber,
      address: address,
      trackingNumber: tracking,
    });
    seenTracking.add(tracking);
  }
  
  log('INFO', 'Parsing Spoke terminé', { 
    total: colisForTour.length, 
    premier: colisForTour[0],
    dernier: colisForTour[colisForTour.length - 1]
  });

  return colisForTour;
}

// Tester
console.log('\n========== TEST PARSING SPOKE ==========\n');
const result = parseSpokeColis(textContent);
console.log('\n========== RÉSULTAT ==========\n');
console.log(JSON.stringify(result, null, 2));
