# Battle of Talingchan — Rule Spec for vs-AI web build
Source: official Rule Book Ver. 3.2 (cdn.bangbon.app/rules/rulebook-9PoUza3Yhi.pdf), pages cited as [pN].

## Deck / Setup
- Main Deck = exactly 50 cards; max 4 copies per name; "Only #1": exactly one Only#1 card in the deck (any type) [p1,p5]. Exception: if a card allows 50 copies, Only#1 can be skipped.
- LIFE Deck = 5 LIFE cards, all different names [p1].
- Name counting: "..." symbol in rules text = extra (alias) name; without it = 2 main names [p14].
- Setup: shuffle, draw 5. Decide first player (coin/RPS). Mulligan any number: put under deck without shuffle, redraw same count, then shuffle. Shuffle LIFE cards, place face-down in a row, top first [p19].

## Zones [p1-2]
- Avatar Zone: max 6 cards (Avatar + Token), max 4 Avatars.
- Magic Zone: any number of cards. Normal/Modification/React sit here while resolving; Avatars may be moved here.
- Land Magic Zone: 1 card, shared; new Land Magic sends old one to Hell immediately [p11].
- Construct Zone: max 3, unique names per side.
- Deck, Hell Zone, Dark Dimension Zone (exiled), LIFE Card Zone.
- Public: Avatar, Magic, Hell, Land, Construct, Dark Dimension, revealed LIFE. Private: Deck, face-down LIFE, hand (opponent may ask count only).
- Revealing from Deck with no stated destination -> shuffle after. Any search -> shuffle (also when nothing found) [p3].
- Cards discarded from hand to pay cost go to Hell; a card used as GEM is not in Hell during Cost Step [p2,p6].

## Turn order [p21]
Draw -> Main -> Battle -> End. No phase may be skipped (player 1's first turn: no Battle Phase, go to End).
### Draw Phase
- Hand < 3: draw up to 3. Hand >= 3: draw exactly 1. First player's first turn: draw 2.
- Turn owner's Avatars become active (stand) and draw happens together; only after both may no-timing React Magic be used.
### Main Phase [p22]
- Summon Avatars (unlimited), build Constructs, play Normal / Modification / React / Land Magic, activate "สั่งใช้" abilities (Main Phase only unless stated; no effect may be resolving).
- At start: resolve LIFE-card abilities from last turn's damage first; only after all resolve may no-timing React Magic be used.
### Battle Phase [p22-23]
1. Attack step: choose attackers (rest them; "สามัคคี"/"แทงหลัง" activate here, multiple chosen together) and targets (Avatar / Construct / LIFE Zone; "เตะไข่" can hit LIFE directly).
2. Attack made; power goes to Snapshot; "เมื่อโจมตี" abilities.
3. Opponent may use "โล่มนุษย์" to redirect target; then target confirmed; "when attacked" abilities.
4. Power becomes final (Layer 4 resolved).
- Battle: higher power wins; loser destroyed -> Hell. Equal power: both destroyed (ลูกฮึด: tie rules p8). Power 0 vs power 0: nothing happens.
- After battle: loser to Hell; "when destroy/after battle" abilities; then "คำสั่งเสีย".
- Attacking Construct: Construct destroyed only if attacker power is greater; if lower, nothing; not a battle; can be attacked even if opponent has Avatars [p23].
- Attacking LIFE: only if opponent's Avatar Zone has no Avatar (Magic Zone Avatars and Constructs don't block). One hit damages exactly 1 LIFE card, top first, regardless of power. Power 0 hits but deals no damage. Not a battle [p25].
### End Phase [p25]
- Hand > 7: discard to 7 (last action of turn).

## Summon / Build [p6,p17]
- Cost Step -> Summon -> After Summon. Pay GEM by discarding hand cards, one summon per payment. GEM total >= cost with no removable excess (cost 4: not 4+1, but 3+2 ok). Cost 0 is free; GEM 0 card cannot pay. Colored GEM pays only same-color; colorless pays any.
- "จุติ" triggers in Summon step; React cards for "when summoned" usable then. After Summon: opponent can no longer use them.
- Constructs: Cost Step -> Build, same payment rules.

## Magic types [p10-12]
- Each Magic type usable once per turn total (both players' turns share it).
- Normal: Main Phase, nothing resolving. Modification: Main Phase; attaches to Avatar; goes to Hell when Avatar leaves. Land: Main Phase. React: any phase, either turn, when condition met.
- Timing: own Main = Normal/Mod/React/Land; own other phases = React; opponent turn = React.
- Stack: last card used resolves first [p12].
- React priority: on a React-trigger action, turn owner gives opponent priority first; if opponent passes they cannot return to it [p18-19].

## Effect layers / power [p15-16]
- L0 base; L1 direct [+/-] power/ability grants on Avatar; L2 from other cards (Land/Construct/continuous); L3 Snapshot after L0-2 when attacking; L4 React/after-L3 changes until battle end. L1 effects from Avatar/Magic/Construct are removed by another L1 removal-ability on same layer.

## Avatar details
- Controller = whoever summoned it; destroyed -> Hell of original owner [p6].
- Zone full -> cannot summon or take control unless the result stays within limits [p1].
- In Magic Zone: still Avatar with power, cannot attack/be attacked, no abilities, per-turn limit not reset by moving, status reset on move [p9].
- Leaves field: destroyed (battle/card), to Hell, to hand, to deck, exiled. Control change and move to Magic Zone are not leaving [p9].
- Keywords: จุติ, คำสั่งเสีย, เซ่นไหว้, พอดี, สอดแนม, ธรณีสูบ, เลือกปฏิบัติ, สามัคคี, โล่มนุษย์, เตะไข่, เทิร์นละครั้ง, ต่อเนื่อง, สั่งใช้, อัตโนมัติ, ลูกฮึด, แทงหลัง, เนรเทศ [p7-8].
- Token: acts as Avatar; leaving field goes to zone then is removed; Avatar+Token <= 6, Avatars <= 4 [p19].
- Partner ("คู่หู"): both named Avatars must be on field, declare once per turn [p20-21].

## LIFE / Win [p5,p20-21,p25]
- LIFE ability fires only when damaged (flipped), once. Multiple at once: top first.
- All LIFE gone -> "สาหัส". Loss when a LIFE-zone attack succeeds while in สาหัส; Deck reaches 0; or special win cards. Power 0 hit in สาหัส does not end game.
