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
    
    # Forcer l'encodage UTF-8 pour la sortie standard
    sys.stdout.reconfigure(encoding='utf-8')
    
    pdf_path = sys.argv[1]
    
    try:
        result = parse_spoke_pdf(pdf_path)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
