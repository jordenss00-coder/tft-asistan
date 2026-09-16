# TFT Asistan

Teamfight Tactics için masaüstü asistan: güncel meta comp'lar, trait planlayıcı ("11 Çiçek nasıl yapılır?"), maç geçmişi analizi, Gemini tabanlı AI koç ve oyun içi overlay.

## Kurulum (kullanıcılar için)

1. [Releases](https://github.com/jordenss00-coder/tft-asistan/releases/latest) sayfasından `TFT Asistan Setup x.y.z.exe` dosyasını indir ve çalıştır.
2. Windows "kişisel bilgisayarınızı korudu" uyarısı gösterirse **Ek bilgi → Yine de çalıştır**'a tıkla (uygulama imzasız).
3. Kurulumdan sonra güncellemeler otomatik gelir: uygulama açılışta ve 4 saatte bir yeni sürümü kontrol eder, arka planda indirir. Sol alttaki **Yeniden başlat ve güncelle** butonuyla ya da uygulamayı kapatınca kurulur.

Her kullanıcı kendi Riot ve Gemini API anahtarını Ayarlar'dan girer. Anahtarlar yalnızca o bilgisayarda saklanır.

## Geliştirme

### Tahtaya göre canlı öneri (0.5.3)

Canlı Koç ve overlay içindeki **Tahtamı oku ve öner** düğmesi TFT pencere görüntüsünü
Gemini'ye gönderir (kullanıcının Gemini anahtarı gerekir; API ücreti oluşabilir).
Kendi tahtanı hazırlık aşamasında açık tut. Deneysel görsel tanıma şampiyonları ve
yıldızları okur; belirsiz/eksik sonuç mevcut listeyi değiştirmez. Okunan listeyi
kontrol et, gerekirse birimleri ve yıldızlarını düzelt. Eşyalar hâlâ elle girilir.
**30 sn otomatik okumayı başlat** oturum boyunca çalışır; durdurulabilir ve maç
bittiğinde kapanır. Uygulama yeniden açılınca tekrar etkinleştirilmelidir.

Motor sahadaki birimleri meta comp'larıyla karşılaştırır; en yakın yeterli eşleşme
eşya/seviye önerilerinin hedefidir. Elle seçilen hedef her zaman önceliklidir.
Eşleşme bir olasılık veya kazanma yüzdesi değildir. Gerçek maçlardaki görsel tanıma
doğruluğu henüz ölçülmemiştir; otomatik karar veya oyun girdisi uygulanmaz.

Doğrulama: `node --test tests/board.test.js`

```bash
npm install
npm start
```

Gereksinim: Node.js 20+ (Windows).

## Yeni sürüm yayınlama

1. `package.json` içindeki `version` değerini artır (ör. `0.2.0` → `0.2.1`).
2. Değişiklikleri commit'leyip GitHub'a gönder.
3. Yayınla (GitHub CLI ile giriş yapılmış olmalı):

```powershell
$env:GH_TOKEN = gh auth token; npm run release
```

Bu komut kurulum dosyasını derler ve GitHub Releases'e yükler. Kurulu uygulamalar yeni sürümü kendiliğinden bulur.

## Özellikler

| Bölüm | Ne yapar |
| --- | --- |
| **Meta Comp'lar** | 6 kaynaktan gelen comp'ları birim benzerliğine göre birleştirir, her sitenin tier'ını yan yana gösterir. Carry eşyaları, erken board, stage ipuçları, güçlendirmeler ve TFT istemcisine yapıştırılabilir takım kodu içerir. |
| **Comp Planlayıcı** | Bir trait'i hedef kademeye çıkarmak için gereken şampiyonları, amblem sayısını ve tarifini, seviye/slot ihtiyacını, adım adım yolu ve önerilen final board'u hesaplar. |
| **Oynanış Analizi** | Açık istemcideki hesabını otomatik algılar, son maçlarını çeker: ortalama sıra, top 4, seviye ve altın alışkanlıkları, eşya toplama, comp/trait/güçlendirme performansı ve otomatik gelişim önerileri. Motor verisi varsa her maç için güçlendirme seçimi, eşya yerleşimi ("X yerine Y"), elenirken board gücü ve o eşya/güçlendirmelere daha uygun comp'lar değerlendirilir. |
| **AI Koç** | Gemini ile Türkçe sohbet. Set verisi, birleşik meta, trait planı ve maç analizin bağlam olarak gönderilir. |
| **Canlı Koç** | Oyundaki durumunu (stage, seviye, altın, can, seri, bileşenler, eşyalar, güçlendirmeler, birimler) girersin; ekonomi/seviye/roll kararı, sana en uygun comp'lar, bileşenlerden hangi eşyanın yapılıp kime verileceği ve board gücü kontrolü anında hesaplanır. Overlay'deki Koç sekmesiyle eşzamanlıdır. |
| **Kendi istatistik motoru** | Riot API ile sunucundaki Challenger/Grandmaster/Master dereceli maçlarını arka planda toplar; birim, yıldız, eşya (birim üzerinde), güçlendirme, trait ve comp başarılarını sitelerden bağımsız hesaplar. Canlı Koç ve maç analizi bu veriyi kullanır. |
| **Comp detayı** | Board yerleşimi (4×7 altıgen, TFT Academy rehberinden), seviye 4-5'ten 9-10'a kadar board planı, comp'taki **her birimin** önerilen eşyaları, kaynak bazlı istatistikler ve tıklanabilir trait detayları. |
| **Eşya Rehberi** | Eşyalar yüksek elo başarısına göre sıralı: ortalama sıra, top 4, oynanma ve **en iyi taşıyıcılar**. Eşyaya tıklayınca açıklama, tarif, taşıyıcı listesi ve o eşyayı kullanan comp'lar. Bileşen birleşim tablosu da ayrı bölümde durur. |
| **Trait detayı** | Kademe etkileri, kademe bazlı ortalama sıra/top 4, trait'in şampiyonları, amblem tarifi ve "bu trait nasıl oynanır?" için AI koça kısayol. |
| **Şampiyon detayı** | Uygulamadaki herhangi bir birime tıklayınca açılır: yeteneğin ne yaptığı (sayılarla, 1★/2★/3★), mana maliyeti, temel değerler, en iyi eşyalar, birimin ortalama sırası ve 3★ başarısı, o birimi kullanan comp'lar. |
| **Overlay** | Oyunun üstünde duran panel: sabitlenen comp, meta listesi, hızlı trait planı ve eşya tablosu. TFT maçı başlayınca otomatik açılabilir. |

## Ekran okuma (deneysel)

Ayarlar → **Ekran okuma** açıkken, TFT maçı sırasında 3 saniyede bir oyun penceresinden kendi **altın**, **seviye**, **stage**, (isteğe bağlı) **can** ve **dükkan** bilgilerin okunur ve Canlı Koç'a otomatik aktarılır. Dükkanda hedef comp'una uyan birimler işaretlenir.

- Okuma tamamen bilgisayarında, çevrimdışı OCR (Tesseract, İngilizce + Türkçe dil verisi) ile yapılır; görüntüler hiçbir yere gönderilmez.
- Yalnızca kendi ekranındaki bilgiler okunur; rakip bilgisi okunmaz.
- Oyunu **Kenarlıksız** veya **Pencereli** modda çalıştır.
- Yazıların yeri çözünürlüğe ve arayüz ölçeğine göre değiştiği için ilk kullanımda kalibrasyon yap: maç sırasında "5 sn sonra ekran görüntüsü al" → her alan için kutu çiz → "Okumayı test et" → "Alanları kaydet".

## Veri kaynakları

- **Set verisi (Türkçe):** CommunityDragon
- **İstatistik:** MetaTFT, tactics.tools (Elmas+ maçlar)
- **Rehber / tier listesi:** TFT Academy, lolchess.gg, TFT Flow, BunnyMuffins

Kaynaklar Ayarlar'dan tek tek kapatılabilir. Veriler önbelleğe alınır (istatistik 1 saat, rehberler 3 saat, set verisi 12 saat). Bir site ulaşılamazsa son önbellek kullanılır. Bu siteler resmi bir API sunmadığı için sayfa yapıları değişirse ilgili kaynak "hata" olarak görünür, diğerleri çalışmaya devam eder.

## API anahtarları

- **Riot API:** [developer.riotgames.com](https://developer.riotgames.com/). Geliştirici anahtarları 24 saatte bir yenilenmelidir.
- **Gemini API:** [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Varsayılan model `gemini-3.1-flash-lite`'tır (düşük maliyet). Ayarlar'daki "Modelleri getir" ile başka model seçilebilir.

Anahtarlar `%APPDATA%\tft-asistan\settings.json` içinde Windows DPAPI ile şifrelenmiş olarak saklanır.

## Overlay kullanımı

- Varsayılan kısayollar: **Alt+T** overlay'i açar/kapatır, **Alt+Y** tıklama geçirgenliğini açar/kapatır (açıkken tıklamalar oyuna geçer).
- Overlay'in oyunun üstünde görünmesi için TFT'yi **Kenarlıksız** veya **Pencereli** modda çalıştır. Tam ekran modunda görünmez.
- Oyun algılama, çalışan oyun sürecine bakarak yapılır (`TFTClient-Win64-Shipping.exe`). TFT, League'in aksine `127.0.0.1:2999` yerel oyun API'sini açmaz. Yalnızca sürecin varlığına bakılır, oyun verisi okunmaz.

## Riot kurallarına uyum

Overlay yalnızca kullanıcının kendi seçtiği comp'u, genel meta istatistiklerini ve plan bilgisini gösterir. Rakiplerin board'larını takip etmez, oyun belleğini okumaz, girdi otomasyonu yapmaz ve reklam içermez.

## Proje yapısı

```
main.js                  Pencereler, overlay, kısayollar, IPC
preload.js               Renderer'a açılan güvenli köprü
src/services/
  staticData.js          CommunityDragon set verisi + takım planlayıcı kodları
  meta.js                Kaynak birleştirici
  sources/*.js           Her site için veri okuyucu
  planner.js             Trait planlayıcı
  riot.js, analysis.js   Maç çekme ve oynanış analizi
  gemini.js, coach.js    AI koç
  liveClient.js          Oyun algılama
src/renderer/            Ana pencere ve overlay arayüzü
```
