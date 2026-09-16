# TFT Asistan — diğer yapay zekâ için devir dosyası

Son durum: 16 Eylül 2026. Proje: `D:\TFT`. Dil: Türkçe. Windows / PowerShell / Node.js / CommonJS.

## 1. Kullanıcının istediği sonuç

TFT oynarken sahadaki gerçek şampiyonları, yıldızlarını, eşyalarını, yedekleri,
dükkânı ve ekonomiyi otomatik algılayan; oynanan comp'a göre somut öneriler veren
masaüstü uygulama ve oyun içi overlay.

Kullanıcı ve eşi farklı Windows bilgisayarlarda kullanacak. GitHub Releases üzerinden
otomatik güncelleme daha önce kuruldu. Kullanıcı görsel okumadan memnun değil ve
**Overwolf GEP'e geçişi açıkça istedi.** Overwolf'un kişisel uygulama kısıtı
açıklandıktan sonra **herkese açık uygulama olarak sunmayı da kabul etti.**

Son kullanıcı isteği: Çalışmayı durdurup yapılacakları bu dosyada devretmek.
GEP geçişini tamamlanmış sayma; aşağıdaki durumu temel al.

## 2. Şu anda gerçekten ne var?

- Depo: https://github.com/jordenss00-coder/tft-asistan
- Son yayımlanan sürüm: **0.5.3**.
- Sürüm: https://github.com/jordenss00-coder/tft-asistan/releases/tag/v0.5.3
- Son uygulama değişikliği commit'i: `c237d9f` (tam kimliği Git'ten al).
- O sürümün `.exe`, `.exe.blockmap`, `latest.yml` varlıkları yayımlandı ve kontrol edildi.
- Yerel kurulum: `D:\TFT\dist\TFT-Asistan-Setup-0.5.3.exe`.
- Normal Electron uygulaması, Türkçe arayüz, meta kaynakları, comp planlayıcı,
  Riot maç analizi, Gemini koç, ekonomi/eşya/comp öneri motoru mevcut.
- `Alt+T` overlay, `Alt+Y` tıklama geçirgenliği varsayılanları.
- Kullanıcı ayarları/anahtarları yerel Electron userData içindeki store'da tutuluyor.
  Windows safeStorage kullanılıyor; anahtarları terminalde veya Git'te açığa çıkarma.
- **Gerçek maç verisi akmıyor.** Overwolf çalışma zamanı, onay ve kimlik bilgileri yok.
  Ancak 16 Eylül 2026 sonrası turda GEP kodu ve testleri yazıldı (aşağıya bak).

### 16 Eylül sonrası turda tamamlananlar (onay gerektirmeyen kısım)

Kullanıcı "onay gerektirmeyen kısmı yaz" dedi; şunlar yazıldı ve `npm test` ile doğrulandı (21/21):

- `src/services/gep/tftState.js` — saf normalizasyon: `applyInfo`, `applySnapshot`, `toLive`,
  `toLivePatch`, `isUsable`. JSON-metin ve nesne biçimleri, board/bench ayrımı, dükkan yuvaları,
  yalnızca yerel oyuncunun `item_bench` kaydı, rakip alanlarının yok sayılması, LoL oyun kimliğinin
  reddi, bilinmeyen şampiyonun zorla eşlenmemesi, yeni maç/maç sonu temizliği.
- `src/services/gep/client.js` — paket `ready`, `game-detected` (yalnızca 21570), `setRequiredFeatures`,
  `getInfo` anlık görüntüsü (session koruması ile), `new-info-update`/`new-game-event`, `game-exit`,
  `elevated-privileges-required`, `error`. Çift dinleyici kaydı engellendi; Overwolf runtime yoksa
  `unavailable` modunda sessizce devre dışı kalır.
- `tests/gep.test.js` — 16 senaryo; `package.json` içine `npm test` eklendi.
- `main.js` — `initGep()`, `applyGepLive()` (yalnızca gelen alanlar yazılır, tahtadan trait sayımı),
  `gep:status` IPC'si, GEP canlıyken OCR döngüsünün durdurulması.
- `preload.js` — `gep:status` invoke ve event kanalı.
- `src/renderer/live.js` — veri kaynağı durum satırı, dükkanın ortak canlı durumdan gösterilmesi.
- Eksik veri koruması: tur/altın/seviye gelmeden ekonomi ve board önerisi üretilmiyor;
  `coachNow` artık `missing` listesi döndürüyor ve arayüz eksikleri yazıyor.

Kalan: Overwolf runtime indirme, `overwolf.packages` yapılandırması, onay/kimlik/imzalama,
gerçek maç testi (test listesindeki 13-15 numaralı maddeler).

### Overwolf paketleri

`npm install --save-dev --save-exact` ile şu paketler kuruldu:

- `@overwolf/ow-electron`: `42.7.1`
- `@overwolf/ow-electron-builder`: `26.9.3`
- `@overwolf/ow-electron-packages-types`: `1.1.11`

`package.json` ve `package-lock.json` değişiklikleri commit edildi (`59045d2`).
Standart `electron` ve `electron-builder` hâlâ devDependencies içinde.
`npm start` hâlâ `electron .`, `npm run dist` hâlâ standart electron-builder çağırıyor.
`overwolf.packages` yapılandırması henüz eklenmedi.

`node_modules/@overwolf/ow-electron/path.txt` ve `dist/ow-electron.exe` kontrolleri false
döndü. npm paketinin kurulması runtime indirmesinin tamamlandığı anlamına gelmiyor.
Resmi pakette `install.js` ve `install-ow-electron` komutu var; çalıştırma yolunu
paketin CLI ve belgelerinden doğrula. Runtime henüz başlatılmadı.

npm kurulumunda **8 high severity vulnerability** raporlandı; ayrıntıları incelenmedi.
`npm audit` ile kökenlerini ayır, körlemesine `npm audit fix --force` çalıştırma.

## 3. Neden önceki çözüm yetersiz?

`screenReader.js` Tesseract ile altın, seviye, stage, trait paneli ve dükkân metnini
okuyor; tahtadaki şampiyon modellerini tanımıyor.

0.5.3'te eklenen `boardVision.js`, kullanıcının düğmeye basması veya 30 saniyelik
okumayı açmasıyla oyun penceresi görüntüsünü Gemini'ye gönderiyor. Deneysel;
gerçek maçtaki doğruluk **ölçülmedi**. Eşyaları okumuyor. Beş otomatik testin geçmesi,
görsel tanımanın gerçek oyunda çalıştığını kanıtlamıyor.

Yeni hedef: GEP olaylarını ana veri kaynağı yap. Ekran görüntüsü ve Gemini,
tahta tanıma için zorunlu olmasın. Gemini yalnızca isteğe bağlı açıklama/sohbet
için kalabilir. GEP hatasında sessizce görüntü göndermeye geçme.

## 4. Erişim ve dağıtım gereksinimleri — dış bağımlılıklar

16 Eylül 2026 tarihinde resmi belgelerden doğrulandı; işe devam ederken tekrar kontrol et:

1. Overwolf uygulama fikrinin başvurulup onaylanmasını/whitelist edilmesini istiyor.
2. Sadece kişisel/aile içi kullanımlı private app'leri şu anda onaylamadığını söylüyor.
   Kullanıcı public app olmasını kabul etti; bunun onay alınmış olmasıyla ilgisi yok.
3. Dev mode bile kimlik doğrulama istiyor:
   - `OW_CLI_EMAIL` + `OW_CLI_API_KEY` (Overwolf Console), veya
   - onaylı geliştirici profilinden `OW_DEV_KEY`.
4. Bu ortamda `OW*` ortam değişkeni adları kontrol edildi; hiçbir sonuç dönmedi.
   Hesabın başka yerde bulunmadığı sonucu çıkarma. Kullanıcıdan anahtarı sohbete
   yapıştırmasını isteme; yerel environment/secrets kurulumu tercih et.
5. Dağıtılabilir GEP exe'si için hem Overwolf paket bütünlük imzası hem geliştiricinin
   **kendi kod imzalama sertifikası** gerekiyor. Dev mode paketli uygulamada çalışmıyor.
6. Üretim belgeleri `OW_CLI_EMAIL`, `OW_CLI_API_KEY`, `OW_BUILD_KEY`, kayıtlı App UID
   ve kod imzalama sertifikası gerektiriyor.
7. Mevcut `build.win.signAndEditExecutable: false` ayarı üretim GEP dağıtımı için
   uygun değil. İmzasız normal exe yayımlayıp GEP'in çalışacağını söyleme.

Henüz Overwolf hesabına giriş yapılmadı, başvuru gönderilmedi, App UID alınmadı,
sertifika satın alınmadı/kurulmadı. Bu işlemler tamamlanmış gibi davranma.
Başvuru metnini önce hazırlanmış, incelenebilir bir dosya haline getir.

### Resmi bağlantılar

- Başvuru koşulları: https://dev.overwolf.com/ow-electron/getting-started/project-roadmap/
- Başvuru formu: https://dev.overwolf.com/app-idea-form/
- Geliştirme: https://dev.overwolf.com/ow-electron/getting-started/develop-your-idea/
- İlk uygulama: https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/first-app/
- Dev mode: https://dev.overwolf.com/ow-electron/guides/dev-tools/dev-mode/
- Üretim imzalama: https://dev.overwolf.com/ow-electron/guides/dev-tools/app-signing/
- GEP API: https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/gep/Overview/
- GEP arayüzü: https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/gep/interfaces/OverwolfGameEventPackage/
- TFT veri şeması: https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/teamfight-tactics/
- Resmi Electron örneği: https://github.com/overwolf/ow-electron-packages-sample
- Riot TFT kuralları: https://developer.riotgames.com/docs/tft

## 5. Kod haritası

| Dosya | İşlev / yapılacak bağlantı |
|---|---|
| `main.js` | Pencereler, IPC, canlı state, OCR döngüsü, Gemini tahta taraması, updater |
| `preload.js` | İzin verilen invoke/event kanalları; yeni GEP status kanalını ekle |
| `src/renderer/live.js` | Ana pencere ve overlay'in ortak canlı koç formu/state/sonuç görünümü |
| `src/renderer/overlay.js` | Overlay Canlı Koç sekmesi, `Live.init`, `live:state` dinleyicileri |
| `src/renderer/app.js` | Masaüstü ekranları ve ayarlar |
| `src/services/liveClient.js` | Şu an tasklist ile oyun süreci tespiti; GEP lifecycle ile çakıştırma |
| `src/services/ocr/screenReader.js` | Yerel OCR; GEP verisini ezmemeli |
| `src/services/ocr/boardVision.js` | Deneysel Gemini tahta okuma; GEP'e geçince ana yol olmamalı |
| `src/services/engine/index.js` | `coachNow` tüm önerileri birleştirir |
| `src/services/engine/boardMatch.js` | Gerçek birim listesini meta comp'larıyla eşleştirir |
| `src/services/engine/compRecommender.js` | Birim/eşya/trait/meta uyum puanları |
| `src/services/engine/itemCoach.js` | Eşya üretme, taşıyıcı ve eksik eşya önerileri |
| `src/services/engine/boardCoach.js` | Sahadaki birimlerden güç ve eksik slot tahmini |
| `src/services/engine/econCoach.js` | Ekonomi ve seviye önerileri |
| `src/services/traits.js` | ID çözümleme, tekil şampiyon sayımı, amblem katkıları |
| `src/services/staticData.js` | Set, şampiyon ve eşya sözlükleri |
| `src/services/store.js` | Ayarlar, API anahtarları ve kalıcılık |
| `scripts/release.ps1` | Eski normal Electron release akışı; OW builder'a uyarlanmalı |
| `tests/board.test.js` | Beş test; GEP testi henüz yok |

## 6. Doğrulanan GEP API bilgileri

Resmi örnekte paket erişimi: `app.overwolf.packages.gep`.
Paket yöneticisinin hazır olma olayı:

```js
app.overwolf.packages.on('ready', (_event, name, version) => {
  if (name === 'gep') {
    // app.overwolf.packages.gep dinleyicilerini kur
  }
});
```

Dinleyicileri erken kur; uygulama açılırken ready olayını kaçırma ve birden fazla
kez kaydetme. Varsa zaten yüklenmiş paket akışını da belgelerden doğrula.

GEP imzaları:

```js
gep.on('game-detected', (event, gameId, name, ...args) => {});
// İlgili oyun için event.enable(); ardından feature kaydı.
await gep.setRequiredFeatures(gameId, features);
await gep.getFeatures(gameId); // string[]
await gep.getInfo(gameId);     // mevcut snapshot
gep.on('new-info-update', (event, gameId, data) => {});
gep.on('new-game-event', (event, gameId, data) => {});
gep.on('game-exit', (event, gameId, gameName, pid, ...args) => {});
gep.on('elevated-privileges-required', (event, gameId, name, pid) => {});
gep.on('error', (event, gameId, error, ...args) => {});
```

Electron `InfoUpdate`: `{category, feature, gameId, key, value}`.
TFT sayfasındaki Native örneklerinde ayrıca `{info:{category:{key:value}}}` ve
`{feature,category,key,data:"JSON string"}` biçimleri var. Snapshot ve canlı event'i
ayrı normalize et; tek bir örnek şekline güvenme, otomatik testlere ikisini de koy.

Kurulu type tanımlarında:

- `TeamfightTactics = 21570`
- `LeagueofLegends = 5426`

TFT sayfası LoL/TFT'nin ortak game ID davranışından da bahsediyor. GEP runtime'da
gelen kimliği ve `match_info.game_mode` değerini doğrula. LoL maçını TFT sayma;
21570 sabitinin her event'te mutlaka geleceğini varsayma.

Resmi örnek projenin `package.json`'ında:

```json
{"overwolf":{"packages":["gep","utility","overlay","recorder"]}}
```

Bizim yalnızca gereken paketleri istememiz yeterli; GEP için `gep`.
Mevcut BrowserWindow overlay'i korumak ayrı, Overwolf native overlay API'sine
taşımak ayrı iştir. Kullanıcının önceliği doğru canlı veridir.
Örneğin script'leri `ow-electron .` ve `ow-electron-builder --publish=never` kullanır.
Tip tanımlarını `node_modules/@overwolf/ow-electron-packages-types` altında incele.

## 7. TFT verisini uygulamanın state'ine çevirme

Önerilen yeni modüller (henüz yazılmadı):

- `src/services/gep/tftState.js`: saf, test edilebilir event/snapshot normalizasyonu.
- `src/services/gep/client.js`: Electron Overwolf paket yaşam döngüsü, abonelikler,
  bağlantı durumu, snapshot ve tekrar bağlanma.

### Eşleme

| GEP feature/key | Beklenen anlam | Uygulama |
|---|---|---|
| `board.board_pieces` | `cell_N: {name,level,item_1,item_2,item_3}` | `units: [{id,star,items,cell}]` |
| `bench.bench_pieces` | Aynı birim biçimi | Ayrı `bench` dizisi |
| `store.shop_pieces` | `slot_N: {name}` | 5 yuvalı `shop`; Sold/boş -> null |
| `me.xp` | `{level,current_xp,xp_max}` | `level`, `xp`, mümkünse `xpMax` |
| `me.gold` | Sayı/string | `gold` |
| `me.health` | Sayı/string | `hp` |
| `me.summoner_name` | Yerel oyuncu adı | Kendi item_bench kaydını seçmek için |
| `match_info.round_type` | `{stage,name,type}` | `stage`, tur tipi |
| `match_info.battle_state` | `{in_progress}` | Hazırlık/savaş durumu |
| `match_info.match_state` | `{in_progress}` | Maç başlangıcı/yerel oyuncu maç sonu |
| `match_info.pseudo_match_id` | Overwolf maç kimliği | Yeni maçta eski state'i temizlemek için |
| `bench.item_bench` | TÜM oyuncuların isim/tag ve bench_items listesi | Yalnızca yerel oyuncunun boşta eşyaları |

`bench.item_bench` örneği:

```json
[{"summoner":"Player","tag_line":"TR1","bench_items":[{"name":"DA_Component_BFSword","count":2}]}]
```

Yerel oyuncuyu kesin ayıramıyorsan başka bir oyuncunun eşyasını kullanma.
Kendi isim/tag bilgisi gelmeden kaydı atla veya yalnızca güvenilir yerel kaydı bekle.
Rakip `opponent_board_pieces`, roster geçmişi veya sonraki hamle tahmini bu uygulamanın
hedefi değil; önerilere dahil etme. Güçlendirme verileri için güncel Riot kısıtlarını
ayrıca doğrula; sırf API'de var diye augment istatistiklerini serbest varsayma.

### Kritik veri kuralları

- Eksik alan != boş liste. `board_pieces={}` gerçekten geldiyse tahtayı temizle;
  yalnızca gold event'i gelince tahtayı silme.
- Birim birleştirme/satma/taşıma doğru yansısın. Snapshot mı delta mı olduğunu
  gerçek örneklerle doğrula; tüm listeyi körlemesine append etme.
- ID'leri güncel statik sözlükte doğrula. Bilinmeyen ID'yi başka şampiyona zorla
  eşlemektense “bilinmiyor/veri uyumsuz” göster.
- `board` ve `bench` kesin ayrı olsun. Trait sayımı, boş slot ve board güç
  hesabında sadece board kullan. Yedekler geçiş/alış önerisine yardımcı olabilir.
- Birimin üzerindeki eşya boşta eşya değildir. `completed` yalnızca atanmamış
  bitmiş eşyaları, `components` yalnızca boşta bileşenleri temsil etsin.
- Eşya öneri motoruna `equipped`/birim eşyalarını ayrı geçir: takılı eşya tekrar
  üretilecek/atanacak gibi görünmesin; eksik carry eşyası hesabı bunu dikkate alsın.
- Trait sayımında amblem katkısını da dahil et. `countTraits` emblemTraits alabiliyor.
- GEP modu aktifken OCR, görüntü AI'sı ve eski form güncellemeleri GEP alanlarını
  ezmesin. Manuel hedef comp seçimi gibi kullanıcı tercihlerini koru.
- Event'leri ana süreçte işle; ana pencerenin görünür/kapalı olmasına bağlı olmasın.
- Async statik veri/snapshot cevabı yeni maçın verisini veya daha yeni eventi ezmesin.
  Session/revision kontrolü kullan; listener/timer temizliğini uygula.
- Provider hata/veri yok durumunda eski tahtayı “canlı” gösterme. Kaynak, son başarılı
  veri zamanı, beklenen/eksik alan ve hata kullanıcıya anlaşılır şekilde görünsün.
- GEP alanları gelmeden `2-1 / 4 seviye / 10 altın` varsayılanlarını gerçek oyun
  değeriymiş gibi kullanıp öneri verme. Canlı durumun yeterliliğini açıkça kontrol et.

## 8. Yapılacaklar — önerilen sıra

### A. Erişim ve başvuru hazırlığı

- [ ] Kullanıcıyla Overwolf hesabı/Console erişimini kur; login gerekirse kullanıcı yapsın.
- [ ] İngilizce başvuru taslağı yaz: Türkçe TFT koçu, public Windows uygulaması,
      oyun içi arayüz, yalnızca kendi durumundan karar seçenekleri ve maç sonrası analiz.
- [ ] Başvuruya mevcut depo ve ürün ekranlarını ekle; henüz çalışmayan GEP'i
      mevcut özellik gibi sunma. Monetizasyon planını kullanıcı adına uydurma.
- [ ] Onay/dev credential ve üretim imza gereksinimlerini takip edilebilir listeye koy.
- [ ] `.env`, sertifika, private key ve geliştirme giriş dosyalarını `.gitignore`'a ekle.

### B. Runtime ve bağlantı

- [ ] OW runtime indirmesini tamamla, ayrı `start:ow` veya ana `start` script'ini ayarla.
- [ ] `overwolf.packages` yapılandırmasını ekle; gereksiz recorder/ads modülü ekleme.
- [ ] GEP servisinin paket ready/game detected/exit/error akışını yaz.
- [ ] TFT feature aboneliklerini ve ilk getInfo snapshot'ını bağla.
- [ ] Kimlik bilgisi yoksa açık mesaj göster; normal UI'nin açılmasını GEP başarısı sanma.
- [ ] GEP desteği için runtime'ın sürüm değişimini (Electron 44 -> OW 42 tabanı)
      preload, safeStorage, pencere ve updater bakımından test et.

### C. State ve öneri motoru

- [x] 7. bölümdeki normalizasyonu saf fonksiyonlarla yaz ve test et.
- [x] `main.js` canlı state'ini GEP üzerinden güncelle, `live:state` broadcast kullan.
- [x] Veri modu/durumunu izinli IPC ile UI'ye taşı (`gep:status`).
- [x] Board/bench/equipped/free items ayrımını öneri motoruna uygula.
- [x] Gerçek tahtaya göre comp eşleştirmeyi koru; manuel hedef comp önceliğini koru.
- [x] GEP'de stage/altın/level eksikken yanıltıcı ekonomi önerilerini engelle (`missing` listesi).

### D. Arayüz

- [x] Ana pencere ve overlay'de “GEP bağlanıyor / oyun bekleniyor / canlı / veri
      kesildi / geliştirici erişimi gerekli” gibi doğru durumlar göster.
- [ ] Görüntü-Gemini tahta okuma panelini ana akıştan kaldır veya açık tercihle
      alternatif yap; kullanıcı GEP istedi, yeniden görüntü okumayı ana çözüm yapma.
- [ ] Okunan tahta, yıldızlar, takılı eşyalar, yedekler, dükkân ve son veri zamanı göster.
- [ ] Kullanıcıya “Şimdi oku” zorunluluğu olmadan event geldikçe önerileri yenile.
- [x] Dükkân önerilerini ortak `Live.state.shop` ile göster; OCR yalnızca yedek kaynak.

### E. Test ve dağıtım

- [ ] Aşağıdaki testleri çalıştır ve gerçek maç entegrasyonunu doğrula.
- [ ] `scripts/release.ps1`'i OW builder, imzalama ve her komutun exit code kontrolüyle düzelt.
- [ ] Recursive silme öncesinde hedefin proje içindeki `D:\TFT\dist` olduğunu doğrula;
      mümkünse çıktı klasörünü silmeden paketle. Mevcut betiği körlemesine kullanma.
- [ ] Üretim imzası/dev credentials tamamlanmadan mevcut latest sürümünü bozacak
      bir “GEP hazır” release yayımlama. Gerekirse prerelease/ayrı dal kullan.
- [ ] Onay ve imzalama tamamlanınca versiyon artır, paketle, test et, ardından publish.
- [ ] Eski kullanıcı ayarları ve API anahtarları korunsun; appId/userData adını
      gereksiz değiştirme. İki bilgisayarda güncelleme senaryosunu test et.
- [ ] Release'te `.exe`, `.exe.blockmap`, `latest.yml` birlikte ve hash'leri uyumlu olsun.

## 9. Asgari test listesi

Mevcut test: `node --test tests/board.test.js` — son çalışmada 5/5 geçti.

Yeni testler:

1. JSON-string ve object biçimindeki GEP update'leri aynı state'e dönüşüyor.
2. Boş board snapshot'ı tahtayı temizliyor; eksik board alanı tahtayı koruyor.
3. Satılan birim ve yıldız birleşmesi doğru; yedekler board sayımına girmiyor.
4. Shop Sold/boş slotu null oluyor, sıra korunuyor.
5. Takılı eşya boşta eşya/üretilebilir bileşen gibi sayılmıyor.
6. Item bench'ten yalnızca kendi oyuncunun eşyaları seçiliyor; belirsiz isim atlanıyor.
7. Rakip board güncellemesi hiçbir öneri/state değişikliği üretmiyor.
8. Maç sonu, yeni maç, oyun exit: eski veriler ve plan kaynakları temizleniyor.
9. LoL event'leri TFT state'ine işlenmiyor.
10. Hata, yetki ihtiyacı, eksik feature ve geciken snapshot durumları doğru gösteriliyor.
11. Tekrarlanan ready/detected event'leri çift listener/timer oluşturmuyor.
12. Sahte EventEmitter GEP ile board -> state -> coach -> renderer bağlantısı test ediliyor.
13. Gerçek TFT maçında şampiyon al/sat/taşı, eşya ver, seviye yükselt; UI'yi karşılaştır.
14. Ana pencere gizliyken overlay güncelleniyor; oyunlar arasında önceki board kalmıyor.
15. Paketli imzalı sürümde GEP yükleniyor; sadece dev modunun çalışması yeterli değil.

## 10. Kalan işler konusunda dürüst raporlama

- “Paketleri kurdum” != “GEP canlı veri alıyor”.
- “Sentetik testler geçti” != “Gerçek maçta doğru çalışıyor”.
- “GitHub public” != “Overwolf onaylı public app”.
- Onay ve anahtar yoksa kodu/testleri/başvuru taslağını tamamla; hangi dış adımın
  kullanıcıya veya Overwolf'a bağlı olduğunu açıkça belirt.
- Önceki cevaplarda platform ve veri imkânları konusunda fazla kesin ifadeler var;
  bu dosyadaki doğrulanan durumu ve güncel resmi belgeleri esas al.

## Yeni yapay zekâya verilecek kısa talimat

> D:\TFT\DEVIR-OVERWOLF-GEP.md dosyasını oku. Kullanıcı Overwolf GEP'e geçişi ve
> herkese açık uygulama olmasını onayladı. Mevcut arayüzü koruyarak GEP entegrasyonunu,
> state normalizasyonunu, UI durumlarını ve testlerini tamamla. Şu an yalnızca üç
> Overwolf npm paketi kurulmuş; çalışan entegrasyon veya Overwolf onayı yok. Gerekli
> erişim ve imza adımlarını somutlaştır. Görsel okumayı ana çözüm yapma ve gerçek
> maç testi yapmadan entegrasyonun çalıştığını iddia etme.
