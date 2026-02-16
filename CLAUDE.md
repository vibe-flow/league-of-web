# CLAUDE.md

## Projet

League of Web — MOBA web (mode ARAM) jouable en navigateur.

## Stack

- Monorepo Bun : `apps/web` (React/Vite + PixiJS), `apps/api` (NestJS)
- Validation : Zod, schemas dans `packages/shared/src/schemas/`
- API : tRPC pour le hors-jeu (lobby, stats), WebSocket pour le in-game
- ORM : Prisma, schema dans `prisma/schema.prisma`
- State management : Zustand (`stores/`)
- Rendu jeu : PixiJS (Canvas/WebGL) dans un composant React
- Game server : NestJS WebSocket Gateway + game loop custom (30Hz)
- Tests : Vitest

## Infrastructure

PostgreSQL, Redis et autres services sont heberges dans un repo partage :
`/Users/flow/Dev/local-services/` (docker-compose avec `make up`).

Ce projet n'a PAS son propre Docker Compose pour la DB. Les connexions :

- PostgreSQL : `localhost:5432` (user: postgres, password: postgres)
- Redis : `localhost:6379`

## Commandes

```bash
bun install              # Installer les dependances
bun run dev              # Lancer le dev (web + api)
bun run dev:web          # Lancer seulement le frontend
bun run dev:api          # Lancer seulement le backend
make db-migrate          # Migrations Prisma
make db-studio           # Interface BDD
make test                # Lancer tous les tests
make lint                # ESLint
make format              # Prettier + ESLint
```

## Conventions

- Nouveaux modules API dans `apps/api/src/modules/`
- Chaque module a son fichier tRPC : `{module}.trpc.ts`
- Schemas Zod partages dans `packages/shared/src/schemas/`
- Tests dans le meme dossier que le fichier teste : `*.spec.ts`
- Composants UI avec shadcn/ui + Tailwind
- State global via Zustand stores

## Architecture du Jeu

- **Hors-jeu** (lobby, selection champion, resultats) : React + shadcn/ui + tRPC
- **In-game** (le match) : PixiJS Canvas + WebSocket temps reel
- **Serveur autoritaire** : le serveur fait foi, le client predit et affiche
- **Shared package** : types, constantes, formules de jeu partagees client/serveur

## Documentation

- `docs/ARCHITECTURE.md` — Vue d'ensemble technique
- `docs/GAME_DESIGN.md` — Regles du jeu, stats, formules
- `docs/ROADMAP.md` — Phases de developpement
- `docs/technical/NETCODE.md` — Synchronisation reseau
- `docs/technical/CHAMPIONS.md` — Systeme de champions et sorts
- `docs/technical/PATHFINDING.md` — Navigation et deplacement
- `docs/technical/GAME_LOOP.md` — Boucle de jeu et state machines

## A eviter

- class-validator (utiliser Zod)
- localStorage direct pour l'auth (utiliser Zustand store)
- Docker Compose local pour DB (utiliser local-services)
- Jest (utiliser Vitest)
