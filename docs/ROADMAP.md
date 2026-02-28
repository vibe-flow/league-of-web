# Roadmap

## Phase 1 — Prototype Solo (pas de réseau)

**Objectif :** Un joueur se déplace sur une map ARAM dans un canvas PixiJS.

**Docs de référence :**

- [ARCHITECTURE.md](ARCHITECTURE.md) — structure du monorepo, stack technique
- [GAME_DESIGN.md](GAME_DESIGN.md) — dimensions de la map, structures
- [technical/PATHFINDING.md](technical/PATHFINDING.md) — A\* sur grille, path smoothing
- [technical/GAME_LOOP.md](technical/GAME_LOOP.md) — client render loop (PixiJS Ticker)

### Scope

- [x] Setup du projet (monorepo, dépendances)
- [ ] Canvas PixiJS intégré dans React (composant GameCanvas)
- [ ] Map ARAM basique (rectangles colorés : lane, base, herbe)
- [ ] Un champion (cercle coloré) qui se déplace au clic droit
- [ ] Pathfinding basique (A\* sur grille simplifiée)
- [ ] Caméra qui suit le joueur avec zoom
- [ ] Minimap basique
- [ ] Barres de vie au-dessus des entités

### Ce qu'on ne fait PAS

- Pas de réseau
- Pas de combat
- Pas de minions
- Pas de vrais sprites (placeholders géométriques)

---

## Phase 2 — Multijoueur

**Objectif :** Deux joueurs peuvent rejoindre un lobby et se voir bouger sur la même map.

**Docs de référence :**

- [technical/NETCODE.md](technical/NETCODE.md) — serveur autoritaire, prediction, interpolation, protocole WebSocket
- [technical/GAME_LOOP.md](technical/GAME_LOOP.md) — game loop serveur (30Hz), match lifecycle

### Scope

- [ ] Lobby : créer / rejoindre (React + tRPC)
- [ ] WebSocket Gateway dans NestJS
- [ ] Game loop serveur autoritaire (30Hz)
- [ ] Le serveur gère les positions, le client affiche
- [ ] Client-side prediction pour le mouvement du joueur local
- [ ] Entity interpolation pour les autres joueurs
- [ ] Sélection d'équipe dans le lobby (bleu / rouge)
- [ ] Spawn dans la base correspondante

### Ce qu'on ne fait PAS

- Pas de combat
- Pas de minions/tourelles
- Pas de lag compensation (pas encore de skillshots)

---

## Phase 3 — Combat de base

**Objectif :** Les champions peuvent se battre entre eux.

**Docs de référence :**

- [technical/CHAMPIONS.md](technical/CHAMPIONS.md) — stats, pipeline de dégâts, scaling par niveau
- [technical/GAME_LOOP.md](technical/GAME_LOOP.md) — entity state machine, animation timing (windup/damage point)
- [GAME_DESIGN.md](GAME_DESIGN.md) — formules de dégâts, XP, respawn

### Scope

- [x] Système de stats (HP, AD, Armor, etc.)
- [x] Auto-attaques (clic sur un ennemi à portée)
- [x] Animation d'auto-attaque (windup + projectile si distance)
- [x] Pipeline de dégâts (bruts → armor → dégâts finaux)
- [x] Barres de vie dynamiques
- [x] Mort et réapparition (timer + respawn en base)
- [x] Feedbacks visuels (flash rouge quand touché, animation de mort)
- [x] Système de niveaux et XP (gain passif + kills)

### Ce qu'on ne fait PAS

- Pas de sorts (seulement auto-attaques)
- Pas de minions/tourelles
- Pas d'items

---

## Phase 4 — Sorts et Champions

**Objectif :** Les champions ont des sorts uniques.

**Docs de référence :**

- [technical/CHAMPIONS.md](technical/CHAMPIONS.md) — AbilityContext, système de sorts, cooldowns, buffs, exemple complet
- [technical/NETCODE.md](technical/NETCODE.md) — lag compensation pour les skillshots
- [technical/GAME_LOOP.md](technical/GAME_LOOP.md) — cast time, channel, state machine Casting

### Scope

- [ ] Architecture AbilityContext (helpers réutilisables)
- [ ] Système de cooldowns
- [ ] Système de mana
- [ ] 3 types de sorts implémentés :
  - Skillshot (projectile en ligne)
  - Sort ciblé (clic sur ennemi)
  - Dash (déplacement rapide)
- [ ] 2-3 champions jouables avec 4 sorts chacun (Q/W/E/R)
- [ ] Lag compensation pour les skillshots
- [ ] Indicateurs de portée au survol des sorts
- [ ] Effets visuels basiques (particules pour les sorts)

### Ce qu'on ne fait PAS

- Pas de buffs/debuffs complexes
- Pas de minions/tourelles
- Pas d'items

---

## Phase 5 — Minions et Tourelles

**Objectif :** La lane s'anime avec des minions et des tourelles.

**Docs de référence :**

- [technical/PATHFINDING.md](technical/PATHFINDING.md) — flowfield pour minions, local avoidance
- [GAME_DESIGN.md](GAME_DESIGN.md) — composition des vagues, stats des tourelles, comportement IA
- [technical/GAME_LOOP.md](technical/GAME_LOOP.md) — game clock, événements temporisés (spawn)

### Scope

- [ ] Spawn de vagues de minions (toutes les 30s)
- [ ] IA des minions (avancer, cibler l'ennemi le plus proche)
- [ ] Flowfield pathfinding pour les minions
- [ ] Tourelles avec IA de ciblage (priorité minions > champions)
- [ ] Les tourelles doivent être détruites dans l'ordre
- [ ] Nexus (objectif de victoire)
- [ ] Écran de victoire / défaite
- [ ] Gold : passif + last hit + kills
- [ ] XP de proximité (minions)

### Ce qu'on ne fait PAS

- Pas de boutique d'items
- Pas de fog of war
- Pas de buissons

---

## Phase 6 — Items et Boutique

**Objectif :** Les joueurs peuvent acheter des items pour renforcer leur champion.

**Docs de référence :**

- [technical/CHAMPIONS.md](technical/CHAMPIONS.md) — comment les items modifient les stats (flat/percent modifiers)
- [GAME_DESIGN.md](GAME_DESIGN.md) — liste d'items, coûts, stats

### Scope

- [ ] Système d'inventaire (6 slots)
- [ ] Boutique accessible en base (UI React overlay)
- [ ] 15-20 items de base couvrant les archétypes (AD, AP, Tank)
- [ ] Les items modifient les stats du champion
- [ ] Gold suffisant pour acheter via gold passif + farm + kills

### Ce qu'on ne fait PAS

- Pas d'items actifs (seulement des stats passives)
- Pas de recettes complexes (achat direct)

---

## Phase 7 — Polish et Fog of War

**Objectif :** Le jeu ressemble à un vrai jeu.

**Docs de référence :**

- [technical/NETCODE.md](technical/NETCODE.md) — fog of war côté serveur (filtrage des entités)
- [technical/CHAMPIONS.md](technical/CHAMPIONS.md) — système de buffs/debuffs complet

### Scope

- [ ] Fog of War basique (rayon de vision par unité)
- [ ] Buissons (cachent les unités à l'intérieur)
- [ ] Système de buffs/debuffs (stun, slow, shield)
- [ ] Screen shake, particules améliorées
- [ ] Sons (auto-attaques, sorts, kills)
- [ ] Remplacement des placeholders par des vrais sprites
- [ ] Minimap complète avec icônes
- [ ] Scoreboard (Tab)
- [ ] Chat en jeu

---

## Phase 8 — Lobby complet et 5v5

**Objectif :** Une vraie expérience de jeu 5v5.

**Docs de référence :**

- [technical/NETCODE.md](technical/NETCODE.md) — delta compression, bandwidth optimization, reconnection
- [GAME_DESIGN.md](GAME_DESIGN.md) — règles de matchmaking

### Scope

- [ ] Lobby complet : inviter des joueurs, prêt/pas prêt
- [ ] Sélection de champion dans le lobby
- [ ] Support 5v5 (10 joueurs simultanés)
- [ ] Optimisation bande passante (delta compression)
- [ ] Optimisation performance serveur (spatial hashing)
- [ ] Tests de charge

---

## Principes de progression

1. **Chaque phase produit quelque chose de jouable** — on peut tester à la fin de chaque phase
2. **On ne fait que ce qui est dans le scope** — pas de feature creep
3. **Placeholders d'abord, polish ensuite** — le gameplay prime sur le visuel
4. **Tester le multijoueur tôt** — Phase 2 arrive vite pour valider le netcode
