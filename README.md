# ⚓ Keezen op Zee

Online versie van het klassieke bordspel **Keezen** met een nautisch thema.
Speel tegen vrienden via een simpele havencode (room code), of lokaal aan dezelfde kade.
Geen account, geen server, geen build-stap — werkt direct op GitHub Pages.

![board preview](keezen%20bord.jpg)

---

## 🚢 Spelen

Open de pagina in je browser en kies:

1. **Nieuwe Reis** — start een spel. Je krijgt een havencode (bijv. `K3MZ4P`) en een deelbare link. Stuur die naar je medespelers.
2. **Mee aan Boord** — vul de havencode in om mee te doen.
3. **Aan dezelfde kade** — speel lokaal aan één scherm (hot-seat).

Lege plekken aan tafel worden automatisch bemand door **botbemanning**, dus je kunt al spelen vanaf 2 spelers.

---

## ⚓ Spelregels (kort)

Volledige regels vind je in-game (kompasknop linksboven).

- 4 spelers, **2 teams** van 2 (teamgenoten zitten tegenover elkaar).
- Doel: breng als eerste team alle 8 schepen in de thuishaven.
- Speel kaarten om schepen te bewegen. Speciale kaarten:
  - **Aas** — schip uit haven, óf 1 vooruit
  - **Heer** — schip uit haven
  - **Vrouw** — 12 vooruit
  - **Boer** — ruilen met een ander schip
  - **Zeven** — verdeel 7 stappen over 1 of 2 schepen
  - **Vier** — 4 achteruit
- Kun je een kaart spelen, dan **moet** je dat doen.
- Een schip op zijn eigen startveld kun je niet slaan, ruilen of passeren.

---

## 🧭 Hosten op GitHub Pages

Er is geen build-stap. Alle bestanden zijn statisch.

1. **Maak een nieuwe repo** op GitHub (bijv. `keezen-online`).
2. **Upload deze bestanden** naar de repo (via `git push` of de web-uploader):
   ```
   index.html
   css/style.css
   js/board.js
   js/game.js
   js/network.js
   js/app.js
   README.md
   ```
3. **Activeer GitHub Pages**: ga naar `Settings → Pages → Source: Deploy from a branch → main → /(root)`.
4. Na een minuut staat je spel live op `https://<jouw-username>.github.io/keezen-online/`.

Deel die link met vrienden. Iedereen die de pagina opent kan een nieuwe reis starten of via havencode meedoen.

### Lokaal testen

```bash
# Vanuit de project map:
python -m http.server 8000
# Of met Node:
npx serve .
```

Open dan `http://localhost:8000` in je browser.

---

## 🌊 Hoe werkt de online verbinding?

- Het spel gebruikt **PeerJS** voor peer-to-peer WebRTC verbindingen.
- De "kapitein" (host) krijgt een unieke ID gebaseerd op de havencode.
- Andere spelers verbinden direct met de host — geen tussenliggende server nodig voor het spel zelf.
- PeerJS gebruikt de gratis publieke signaling-server van peerjs.com om de eerste verbinding te leggen.
- Zodra verbonden, wisselen browsers data direct uit (WebRTC data channels).

Dit betekent:
- De **host moet online blijven** zolang het spel duurt — als die de tab sluit, stopt het spel voor iedereen.
- Werkt vanaf elk modern browsertype (Chrome, Firefox, Safari, Edge) en op mobiel.

---

## 🛠 Structuur

```
keezen-online/
├── index.html         # HTML + alle schermen
├── css/style.css      # Nautisch thema (parchment, brass, deep sea)
├── js/board.js        # SVG-bordrendering en positie-wiskunde
├── js/game.js         # Spelstaat, kaarten, beweegvalidatie, bot-AI
├── js/network.js      # PeerJS host/client laag
├── js/app.js          # UI controller + glue code
└── README.md
```

Geen npm dependencies, geen build, geen framework. Vanilla JS + SVG + CSS.
PeerJS wordt geladen via `unpkg.com` CDN.

---

## 🦜 Tips & troubleshooting

- **"Havencode niet gevonden"**: controleer of de host nog online is en de code juist is overgenomen (hoofdletters / cijfers).
- **Verbinding verbreekt**: WebRTC kan via strenge firewalls/proxies haperen. Probeer een andere netwerk of mobiel hotspot.
- **Twee spelers**: het werkt prima met 2 mensen — de andere 2 stoelen worden door bots bemand.
- **Spel resetten**: ververs de pagina (de host moet daarna opnieuw een spel openen).

---

## 📜 Licentie

Vrij te gebruiken voor persoonlijk gebruik. Keezen is een traditioneel spel zonder officiële uitgever; deze versie volgt de gangbare Nederlandse regels.
