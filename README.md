# Metka

Wyszukiwarka ubrań z AI. Opisujesz ubranie własnymi słowami, a aplikacja pokazuje konkretne produkty: zdjęcie, cenę i bezpośredni link do strony produktu w sklepie.

## Jak to działa

1. Strona wysyła opis do serwera.
2. Serwer prosi Claude (z wyszukiwaniem w sieci) o znalezienie pasujących produktów. Jeśli w opisie brakuje czegoś ważnego, Claude zadaje krótkie pytania.
3. Serwer odrzuca adresy, których nie zwróciło wyszukiwanie (ochrona przed zmyślonymi linkami).
4. Serwer otwiera każdą stronę produktu, sprawdza, czy to naprawdę produkt (nie kategoria ani artykuł), i czyta zdjęcie oraz cenę. Martwe linki i produkty ponad budżet są usuwane.
5. Strona pokazuje karty produktów pogrupowane według sklepów.

Sklepy, które blokują automatyczne pobieranie stron, dają wynik bez zdjęcia. Taka karta ma dopisek „strona nie została sprawdzona”.

## Wdrożenie z iPada (Render)

Potrzebujesz trzech kont: GitHub, Anthropic Console i Render. Wszystko zrobisz w Safari.

### 1. Klucz API
1. Wejdź na console.anthropic.com, zaloguj się i doładuj konto.
2. W sekcji Limits ustaw miesięczny limit wydatków (np. 10 USD). To Twoje zabezpieczenie przed nieoczekiwanym rachunkiem.
3. W sekcji API keys utwórz klucz i skopiuj go. Nigdy nie wklejaj go do plików projektu.
4. Upewnij się, że w ustawieniach organizacji włączone jest wyszukiwanie w sieci (web search).

### 2. Kod na GitHubie
1. Rozpakuj plik zip w aplikacji Pliki (dotknij go).
2. Na github.com utwórz nowe repozytorium (może być prywatne).
3. Wybierz „uploading an existing file” i wgraj wszystkie pliki: `server.js`, `index.html`, `app.js`, `style.css`, `package.json`, `README.md`. Pliki mają leżeć bezpośrednio w repozytorium, bez podfolderów.

### 3. Serwer na Render
1. Na render.com wybierz New, potem Web Service i połącz repozytorium z GitHuba.
2. Ustaw: Language `Node`, Build Command `npm install`, Start Command `npm start`.
3. W Environment dodaj zmienne:
   - `ANTHROPIC_API_KEY`: Twój klucz (wymagane)
   - `ACCESS_CODE`: dowolne hasło, które będzie trzeba wpisać na stronie (zalecane, bo bez niego każdy z linkiem wydaje Twoje pieniądze)
4. Utwórz usługę. Po kilku minutach dostaniesz adres `https://…onrender.com`.
5. Otwórz adres w Safari. W menu Udostępnij wybierz „Dodaj do ekranu początkowego”, a aplikacja będzie działać jak zwykła ikona.

Darmowy plan Render usypia serwer po okresie bezczynności, więc pierwsze otwarcie może trwać około minuty.

## Ustawienia (zmienne środowiskowe)

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `ANTHROPIC_API_KEY` | brak | Klucz API (wymagany) |
| `ACCESS_CODE` | brak | Hasło do aplikacji. Puste oznacza dostęp dla każdego |
| `DAILY_LIMIT` | 150 | Maksymalna liczba wyszukiwań na dobę |
| `IP_LIMIT` | 6 | Wyszukiwań na jeden adres IP w ciągu 10 minut |
| `MODEL` | claude-sonnet-5-5 | Model Claude używany do wyszukiwania |
| `MAX_SEARCHES` | 5 | Ile wyszukiwań w sieci może wykonać jedno zapytanie |

## Koszt

Jedno zapytanie użytkownika to do 5 wyszukiwań w sieci (według cennika Anthropic 10 USD za 1000 wyszukiwań, czyli do 0,05 USD) plus koszt tokenów modelu. Powtórzone zapytanie w ciągu 30 minut jest brane z pamięci i nic nie kosztuje. Aktualne ceny sprawdź w dokumentacji Anthropic.

## Bezpieczeństwo

- Klucz API trzymany jest tylko w zmiennej środowiskowej na serwerze.
- Serwer pobiera strony sklepów, więc blokuje adresy prywatne i wewnętrzne (ochrona SSRF), porty inne niż 80 i 443 oraz przekierowania do takich adresów.
- Wszystkie teksty z internetu są wstawiane do strony jako zwykły tekst, a adresy muszą zaczynać się od http lub https.
- Są limity zapytań na IP i na dobę.

## Uruchomienie na komputerze (opcjonalnie)

```
ANTHROPIC_API_KEY=twoj_klucz node server.js
```

Potem otwórz http://localhost:3000. Wymagany jest Node.js 20 lub nowszy.

## Znane ograniczenia

- Wyniki zależą od tego, co zwróci wyszukiwarka. Ceny i dostępność są z chwili pobrania strony.
- Część sklepów blokuje roboty. Dla nich aplikacja pokaże link bez zdjęcia.
- Aplikacja nie wie, czy dany rozmiar jest dostępny.
