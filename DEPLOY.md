# Uutuuskirjat pilotiksi nettiin

## 1) Vaihda admin-salasana ja kutsusuola
Muokkaa tiedostoa `app.js`:

- `ADMIN_PASSWORD`
- `INVITE_SALT`

Esimerkki:

```js
const ADMIN_PASSWORD = "oma-pitka-admin-salasana";
const INVITE_SALT = "oma-pitka-satunnainen-salt";
```

Ilman tätä kutsut eivät ole turvallisia.

## 2) Julkaise Verceliin (preview)

Projektikansiossa:

```bash
cd /Users/jarieklund/Dropbox/Uutuuskirjat
vercel deploy -y
```

Jos `vercel` puuttuu:

```bash
npm i -g vercel
vercel login
vercel deploy -y
```

Saat URL-osoitteen, jota voit jakaa testikäyttäjille.

## 3) Luo kutsut admin-paneelista

1. Avaa julkaistu URL selaimessa.
2. Paina `Admin`.
3. Kirjaudu `ADMIN_PASSWORD`-salasanalla.
4. Luo kutsulinkki ja jaa se käyttäjälle.

Käyttäjä avaa linkin ja pääsee sovellukseen.

## 4) Rajaus pilotille

- Käytä vain kutsulinkkejä.
- Vaihda `INVITE_SALT`, jos haluat mitätöidä vanhat kutsut.

## Huomio tietoturvasta

Tämä on kevyt pilottilukitus (ei täysiverinen käyttäjäjärjestelmä). Se sopii pienen testiryhmän käyttöön, mutta ei korkean tietoturvan tuotantokäyttöön.
