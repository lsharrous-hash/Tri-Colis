#!/usr/bin/env python3
import sys
import json
import re

def parse_spoke_pdf(pdf_path):
    try:
        import pdfplumber
    except ImportError:
        print(json.dumps({"error": "pdfplumber not installed"}))
        sys.exit(1)
    
    colis = []
    seen_trackings = set()
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                
                for table in tables:
                    if not table:
                        continue
                    
                    # Trouver les indices des colonnes
                    header = table[0] if table else []
                    header_lower = [str(h).lower() if h else '' for h in header]
                    
                    order_idx = None
                    address_idx = None
                    notes_idx = None
                    
                    for i, h in enumerate(header_lower):
                        if h == '#' or 'order' in h or 'n°' in h:
                            order_idx = i
                        elif 'address' in h or 'adresse' in h:
                            address_idx = i
                        elif 'notes' in h or 'tracking' in h or 'colis' in h:
                            notes_idx = i
                    
                    # Parser les lignes
                    for row in table[1:]:
                        if not row or len(row) < 2:
                            continue
                        
                        # Extraire l'ordre
                        order_num = None
                        if order_idx is not None and order_idx < len(row):
                            try:
                                order_num = int(str(row[order_idx]).strip())
                            except:
                                pass
                        
                        # Extraire l'adresse
                        address = ''
                        if address_idx is not None and address_idx < len(row):
                            address = str(row[address_idx] or '').strip()
                        
                        # Extraire les trackings de la colonne notes
                        notes = ''
                        if notes_idx is not None and notes_idx < len(row):
                            notes = str(row[notes_idx] or '').strip()
                        
                        # Chercher les trackings dans notes
                        # Patterns: GFFR..., DOFR..., CNFR..., CIFR... avec ou sans HD et ;
                        tracking_pattern = r'([A-Z]{2,4}FR\d{10,20})'
                        matches = re.findall(tracking_pattern, notes, re.IGNORECASE)
                        
                        for tracking in matches:
                            tracking_clean = tracking.upper()
                            # Enlever HD à la fin si présent
                            if tracking_clean.endswith('H'):
                                tracking_clean = tracking_clean[:-1]
                            
                            # Extraire la ville de l'adresse (après la dernière virgule)
                            city = ''
                            if ',' in address:
                                city = address.split(',')[-1].strip()
                            
                            if tracking_clean not in seen_trackings:
                                seen_trackings.add(tracking_clean)
                                colis.append({
                                    'orderNumber': order_num or len(colis) + 1,
                                    'trackingNumber': tracking_clean,
                                    'address': address,
                                    'city': city
                                })
        
        # Trier par numéro d'ordre
        colis.sort(key=lambda x: x['orderNumber'])
        
        print(json.dumps(colis))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: parse_spoke.py <pdf_path>"}))
        sys.exit(1)
    
    parse_spoke_pdf(sys.argv[1])
