# Utwardzone lotniska w Polsce

Katalog gry zawiera 64 lotniska/lądowiska, 68 pasów i 136 kierunków podejścia. Jest dostępny w **Land** oraz **Free flight**. Stan katalogu: 2026-09-09.

## Zakres i źródła

- [OurAirports](https://ourairports.com/data/): kraj, rodzaj i status lotniska, nawierzchnie, zamknięcia pasów, wymiary, progi i wysokości. Dane udostępnione jako public domain.
- [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/): uzupełnienie współrzędnych oraz nowych utwardzonych pasów. Identyfikatory źródłowych dróg OSM są zapisane przy rekordach.
- [Operator lotniska Kąkolewo](https://www.lotniskokakolewo.pl/en/aviation/for-pilots/): kod EPPG i użytkowany centralny odcinek 1190 m. Cały dawny pas wojskowy nie jest traktowany jako dostępna droga startowa.

Źródłowy katalog z pochodzeniem każdego rekordu: [polishRunways.json](../src/data/polishRunways.json). Ten pochodny zbiór danych jest udostępniany na ODbL; licencja kodu gry pozostaje MIT.

„Czynne” oznacza obiekty oznaczone jako otwarte w katalogu, z utwardzoną drogą startową i bez informacji o wycofaniu jej z użytku. To migawka danych, nie bieżące NOTAM, harmonogram pracy ani gwarancja dostępności operacyjnej. Uwzględnia obiekty cywilne, prywatne i wojskowe. Nie jest to wyłącznie lista portów obsługujących rejsy pasażerskie.

## Reguły importu i znane ograniczenia

- Odrzucane są lotniska i pasy oznaczone `closed`, `disused` lub `abandoned`, trawa, grunt, woda oraz nawierzchnie nieokreślone. Sam wpis `Hard` bez potwierdzonej utwardzonej nawierzchni nie wystarcza: dotyczy to m.in. rozbieżnych danych Chojnic.
- Pomijany jest muzealny pas Kraków-Czyżyny, dawne lotnisko Sochaczew bez potwierdzonych bieżących operacji oraz poligon Nadarzyce. Nie są dodawane same zachowane powierzchnie betonowe dawnych lotnisk.
- Fragmenty przed przesuniętymi progami są scalane z właściwym pasem. Duplikaty pasa sportowego Rzeszów pod EPRZ/EPRJ oraz Lublin pod EPLB/EPSW są usuwane. Zamknięty poprzeczny pas Torunia pozostaje wyłączony.
- Pas musi mieć położenie obu końców. Długość geometryczna może nieznacznie różnić się od deklarowanej przez operatora. Oznaczenia kierunków pochodzą ze źródeł; kurs rzeczywisty jest obliczany z geometrii.
- Przy brakującej szerokości zastosowano ostrożne przybliżenie dla Grądów (24 m), Kazimierza Biskupiego (20 m), Śmiłowa (20 m) i Krośniewic (12 m). `widthEstimated` oznacza takie rekordy, a menu pokazuje `~` przed szerokością.
- Bardzo krótkie fragmenty poniżej 250 m, np. sam betonowy fragment startowiska szybowcowego w Jeżowie Sudeckim, nie są powiększane do fikcyjnego utwardzonego pasa.
- Wysokość początkowa: wysokość MSL ze źródła + przybliżenie geoidy 35 m. Następnie gra mierzy teren na początku, w środku i na końcu pasa. Dopuszcza łagodny spadek podłużny; nie zmienia powierzchni pod kołami przy lądowaniu.

## Aktualizacja

Pobierz nowe pliki do katalogu tymczasowego:

```sh
curl -sSL --fail https://davidmegginson.github.io/ourairports-data/airports.csv -o /tmp/airports.csv
curl -sSL --fail https://davidmegginson.github.io/ourairports-data/runways.csv -o /tmp/runways.csv
curl -sSL --fail --data-urlencode 'data=[out:json][timeout:60];way["aeroway"="runway"](49,14,55,24.2);out tags geom;' https://overpass.kumi.systems/api/interpreter -o /tmp/runways-osm.json
python3 scripts/import-polish-runways.py /tmp/airports.csv /tmp/runways.csv /tmp/runways-osm.json
npm test
npm run build
```

Przed przyjęciem aktualizacji przejrzyj `omissions`, zmiany statusów, duplikaty i wyjątki w importerze oraz zaktualizuj poniższą listę. Import nie odczytuje `.env` ani nie używa OpenSky. Gra korzysta z dołączonej migawki, bez odpytywania tych źródeł podczas lotu.

## Lista pasów

Wymiary dotyczą powierzchni odwzorowanej w grze. Dla krótkich pasów należy wybrać lekki samolot.

| Lotnisko | Kod | Pas | Wymiary (m) |
| --- | --- | --- | --- |
| Arłamów Airfield | EPAR | 16/34 | 1194 × 35 |
| Warsaw Babice Airport | EPBC | 10R/28L | 1293 × 90 |
| Białystok-Krywlany Airfield | EPBK | 09R/27L | 1326 × 30 |
| Borsk Airfield | EPBO | 10/28 | 1738 × 40 |
| Ignacy Jan Paderewski Bydgoszcz Airport | EPBY | 08/26 | 2492 × 60 |
| Depułtycze Królewskie Airfield | EPCD | 18L/36R | 1021 × 30 |
| Cewice Naval Air Base | EPCE | 07/25 | 2487 × 52 |
| Darłówo Naval Air Base | EPDA | 04/22 | 588 × 30 |
| Deblin Military Air Base | EPDE | 12/30 | 2484 × 60 |
| Gdańsk Lech Wałęsa Airport | EPGD | 11/29 | 2783 × 45 |
| Gliwice-Trynek Airfield | EPGL | 08R/26L | 884 × 23 |
| Grądy Airfield | EPGY | 09/27 | 802 × ~24 |
| Kielce-Masłów Airfield | EPKA | 11R/29L | 1153 × 30 |
| Kazimierz Biskupi Airfield | EPKB | 09/27 | 638 × ~20 |
| Kołobrzeg-Bagicz Airfield | EPKG | 07/25 | 889 × 40 |
| Kraków John Paul II International Airport | EPKK | 07/25 | 2520 × 60 |
| Katowice-Muchowiec Airfield | EPKM | 05L/23R | 1150 × 30 |
| Opole-Kamień Śląski Airfield | EPKN | 11/29 | 1200 × 60 |
| Krosno Airfield | EPKR | 11R/29L | 1060 × 30 |
| Krzesiny Military Air Base | EPKS | 12/30 | 2493 × 60 |
| Katowice Wojciech Korfanty International Airport | EPKT | 08/26 | 3191 × 45 |
| Bielsko-Biała Kaniów Airfield | EPKW | 13/31 | 989 × 30 |
| Lublin Airport | EPLB | 07/25 | 2563 × 45 |
| Łask Air Base | EPLK | 10/28 | 2991 × 60 |
| Łódź Władysław Reymont Airport | EPLL | 07/25 | 2482 × 45 |
| Lubin Airfield | EPLU | 13L/31R | 999 × 30 |
| Leźnica Wielka Air Base | EPLY | 10/28 | 2480 × 60 |
| Malbork Królewo Air Base | EPMB | 07/25 | 2500 × 50 |
| Miroslawiec Military Air Base | EPMI | 12/30 | 2496 × 45 |
| Mielec Airfield | EPML | 08R/26L | 2489 × 45 |
| Mielec Airfield | EPML | 17/35 | 662 × 25 |
| Minsk Mazowiecki Military Air Base | EPMM | 09/27 | 2472 × 43 |
| Warsaw Modlin Airport | EPMO | 08/26 | 2494 × 45 |
| Nowe Miasto nad Pilicą Airfield | EPNM | 08/26 | 2384 × 60 |
| Olsztyn-Dajtki Airfield | EPOD | 09L/27R | 848 × 23 |
| Oksywie Air Base / Gdynia-Kosakowo Airfield | EPOK | 08/26 | 576 × 30 |
| Oksywie Air Base / Gdynia-Kosakowo Airfield | EPOK | 13/31 | 2492 × 59 |
| Kąkolewo Airport | EPPG | 10L/28R | 1190 × 30 |
| Piła Airfield | EPPI | 03/21 | 2357 × 59 |
| Poznań-Ławica Airport | EPPO | 10/28 | 2484 × 50 |
| Pruszcz Gdański Air Base | EPPR | 09/27 | 625 × 45 |
| Piotrków Trybunalski-Bujny Airfield | EPPT | 03/21 | 955 × 18 |
| Powidz Military Air Base | EPPW | 10L/28R | 2721 × 30 |
| Powidz Military Air Base | EPPW | 10R/28L | 3503 × 60 |
| Warsaw Radom Airport | EPRA | 07/25 | 2501 × 45 |
| Rzeszów Sports Airfield | EPRJ | 08R/26L | 896 × 30 |
| Częstochowa-Rudniki Airport | EPRU | 08/26 | 1977 × 60 |
| Rzeszów-Jasionka Airport | EPRZ | 09/27 | 3206 × 45 |
| Solidarity Szczecin–Goleniów Airport | EPSC | 13/31 | 2489 × 60 |
| Swidwin Military Air Base | EPSN | 11/29 | 2477 × 58 |
| Suwałki Airfield | EPSU | 08/26 | 1302 × 30 |
| Olsztyn-Mazury Airport | EPSY | 01/19 | 2486 × 45 |
| Tomaszów Mazowiecki Military Air Base | EPTM | 11/29 | 1978 × 60 |
| Toruń Airfield | EPTO | 10/28 | 1228 × 57 |
| Warsaw Chopin Airport | EPWA | 11/29 | 2791 × 50 |
| Warsaw Chopin Airport | EPWA | 15/33 | 3683 × 60 |
| Copernicus Wrocław Airport | EPWR | 11/29 | 2537 × 45 |
| Zielona Góra-Babimost Airport | EPZG | 06/24 | 2467 × 60 |
| Poznań-Bednary Airfield | PL-0001 | 11R/29L | 1900 × 30 |
| Chojna Airfield | PL-0007 | 09/27 | 1092 × 40 |
| Żerniki Gądki Airfield | PL-0076 | 06/24 | 654 × 18 |
| Lipki Wielkie Airfield | PL-0078 | 05/23 | 791 × 25 |
| Szczecinek-Wilcze Laski Airfield | PL-0080 | 10/28 | 1259 × 30 |
| Zator | PL-0087 | 06/24 | 696 × 22 |
| Śmiłowo Henryk Stokłosa Airfield | PL-0100 | 10/28 | 789 × ~20 |
| Rytel-Uboga Airstrip | PL-0169 | 03/21 | 495 × 27 |
| Czersk Świecki | PL-0182 | 17/35 | 376 × 25 |
| Krośniewice Airstrip | PL-0184 | 07/25 | 516 × ~12 |
