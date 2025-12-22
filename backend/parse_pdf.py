#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parse PDF files to extract tracking numbers and addresses.
Supports both table-based PDFs (Spoke format) and text-based PDFs.
"""

import sys
import json
import re

def clean_tracking(tracking):
    """Nettoie un numéro de tracking (retire les retours à la ligne et suffixes)"""
    if not tracking:
        return ""
    # Retirer les retours à la ligne et les suffixes comme "3;" ou "HD;"
    cleaned = re.sub(r'[\r\n]+', '', str(tracking))
    cleaned = re.sub(r';.*$', '', cleaned)
    return cleaned.strip()

def extract_tracking_from_text(text):
    """Extrait un tracking d'un texte qui peut contenir d'autres données"""
    if not text:
        return None
    # Chercher un pattern de tracking
    match = re.search(r'(GFFR|DOFR|CNFR|CRFR|SPFR)\d{12,16}', str(text), re.IGNORECASE)
    if match:
        return match.group(0).upper()
    return None

def parse_pdf_with_pdfplumber(pdf_path):
    """Parse un PDF avec pdfplumber pour extraire les tables"""
    try:
        import pdfplumber
    except ImportError:
        return None
    
    colis = []
    seen_trackings = set()
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if not row or len(row) < 2:
                            continue
                        
                        # Format Spoke typique: [#, Address, Time, Notes(tracking)]
                        # Chercher le tracking dans toutes les cellules
                        tracking = None
                        tracking_cell_idx = -1
                        
                        for i, cell in enumerate(row):
                            if cell:
                                found_tracking = extract_tracking_from_text(cell)
                                if found_tracking:
                                    tracking = found_tracking
                                    tracking_cell_idx = i
                                    break
                        
                        if not tracking:
                            continue
                        
                        # Trouver l'adresse (généralement cellule [1] pour format Spoke)
                        address = ""
                        
                        # Format Spoke: l'adresse est dans la 2ème cellule (index 1)
                        if len(row) > 1 and row[1]:
                            potential_addr = str(row[1]).strip()
                            # Vérifier que ce n'est pas un tracking ou une heure
                            if (len(potential_addr) > 10 and 
                                not re.search(r'GFFR|DOFR|CNFR|CRFR|SPFR', potential_addr, re.I) and
                                not re.match(r'^\d{2}:\d{2}$', potential_addr)):
                                address = potential_addr
                        
                        # Fallback: chercher dans les autres cellules
                        if not address:
                            for i, cell in enumerate(row):
                                if i == tracking_cell_idx or not cell:
                                    continue
                                potential = str(cell).strip()
                                if (len(potential) > 15 and 
                                    not re.search(r'GFFR|DOFR|CNFR|CRFR|SPFR', potential, re.I) and
                                    not re.match(r'^\d{2}:\d{2}$', potential) and
                                    not re.match(r'^\d+$', potential)):
                                    address = potential
                                    break
                        
                        if tracking not in seen_trackings:
                            seen_trackings.add(tracking)
                            colis.append({
                                "trackingNumber": tracking,
                                "address": address,
                                "city": ""
                            })
    except Exception as e:
        print(json.dumps({"error": f"Erreur pdfplumber: {str(e)}"}), file=sys.stderr)
        return None
    
    return colis

def parse_pdf_with_regex(pdf_path):
    """Fallback: extraire les trackings du texte brut"""
    try:
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            text = ""
            for page in pdf.pages:
                text += page.extract_text() or ""
    except:
        # Essayer avec PyPDF2 si pdfplumber échoue
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(pdf_path)
            text = ""
            for page in reader.pages:
                text += page.extract_text() or ""
        except:
            return []
    
    # Extraire tous les trackings
    tracking_pattern = r'\b(GFFR|DOFR|CNFR|CRFR|SPFR)\d{12,16}\b'
    matches = re.findall(tracking_pattern, text, re.IGNORECASE)
    
    # Reconstruire les trackings complets
    full_matches = re.findall(r'\b(?:GFFR|DOFR|CNFR|CRFR|SPFR)\d{12,16}\b', text, re.IGNORECASE)
    
    seen = set()
    colis = []
    for match in full_matches:
        upper = match.upper()
        if upper not in seen:
            seen.add(upper)
            colis.append({
                "trackingNumber": upper,
                "address": "",
                "city": ""
            })
    
    return colis

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: parse_pdf.py <pdf_path>"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    # Essayer avec pdfplumber (tables avec adresses)
    colis = parse_pdf_with_pdfplumber(pdf_path)
    
    # Si pas assez de résultats, utiliser le fallback regex
    if not colis or len(colis) < 5:
        colis_regex = parse_pdf_with_regex(pdf_path)
        if colis_regex:
            # Fusionner les résultats
            if colis:
                existing = set(c["trackingNumber"] for c in colis)
                for c in colis_regex:
                    if c["trackingNumber"] not in existing:
                        colis.append(c)
            else:
                colis = colis_regex
    
    print(json.dumps(colis, ensure_ascii=False))

if __name__ == "__main__":
    main()
