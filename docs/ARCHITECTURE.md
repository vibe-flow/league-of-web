# Architecture Technique

## Vue d'ensemble

League of Web est un MOBA jouable en navigateur, inspiré du mode ARAM de League of Legends. Le projet est structuré en monorepo avec deux grandes parties : l'application hors-jeu (lobby, UI) et le moteur de jeu en temps réel.

## Stack Technique

| Couche               | Technologie                                 | Rôle                                                 |
| -------------------- | ------------------------------------------- | ---------------------------------------------------- |
| **Rendu jeu**        | PixiJS (Canvas/WebGL)                       | Affichage de la map, sprites, particules, effets     |
| **UI hors-jeu**      | React + shadcn/ui + Tailwind                | Lobby, sélection de champion, écrans de résultats    |
| **API REST/tRPC**    | NestJS                                      | Gestion des lobbies, comptes (futur), stats          |
| **Game Server**      | NestJS WebSocket Gateway + game loop custom | Logique de jeu autoritaire, synchronisation          |
| **Base de données**  | PostgreSQL + Prisma                         | Données persistantes (comptes, stats)                |
| **Cache/temps réel** | Redis (futur)                               | Sessions, matchmaking                                |
| **Shared**           | Package shared (monorepo)                   | Types, constantes, formules partagées client/serveur |
| **Langage**          | TypeScript partout                          | Un seul langage, partage de code client/serveur      |

## Schéma d'Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                      │
│                                                              │
│  ┌──────────────────────┐    ┌───────────────────────────┐  │
│  │     React App         │    │     PixiJS Game Canvas    │  │
│  │                       │    │                           │  │
│  │  - Lobby              │    │  - Rendu de la map        │  │
│  │  - Sélection champion │◄──►│  - Sprites & animations   │  │
│  │  - Écran de résultat  │    │  - Particules & effets    │  │
│  │  - UI overlay in-game │    │  - Input handling         │  │
│  │                       │    │  - Client prediction      │  │
│  └──────────┬────────────┘    └──────────┬────────────────┘  │
│             │ tRPC                        │ WebSocket          │
└─────────────┼────────────────────────────┼───────────────────┘
              │                            │
              ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                        SERVEUR (NestJS)                      │
│                                                              │
│  ┌──────────────────────┐    ┌───────────────────────────┐  │
│  │     API Module        │    │     Game Server Module    │  │
│  │                       │    │                           │  │
│  │  - Lobby CRUD         │    │  - Game loop (30Hz)       │  │
│  │  - Auth (futur)       │    │  - Physique & collisions  │  │
│  │  - Stats (futur)      │    │  - Logique de combat      │  │
│  │                       │    │  - Pathfinding            │  │
│  └──────────┬────────────┘    │  - State broadcast        │  │
│             │                 │  - Fog of War             │  │
│             ▼                 └───────────────────────────┘  │
│  ┌──────────────────────┐                                    │
│  │  PostgreSQL + Prisma  │                                   │
│  └──────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
```

## Principes Fondamentaux

### Serveur Autoritaire

Le serveur est la seule source de vérité. Le client envoie des **intentions** (clic droit pour bouger, lancer un sort), le serveur **valide et exécute**. Le client ne fait qu'afficher et prédire.

Cela garantit :

- **Anti-triche** : le client ne peut pas modifier ses stats, sa position, etc.
- **Cohérence** : tous les joueurs voient le même état de jeu
- **Fog of War sécurisé** : le client ne reçoit jamais les positions des ennemis invisibles

### Partage de code Client/Serveur

Grâce au monorepo TypeScript, le package `shared` contient :

- Les **types** (ChampionDefinition, AbilityDefinition, GameState, etc.)
- Les **constantes** (stats de base, cooldowns, ratios)
- Les **formules** (calcul de dégâts, scaling par niveau)
- Les **enums** et identifiants

Le client utilise ces données pour la prédiction, le serveur pour la logique autoritaire.

### Séparation Hors-Jeu / En-Jeu

|                   | Hors-jeu (Lobby)       | En-jeu (Match)                |
| ----------------- | ---------------------- | ----------------------------- |
| **Rendu**         | React + shadcn         | PixiJS Canvas                 |
| **Communication** | tRPC (requête/réponse) | WebSocket (temps réel)        |
| **Fréquence**     | À la demande           | 30 ticks/seconde              |
| **State**         | Base de données        | En mémoire sur le game server |

Quand un match démarre, le client bascule de la vue React vers le canvas PixiJS. Quand le match se termine, il revient sur React.

## Structure du Monorepo

```
league-of-web/
├── apps/
│   ├── api/                    # NestJS — API + Game Server
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── lobby/      # Gestion des lobbies (tRPC)
│   │       │   └── game/       # Game server (WebSocket + game loop)
│   │       └── ...
│   └── web/                    # React — Client web
│       └── src/
│           ├── pages/          # Lobby, résultats
│           ├── game/           # Canvas PixiJS, rendu, input
│           └── ...
├── packages/
│   └── shared/                 # Types, constantes, formules partagées
│       └── src/
│           ├── champions/      # Définitions des champions
│           ├── types/          # Interfaces communes
│           └── formulas/       # Calculs de dégâts, stats, etc.
├── docs/                       # Documentation du projet
└── prisma/                     # Schéma de base de données
```

## Scalabilité

### Un process par match

Chaque match tourne dans son propre contexte isolé. Cela permet :

- D'éviter qu'un crash d'un match affecte les autres
- De répartir la charge (futur : plusieurs serveurs)
- De garbage-collecter proprement à la fin d'un match

### Optimisations futures si nécessaire

- **WASM** : compiler les calculs lourds (pathfinding) en Rust/WASM et les appeler depuis Node.js
- **Worker threads** : isoler le game loop dans un thread dédié
- **Redis** : pour le matchmaking et la communication inter-process
