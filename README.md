# Rekordbox Set Builder

Aplikace, která z tvé rekordboxové kolekce poskládá playlisty a sety **z tracků, které k sobě pasují** –
podle harmonie klíčů (Camelot wheel), tempa (BPM), energie a stylu. Výsledek vyexportuje jako XML,
které rekordbox načte jako playlisty.

Nic se neposílá na internet, nikdo nesahá do `master.db`. Pracuje se s oficiálním **XML exportem** rekordboxu,
což je obousměrný most, ve kterém se nedá nic rozbít.

## Co to umí

| Funkce | Popis |
| --- | --- |
| **DnB režim** | Jedním klikem nastaví váhy pro DnB (klíč + energie + subžánr), **rychlého mixování ≈ 2 min na track** a peak-time křivku. Hodinový set tak má **~29 tracků**, ne 12. |
| **Styl mixu** | Kolik minut track v setu skutečně hraje: automaticky (podle žánru – u DnB rychlé), rychlé ≈2 min, standard ≈3 min, ≈4 min, nebo celé tracky. Podle toho se počítá, kolik tracků se do setu vejde. |
| **Rozsah práce** | Pracuj jen s **jedním playlistem** (importovaným nebo vygenerovaným) nebo s **jedním žánrem** (např. Drum & Bass) místo celé knihovny. Rozsah respektují všechny generátory i hledání podobných. |
| **Import jen playlistu** | Když XML neobsahuje celou kolekci, ale tracky v playlistu mají metadata (název, BPM, klíč), aplikace si je dopočítá. Prázdný XML bez metadat ji upozorní, co vyexportovat. |
| **Set z tracku** | Vybereš startovní track a délku/křivku energie – aplikace dobere další tracky tak, aby na sebe navazovaly (rozjezd → peak → dojezd, warm-up, peak time, gradace, chillout…). Umí vyzkoušet víc variant a nechat tu nejlepší. |
| **Auto playlisty** | Rozseká kolekci na playlisty, které drží pohromadě (typicky podle stylu a tempa), a každý seřadí do plynulého toku. |
| **Uspořádat playlist** | Vezme existující playlist (z XML nebo vygenerovaný) a přeřadí ho tak, aby přechody mezi tracky seděly. Ukáže skóre před/po. |
| **Podobné tracky** | U každého tracku vypíše, co na něj nejlíp navazuje – i s vysvětlením proč („klíče 8A → 9A hrají spolu“, „tempo skoro stejné“…). |
| **Ruční energie** | Energie se odhaduje z komentářů (`energy 7`), hodnocení a tempa; kde to nesedí, přepíšeš ji ručně. |
| **Export** | XML pro rekordbox, M3U8, CSV report přechodů, JSON projekt (nastavení + playlisty). |
| **CLI** | To samé bez prohlížeče: `node cli.mjs --in export.xml`. |

## Jak aplikaci spustit

```bash
npm install      # jednou
npm run dev      # http://localhost:3000
```

V prohlížeči:
1. **Načíst rekordbox XML** (nebo **Demo DnB** – 140 DnB tracků, případně **Demo data** – 180 tracků ze všech stylů).
2. Když chceš DnB set: zkontroluj, že v tabu **Kolekce** je v rozsahu jen **Drum & Bass** (demo DnB to nastaví samo),
   v tabu **Set z tracku** klikni na **DnB režim** a nech délku 60 minut – uvidíš „29 tracků na 60 min“.
3. **Postavit set** (u playlistů z celé kolekce použij tab **Auto playlisty**).
4. V tabu **Export a nastavení** klikni na **Stáhnout XML pro rekordbox**.

### DnB sety

Pro DnB platí, že se nemixují celé tracky, ale zhruba 2 minuty z každého – aplikace to má
zabudované, takže **60minutový set = ~29 tracků** (v kolekci, kde je dost DnB tracků).

- **Styl mixu na auto** sám pozná, že jde o DnB (≥ 30 % tracků v rozsahu) a přepne se na rychlé mixování.
- Váhy **DnB set** staví hlavně na harmonii klíčů, energii a subžánru z tagů (`#liquid`, `#neurofunk`, `#jump up`, `#rollers`).
- V **rozsahu** si vyber jen svůj DnB playlist (třeba „Liquid warm-up“) nebo žánr a pracuješ jen s ním.
- Půl/dvojnásobek tempa (174 vs 87) je povolený, takže se dají řadit i halftime tracky.

### Kde vzít XML z rekordboxu

V rekordboxu: **File → Export Collection in xml format** (klidně jen jednou, soubor se dá pořád přepisovat).
Když už nějaký `rekordbox.xml` používáš jako most pro jiné aplikace, můžeš nahrát ten.

Důležité: v XML musí být i kolekce (tracky), ne jen playlisty – bez cest k souborům by rekordbox
nevěděl, které tracky má do playlistu dát.

### Jak dostat vygenerované playlisty do rekordboxu

1. V aplikaci **Stáhnout XML pro rekordbox** (soubor obsahuje celou kolekci + nové playlisty ve složce).
2. V rekordboxu: **Preferences → Advanced → rekordbox xml** a nastav cestu ke staženému souboru.
3. V levém stromu se objeví uzel **rekordbox xml** – rozbal ho, najdi složku s playlisty
   (např. „Set Builder 17. 10.“) a **přetáhni playlisty** do svých playlistů.
4. Pořadí tracků i jejich počet zůstane, jak je aplikace poskládala. Původní playlisty z XML se zachovají.

## Jak funguje skórování

Skóre dvou tracků (0–100 %) je vážený průměr dílčích shod:

- **Klíč (Camelot wheel)** – stejný klíč 100 %, paralelní dur/moll 92 %, soused ±1 88 %, diagonála 80 %,
  +2 (energy boost) 70 %; tritón se bere jako konflikt.
- **BPM** – do 0,5 % skoro totožné, do 2 % výborné, do 6 % ještě OK; půl/dvojnásobek tempa (172 vs 86)
  se dá zapnout jako kompatibilní.
- **Energie** – odhad 0–100 (komentář `energy 7`, hodnocení, percentil BPM ve stylu) s ručním přepsáním.
- **Styl / tagy** – shoda žánru, překryv tagů z komentáře (`#deep`, `#peak`, `#rolling`…).
- **Hodnocení, label, artist, album** – jemné dorovnání vkusu.

Tvrdá pravidla (max. skok BPM, max. skok energie, minimální shoda klíče, neopakovat interpreta za sebou)
se dají nastavit v tabu **Export a nastavení**; presety přepnou váhy jedním klikem
(vyvážené, harmonické, tempo, žánr, nálada, energie, objevování).

Proč to funguje: harmonické mixování = klíče vedle sebe na Camelot wheelu, tempo v pár procentech
a energie plynule nahoru/dolů. Přesně to aplikace hlídá a ještě to umí vysvětlit u každého přechodu.

## CLI

```bash
node cli.mjs --in rekordbox.xml --preset genre --size 20 --out playlisty.xml --csv report.csv
node cli.mjs --in rekordbox.xml --mode report
node cli.mjs --help

# DnB: hodinový set z tracků žánru Drum & Bass se stylem rychlého mixování
node cli.mjs --in rekordbox.xml --mode set --genre "Drum & Bass" --minutes 60 \
  --mix-style auto --preset dnb --out dnb-set.xml

# DnB playlisty z celé kolekce
node cli.mjs --in rekordbox.xml --preset dnb --genre "Drum & Bass" --size 25 --out dnb-crates.xml

# přeřazení existujícího playlistu
node cli.mjs --in rekordbox.xml --mode reorder --playlist "Techno peak" --out serazeno.xml
```

Důležité volby: `--mix-style auto|quick|standard|long|full`, `--seconds-per-track <n>`,
`--genre "<žánr>"`, `--minutes`, `--count`, `--curve`, `--preset`.

Hodí se pro dávkové zpracování nebo když chceš výsledek rovnou zapsat do svého `rekordbox.xml`
(`--out` může být stejná cesta, kterou má nastavenou rekordbox).

## Vývoj a testy

```bash
npm test          # 64 testy: engine, UI tok v jsdom, quickie import, měření BPM/klíče, export XML
npm run fixture   # vygeneruje demo kolekci (fixtures/ + public/demo-collection.xml)
npm run build     # produkční build do dist/
```

Struktura:

```
src/lib/      engine bez závislostí (XML, klíče, skóre, generátory) – používá ho i CLI
src/ui/       panely, stav aplikace a akce (testovatelné i bez prohlížeče)
test/         node:test – včetně testů, které odklikají celé UI v jsdom
cli.mjs       příkazová řádka
```

## DnB subžánry (neuro / deep / jungle…)

Když v rozsahu převažuje DnB (aspoň 25 %), tab **Auto playlisty** nejdřív rozdělí tracky podle
subžánru – Neurofunk, Deep DnB, Liquid, Jungle, Jump Up, Rollers, Halftime, Ostatní DnB – a každý
subžánr dostane vlastní playlist(y). House, techno a zbytek kolekce jde zvlášť a nikdy se s DnB
nepromíchá. Přepínač **Rozdělit DnB podle subžánru** najdeš pod možnostmi (výchozí stav: zapnuto).
Hub­natý tag v komentáři (`#neurofunk`, `#liquid`, `jump up`) nebo žánr tracku k rozpoznání stačí.

## Quickie import (bez XML)

Tab **Quickie import** funguje jako quickiemusic.com: přetáhni do okna rovnou MP3 / FLAC / WAV / M4A
soubory a o zbytek se postará aplikace:

1. **Vyčistí zmatené názvy** – `01 - Artist_-_Track (320kbps) [www.site.com].mp3`
   → interpret `Artist`, název `Track`.
2. **Přečte tagy** – ID3v1/ID3v2.3/2.4 (MP3), Vorbis comment (FLAC), QuickTime `ilst` (M4A/ALAC),
   RIFF INFO (WAV). Bez tagů použije hádanky z názvu (BPM, Camelot klíč, žánr).
3. **Změří BPM a tóninu z audia** – Web Audio API: BPM přes autokorelatci onsetů
   (vč. oktavové korekce 87 ↔ 174), tónina přes chromagram + Krumhansl–Schmuckler profily na
   Camelot wheel. Detektory jsou čisté funkce a mají vlastní testy na syntetických signálech.
4. **Rozdělí na playlisty** – podle žánru, u DnB podle subžánru (stejný engine jako Auto playlisty).

Vše zůstává v prohlížeči – soubory se nikam neodesílají.

## Omezení

- Energie je odhad (rekordbox energii v XML neexportuje) – nauč aplikaci svůj vkus ručními energiemi
  nebo hodnocením; odhad se pak zlepší.
- Když dva tracky nemají vyplněný klíč nebo BPM, skóre se u nich bere jako neutrální.
- Import „jen playlistu“ funguje, pokud tracky v playlistu nesou metadata. Rekordboxův XML s prázdným
  `<COLLECTION>` a odkazy typu `<TRACK Key="1"/>` metadata nemá – tam je potřeba vyexportovat kolekci.
- Ze setu se nikdy nestane víc tracků, než kolik jich v rozsahu je; když dojde dech, aplikace to napíše.
- Zapisuje se jen do XML, které si sám nastavíš v rekordboxu – aplikace nikdy nemění `master.db`.
- Quickie import: prohlížeč neumí číst cestu k souboru, takže rychle načtené tracky nemají `Location`
  v XML. Když je rekordbox potřebuje spárovat, doplň cestu ručně, nebo playlist používej jen
  pro přípravu/sety. ID quickie tracků začínají na 1 000 001, aby nekolidovala s `TrackID` z XML.
