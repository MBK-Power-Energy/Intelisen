# Intelisen

Aplicație statică pe GitHub Pages, cu date citite din Supabase. Tema implicită este albă; butonul Light/Dark salvează preferința în browser. Login deschide secțiunea Nord Pool, protejată prin Supabase Auth și RLS. Pagina verifică automat datele la 60 de secunde și la revenirea în tab.

## Date și execuție online

Nordpool (`qumxkyavlavixzaevipw`): contracte TEL, statistici Total și tranzacții. SEN (`squtjqwjnwlnqlvfzlzg`): DAMAS, SEN, OPCOM PZU/IDA, ENTSO-E, Open-Meteo și curs BNR. Volue este exclus. Colectoarele rulează prin Supabase Cron; ENTSO-E folosește o Edge Function care acceptă inclusiv răspunsuri ZIP. Calculatorul local nu este necesar pentru colectare.

Istoricul începe la 1 octombrie 2026. Importurile rulează în cozi în cloud; lipsurile sunt afișate ca lipsuri, fără valori fabricate. Datele și reviziile originale sunt păstrate. Exploratorul surselor oferă grafice și export JSON. Scripturile din `collectors/` sunt adaptoare de referință; nu reprezintă execuția online.

Credențialele furnizorilor sunt numai în Vault. Cheile publishable din pagină sunt publice; accesul privat Nord Pool este limitat de `nordpool_private.allowed_emails`. Fișierele statice Nord Pool au fost eliminate din pagina publică. Autentificarea nu acordă automat acces unui cont neautorizat.

## Configurare

În proiectul SEN, se aplică în ordine: `demo-live/setup.sql`, `supabase/damas-reports.sql`, `supabase/opcom.sql`, `supabase/weather.sql`, `supabase/bnr.sql`, `supabase/sen-history.sql`, `supabase/entsoe-documents.sql`, `supabase/entsoe-worker.sql`. Se configurează secretul `entsoe_token` în Vault, se publică `supabase/functions/entsoe-collector/index.ts`, apoi se aplică `supabase/entsoe-worker-cron.sql`. Secretul intern al workerului este creat de SQL. Funcția verifică acest secret pe lângă autentificarea gatewayului.

În proiectul Nordpool: `supabase/nordpool.sql`, `supabase/nordpool-total.sql`, `supabase/nordpool-history.sql`. Vault: `np_username`, `np_password`, opțional `np_subscription_key`. Lista de emailuri autorizate se gestionează administrativ, separat de codul public.

GitHub Pages: Settings → Pages → main → / (root). Publicarea codului este distinctă de colectarea datelor. Tema și Login sunt disponibile în dashboard, demo SEN și pagina Nord Pool.

## Interpretare

PH și comparațiile folosesc CET/CEST. Datele surselor păstrează timestampurile originale UTC. Orele repetate la schimbarea orei rămân în datele brute și sunt excluse din comparațiile PH. O medie orară cere patru sferturi complete.

PZU brut este RON/MWh; comparația PZU în EUR/MWh folosește cursul BNR. Volumele PZU se convertesc din MW în MWh prin durata intervalului. Volumele tranzacțiilor Nord Pool rămân MW, fără marcaj buy/sell inventat. Valorile DAMAS cu unitate neconfirmată rămân brute. API Nord Pool publică tranzacțiile cu întârzierea furnizorului; colectarea frecventă nu elimină această întârziere.

Plotly: `vendor/LICENSE-plotly.txt`. Graficele Nord Pool folosesc TradingView Lightweight Charts.
