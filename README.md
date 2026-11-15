# Metka

Wyszukiwarka ubrań z AI. Opisujesz ubranie własnymi słowami, a aplikacja pokazuje konkretne produkty z nowych i używanych ubrań: zdjęcie, sklep, krótki opis, cenę i przycisk prowadzący na stronę produktu.

## Co potrafi

- **Szukaj**: pole opisu plus opcje: płeć (kobieta, mężczyzna, dziecko), rozmiar, cena od i do. Wszystkie opcje są dobrowolne. Gdy nie podasz ani płci, ani rozmiaru, ani ceny (ani w opcjach, ani w opisie), aplikacja o to zapyta.
- **Wyniki**: wszystkie znalezione produkty zgodne z opisem (do 30). Produkty, które AI dobrało na podstawie Twoich poprzednich wyszukiwań i ulubionych, mają dopisek „Wynika z Twoich preferencji”.
- **Rozmiar**: przy każdym produkcie jest informacja o rozmiarze. Czerwony napis „Brak rozmiaru” albo „Rozmiar niedostępny” oznacza, że strona sklepu podaje rozmiary i Twojego nie ma. Szary napis „nie udało się sprawdzić” oznacza, że sklep nie udostępnia rozmiarów w sposób, który aplikacja potrafi odczytać.
- **Ulubione**: serce przy produkcie zapisuje go w zakładce Ulubione.
- **Opcje**: profil (imię, domyślna płeć i rozmiar), motyw jasny lub ciemny, wyłączenie uczenia się preferencji i czyszczenie historii.

## Jak to działa

1. Strona wysyła opis i opcje do serwera (oraz, jeśli uczenie się preferencji jest włączone, kilka ostatnich opisów i ulubionych).
2. Serwer prosi Claude (z wyszukiwaniem w sieci) o znalezienie produktów w sklepach z nowymi i używanymi ubraniami.
3. Serwer odrzuca adresy, których nie zwróciło wyszukiwanie (ochrona przed zmyślonymi linkami).
4. Serwer otwiera każdą stronę produktu, sprawdza, czy to produkt (a nie kategoria czy artykuł), i czyta zdjęcie, cenę oraz rozmiary. Martwe linki i produkty poza przedziałem cenowym są usuwane.
5. Wynik wraca do strony. W trakcie widać postęp.

## Wdrożenie od zera (Render)

Potrzebujesz kont: GitHub, Anthropic Console i Render.

1. W Anthropic Console doładuj konto, ustaw miesięczny limit wydatków (Limits) i utwórz klucz API.
2. Wgraj wszystkie pliki z tego projektu do repozytorium na GitHubie (bez podfolderów).
3. Na Render: New, Web Service, wybierz repozytorium. Language `Node`, Build Command `npm install`, Start Command `npm start`.
4. W Environment dodaj `ANTHROPIC_API_KEY` (klucz) i `ACCESS_CODE` (hasło do aplikacji).
5. Po kilku minutach otwórz adres `https://…onrender.com`. Na iPadzie w Safari wybierz Udostępnij, potem „Dodaj do ekranu początkowego”.

## Aktualizacja istniejącej aplikacji

1. Wejdź na github.com do repozytorium z aplikacją.
2. Dotknij Add file, potem Upload files.
3. Wybierz nowe pliki. Pliki o tych samych nazwach zastąpią stare, a nowe (`theme.js`, `apple-touch-icon.png`) zostaną dodane. `package.json` zostaje bez zmian.
4. Dotknij Commit changes.
5. Render sam zbuduje nową wersję w ciągu kilku minut. Jeśli nic się nie dzieje, w Render wybierz Manual Deploy, potem Deploy latest commit.
6. Otwórz aplikację ponownie. Ulubione i profil zostaną na iPadzie.

## Ustawienia (zmienne środowiskowe)

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `ANTHROPIC_API_KEY` | brak | Klucz API (wymagany) |
| `ACCESS_CODE` | brak | Hasło do aplikacji. Puste oznacza dostęp dla każdego |
| `MAX_SEARCHES` | 8 | Ile wyszukiwań w sieci wykonuje jedno zapytanie (1 do 15). Więcej oznacza więcej wyników i wyższy koszt |
| `MAX_RESULTS` | 30 | Maksymalna liczba produktów w wyniku |
| `DAILY_LIMIT` | 60 | Maksymalna liczba wyszukiwań na dobę |
| `IP_LIMIT` | 6 | Wyszukiwań na jeden adres IP w ciągu 10 minut |
| `MODEL` | claude-sonnet-5-5 | Model Claude używany do wyszukiwania |

## Koszt

Jedno wyszukiwanie to do 8 zapytań w sieci (według cennika Anthropic 10 USD za 1000 zapytań) plus tokeny modelu. Przy dużej liczbie wyników tokeny mogą kosztować więcej niż same zapytania. Po kilku pierwszych próbach sprawdź zużycie w Anthropic Console (Usage) i dostosuj `DAILY_LIMIT` oraz limit wydatków. Powtórzone to samo wyszukiwanie w ciągu 30 minut jest brane z pamięci i nic nie kosztuje.

## Gdzie są Twoje dane

Profil, ulubione i historia wyszukiwań są zapisane tylko w przeglądarce na urządzeniu. Serwer niczego nie zapisuje. Ikona na ekranie początkowym ma osobną pamięć niż Safari, więc korzystaj zawsze z jednego z nich.

## Bezpieczeństwo

- Klucz API jest tylko w zmiennej środowiskowej na serwerze.
- Serwer pobiera strony sklepów, więc blokuje adresy prywatne i wewnętrzne (ochrona SSRF), porty inne niż 80 i 443 oraz przekierowania do takich adresów.
- Teksty z internetu są wstawiane do strony jako zwykły tekst, a adresy muszą zaczynać się od http lub https.
- Są limity zapytań na IP i na dobę.

## Znane ograniczenia

- AI nie przeszukuje całego internetu. Używa wyszukiwarki w sieci, która zwraca ograniczoną liczbę stron na zapytanie, więc nie każdy pasujący produkt na świecie się pojawi.
- Część sklepów i serwisów (zwłaszcza duże platformy z używanymi ubraniami) blokuje automatyczne pobieranie stron. Dla nich aplikacja pokazuje produkt bez zdjęcia i bez sprawdzonego rozmiaru.
- Rozmiar jest sprawdzany tylko tam, gdzie strona udostępnia go w danych strukturalnych. Czerwony napis pojawia się wtedy, gdy strona wymienia co najmniej dwa rozmiary i Twojego wśród nich nie ma.
- Ceny i dostępność są z chwili pobrania strony.
