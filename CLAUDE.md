# League of Web

Conventions vibe-stack : @~/.claude/shared/vibe-stack.md

## Projet

MOBA web (mode ARAM) jouable en navigateur.

- **Hors-jeu** (lobby, selection champion, resultats) : React + shadcn/ui + tRPC
- **In-game** (le match) : PixiJS Canvas + WebSocket temps reel
- **Serveur autoritaire** : le serveur fait foi, le client predit et affiche
- **Shared package** : types, constantes, formules de jeu partagees client/serveur

API : tRPC pour le hors-jeu (lobby, stats), WebSocket pour le in-game.
Rendu jeu : PixiJS (Canvas/WebGL) dans un composant React.
Game server : NestJS WebSocket Gateway + game loop custom (30Hz).

## Infrastructure

PostgreSQL, Redis et autres services sont heberges dans un repo partage :
`/Users/flow/Dev/local-services/` (docker-compose avec `make up`).

Ce projet n'a PAS son propre Docker Compose pour la DB. Les connexions :

- PostgreSQL : `localhost:5432` (user: postgres, password: postgres)
- Redis : `localhost:6379`

## Documentation

- `docs/ARCHITECTURE.md` — Vue d'ensemble technique
- `docs/GAME_DESIGN.md` — Regles du jeu, stats, formules
- `docs/ROADMAP.md` — Phases de developpement
- `docs/technical/NETCODE.md` — Synchronisation reseau
- `docs/technical/CHAMPIONS.md` — Systeme de champions et sorts
- `docs/technical/PATHFINDING.md` — Navigation et deplacement
- `docs/technical/GAME_LOOP.md` — Boucle de jeu et state machines

## A eviter

- Docker Compose local pour DB (utiliser local-services)
