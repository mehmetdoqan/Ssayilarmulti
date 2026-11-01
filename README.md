# Sihirli Sayılar — Çok Oyunculu MVP

Bu paket, mevcut Sihirli Sayılar HTML oyununa 2–4 kişilik, oda koduyla katılınan internet üzerinden yarışma prototipi ekler.

## Paket içeriği

- `index.html` — Mevcut tek oyunculu oyun + çok oyunculu lobi
- `multiplayer.js` — Oda oluşturma/katılma, oda durumu, oyuncu listesi, tahta kaydetme ve sonuç gönderme
- `database.sql` — Supabase tabloları ve RPC fonksiyonları
- `README.md` — Kurulum talimatları

## Çok oyunculu özellikler

- 2–4 oyunculu oda; oda koduyla katılma
- Oda sahibinin tur başlatması
- Her oyuncunun kendi tahtasında oynaması
- Oyuncu tahtasının hamlelerde Supabase'e kaydedilmesi
- Sunucu saatine bağlı ortak başlangıç zamanı ve 2/3/5 dakikalık sayaç
- Sunucu tarafında 25 hücre, taşma, çakışma ve boş hücre cevabı kontrolü
- İlk geçerli cevabın kazanan olarak kaydedilmesi
- Oda oyuncularının ve kazananın yaklaşık 1,8 saniyede bir yenilenmesi

## Kurulum

### 1. Supabase projesi oluşturun

Supabase hesabınızda yeni bir proje oluşturun. Projenin `Project URL` ve `anon` / `publishable` anahtarını alın.

### 2. Veritabanını kurun

Supabase panelinde **SQL Editor** bölümünü açın. Bu paketteki `database.sql` dosyasının tamamını yapıştırıp çalıştırın.

Bu SQL, odalar ve oyuncular tablolarını, doğrudan tablo erişimini kapatan RLS ayarlarını ve uygulamanın kullandığı RPC fonksiyonlarını oluşturur.

### 3. Bağlantı bilgilerini girin

`index.html` dosyasını web sunucusu üzerinden açın (aşağıdaki yerel test bölümüne bakın). **Çok oyunculu** düğmesine basın ve şunları girin:

- Supabase Project URL
- Anon / publishable key

**Bağlantıyı kaydet** düğmesine basın. Bilgiler yalnızca o tarayıcının `localStorage` alanında saklanır. `service_role` anahtarını kesinlikle kullanmayın.

### 4. Oyuncularla deneyin

1. İlk cihazda **Oda oluştur** seçeneğine basın.
2. Oluşan 6 karakterli kodu diğer oyunculara gönderin.
3. Diğer cihazlarda aynı URL'yi açıp kodla katılın.
4. En az iki oyuncu odadayken oda sahibi **Turu başlat** seçeneğine basar.
5. Her oyuncu kendi tahtasını tamamlar, boş hücre cevabını seçer ve **Kontrol et** düğmesine basar. Doğru cevap veritabanına gönderildiğinde ilk geçerli sonuç kazanan olur.

## Yerel test

Tarayıcı güvenlik ayarları nedeniyle `file://` üzerinden açmak yerine yerel HTTP sunucusu kullanın. Python kuruluysa proje klasöründe:

```bash
python -m http.server 8000
```

Sonra `http://localhost:8000` adresini açın. İnternet üzerinden test etmek için klasörü HTTPS destekleyen statik bir barındırma hizmetine yükleyin. `index.html`, `multiplayer.js` ve (kurulum için) `database.sql` dosyalarını birlikte saklayın.

## Bilinen sınırlar

- Bu, ilk çalıştırılabilir MVP'dir; oda listesi, hesap sistemi, sohbet, turnuva geçmişi ve yeniden bağlanınca tahtayı otomatik geri yükleme henüz yoktur.
- Oyuncu kimliği sekme oturumunda saklanır. Sekme tamamen kapanırsa aynı oyuncu oturumu devam etmeyebilir.
- Tur sorusu şu an çok oyunculu modda “Boş hücrenin numarasını bul” olarak sabitlenmiştir. Tek oyunculu zar menüsündeki tüm yöntemler korunur ancak çok oyunculu turda henüz seçim ekranına bağlanmamıştır.
- Sunucu, yerleşim koordinatlarının sınırlarını, hücre çakışmalarını, toplam 24 dolu hücreyi ve gönderilen boş hücre cevabını doğrular. İleri seviye hile önleme için parça şekillerinin sunucu tarafında sabit tanımlarla doğrulanması ve kullanıcı kimlik doğrulaması sonraki aşamada eklenmelidir.
- Aynı anda gelen sonuçlarda veritabanındaki oda satırı kilitlenerek ilk geçerli gönderim kazanan olarak kaydedilir.

## Güvenlik

`anon` / `publishable` anahtarı tarayıcıda kullanılmak üzere tasarlanmıştır; yetkiler RLS ve RPC fonksiyonlarıyla sınırlanmalıdır. `service_role` veya başka bir gizli anahtarı istemci koduna koymayın. SQL'i yalnızca kendi Supabase projenizde çalıştırın.

## Teknolojiler

HTML, CSS, JavaScript, Supabase Postgres ve Supabase RPC.
