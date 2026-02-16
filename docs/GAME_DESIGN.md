# Game Design — Mode ARAM

## Concept

Un mode ARAM (All Random All Mid) simplifié : deux équipes de 5 joueurs s'affrontent sur une map à une seule lane. L'objectif est de détruire le Nexus ennemi.

## La Map

```
Nexus B    Tourelle B3   Tourelle B2   Tourelle B1    [CENTER]    Tourelle A1   Tourelle A2   Tourelle A3    Nexus A
  ◼──────────◼─────────────◼─────────────◼───────────────────────────◼─────────────◼─────────────◼──────────◼
  │           │             │             │            │              │             │             │          │
  │  Base B   │             │             │          Pont /           │             │             │  Base A  │
  │  (Spawn)  │             │             │         Milieu            │             │             │ (Spawn)  │
  ◼───────────┘             │             │            │              │             │             └──────────◼
                            │             │            │              │             │
                            └─────────────┘            │              └─────────────┘
                              Zone élargie        Zone de combat        Zone élargie
                                                   centrale
```

### Dimensions

- Longueur de la lane : ~8000 unités
- Largeur de la lane : ~800 unités (avec des élargissements par endroits)
- Buissons : 2-4 zones de buissons le long de la lane

### Structures par équipe

- **1 Nexus** : objectif final, 5500 HP
- **3 Tourelles** : défendent la lane, doivent être détruites dans l'ordre
  - Tourelle extérieure : 3500 HP, 150 AD
  - Tourelle intérieure : 3800 HP, 175 AD
  - Tourelle inhibiteur : 4000 HP, 200 AD

### Zones

- **Base (Spawn)** : zone de réapparition, régénération passive, boutique
- **Lane** : le chemin principal entre les deux bases
- **Buissons** : zones qui cachent les unités à l'intérieur (vision réduite)

## Règles de jeu

### Début de partie

1. Les joueurs rejoignent le lobby et choisissent leur champion
2. Tous les joueurs spawn dans leur base
3. Les minions commencent à spawn après 60 secondes
4. Gold passif : 5 gold/seconde dès le début

### Condition de victoire

Détruire le Nexus ennemi. Les tourelles doivent être détruites dans l'ordre (extérieure → intérieure → inhibiteur → Nexus).

### Mort et réapparition

- À la mort, le joueur réapparaît dans sa base après un délai
- Délai de réapparition : `10 + (niveau × 2)` secondes
- Pas de téléportation — on ne peut revenir au combat qu'en marchant

### Régénération en base

- En base : régénération rapide de HP et Mana (10% max HP/sec, 10% max Mana/sec)
- Hors base : régénération naturelle lente (basée sur les stats du champion)

## Système de Stats

### Stats de base d'un champion

| Stat         | Description                         | Exemple (champion mêlée)     |
| ------------ | ----------------------------------- | ---------------------------- |
| HP           | Points de vie                       | 600                          |
| MP           | Points de mana                      | 400                          |
| HP Regen     | Régénération HP/5sec                | 8                            |
| MP Regen     | Régénération MP/5sec                | 7                            |
| AD           | Attack Damage (dégâts physiques)    | 60                           |
| AP           | Ability Power (puissance des sorts) | 0                            |
| Armor        | Réduit les dégâts physiques         | 30                           |
| Magic Resist | Réduit les dégâts magiques          | 32                           |
| Attack Speed | Attaques par seconde                | 0.625                        |
| Move Speed   | Vitesse de déplacement (unités/sec) | 325                          |
| Attack Range | Portée d'auto-attaque (unités)      | 125 (mêlée) / 550 (distance) |
| Crit Chance  | Chance de coup critique (%)         | 0                            |

### Croissance par niveau

Chaque stat a une valeur de croissance par niveau :

```
Stat au niveau N = Base + Croissance × (N - 1)
```

Niveau max : 18

### Formule de dégâts

**Dégâts physiques :**

```
Dégâts finaux = Dégâts bruts × (100 / (100 + Armor))
```

**Dégâts magiques :**

```
Dégâts finaux = Dégâts bruts × (100 / (100 + Magic Resist))
```

Exemples :

- 100 dégâts bruts vs 50 armor → 100 × (100/150) = 66.7 dégâts
- 100 dégâts bruts vs 100 armor → 100 × (100/200) = 50 dégâts
- 100 dégâts bruts vs 0 armor → 100 × (100/100) = 100 dégâts

### Scaling des sorts

Les sorts scalent avec les stats du champion :

```
Dégâts du sort = Base[rang] + (AD × AD_Ratio) + (AP × AP_Ratio)
```

Exemple : un sort avec base [80, 120, 160], ratio AD 0.6, ratio AP 0.4

- Avec 100 AD et 50 AP au rang 2 : 120 + (100 × 0.6) + (50 × 0.4) = 200 dégâts bruts

## Système d'XP et de Niveaux

### Gain d'XP

- **Kill de champion** : 200 + (50 × niveau de la victime) XP
- **Assist** : 50% de l'XP du kill
- **Kill de minion** : être à proximité (1400 unités) quand un minion ennemi meurt → XP partagée
- **XP passive** : 5 XP/seconde (spécifique ARAM pour accélérer le jeu)

### Table de niveaux

| Niveau | XP cumulée requise             |
| ------ | ------------------------------ |
| 1 → 2  | 280                            |
| 2 → 3  | 660                            |
| 3 → 4  | 1140                           |
| 4 → 5  | 1720                           |
| 5 → 6  | 2400                           |
| ...    | +100 par niveau supplémentaire |

### Points de compétence

- 1 point par niveau
- Sorts Q/W/E : rang max 5, déblocables au niveau 1
- Sort R (ultime) : rang max 3, déblocable aux niveaux 6, 11, 16

## Système de Gold

### Gain de gold

- **Gold passif** : 5 gold/seconde
- **Last hit minion** : 20-25 gold (mêlée), 15-20 gold (caster)
- **Kill de champion** : 300 gold
- **Assist** : 150 gold

### Boutique d'items (MVP simplifié)

Pour le MVP, une boutique simplifiée accessible uniquement en base :

**Items de départ :**
| Item | Coût | Stats |
|------|------|-------|
| Épée longue | 350g | +10 AD |
| Tome d'amplification | 350g | +20 AP |
| Tissu d'armure | 300g | +15 Armor |
| Cape de résistance | 300g | +15 MR |

**Items complets (exemples) :**
| Item | Coût | Stats |
|------|------|-------|
| Lame d'infini | 3400g | +70 AD, +20% Crit |
| Bâton du vide | 2800g | +65 AP |
| Plastron | 2500g | +50 Armor, +400 HP |

_La boutique sera enrichie progressivement._

## Minions

### Vagues de minions

- Spawn toutes les **30 secondes** depuis chaque Nexus
- Commencent à spawn à **1:00** de jeu

### Composition d'une vague

- 3 minions mêlée : 450 HP, 12 AD, 0 Armor
- 3 minions caster : 300 HP, 23 AD (distance), 0 Armor
- 1 minion canon (toutes les 3 vagues) : 700 HP, 40 AD, 20 Armor

### Comportement

- Avancent sur la lane en ligne droite
- Attaquent l'ennemi le plus proche (priorité : minions > champions > tourelles)
- Si un champion allié est attaqué par un champion ennemi, les minions proches ciblent l'attaquant

## Tourelles

### Comportement

- Attaquent un ennemi à portée (800 unités)
- Priorité de ciblage : minion le plus proche > champion qui attaque un allié > champion le plus proche
- Dégâts croissants : chaque attaque successive sur le même champion fait +25% de dégâts (stacks jusqu'à +100%)
- Reset quand la tourelle change de cible

### Protection

- Les tourelles ne peuvent être attaquées que si la tourelle précédente est détruite
- Les tourelles ont une résistance aux dégâts des champions tant que des minions alliés sont à portée : -50% dégâts des champions sans minions
