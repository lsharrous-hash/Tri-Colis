#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import json
import pdfplumber

# Forcer l'encodage UTF-8 pour stdout
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def parse_spoke_pdf(pdf_path):
    all_data = []
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                tables = page.extract_tables()
                
                for table in tables:
                    for row in table:
                        # Vérifier que la ligne a au moins 4 colonnes
                        if not row or len(row) < 4:
                            continue
                        
                        # Ignorer les headers et lignes vides
                        if not row[0] or row[0] == '#' or row[0].strip() == '':
                            continue
                        
                        # Nettoyer les données
                        order_num = row[0].strip() if row[0] else ''
                        address = row[1].strip() if row[1] else ''
                        time = row[2].strip() if row[2] else ''
                        tracking = row[3] if row[3] else ''
                        
                        # Nettoyer le code tracking (supprimer retours à la ligne, espaces, point-virgule final)
                        if tracking:
                            tracking = tracking.replace('\n', '').replace('\r', '').replace(' ', '').replace(';', '').strip()
                        
                        # Vérifier que les données essentielles sont présentes
                        if order_num and address and tracking:
                            all_data.append({
                                'orderNumber': order_num,
                                'address': address,
                                'estimatedTime': time,
                                'trackingNumber': tracking
                            })
        
        # Retourner en JSON
        print(json.dumps(all_data, ensure_ascii=False))
        return 0
        
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        return 1

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: python parse_pdf_spoke.py <pdf_path>'}), file=sys.stderr)
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    sys.exit(parse_spoke_pdf(pdf_path))
