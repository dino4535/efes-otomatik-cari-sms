# Efes Cari Yaşlandırma ve SMS Yönetimi

Kullanıcı bazlı şube ve SQL Server veritabanı seçimiyle salt okunur cari yaşlandırma raporu üreten, kullanıcı/yetki yönetimi, işlem kayıtları ve SMS gönderim altyapısı sunan yerel ağ uygulaması.

## Özellikler

- Fatura tarihine göre cari yaşlandırma: `0-14`, `15-21`, `22-30`, `31-45`, `46-60`, `61+` ve ayrıca `30+` toplamı.
- Aynı gün fatura/tahsilat eşleştirmesi ve kalan tahsilatların en eski faturalara FIFO uygulanması.
- Ayarlar ekranından ERP sunucu, port, kullanıcı ve şifre değiştirme; bağlantı testi.
- Kullanıcı bazlı ERP veritabanı ve şube ataması; kullanıcılar bu değerleri değiştiremez, yalnızca sistem yöneticisi atayabilir.
- Yönetici tarafından belirlenen TL toleransı (varsayılan `0`).
- Cari detayında açık faturalar, tahsilatlar, kalan tutarlar ve gün aralıkları.
- Cari detayında `Bire Bir Eşleşenler` sekmesi: tutarı birebir aynı olan aynı gün fatura/tahsilat çiftleri.
- Excel (`.xlsx`) dışa aktarma, arama, gün aralığı filtresi ve telefon filtresi.
- Giriş sonrası masaüstü kısayollarına sahip ana ekran; üst **Uygulamalar** başlat menüsü, KPI özetleri ve hızlı erişim. Sol menü kullanılmaz.
- Bayi/cari bazlı cari hareketleri ekranı: cari listesi, tarih aralığı seçimi, devir bakiyesi ve yürüyen bakiye ile ekstre.
- Ekstrede her fatura için vade tarihi, ödenme tarihi, durum ve gecikme günü; ödenen faturalarda gecikme son tahsilat tarihi − vade, açık/kısmi faturalarda rapor tarihi − vade olarak hesaplanır. Tahsilatlar kayıt tarihi yerine vade tarihine göre (çeklerde çek vadesi) FIFO ile eşleştirilir.
- Ağırlıklı ortalama vade tarihi, ağırlıklı ortalama tahsilat tarihi ve ortalama vade metrikleri.
- Ekstrede **Tür Bazında Tutarlar**: fatura, **İskonto Faturası**, **İşletme Katkı Payı**, iade, nakit tahsilat, **Kredi Kartı Tahsilatı**, çek ve havale/FAST hareketlerinin adet, borç, alacak ve net toplamları.
- Kullanıcı bazlı **finans görünürlüğü**: cari fonlama tutarı/günü, geç ödenen fatura faizi ve mevduat faiz kazancı yalnızca `finance.view` yetkisi olan kullanıcılara gösterilir.
- Ayarlardan yönetilen yıllık **mevduat faiz oranı** ile geç ödenen ve vadesi geçen faturalarda basit faiz (gün / 365) hesabı.
- Cari ekstresini vade/gecikme/durum/ödenme tarihi ve koşullu mevduat faizi sütunlarıyla Excel (`.xlsx`) olarak indirme.
- Stok durumu ekranı: ERP stok hareketlerinden güncel miktar, litre/adet karşılığı (gerekirse ürün adından litre çıkarımı), son alış/satış tarihi ve fiyatı, ortalama satış, stok günü ve FIFO parti yaşı.
- Kullanıcı hesapları, Admin/Kullanıcı rolleri ve ayrıntılı yetkiler.
- Zorunlu ilk giriş şifre değişikliği, giriş denemesi sınırı ve oturum yönetimi.
- Tüm kritik işlemler için işlem kaydı (audit log).
- SMS şablonları, cari bazlı telefon/aralık/opt-out/not ve sonraki gönderim zamanı.
- Test modunda gerçek SMS göndermeden simülasyon ve gönderim kayıtları.
- 5 dakikada bir çalışan zamanlayıcı; günlük gönderim saati, sessiz saatler, günlük limit ve cari aralığı kuralları.
- SQLite üzerinde yerel uygulama verisi; `node:sqlite` sayesinde ek veritabanı kurulumu gerekmez.
- Docker/Docker Compose ile Linux dağıtımı ve otomatik sağlık kontrolü.

## Teknoloji

- Node.js 24+
- Express 4, EJS, sunucu taraflı Türkçe arayüz
- SQLite (`node:sqlite`)
- `mssql` ile SQL Server bağlantısı
- `node-cron` zamanlayıcı
- Docker / Docker Compose

## Hızlı Başlangıç (Windows veya Linux)

1. Node.js 24+ kurun.
2. Bağımlılıkları yükleyin:

   ```bash
   npm install
   ```

3. `.env.example` dosyasını `.env` olarak kopyalayın ve doldurun:

   ```powershell
   Copy-Item .env.example .env
   ```

   ```bash
   cp .env.example .env
   ```

4. En az şu değerleri değiştirin:
   - `ERP_PASSWORD`: ERP kullanıcı şifresi.
   - `SESSION_SECRET`: en az 32 karakterlik rastgele bir değer.
   - `ADMIN_INITIAL_PASSWORD`: ilk yönetici şifresi.

5. Uygulamayı başlatın:

   ```bash
   npm start
   ```

   Windows'ta tek tıkla başlatmak için `baslat.bat` dosyasına çift tıklayabilirsiniz. Betik Node.js sürümünü kontrol eder, eksik bağımlılıkları yükler, `.env` yoksa `.env.example` dosyasından oluşturur, uygulamayı ayrı bir pencerede başlatır ve tarayıcıyı açar. Uygulama zaten çalışıyorsa yalnızca tarayıcıyı açar.

6. Tarayıcıdan açın: `http://localhost:5555`

   Yerel ağdaki diğer bilgisayarlar için başlangıç çıktısında yazan `http://<yerel-ip>:5555` adresini kullanın.

7. `ADMIN_USERNAME` / `ADMIN_INITIAL_PASSWORD` ile giriş yapın. İlk girişte şifre değiştirme ekranı zorunludur.

> `ADMIN_INITIAL_PASSWORD` yalnızca veritabanında hiç yönetici yokken kullanılır. Daha sonra `.env` içindeki değeri değiştirmek mevcut admin şifresini değiştirmez.

### ERP veritabanı değiştirme

`Ayarlar > ERP Veritabanı` bölümünden SQL Server bağlantısı değiştirilebilir:

- Sunucu, port, kullanıcı ve şifre alanları.
- TLS/şifreleme ve sunucu sertifikasına güven seçenekleri.
- `ERP Bağlantısını Test Et` butonu, kaydetmeden önce formdaki değerlerle bağlantıyı ve `TBLCAHAR` / `TBLCASABIT` tablolarını kontrol eder.
- Kaydettiğinizde yeni bağlantı bir sonraki yaşlandırma sorgusunda kullanılır ve yaşlandırma önbelleği temizlenir.

**ERP veritabanı ve şube kullanıcı bazlıdır.** Her kullanıcıya `Kullanıcılar` ekranından ayrı veritabanı ve şube atanır; kullanıcı giriş yaptığında yaşlandırma ve SMS ekranları kendi veritabanı/şubesini kullanır. Kullanıcı rolündeki hesaplar bu değerleri değiştiremez; yalnızca sistem yöneticisi atayabilir. Ayarlar ekranındaki **Varsayılan Veritabanı** ve **Varsayılan Şube Kodu** yalnızca kullanıcı bazlı değer tanımlanmamışsa ve arka plan SMS görevinde kullanılır.

Şifre alanı boş bırakılırsa mevcut şifre korunur. İlk kurulumda `.env` içindeki `ERP_PASSWORD` kullanılır; ayarlar ekranından yeni şifre girildiğinde yerel SQLite ayar veritabanında saklanır. `data/app.db` dosyasını yetkisiz erişime karşı koruyun.

### Geliştirme modu

```bash
npm run dev
```

## Yapılandırma

Tüm ayarlar `.env` ve uygulama içindeki **Ayarlar** ekranından yönetilir. Önemli ortam değişkenleri:

| Değişken | Açıklama | Varsayılan |
| --- | --- | --- |
| `PORT` | HTTP portu | `5555` |
| `HOST` | Dinlenecek adres | `0.0.0.0` |
| `NODE_ENV` | `development` / `production` | `development` |
| `APP_COMPANY_NAME` | Firma adı | `Efes` |
| `APP_BRANCH` | Varsayılan şube kodu (kullanıcı bazlı değer yoksa) | `3` |
| `APP_TIMEZONE` | Saat dilimi | `Europe/Istanbul` |
| `ERP_SERVER` | SQL Server adresi | `192.168.12.192` |
| `ERP_DATABASE` | Varsayılan ERP veritabanı (kullanıcı bazlı değer yoksa) | `DINO2026` |
| `ERP_USER` / `ERP_PASSWORD` | Salt okunur ERP kullanıcısı | `TEKNODES` / boş |
| `ERP_ENCRYPT` | SQL Server şifreli bağlantı | `false` |
| `ERP_TRUST_CERT` | Sertifika doğrulamasını gevşet | `true` |
| `APP_DB_PATH` | SQLite dosyası | `./data/app.db` |
| `SESSION_SECRET` | Oturum imzalama anahtarı | **mutlaka değiştirin** |
| `SESSION_HOURS` | Oturum süresi (saat) | `8` |
| `ADMIN_USERNAME` | İlk admin kullanıcı adı | `admin` |
| `ADMIN_INITIAL_PASSWORD` | İlk admin şifresi | **mutlaka değiştirin** |
| `ADMIN_FULL_NAME` | İlk admin adı | `Sistem Yöneticisi` |

ERP bağlantısı için kullanılan hesap yalnızca `SELECT` yetkisine sahip olmalıdır. Uygulama ERP tarafına yazma işlemi yapmaz.

**Finans** ayarlarındaki **Mevduat Faiz Oranı (yıllık %)** ile geç ödenen ve vadesi geçen faturaların faiz karşılığı hesaplanır. Oran `0` ise fonlama tutarı ve günü yine gösterilir, ancak faiz hesaplanmaz. Finans kartları ve ekstredeki mevduat faizi sütunu kullanıcı bazlı `finance.view` yetkisiyle görünür.

## Yaşlandırma Kuralları

- Kapsam: giriş yapan kullanıcının atanmış şubesi ve ERP veritabanı; `CARI_TIP = 'A'`. Cari ana kayıtlarında `SUBE_KODU = -1` olan ortak kayıtlar da dahil edilir.
- Hareket türleri: `A, B, C, D, E, G, K`.
- Yaş, fatura tarihi `TBLCAHAR.TARIH` üzerinden hesaplanır; vade tarihi kullanılmaz.
- Varsayılan olarak önce aynı gün içinde tutarı birebir aynı olan fatura ve tahsilatlar eşleştirilir; bu peşin fatura çiftleri FIFO'ya dahil edilmez.
- Yaşlandırma ekranındaki **Peşin Faturalar** seçimiyle bu çiftler hesaplamaya dahil edilebilir. Dahil edildiğinde aynı gün eşleştirmesi yapılmaz; tahsilat normal FIFO akışıyla en eski faturalara uygulanır ve peşin fatura açık bakiye olarak kalır. Böylece aynı gün eşit çiftlerin yaşlandırma dağılımına etkisi ayrıca görülebilir.
- Aynı gün tutarı eşit olmayan ve eşleşmeyen tahsilatlar en eski faturalardan başlayarak FIFO ile kapatılır.
- Tahsilatlarda FIFO tarihi olarak `D/G/K` hareketlerinin **vade tarihi** kullanılır. Vadeli çek, kayıt tarihinde değil vade tarihinde tahsil edilmiş sayılır; vadesi rapor tarihinden sonra olan çek açık borcu kapatmaz.
- Vadesi gelmemiş tahsilatlar cari bakiyesine yansır ancak açık faturayı kapatmaz. Bu nedenle açık borç toplamı ile cari bakiyesi arasındaki farkta vadesi gelmemiş çek/tahsilat tutarı ayrıca gösterilir.
- Tüm hesaplar kuruş cinsinden tam sayı ile yapılır.
- `30+` toplamı, `31-45 + 46-60 + 61+` aralıklarının toplamıdır.
- Kontrol toplamı, cari bakiyelerinin pozitif toplamıyla karşılaştırılır. ERP'deki 8 ondalık basamak ve büyük veri hacmi nedeniyle küçük yuvarlama farkları normaldir; kontrol betiği 1 TL'ye kadar tolerans tanır.

Kontrol betiği:

```bash
node scripts/check-aging.js
node scripts/check-aging.js 2026-11-11
```

## Ana Ekran ve Bayi Cari Hareketleri

Giriş sonrası açılan **Ana Ekran** (`/`), Windows masaüstü kısayollarına benzer ikonlarla cari yaşlandırma, bayi cari hareketleri, SMS, kullanıcılar, ayarlar ve işlem kayıtları ekranlarına hızlı erişim sağlar. Üst bölümde toplam açık borç, 30+ gecikmiş tutar, borçlu cari sayısı ve bugünkü SMS adedi özetlenir.

Uygulamada sol menü yoktur. Tüm ekranlara üst çubuktaki **Uygulamalar** başlat menüsünden veya ana ekrandaki masaüstü ikonlarından geçilir. Başlat menüsü `Alt+U` ile açılıp kapanır; dışarı tıklamak veya `Esc` kapatır. Üst çubukta ayrıca kullanıcı, ERP veritabanı ve şube bilgisi görünür.

**Bayi Cari Hareketleri** (`/cari-hareketleri`) ekranında:

- Cari listesi panelinde cari kodu, isim veya telefonla arama; yalnızca bakiyesi olanları filtreleme ve sayfalama.
- Cari seçildiğinde tarih aralığına göre borç, alacak ve yürüyen bakiye hareketleri görüntülenir.
- Ekstre başlangıcından önceki hareketlerden **devir bakiyesi** hesaplanır; dönem borcu, dönem alacağı ve dönem kapanışı ayrıca gösterilir.
- Her fatura satırında **vade tarihi**, **durum** (Ödendi/Kısmi/Açık), **ödenme tarihi** ve **gecikme günü** gösterilir.
- Tahsilatlar yaşlandırma motoruyla aynı kurallarla faturalara bağlanır: önce aynı gün tutarı birebir aynı olan fatura/tahsilat çiftleri kapanır, kalan tahsilatlar en eski borca FIFO uygulanır. Tahsilatın efektif tarihi **D/G/K için vade tarihidir**; çeklerde kayıt tarihi değil çek vadesi esas alınır. Vadesi gelmemiş çek, vadesi gelene kadar faturayı kapatmaz. Ödenen faturada gecikme **son tahsilat tarihi − vade**; açık veya kısmi faturada kalan tutar için **rapor tarihi − vade** olarak hesaplanır. Erken/aynı gün ödemede gecikme `0` olur; devir ve tahsilat satırlarında gecikme hesaplanmaz.
- Durum ve ödenme tarihi seçili bitiş tarihine göredir. Kısmi satırlarda son ödeme tarihi ile birlikte **ödenen** ve **kalan** tutar gösterilir.
- Dönem için **ağırlıklı ortalama vade tarihi**, **ağırlıklı ortalama tahsilat tarihi**, bunlardan türetilen **ortalama vade** ve **ortalama tahsilat farkı** kartları gösterilir. Ağırlıklar fatura/tahsilat kuruş tutarlarıdır; devir (`A`) hareketi ortalamaya katılmaz.
- **Tür Bazında Tutarlar** alanı, seçili dönemdeki hareketleri etkin türe göre toplar. `D/G/K` türünde alacak hareketi ve belge numarası `KK...` ile başlıyorsa veya açıklamada `KREDI KART`, `KREDİ KART`, `K.KART`, `KKART`, `Kart İşlemleri`, `POS BLOKE ÇÖZÜM`, `KART TAHSİLAT` geçiyorsa hareket **Kredi Kartı Tahsilatı** olarak sınıflanır ve `CC` anahtarıyla ayrıca gösterilir. Aynı sınıflama yaşlandırma cari detayındaki tahsilat satırlarında da **Kredi Kartı Tahsilatı** etiketiyle kullanılır. Diğer türler `A, B, C, D, E, G, K` etiketleriyle listelenir.
- Fatura alt türü, belgenin `TBLSTHAR` stok kalemlerinin `TBLSTSABIT.STOK_ADI` açıklamalarından türetilir. Stok açıklaması önce fatura şubesindeki kayıttan, yoksa `SUBE_KODU = -1` global stok kaydından alınır. Tüm kalemleri **İSKONTO** olan fatura **İskonto Faturası** (`BI`), tüm kalemleri **İŞLETME KATKI PAYI** olan fatura **İşletme Katkı Payı** (`BK`) olarak gösterilir. İskonto/katkı kalemi yanında normal stok kalemi de içeren faturalar **Fatura** olarak kalır. Etiket borç/alacak yönünden bağımsız uygulanır; satırlar `STHAR_CARIKOD` ile cariye daraltılır.
- **Finans** kartları (`finance.view` yetkisi varsa): **Fonlanan Tutar**, **Ort. Fonlama Günü**, **Geç Ödenen Faiz** ve **Mevduat Faiz Kazancı**. Fonlanan tutar, vadesi geçmiş açık veya kısmi faturaların kalan tutarıdır; fonlama günü kalan tutarla ağırlıklı ortalama gecikmedir.
- Mevduat faizi basit faizdir: `anapara × yıllık oran × gün / 365`. Ödenen faturada anapara fatura tutarı, gün son tahsilat tarihi − vade; kısmi faturada ödenen kısım için aynı kural, kalan kısım için rapor tarihi − vade; açık faturada kalan tutar ve rapor tarihi − vade kullanılır. Geç ödenen faiz tahsil edilmiş gecikmeleri, toplam kazanç ayrıca devam eden vadesi geçmiş tutarları içerir. Oran `0` ise faiz hesaplanmaz.
- Ekstre tablosunda `finance.view` varsa satır bazlı **Mevduat Faizi** sütunu ve devir/toplam satırlarında buna uygun sütun genişliği gösterilir.
- **Excel İndir** düğmesi seçili cari ve tarih aralığındaki ekstreyi vade tarihi, vade günü, gecikme günü, koşullu mevduat faizi, durum, ödenen/kalan tutar, ödenme tarihi ve vade/finans özetiyle `.xlsx` olarak indirir. Dosya adı `efes-cari-ekstre-<cariKod>-<bitisTarihi>.xlsx`, tüm geçmişte `-tum-gecmis` ekli olur.
- Varsayılan tarih aralığı içinde bulunulan yılın başı ile bugündür. **Tümü** ile tüm geçmiş görüntülenebilir.
- Liste için `aging.view`, ekstre ve Excel çıktısı için `aging.detail` yetkisi gerekir. Excel indirme `ledger.export` olarak işlem kaydına yazılır.

ERP'de ayrı bir bayi alanı/tablosu kullanılmadığından bayi listesi, `CARI_TIP = 'A'` olan cari hesaplardan oluşturulur; her cari için ekstre açılabilir. Ekstre bakiye doğruluğu için `A, B, C, D, E, G, H, K` hareket türleri kullanılır. Yaşlandırma raporu ise mevcut davranışını koruyarak `A, B, C, D, E, G, K` türlerini kullanır.

API uçları (oturumdaki kullanıcının veritabanı/şube kapsamıyla):

- `GET /api/ledger/dealers?q=&page=&pageSize=&onlyWithBalance=`
- `GET /api/ledger/statement?cariKod=&start=&end=` (`all=1` ile tüm geçmiş)
- `GET /api/ledger/statement.xlsx?cariKod=&start=&end=` (`all=1` ile tüm geçmiş)

## Stok Durumu

**Stok Durumu** (`/stok`) ekranı, kullanıcının atanmış ERP veritabanı ve şubesindeki stokları `TBLSTHAR` hareketlerinden hesaplar. Ekranın varsayılan görünümü stokta olan ürünlerdir; durum filtresiyle sıfır, negatif veya tüm ürünler görüntülenebilir.

### Hesaplama kuralları

- **Güncel stok:** `TBLSTHAR` içindeki `STHAR_GCKOD = 'G'` satırları pozitif, `'C'` satırları negatif toplanır. `TBLSTSABIT.MIKTAR` ve `STOKPH` kullanılmaz; bu alanlar ERP'de güncel tutulmamaktadır.
- **Ürün ve birim bilgisi:** Önce şubenin `TBLSTSABIT` kaydı, eksik alanlarda `SUBE_KODU = -1` global kaydı kullanılır. Stok miktarı ve hareket fiyatları birincil birim (`OLCU_BR1`) cinsindendir.
- **Litre/adet:** `OLCU_BR2` ve `OLCU_BR3` içinde `LT` / `AD` birimi varsa `PAY_1/PAYDA_1` (BR1→BR2) ve `PAY2/PAYDA2` (BR1→BR3) oranlarıyla dönüştürülür. Koli/kasa benzeri kaynak birimlerde 1'den küçük kayıtlı oran ters çevrilir; örneğin `1/24` ile `24/1` aynı koli→adet ilişkisini ifade eder. Birim dönüşümü tanımlı değilse litre, ürün adındaki `50 CL`, `70CL`, `23,7 CL`, `1 L`, `6*70CL`, `20*50 CL`, `12'Lİ` gibi ifadelerden hesaplanır. Koli/tava birimlerinde adet çarpanı (PAY oranı veya addaki paket adedi) kullanılır; `TEK ŞİŞE` / `TEK KUTU` ürünleri tek parça sayılır. `003/004/6xx` kodlu ve `ŞİŞE`, `KASA`, `PALET`, `FIÇI` gibi başlayan ambalaj/malzeme kartları litreye katılmaz. Adet dönüşümü tanımlı değilse adet hücresi boş kalır.
- **Son alış:** En güncel `STHAR_HTUR = 'L' AND STHAR_GCKOD = 'G' AND STHAR_GCMIK > 0` hareketi. **Son satış:** En güncel `STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_GCMIK > 0` hareketi. Ters yönlü satırlar iade sayılır ve son alış/satış tarihini belirlemez.
- **Fiyat:** Son hareketin `STHAR_NF` değeri, yoksa `STHAR_BF` değeri kullanılır. Hareket fiyatı hiç yoksa `TBLSTSABIT.SATIS_FIAT1` / `ALIS_FIAT1` yedek olur; `FIAT_BIRIMI` bu master fiyatını birincil birime çevirir. Hareket fiyatları her zaman birincil birim fiyatıdır.
- **Stok değeri:** Güncel stok × son alış fiyatı.
- **Ortalama satış:** Seçili penceredeki (30/60/90/180/365 gün, varsayılan 30) brüt `J/C` satış miktarı ÷ gün sayısı. İadeler (`J/G`) ortalama satıştan düşülmez; aksi halde sık iade yapan ürünlerde negatif ortalama oluşur.
- **Stok günü:** Güncel stok ÷ ortalama günlük satış. Ortalama satış `0` veya negatifse boş bırakılır.
- **Kalan stok yaşı (FIFO):** En yeni giriş partileri stokta kalacak şekilde hesaplanır. **Ortalama stok yaşı** stokla ağırlıklı ortalamadır; **En Eski Parti** stokta kalan en eski giriş partisinin yaşıdır. Stok sıfır veya negatifse yaş üretilmez.
- **Hizmet kalemleri:** `GRUP_KODU = 'EFES'`, `900xxx` / `EFESxx` kodları ve `HIZMET BEDELLERİ` fiziksel stok olmadığından varsayılan olarak gizlenir. Listede **Hizmet/EFES kalemlerini göster** ile dahil edilebilir.
- **Önbellek:** Tüm stok toplamları 60 saniye bellekte tutulur ve eşzamanlı istekler tek sorguda birleştirilir. **Listeyi Yenile** düğmesi önbelleği atlar. Arama, durum filtresi, sıralama ve sayfalama önbellekteki veri üzerinde JavaScript tarafında yapılır.

### Ortak litre tanımları

`/stok/litreler` ekranı, stok kodu bazında **ortak** litre tanımlarını yönetir. Aynı stok kodu DINO2026 ve BERMER2026 gibi farklı veritabanlarında aynı manuel değeri kullanır. Yetki `stock.litre` ile verilir; yönetici rolü varsayılan olarak yetkilidir.

- **Öncelik:** Manuel tanım → birim dönüşümü (`OLCU_BR1/2/3`) → ürün adından litre çıkarımı. Manuel değer girildiğinde otomatik hesap geçersiz sayılır.
- **Düz sayı** (`12`, `0,5`): 1 stok biriminin toplam litresi. Örneğin `12` girilirse 5 koli stok `60 Lt` olur.
- **Şişe/kutu hacmi** (`50 CL`, `70cl`, `330 ML`, `50 CC`): koli/tava gibi birimlerde ürün adından veya birim oranından bulunan paket adediyle çarpılır. `24` adetlik kolide `50 CL` girişi `12 Lt / koli` olur.
- **Litre** (`12 LT`, `1 L`): 1 stok biriminin litresi kabul edilir; paket çarpanı uygulanmaz.
- Boş bırakıp kaydetmek manuel tanımı siler ve otomatik hesaba döner.
- Ambalaj/malzeme kartları (`003/004/6xx`, `ŞİŞE`, `KASA`, `PALET`, `FIÇI` vb.) varsayılan olarak gizlenir; manuel litre tanımı girilen ambalaj kartları yine görünür kalır. Tümünü görmek için **Ambalaj/malzeme kalemlerini göster** kullanılır.
- Değişiklikler toplu kaydedilir; her kayıt işlem kaydına (audit log) yazılır. Stok listesi ve Excel çıktısı manuel tanımları anında kullanır.

### Ekran ve dışa aktarma

- Durum filtresi: **Stokta Olanlar**, **Sıfır Stok**, **Negatif Stok**, **Tümü**.
- Sütunlar: stok kodu, adı, stok, litre, adet, son alış/satış tarihi, ortalama günlük satış, stok günü, ortalama stok yaşı, en eski parti, son satış fiyatı (ve varsa litre fiyatı), stok değeri.
- Satıra tıklanınca son 50 stok hareketi tür, belge, cari, miktar, birim fiyat ve açıklama ile gösterilir.
- **Excel** düğmesi filtrelenmiş tüm listeyi (sayfalama olmadan) başlık, özet, açıklama, toplam satırı ve otomatik filtreyle indirir. Dosya adı `efes-stok-durumu-<tarih>.xlsx` biçimindedir.
- Liste için `stock.view`, Excel çıktısı için `stock.export` yetkisi gerekir. Excel indirme `stock.export` olarak işlem kaydına yazılır.

API uçları (oturumdaki kullanıcının veritabanı/şube kapsamıyla):

- `GET /api/stock?state=in|zero|negative|all&window=30|60|90|180|365&q=&sort=&dir=&page=&pageSize=&services=0|1&refresh=0|1`
- `GET /api/stock/export.xlsx?state=&window=&q=&sort=&dir=&services=`
- `GET /api/stock/:stokKodu/movements?limit=50`
- `GET /api/stock/litres?state=&source=missing|manual|auto|all&q=&services=0|1&packaging=0|1&page=&pageSize=` (`stock.litre`)
- `POST /api/stock/litres` gövde: `{ "entries": [{ "code": "226931", "value": "50 CL" }] }`; boş `value` manuel tanımı siler. (`stock.litre`)
- `DELETE /api/stock/litres/:stokKodu` manuel tanımı siler. (`stock.litre`)

## SMS Altyapısı

Varsayılan olarak **test modu** açıktır (`sms.test_mode = 1`). Bu modda gerçek SMS gönderilmez; gönderimler `simulated` durumuyla kaydedilir.

### Otomatik gönderim

- Zamanlayıcı her 5 dakikada bir kontrol eder.
- `sms.enabled = 1` değilse otomatik gönderim yapılmaz.
- Günde en fazla bir otomatik görev başarıyla çalışır.
- Gönderim saati (`sms.send_time`) ve sessiz saatler dikkate alınır.
- Adaylar: 30+ gecikmiş borcu olan, geçerli telefonu bulunan, SMS'i açık ve opt-out olmayan cariler.
- Cari bazlı aralık ve `nextSmsAt` varsa öncelik onlardadır.
- Günlük limit (`sms.max_per_day`) ve minimum borç (`sms.min_debt`) uygulanır.

Gönderim kayıtları, planlanan cariler ve manuel görev çalıştırma **SMS Yönetimi** ekranındadır. Otomatik görev manuel olarak da çalıştırılabilir; manuel gönderim otomatik gönderim kapalıyken de yapılabilir.

### Canlı SMS sağlayıcısı ekleme

Sağlayıcı API bilgileri ve gönderici başlığı (sender header) geldiğinde:

1. `src/providers/` altına sağlayıcı modülü ekleyin.
2. Modül `send({ to, message, header })` fonksiyonunu sunmalıdır.
3. Başarılı yanıtta `{ status, provider, providerMessageId, raw }` döndürün; hata durumunda hata fırlatın.
4. `src/providers/index.js` içindeki `getProvider` fonksiyonuna sağlayıcıyı bağlayın.
5. API anahtarlarını `.env` üzerinden okuyun; repoya yazmayın.
6. Ayarlar ekranında `sms.provider` değerini sağlayıcı adıyla güncelleyin ve test modunu kapatın.

Gönderici başlığı şu anda `app.company_name` değerinden gelir. Sağlayıcı gereksinimine göre ayrı bir `sms.header` ayarı eklenebilir.

## Kullanıcılar ve Yetkiler

Her kullanıcı için **ERP Veritabanı** ve **Şube Kodu** atanır. Bu değerler kullanıcı oluşturulurken veya düzenlenirken girilir ve kullanıcının yaşlandırma/SMS sorgularında kullanılır. Kullanıcı rolündeki hesaplar bu alanları düzenleyemez; yalnızca sistem yöneticisi (`admin`) atayabilir. Yönetici olmayan bir kullanıcı yeni kullanıcı oluşturursa, yeni kullanıcı oluşturanın veritabanı ve şubesini devralır.

Yönetici rolü tüm yetkilere sahiptir. Kullanıcı rolüne aşağıdaki yetkiler ayrı ayrı verilebilir:

- `aging.view`: Cari yaşlandırma listesi ve bayi cari listesi
- `aging.detail`: Cari fatura/tahsilat detayı ve cari ekstresi
- `aging.export`: Yaşlandırma raporunu Excel olarak indirme
- `stock.view`: Stok durumu listesi ve stok hareketleri
- `stock.export`: Stok durumu raporunu Excel olarak indirme
- `stock.litre`: Ortak stok litre tanımlarını görüntüleme ve düzenleme
- `finance.view`: Fonlama tutarı/günü, geç ödenen faiz, mevduat faiz kazancı ve ekstredeki mevduat faizi sütunu
- `sms.view`: SMS kayıtları ve planlanan SMS'ler
- `sms.send`: Manuel SMS ve görev çalıştırma
- `sms.settings`: Cari bazlı SMS ayarları
- `users.view`: Kullanıcıları görüntüleme
- `users.manage`: Kullanıcı ekleme/düzenleme/pasifleştirme
- `settings.manage`: Sistem ayarları ve şablonlar
- `audit.view`: İşlem kayıtları

## Yedekleme

Uygulama çalışırken tutarlı bir SQLite kopyası alın:

```bash
npm run backup
```

Yedekler varsayılan olarak `data/backups/` altına yazılır ve son 30 yedek saklanır. Farklı dizin/saklama sayısı için:

```powershell
$env:BACKUP_DIR="D:\yedekler"; $env:BACKUP_KEEP="60"; npm run backup
```

```bash
BACKUP_DIR=/mnt/yedekler BACKUP_KEEP=60 npm run backup
```

Yedek betiği `VACUUM INTO` kullanır ve ardından `PRAGMA integrity_check` ile kopyayı doğrular.

## Docker ile Dağıtım (Linux)

1. Sunucuda Docker ve Docker Compose kurun.
2. Projeyi kopyalayın ve `.env` dosyasını oluşturun.
3. `NODE_ENV=production`, güçlü `SESSION_SECRET` ve doğru ERP bilgilerini ayarlayın.
4. Başlatın:

   ```bash
   docker compose up -d --build
   docker compose logs -f
   ```

5. Açın: `http://<sunucu-ip>:5555`

Veriler adlandırılmış Docker volume'larında tutulur:

- `efes-data` → `/app/data` (SQLite ve yedekler)
- `efes-logs` → `/app/logs`

Yedek alma:

```bash
docker compose exec app node scripts/backup.js
docker compose cp app:/app/data/backups ./backups
```

Volume'ları tamamen silmek veritabanını da siler:

```bash
docker compose down -v
```

### Docker notları

- Konteyner, ERP sunucusuna (`192.168.12.192`) erişebilen ağda olmalıdır.
- Linux'ta host ağı gerekiyorsa compose dosyasına `network_mode: host` eklenebilir; bu durumda `ports` kaldırılmalıdır.
- Dışarıya açmadan önce HTTPS için reverse proxy (nginx/Caddy) kullanın.
- `.env` dosyasını repoya veya imaja dahil etmeyin. `.dockerignore` bunu engeller.

## Testler

```bash
npm test
node scripts/check-aging.js
```

`npm test`, yaşlandırma eşleştirme ve kova sınırlarını, Excel çıktısını, kullanıcı kapsamını, cari ekstresi hesaplamalarını, kredi kartı tahsilatı türünü, iskonto/işletme katkı payı fatura alt türlerini, tür bazlı özeti, fonlama/mevduat faizi hesabını ve stok birim dönüşümü/ürün adından litre çıkarımı/manuel litre girişi/ambalaj filtresi/FIFO yaşı/Excel çıktısını kapsayan birim testlerini çalıştırır. `check-aging.js` gerçek ERP verisiyle kontrol toplamını doğrular; ERP erişimi gerektirir.

## Dizin Yapısı

```text
src/
  config.js              Ortam değişkenleri
  db/
    erp.js               SQL Server bağlantısı ve sorgular
    sqlite.js            SQLite şeması, seed ve ayarlar
  middleware/            Oturum, yetki, CSRF, hata yönetimi
  providers/             SMS sağlayıcı soyutlaması
  routes/                Sayfa ve API rotaları
  services/              Yaşlandırma, cari ekstre, SMS, kullanıcı, ayar, zamanlayıcı
  views/                 EJS sayfaları
public/                  CSS ve tarayıcı JavaScript'i
scripts/
  check-aging.js         ERP kontrol toplamı
  backup.js              SQLite yedeği
tests/aging.test.js      Yaşlandırma birim testleri
tests/ledger.test.js     Cari ekstresi birim testleri
tests/stock.test.js      Stok hesaplama ve Excel birim testleri
data/app.db              Yerel uygulama veritabanı (git'e girmez)
```

## Güvenlik Notları

- Uygulamayı yalnızca güvenilir yerel ağda yayınlayın.
- `SESSION_SECRET`, admin şifresi ve ERP şifresini güçlü tutun.
- İlk girişten sonra varsayılan admin şifresini değiştirin.
- ERP hesabına yalnızca okuma yetkisi verin.
- `.env`, `data/` ve `logs/` dizinlerini paylaşmayın; bunlar `.gitignore` içindedir.
- Canlıya geçmeden önce test modunu kapatmadan gerçek SMS gönderimini etkinleştirmeyin.
