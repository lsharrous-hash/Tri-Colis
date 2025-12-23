#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parser universel pour l'import de fichiers de livraison
Supporte: PDF Spoke (multi/uni chauffeur), Excel Gofo, Excel Cainiao
Extensible pour d'autres formats
"""

import sys
import json
import re
import os

# ============================================================
# CONFIGURATION DES FORMATS (extensible)
# ============================================================

EXCEL_FORMATS = {
    "gofo": {
        "tracking_columns": ["data.waybillNo", "waybillNo", "Tracking", "tracking", "Numéro de tracking"],
        "address_columns": ["data.toStreet", "toStreet", "Address", "address", "Adresse"],
        "city_columns": ["data.toCity", "toCity", "City", "city", "Ville"],
        "postal_columns": [],  # Gofo n'a pas de code postal
        "order_columns": []
    },
    "cainiao": {
        "tracking_columns": ["Tracking No.", "TrackingNo", "tracking_no", "Numéro de suivi", "Numéro de tracking"],
        "address_columns": ["Receiver's Detail Address", "ReceiverAddress", "Address", "Adresse"],
        "city_columns": ["Receiver's City", "ReceiverCity", "City", "Ville"],
        "postal_columns": ["Receiver's Zip Code", "ZipCode", "PostalCode", "Code Postal", "Code postal"],
        "order_columns": []
    }
}

# ============================================================
# FONCTIONS DE NETTOYAGE
# ============================================================

def clean_tracking(text, source_type=None):
    """
    Nettoie le code tracking selon le type de source
    - Gofo (GFFR): 18 chars -> 17 chars (enlève dernier chiffre parasite)
    - Cainiao (DOFR/CNFR): enlève suffixe XHD
    """
    if not text:
        return ""
    
    # Convertir en string et nettoyer
    cleaned = str(text).replace('\n', '').replace(' ', '').replace(';', '').strip()
    
    # Enlever le suffixe HD pour Cainiao
    if cleaned.startswith(('DOFR', 'CNFR')):
        # Pattern: ...XHD où X est un chiffre
        cleaned = re.sub(r'\dHD$', '', cleaned)
    
    # Enlever le dernier chiffre parasite pour Gofo (18 -> 17 chars)
    elif cleaned.startswith('GFFR') and len(cleaned) == 18:
        cleaned = cleaned[:-1]
    
    return cleaned

def get_colis_type(tracking):
    """Détermine le type de colis basé sur le préfixe du tracking"""
    if not tracking:
        return None
    if tracking.startswith('GFFR'):
        return 'gofo'
    elif tracking.startswith(('DOFR', 'CNFR')):
        return 'cainiao'
    return 'unknown'

def extract_postal_code(text):
    """Extrait le code postal (5 chiffres) d'un texte"""
    if not text:
        return ""
    match = re.search(r'\b(\d{5})\b', str(text))
    return match.group(1) if match else ""

def extract_city_from_address(address):
    """Tente d'extraire la ville depuis l'adresse"""
    if not address:
        return ""
    
    # Patterns courants
    patterns = [
        r',\s*([A-ZÀ-Ÿ][a-zà-ÿ\-]+)\s*,',  # Entre virgules
        r',\s*([A-ZÀ-Ÿ][a-zà-ÿ\-]+)\s*$',  # Après dernière virgule
        r'\d{5}\s+([A-ZÀ-Ÿ][a-zà-ÿA-ZÀ-Ÿ\-]+)',  # Après code postal
    ]
    
    for pattern in patterns:
        match = re.search(pattern, address)
        if match:
            return match.group(1).strip()
    
    # Fallback: chercher "Reims" ou "REIMS"
    if re.search(r'\breims\b', address, re.IGNORECASE):
        return "Reims"
    
    return ""

# ============================================================
# PARSERS SPECIFIQUES
# ============================================================

def fix_encoding(text):
    """
    Répare les problèmes d'encodage courants dans les textes.
    Remplace le caractère de remplacement Unicode (U+FFFD) et autres corruptions.
    """
    if not text or not isinstance(text, str):
        return text
    
    # Remplacements courants pour les caractères corrompus
    replacements = {
        '�': 'é',  # Cas le plus courant
        '\ufffd': 'é',
        'Ã©': 'é',
        'Ã¨': 'è',
        'Ãª': 'ê',
        'Ã ': 'à',
        'Ã¢': 'â',
        'Ã®': 'î',
        'Ã´': 'ô',
        'Ã»': 'û',
        'Ã§': 'ç',
        'Ã‰': 'É',
        'Ã€': 'À',
        'Ã"': 'Ô',
        'Å"': 'œ',
        'â€™': "'",
        'â€"': '-',
        'â€œ': '"',
        'â€': '"',
    }
    
    result = text
    for old, new in replacements.items():
        result = result.replace(old, new)
    
    return result

def parse_excel(filepath, filename):
    """
    Parse un fichier Excel (Gofo ou Cainiao)
    Retourne: {chauffeurs: [{name, colis: [...]}], format_detected}
    """
    try:
        import pandas as pd
    except ImportError:
        return {"error": "pandas non installé"}
    
    df = pd.read_excel(filepath)
    columns = [str(c) for c in df.columns]
    
    # Détecter le format
    detected_format = None
    column_mapping = {}
    
    for format_name, format_config in EXCEL_FORMATS.items():
        # Chercher la colonne tracking
        tracking_col = None
        for tc in format_config["tracking_columns"]:
            if tc in columns:
                tracking_col = tc
                break
        
        if tracking_col:
            detected_format = format_name
            column_mapping["tracking"] = tracking_col
            
            # Chercher les autres colonnes
            for ac in format_config["address_columns"]:
                if ac in columns:
                    column_mapping["address"] = ac
                    break
            
            for cc in format_config["city_columns"]:
                if cc in columns:
                    column_mapping["city"] = cc
                    break
            
            for pc in format_config["postal_columns"]:
                if pc in columns:
                    column_mapping["postal"] = pc
                    break
            
            for oc in format_config["order_columns"]:
                if oc in columns:
                    column_mapping["order"] = oc
                    break
            
            break
    
    if not detected_format:
        return {"error": f"Format Excel non reconnu. Colonnes trouvées: {columns}"}
    
    # Extraire le nom du chauffeur depuis le nom du fichier
    chauffeur_name = extract_chauffeur_from_filename(filename)
    
    # Parser les colis
    colis_list = []
    for idx, row in df.iterrows():
        tracking_raw = row.get(column_mapping.get("tracking", ""), "")
        if pd.isna(tracking_raw) or not tracking_raw:
            continue
        
        tracking = clean_tracking(tracking_raw)
        if not tracking:
            continue
        
        colis_type = get_colis_type(tracking)
        
        address = str(row.get(column_mapping.get("address", ""), "")) if column_mapping.get("address") else ""
        city = str(row.get(column_mapping.get("city", ""), "")) if column_mapping.get("city") else ""
        postal = ""
        
        # Réparer l'encodage des caractères spéciaux
        address = fix_encoding(address)
        city = fix_encoding(city)
        
        if column_mapping.get("postal"):
            postal_val = row.get(column_mapping["postal"], "")
            if not pd.isna(postal_val):
                postal = str(int(postal_val)) if isinstance(postal_val, float) else str(postal_val)
        
        # Si pas de ville, essayer d'extraire de l'adresse
        if not city or city == "nan":
            city = extract_city_from_address(address)
        
        # Si pas de code postal, essayer d'extraire de l'adresse
        if not postal:
            postal = extract_postal_code(address)
        
        # Nettoyer les valeurs "nan"
        if city == "nan":
            city = ""
        if address == "nan":
            address = ""
        
        colis_list.append({
            "trackingNumber": tracking,
            "type": colis_type,
            "orderNumber": None,  # Excel n'a pas de numéro d'ordre
            "address": address.strip(),
            "city": city.strip(),
            "postalCode": postal.strip()
        })
    
    return {
        "success": True,
        "format": f"excel_{detected_format}",
        "chauffeurs": [{
            "name": chauffeur_name,
            "colis": colis_list
        }],
        "totalColis": len(colis_list),
        "stats": count_by_type(colis_list)
    }

def parse_pdf_spoke(filepath, filename):
    """
    Parse un fichier PDF Spoke (multi ou uni chauffeur)
    Retourne: {chauffeurs: [{name, colis: [...]}], format_detected}
    """
    try:
        import pdfplumber
    except ImportError:
        return {"error": "pdfplumber non installé"}
    
    with pdfplumber.open(filepath) as pdf:
        # Extraire le texte du header (première page)
        first_page = pdf.pages[0]
        header_text = first_page.extract_text() or ""
        header_lines = header_text.split('\n')[:5]
        header_combined = ' '.join(header_lines)
        
        # Détecter les plages de chauffeurs
        plages = extract_chauffeur_plages(header_combined)
        
        is_multi = len(plages) > 0
        
        # Si uni-chauffeur, extraire le nom du header ou du fichier
        if not is_multi:
            chauffeur_name = extract_chauffeur_from_header(header_lines[0] if header_lines else "")
            if not chauffeur_name:
                chauffeur_name = extract_chauffeur_from_filename(filename)
            plages = [{"name": chauffeur_name, "start": 1, "end": 99999}]
        
        # Extraire tous les colis du PDF
        all_colis = []
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if not row or len(row) < 4:
                        continue
                    
                    # Ignorer les headers et lignes vides
                    order_str = row[0]
                    if not order_str or order_str == '#' or not order_str.strip().isdigit():
                        continue
                    
                    # Ignorer "Lieu d'arrivée"
                    if row[1] and "Lieu d'" in str(row[1]):
                        continue
                    
                    order_num = int(order_str.strip())
                    address = str(row[1] or "").strip()
                    tracking_raw = str(row[3] or "").strip()
                    
                    tracking = clean_tracking(tracking_raw)
                    if not tracking:
                        continue
                    
                    colis_type = get_colis_type(tracking)
                    city = extract_city_from_address(address)
                    postal = extract_postal_code(address)
                    
                    all_colis.append({
                        "trackingNumber": tracking,
                        "type": colis_type,
                        "orderNumber": order_num,
                        "address": address,
                        "city": city,
                        "postalCode": postal
                    })
        
        # Distribuer les colis par chauffeur selon les plages
        chauffeurs_data = []
        for plage in plages:
            chauffeur_colis = [
                c for c in all_colis 
                if c["orderNumber"] and plage["start"] <= c["orderNumber"] <= plage["end"]
            ]
            
            if chauffeur_colis or not is_multi:
                chauffeurs_data.append({
                    "name": plage["name"],
                    "plage": f"{plage['start']}-{plage['end']}" if is_multi else None,
                    "colis": chauffeur_colis if chauffeur_colis else all_colis
                })
        
        # Si aucun chauffeur trouvé, mettre tous les colis sous "Inconnu"
        if not chauffeurs_data:
            chauffeur_name = extract_chauffeur_from_filename(filename)
            chauffeurs_data.append({
                "name": chauffeur_name,
                "colis": all_colis
            })
        
        return {
            "success": True,
            "format": "pdf_spoke_multi" if is_multi else "pdf_spoke_uni",
            "chauffeurs": chauffeurs_data,
            "totalColis": len(all_colis),
            "stats": count_by_type(all_colis)
        }

# ============================================================
# FONCTIONS UTILITAIRES
# ============================================================

def extract_chauffeur_plages(header_text):
    """
    Extrait les plages de chauffeurs depuis le header
    Formats supportés: (NOM début-fin), (NOMdébut-fin), NOM (début-fin)
    """
    plages = []
    seen = set()
    
    # Pattern: (NOM début-fin) ou (NOMdébut-fin) - espace optionnel
    matches = re.findall(r'\(([A-Za-zÀ-ÿ]+)\s*(\d+)-(\d+)\)', header_text)
    for match in matches:
        name = match[0].strip()
        start = int(match[1])
        end = int(match[2])
        key = f"{start}-{end}"
        
        if key not in seen and start < end:
            seen.add(key)
            # Normaliser le nom: première lettre majuscule
            name_normalized = name[0].upper() + name[1:].lower()
            plages.append({"name": name_normalized, "start": start, "end": end})
    
    # Pattern: NOM (début-fin) - si pas déjà trouvé
    if not plages:
        matches = re.findall(r'([A-Za-zÀ-ÿ]+)\s*\(\s*(\d+)\s*-\s*(\d+)\s*\)', header_text)
        for match in matches:
            name = match[0].strip()
            start = int(match[1])
            end = int(match[2])
            key = f"{start}-{end}"
            
            if key not in seen and start < end:
                seen.add(key)
                name_normalized = name[0].upper() + name[1:].lower()
                plages.append({"name": name_normalized, "start": start, "end": end})
    
    return sorted(plages, key=lambda x: x["start"])

def extract_chauffeur_from_header(header_line):
    """Extrait le nom du chauffeur depuis la première ligne du header"""
    if not header_line:
        return None
    
    # Pattern: "NomChauffeur JJ/MM" ou "NomChauffeur - date"
    match = re.match(r'^([A-Za-zÀ-ÿ]+)\s+\d+[/\-]', header_line)
    if match:
        name = match.group(1)
        return name[0].upper() + name[1:].lower()
    
    # Pattern: "NomChauffeur - lun." etc.
    match = re.match(r'^([A-Za-zÀ-ÿ]+)\s+-\s+', header_line)
    if match:
        name = match.group(1)
        return name[0].upper() + name[1:].lower()
    
    return None

def extract_chauffeur_from_filename(filename):
    """Extrait le nom du chauffeur depuis le nom du fichier"""
    if not filename:
        return "Inconnu"
    
    # Enlever l'extension
    name = os.path.splitext(filename)[0]
    
    # Enlever les suffixes courants: _JJ_MM, -JJ_MM, JJ_MM, 23_12, etc.
    name = re.sub(r'[_\-\s]?\d{1,2}[_\-]\d{1,2}$', '', name)
    
    # Liste des noms de sous-traitants à enlever (insensible à la casse)
    st_names = ['jnr', 'sow', 'dt', 'd transport', 'dtransport', 'ktm', 'speedhall', 'tcp', 'transport vals', 'ayoub-dt', 'ayoub dt']
    
    # Enlever les noms de ST en fin de chaîne (avec espace ou séparateur)
    for st in st_names:
        # Avec séparateur ou espace
        name = re.sub(rf'[\s_\-]+{re.escape(st)}$', '', name, flags=re.IGNORECASE)
        # Sans séparateur si le nom fait plus de longueur du ST + 3 caractères
        if len(name) > len(st) + 3:
            name = re.sub(rf'{re.escape(st)}$', '', name, flags=re.IGNORECASE)
    
    # Enlever les suffixes de type longs (avec ou sans séparateur)
    name = re.sub(r'[_\-\s]?(mutualis[eé]|mutualise|gofo|cainiao|caniao|gffr|cnfr|dofr)$', '', name, flags=re.IGNORECASE)
    
    # Enlever les suffixes courts m/c/g SEULEMENT avec séparateur (ex: ayoub_c, test-m)
    name = re.sub(r'[_\-][mcg]$', '', name, flags=re.IGNORECASE)
    
    # Nettoyer
    name = name.strip('_- ')
    
    if name:
        return name[0].upper() + name[1:].lower()
    
    return "Inconnu"

def count_by_type(colis_list):
    """Compte les colis par type"""
    stats = {"gofo": 0, "cainiao": 0, "unknown": 0}
    for c in colis_list:
        t = c.get("type", "unknown")
        if t in stats:
            stats[t] += 1
        else:
            stats["unknown"] += 1
    return stats

# ============================================================
# POINT D'ENTRÉE PRINCIPAL
# ============================================================

def parse_file(filepath, filename=None):
    """
    Point d'entrée principal - détecte le format et parse le fichier
    """
    if not os.path.exists(filepath):
        return {"error": f"Fichier non trouvé: {filepath}"}
    
    if not filename:
        filename = os.path.basename(filepath)
    
    ext = os.path.splitext(filename)[1].lower()
    
    if ext == '.pdf':
        return parse_pdf_spoke(filepath, filename)
    elif ext in ['.xlsx', '.xls']:
        return parse_excel(filepath, filename)
    else:
        return {"error": f"Format non supporté: {ext}"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python parse_import.py <filepath> [filename]"}))
        sys.exit(1)
    
    filepath = sys.argv[1]
    filename = sys.argv[2] if len(sys.argv) > 2 else None
    
    result = parse_file(filepath, filename)
    print(json.dumps(result, ensure_ascii=False))
