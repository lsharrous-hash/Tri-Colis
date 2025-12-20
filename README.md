# Tri-Colis

Application de tri de colis pour sous-traitants de livraison.

## Structure du projet

```
tri-colis/
├── backend/          # Serveur Node.js (API)
│   ├── index.js      # Point d'entrée du serveur
│   ├── package.json  # Dépendances backend
│   ├── data.json     # Base de données (tournées et colis)
│   └── users.json    # Utilisateurs et authentification
│
├── mobile/           # Application React Native (Expo)
│   ├── App.tsx       # Code source de l'app
│   ├── package.json  # Dépendances mobile
│   └── app.json      # Configuration Expo
│
└── README.md
```

## Installation

### Backend

```bash
cd backend
npm install
node index.js
```

Le serveur démarre sur http://localhost:3000

### Mobile

```bash
cd mobile
npm install
npx expo start
```

Scanner le QR code avec l'app Expo Go sur ton téléphone.

## Fonctionnalités

- Import de tournées (PDF Spoke, Excel)
- Scan de colis par QR code / code-barres
- Saisie manuelle si code endommagé
- Numéro d'ordre et chauffeur affichés
- Gestion multi sous-traitants
- Rôles : ADMIN, DISPATCHER, TRIEUR

## Utilisateurs

Les identifiants par défaut sont configurés dans `users.json`.
Changez-les immédiatement après l'installation.
```

---

## Configuration

L'app mobile doit pointer vers l'IP du serveur backend.
Modifier `API_BASE_URL` dans `mobile/App.tsx` avec l'IP de ton PC.
