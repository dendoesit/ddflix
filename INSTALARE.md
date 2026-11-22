# DDflix — cum rulează ACUM (22.11.2026)

- **Server:** pe PC-ul cu Plex (192.168.1.153), în Docker Desktop, containerul `ddflix`, port 8090. Citește filmele direct din `F:\Downloads` (doar citire), același folder ca Plex. Torrentele le face qBittorrent-ul tău, nu DDflix.
  - Pornire sau actualizare: `docker compose -f docker-compose.pc.yml up -d --build`, rulat în `netflix-local`.
  - Pornește singur cu Windows, prin Docker Desktop „autoStart” și `restart: unless-stopped`. PC-ul trebuie să fie pornit, la fel ca pentru Plex.
- **Admin:** http://192.168.1.153:8090
- **The Frame 50** (192.168.1.128): DDFLIX instalat și conectat. Reinstalare: `tvuild-tv.ps1 -NasIp 192.168.1.153 -TvIp 192.168.1.128` (certificat `FrameHomeS`).
- NAS-ul Synology DS216se (192.168.1.160) are 256 MB RAM și nu rulează Docker, deci nu se folosește.
- Restul ghidului de mai jos e varianta pentru NAS/Docker, păstrată pentru un viitor server.

---

# DDflix: Netflix local pe NAS + aplicația pe televizoarele Samsung

## Ce e în folder

| Folder / fișier | Ce e |
|---|---|
| `server/` | Serverul scris de la zero după `MASTER-PROMPT-SERVER.md` (Python + ffmpeg), rulează în Docker pe NAS |
| `docker-compose.yml` | Pornește 2 containere: `bubuflix` (serverul) și `qbittorrent` (descărcările) |
| `.env.example` | Toate setările tale (RSS, căi, IP-uri). Se copiază ca `.env`, **niciodată în cod sau în git** |
| `qbittorrent/qBittorrent/qBittorrent.conf` | Setări inițiale qBittorrent (serverul are voie să-i trimită torrente fără parolă) |
| `tv/` | Aplicația pentru TV (codul primit), cu ID-ul tău `DanFlx0001` și scriptul `build-tv.ps1` |
| `tv-app-src/`, `_incoming/` | Originalele primite, neatinse |

## Arhitectura, pe scurt

```
FileList RSS ──(la 15 min)──> bubuflix (NAS) ──.torrent──> qBittorrent (NAS) ──> /media/downloads/seriale|filme
                                   │  scanează /media la 10 min, recunoaște titlul pe IMDb (Cinemeta, fără cheie),
                                   │  postere, episoade, subtitrări .srt/.ass + cele din .mkv
                                   ▼
          Samsung TV (aplicația DDflix, Tizen) ──HTTP în LAN :8090──> redare
          telefon / PC ──> http://IP-NAS:8090  (admin: conectare TV, profiluri, seriale urmărite, RSS, bibliotecă)
```

- **Pe server:** împerecherea TV-urilor printr-un cod de 6 litere, profiluri cu PIN, catalog („Continuă”, „Lista mea”, căutare), progres și redare:
  - **direct**, fișierul original cu Range: 4K, HDR, Dolby Vision, AC3/EAC3. Acesta e cazul normal în LAN;
  - **remux HLS**, când TV-ul nu suportă sunetul (de ex. DTS sau TrueHD, frecvente pe FileList): video copiat, sunet convertit în AAC stereo, cu derulare exactă;
  - **transcode HLS** la 1080p/720p, doar ca ultimă soluție. Folosește mult procesorul NAS-ului.
- **Pe TV:** aplicația web Tizen primită, gata făcută. Se leagă doar de server (`lanApi` din `js/config.js`). Vremea, BNR, carburanții și crypto pentru dashboard le ia singură de pe internet.
- **RSS → torrent:** în modul `follow` (implicit) se descarcă doar episoadele din „Seriale urmărite”. Același episod nu se descarcă de două ori, iar un episod nu se mai descarcă dacă ai deja sezonul întreg. La prima pornire nu se descarcă ce era deja în feed. Torrentele **nu se șterg niciodată**: rămân la seed, pentru că pe FileList contează ratio-ul. Ce descarci de pe tracker e alegerea și responsabilitatea ta.
- Passkey-ul din URL-ul RSS există doar în `.env`. E mascat (`***`) în loguri și în pagina de admin și nu ajunge în baza de date. Am verificat asta la test.

**Testat local în Docker:** împerecherea TV-ului, profilurile, home, pagina de titlu cu sezoane și episoade, recunoașterea pe IMDb, posterele, redarea directă cu Range (206), remux-ul DTS→AAC cu derulare înainte și înapoi, transcode-ul, subtitrarea .srt în cp1250 cu diacritice și fluxul RSS → qBittorrent 5.0.4 real.
**Netestat încă:** pe un televizor real și pe NAS-ul tău.

## Ce nu face încă (intenționat, pentru prima versiune)
- Nu merge din afara casei. Mai târziu se poate face cu Tailscale sau VPN, fără porturi deschise.
- Trailerele nu se descarcă (yt-dlp).
- Cardurile de știri, trafic și cameră din dashboard rămân pe date demo.
- Profilul „Copii” filtrează după gen (Animation/Family), nu după rating.
- Nu există Plex. Site-ul de control urmează să fie construit pe pagina de admin de acum.

---

## Pasul 1: NAS (o dată)

1. Pe NAS: instalează **Docker** (Synology: Package Center → *Container Manager*; QNAP: *Container Station*).
2. Creează folderele: media (ex. `/volume1/media`, cu `downloads` în el) și `/volume1/docker/bubuflix`.
3. Copiază pe NAS, în `/volume1/docker/bubuflix`: `docker-compose.yml`, `.env.example`, folderul `server/` și folderul `qbittorrent/`.
4. Fă o copie a `.env.example` cu numele `.env` și completează:
   - `WEB_URL=http://IP-NAS:8090`, `LAN_CIDR=192.168.1.0/24`;
   - `PUID`/`PGID`: rezultatul comenzii `id` pe NAS, prin SSH;
   - `MEDIA_PATH`, `DATA_PATH`, `QBT_CONFIG_PATH`;
   - `FILELIST_RSS_URL`: pe filelist.io → **RSS** → bifezi categoriile (ex. Seriale HD/4K, Filme HD) → tip *download* → copiezi linkul **doar aici**.
5. Pornește serverul. Synology: Container Manager → *Project* → Create → folderul de mai sus → Build. Sau prin SSH:
   ```
   cd /volume1/docker/bubuflix && sudo docker compose up -d --build
   ```
6. Deschide `http://IP-NAS:8090`: apare pagina de admin. La **Seriale urmărite** adaugi serialele (ex. `The Last of Us`), apoi la **RSS & torrente** apeși „Verifică acum”.
7. qBittorrent: `http://IP-NAS:8080`. Parola temporară apare în logul containerului `qbittorrent`. Schimb-o din *Options → Web UI*.
   - Opțional, pentru ratio mai bun: în router, forward pe portul `6881` TCP+UDP către NAS.
   - Pagina de admin DDflix (8090) și qBittorrent (8080) **nu se deschid în router**.

Filmele sau serialele pe care le ai deja: pune-le oriunde sub `MEDIA_PATH`, iar la scanare apar automat. Ce nu e recunoscut se potrivește manual în *Bibliotecă*, cu ID-ul IMDb.

## Pasul 2: Televizoarele (o dată pe fiecare TV)

Ai deja **Tizen Studio** în `C:\tizen-studio` și profilul de certificat `FrameHomeS`, folosit pentru The Frame. Acel certificat conține însă **un singur televizor** (1 DUID). Pentru toate 4 îți trebuie un certificat distribuitor nou.

1. Pe fiecare TV: **Apps** → pe telecomandă tastezi `1 2 3 4 5` → **Developer mode ON** → *Host PC IP* = IP-ul PC-ului tău → oprești și pornești TV-ul.
2. Pe PC, pentru fiecare TV, afli DUID-ul:
   ```powershell
   C:\tizen-studio\tools\sdb.exe connect IP-TV:26101
   ```
   ```powershell
   C:\tizen-studio\tools\sdb.exe -s IP-TV:26101 shell 0 getduid
   ```
3. Tizen Studio → *Tools → Certificate Manager* → **+** → *Samsung* → *TV* → nume profil **`DanFlix`** → *Use an existing author certificate* (`%USERPROFILE%\SamsungCertificate\FrameHomeS\author.p12`, parola o pui tu) → certificat distribuitor nou cu **toate cele 4 DUID-uri** → te loghezi cu contul Samsung.
   Fă backup la `%USERPROFILE%\SamsungCertificate\`. Fără el nu mai poți actualiza aplicația.
4. Build și instalare, din `netflix-local\tv`:
   ```powershell
   .\build-tv.ps1 -NasIp IP-NAS -TvIp IP-TV
   ```
   Repeți comanda pentru fiecare televizor, cu IP-ul lui. Scriptul verifică compatibilitatea și rulează testele înainte de împachetare.
5. Pe TV deschizi **DDFLIX**: apare un cod de 6 litere și un QR. Scanezi QR-ul cu telefonul, care e în Wi-Fi-ul de acasă, sau deschizi `http://IP-NAS:8090` → *Televizoare* → introduci codul.

Note TV:
- OLED-ul de 65" redă 4K HDR direct. Pe The Frame, CU8072 și seria 6, 4K direct merge. HDR depinde de panou.
- DTS nu e suportat de TV-urile Samsung noi. Serverul îl convertește automat în AAC stereo, deci pierzi 5.1 pe acele fișiere.
- TizenBrew/TizenTube, recomandat pentru YouTube, folosește tot modul dezvoltator. Cele două nu se încurcă.
- Un TV cu Developer mode deja pornit pentru TizenBrew poate avea alt *Host PC IP*. Setează IP-ul PC-ului de la care instalezi acum.

## Comenzi utile pe NAS
```
sudo docker compose logs -f bubuflix
```
```
sudo docker compose pull qbittorrent && sudo docker compose up -d --build
```
Backup: `DATA_PATH/catalog.db` (profiluri, progres, TV-uri) și `.env`.
