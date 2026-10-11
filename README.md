# Intelisen · date actualizate

Aplicatie JavaScript statica pentru GitHub Pages, cu date locale CSV. Perioada selectabila; implicit saptamana curenta cu date disponibile. Ora snapshotului este afisata in sidebar. Ziua curenta este partiala. Snapshotul contine perioada incepand cu 1 octombrie 2026 si pana la ziua curenta + 1; baseline 7 zile anterior disponibil pentru comparatii.

## Publicare GitHub Pages
Settings → Pages → Deploy from a branch → main → / (root) → Save.

## Actualizare
Pe calculatorul sursa, updaterii Nord Pool, OPCOM PZU/IDA si DAMAS/ENTSO-E apeleaza scriptul local `intelisen/sync_github.py --push` dupa succes. Exportul este validat si trimis prin Git numai daca exista modificari. Nu include credentiale. Calculatorul trebuie sa fie pornit, conectat si autentificat pentru GitHub. Modificarile locale necomise in repository opresc sincronizarea pentru a nu publica editari neaprobate. Esuarea sincronizarii nu anuleaza extragerea de date; se raporteaza separat.

CSV-urile sunt citite la incarcarea paginii. Reincarca pagina pentru ultimul snapshot. index.html include si snapshot de rezerva pentru deschidere locala prin file://; pe GitHub Pages citeste CSV-urile publicate. Plotly/CSS/JS sunt incluse in HTML. Export HTML este offline; CSV exporta toti PH pentru indicatorii selectati.

PH trades: toate tranzactiile pe zi de livrare, fara filtrare de suprapuneri. PH sumar: OHLC oficial Nord Pool, PH01–24. IDA min/max necesita 4 sferturi. Lipsa nu este zero. Explicatii si unitati: sidebar. Tranzactiile simultane pot avea O/C diferit dupa ordonarea exportului. Licenta Plotly.js MIT: vendor/LICENSE-plotly.txt.

## Demo live DAMAS + SEN

Disponibil la https://amariahendre.github.io/Intelisen/demo-live/. Interfata statica citeste direct din Supabase; nu necesita republicare pentru fiecare actualizare de date.

Supabase Cron executa `sync_damas` si `sync_sen` in fiecare minut, inclusiv cand calculatorul este oprit. DAMAS reciteste ziua curenta si precedenta; SEN reciteste ultimele 24 de ore. Raspunsurile schimbate sunt arhivate ca revizii. Erorile sunt inregistrate fara inlocuirea partiala a observatiilor valide.

Scriptul `demo-live/setup.sql` reproduce tabelele, colectoarele si programarea. Numai datele publice si starea colectarii sunt citibile prin API; functiile de colectare sunt rezervate administratorului. Cheia publishable din interfata este publica si nu acorda drepturi administrative.

DAMAS pastreaza semnele si raspunsul brut; NaN/N/A sunt afisate ca lipsuri. Unitatea dezechilibrului ramane neconfirmata. SEN este in MW, cu ore Bucuresti convertite in UTC; orele locale ambigue sunt izolate. Interfata distinge prospetimea colectarii de prospetimea observatiei SEN. Acest endpoint SEN a returnat puncte la aproximativ 10 minute; colectarea la un minut nu produce observatii pe care sursa nu le publica.
