# Cortex base-taxonomy seed — v3 (professional archive)

Designed from first principles for a multi-jurisdictional individual operating
two business entities. Existing `~/Downloads` and `~/Documents` layouts have
been **ignored**. This is a clean-room proposal.

## Top-level structure

Organized by **provenance** first (who owns the records), then by **function**
within each provenance (financial vs corporate vs operational), then by
**time** for transactional flows (invoices, statements) or **singleton stable
folders** for permanent records.

```
/
├── business/
│   ├── fonnit/                              GmbH-style entity, primary
│   │   ├── invoices-in/{year}/{month}/      Vendor expenses for tax filing
│   │   ├── invoices-out/{year}/{month}/     Revenue (FONN-* outgoing)
│   │   ├── bank-statements/{year}/
│   │   ├── tax-filings/{year}/              Steuererklaerung, Bescheid, Gewinnermittlung
│   │   ├── corporate/                       Gewerbeanmeldung, structural docs
│   │   ├── contracts/                       Client/vendor agreements
│   │   ├── payroll/{year}/                  If FonnIT pays employees
│   │   └── brand/                           Logos, marketing assets
│   │
│   ├── terradan-colombia/
│   │   ├── invoices-in/{year}/{month}/
│   │   ├── invoices-out/{year}/{month}/
│   │   ├── bank-statements/{year}/
│   │   ├── tax-filings/{year}/
│   │   ├── corporate/                       RUT, Certificado de Existencia
│   │   └── contracts/
│   │
│   └── terradan-dubai/
│       ├── invoices-in/{year}/{month}/
│       ├── invoices-out/{year}/{month}/
│       ├── bank-statements/{year}/
│       ├── tax-filings/{year}/
│       ├── corporate/                       Trade Licenses, RERA, DET
│       ├── contracts/
│       └── properties/
│           ├── seven-palm-149/              Per-property folders, deeds + permits + Ejari
│           ├── seven-palm-724/
│           └── seven-palm-1220/
│
├── personal-finance/
│   ├── payslips/{employer}/{year}/          /payslips/s-ray/2024/, etc.
│   ├── bank-statements/{bank}/{year}/       /bank-statements/n26/2024/
│   ├── tax-filings/{year}/                  Personal Einkommensteuer
│   ├── insurance/{provider}/                Per-policy folder with renewals over time
│   ├── credit-applications/{year}/          Kreditantrag bundles, complete applications
│   ├── receipts/{year}/                     Personal subscriptions, GitHub, Trello, etc.
│   └── correspondence/{year}/               Demand letters, Mahnungen, bank correspondence
│
├── real-estate/
│   ├── primary-residence/                   Current rental — Stralauer Platz
│   │   ├── lease/                           Mietvertrag + amendments
│   │   ├── rent-payments/{year}/
│   │   └── correspondence/
│   ├── prior-residences/{address}/          Archived former rentals
│   ├── property-search/{search-period}/     Wohnungssuche application bundles
│   └── property-deeds/                      Personal real estate (if any)
│
├── identity/
│   ├── passport/                            Current passport + scans
│   ├── residence-permit/                    Aufenthaltstitel (DE)
│   ├── national-ids/                        Emirates ID, Cedula CO
│   ├── civil-registry/                      Own birth, marriage records
│   └── driving-licenses/
│
├── immigration/
│   ├── visa-applications/{country}/{year}/  /visa-applications/malaysia/2024/
│   └── naturalization/                      Einbuergerung, permanent-residence applications
│
├── family/
│   ├── civil-registry/                      Spouse, children, parents, ancestors
│   ├── correspondence/
│   └── photos-shared/                       Family group photos
│
├── travel/
│   ├── {year}/{location}/                   /travel/2025/malaysia/, /travel/2024/italy/
│   ├── {year}/loose/                        One-off boarding passes without a trip context
│   └── frequent-flyer/                      Loyalty program statements
│
├── employment/
│   ├── {employer}/                          /employment/s-ray/, /employment/habyt/
│   │   ├── contracts/
│   │   ├── correspondence/
│   │   └── certifications/
│   └── cv/                                  Versioned CVs / resumes
│
├── education/
│   ├── higher-ed/                           Diplomas, transcripts, apostilles
│   ├── certifications/                      AWS, language certs (Telc B1)
│   └── reading/                             ebooks, manuals (e.g. trader books)
│
├── legal/
│   ├── powers-of-attorney/
│   ├── notarized-documents/
│   └── correspondence/
│
├── utilities/
│   ├── electricity/                         Ostrom
│   ├── internet/                            DuesselFibre, AldiTalk
│   └── subscriptions/                       Recurring services
│
├── personal/
│   ├── photos/                              IMG_*, phone-camera shots
│   ├── screenshots/                         Bildschirmfoto*
│   ├── shopping/{year}/                     Amazon, Grover order receipts
│   └── media/                               Misc media files
│
└── unsorted/                                UUID-named files, opaque PDFs, awaiting triage
```

## What's different from v2

- **No `/business/fonnit/invoices-in/{year}/`** without a month subfolder. Tax
  filings are monthly, so invoices need `{year}/{month}/` for them to be
  retrievable in the way you actually use them.
- **`/payslips/{employer}/{year}/`** instead of just `/payslips/{year}/` — you
  have two concurrent income streams (S-Ray + freelance/FonnIT), and the
  employer dimension is meaningful for tax and contract context.
- **`/bank-statements/{bank}/{year}/`** — likewise N26 vs Wio vs Revolut are
  different jurisdictions and different filing duties.
- **`/employment/{employer}/`** as a **history** folder (separate from
  payslips). Past employment contracts, correspondence, certifications,
  references stay here even after employment ends — they're durable records,
  not transactional flows.
- **`/personal-finance/insurance/{provider}/`** — per-provider folder rather
  than a single `/insurance/` bucket, so renewals over years stay grouped.
- **`/real-estate/primary-residence/`** as a single semantic folder for
  current home, plus `/prior-residences/{address}/` for archived ones.
- **`/immigration/visa-applications/{country}/{year}/`** — visa applications
  are time-bound bundles assembled per country, then frozen.
- **`/travel/{year}/{location}/`** — your suggested structure exactly. Loose
  boarding passes without a trip context go to `/travel/{year}/loose/`.
- **`/identity/civil-registry/`** is for **self only** (Daniel + Jenny civil
  records). Family members live under `/family/civil-registry/`.

## Time bucketing rules

- **Year + month** for: business invoices (in/out), bank statements
  (business). Month is required because tax-filing periods are monthly.
- **Year only** for: payslips, personal bank statements, rent payments,
  receipts, shopping, travel, correspondence, tax-filings, insurance renewals
  if multiple. Year-level retrieval is fine.
- **No time bucketing** for: identity (passport, residence-permit etc.),
  contracts (lease, employment), property deeds, diplomas, civil-registry,
  brand assets, corporate registrations. These are versioned by file name (or
  by separate copy if the user keeps prior versions), not by year folder.

## Date-extraction strategy (required for invoices + payslips)

The seed needs real dates to bucket invoices into `{year}/{month}/`.
Filenames alone are unreliable (`Rechnung_52.pdf` has no date). Strategy:

1. For invoice + payslip + bank-statement candidate files **<1MB**, open the
   PDF and extract issue date / period date from the content.
2. For files where date extraction fails (encrypted, image-only, weird
   format), bucket as `/{path}/undated/` — they'll need triage to land
   correctly.
3. For files **≥1MB**, fall back to filesystem mtime as the date hint. Most
   large files are scans where mtime is the scan date.

Implementation: spawn a content-reading agent that takes the candidate-invoice
file list, opens each, returns `{ file, year, month, sender, amount }`. Then
the seed-apply step has real data to bucket against.

## Axis values

Largely the same as v2 (34 type / 22 from / 12 context), with a couple of
adjustments:

- **`type`**: drop `misc` as a type axis value. If a file's type can't be
  classified, leave `axis_type` null — `misc` as a folder is fine but
  shouldn't pretend to be a type.
- **`from`**: drop `misc` — same reason. A file with no clear sender gets
  `axis_from` = null.
- **`context`**: keep all 12. Possibly add `family-records` distinct from
  `family` (the former for civil-registry/genealogy, the latter for
  living-family interactions).

## Decisions locked in (2026-04-27)

1. **No numbered prefix** on top-level folders. Alphabetical ordering only.
2. **No `/business/fonnit/payroll/`** — FonnIT is a single-person freelance entity.
3. **Travel photos** go to `/travel/{year}/{location}/` alongside boarding passes etc. `/personal/photos/` holds only everyday phone-camera shots.
4. **`/utilities/` is dropped** — utility bills (Ostrom, DuesselFibre, AldiTalk) collapse into `/personal/finance/invoices/{year}/{month}/` along with the rare other personal invoices.
5. **Apply partial seed now**, content-pass later. This means:
   - Now: singleton folders (identity, contracts, properties, employment, education, brand, photos) and any date-bucketed folder where the year is in the filename (e.g. `Steuer Erklaerung 2023.pdf`, `PayslipsCastlabs2021.pdf`).
   - Later: a content-reading agent opens invoice/payslip/statement PDFs <1MB, extracts real dates, and emits a follow-up seed for the year/month-bucketed folders.
