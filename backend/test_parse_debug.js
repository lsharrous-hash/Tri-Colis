const pdfParse = require('pdf-parse');
const fs = require('fs');

const buf = fs.readFileSync('C:/Users/trans/Desktop/testestest/louis0912test.pdf');

pdfParse(buf).then(d => {
  let text = d.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  console.log("=== TEXTE BRUT (500 premiers chars) ===");
  console.log(text.substring(0, 500));
  
  // Normalisation
  text = text.replace(/([A-Za-zÀ-ÿ0-9])(\d{2}:\d{2})/g, '$1 $2');
  text = text.replace(/(\d{2}:\d{2})\s*\n\s*([A-Z]{2,4}FR\d{10,20})\s*\n\s*HD;?/gi, '$1 $2HD;');
  text = text.replace(/(\d{2}:\d{2})\s*\n\s*([A-Z]{2,4}FR\d{10,20}HD);?/gi, '$1 $2;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})\s+H\s*D\s*;?/gi, '$1HD;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})HD\s*;/gi, '$1HD;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})H\s+D\s*;?/gi, '$1HD;');
  text = text.replace(/([A-Z]{2,4}FR\d{10,20})H\s*\n\s*D\s*;?/gi, '$1HD;');
  
  console.log("\n=== TEXTE NORMALISÉ (1000 premiers chars) ===");
  console.log(text.substring(0, 1000));
  
  // Test du pattern
  const linePattern = /^(\d+[^\d].+?)\s+(\d{2}:\d{2})\s*([A-Z]{2,4}FR\d{10,25}(?:HD)?);?/gm;
  const matches = [];
  let match;
  let sequentialOrder = 0;
  while ((match = linePattern.exec(text)) !== null && matches.length < 5) {
    sequentialOrder++;
    matches.push({
      orderNumber: sequentialOrder,
      address: match[1].trim(),
      time: match[2],
      tracking: match[3]
    });
  }
  
  console.log("\n=== MATCHES DU PATTERN (5 premiers) ===");
  console.log(JSON.stringify(matches, null, 2));
});
