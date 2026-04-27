# Cortex base-taxonomy seed proposal — v2 (intent-driven)

**Sources:** Documents (809 files), Downloads (2284 files).

## Design principles

1. **Folders express purpose, not content.** Invoices live under the entity (FonnIT, Terradan-CO, Terradan-Dubai) that files them on taxes, then by year. Vendor stays in the `from` axis only — searchable but never path-driving.
2. **Time bucketing for high-volume types**: invoices, payslips, bank statements, rent payments, travel.
3. **Stable singleton folders** for low-volume / high-importance docs (passport, residence-permit, diplomas) — no year subfolder.
4. **Entity → jurisdiction → category** for businesses: `/business/terradan/dubai/properties/seven-palm-149/`.
5. **Self+spouse vs other family**: civil-registry rows for Daniel+Jenny → `/identity/civil-registry/`. For Jaime, Alejandro, Medellín ancestors → `/family/civil-registry/`.
6. **Multi-jurisdiction identity**: passport / residence-permit / national-id / civil-registry are separate folders — they're used in different contexts.

**Output if approved:** 34 type / 22 from / 12 context labels written to TaxonomyLabel; 26 stable folders populated with 78 `status='filed'` items so the h9w auto-file gate fires on day 1.

## Stable folders — anchor seeds

| folder | mapped | examples |
|--------|--------|----------|
| `/travel/2025/` | 15 | FlightMadridMedellin.pdf, HotelKualaLumpur.pdf, boarding-pass (4) 2.pdf |
| `/business/fonnit/invoices-in/2025/` | 9 | Rechnung_52.pdf, Rechnung_63.pdf, Invoice-3195327959.pdf |
| `/personal/finance/payslips/2025/` | 8 | Brutto-Netto-Abrechnung 2025 08 August.pdf, Payroll Sep 2025.pdf, Payslips 2401. |
| `/real-estate/rental/contracts/` | 8 | Mietvertrag.pdf, Sublet Agreement.pdf, Mietvertrag.pdf |
| `/family/civil-registry/` | 7 | REGISTRO CIVIL JAIME 7 JUL 2025.pdf, REGISTRO CIVIL ALEJANDRO 7 JUL 2025.pdf, RE |
| `/personal/finance/receipts/2025/` | 7 | Trello-Receipt-30668189.pdf, github-dfonnegra-receipt-2025-04-22.pdf, github-dfo |
| `/identity/national-ids/` | 6 | Emirates ID Front.pdf, AUFENTHALTSTITEL.pdf, Emirates ID.pdf |
| `/business/fonnit/invoices-in/2024/` | 5 | Invoice_Apple_8.pdf, Invoice_EUINDE24_1380117_AWS.pdf, T656986555_Upwork.pdf |
| `/personal/finance/bank-statements/2025/` | 5 | N26_February.pdf, BankStatementNovember.pdf, Wio_Bank_PJSC_Salary_Transfer_Guide |
| `/personal/finance/credit-applications/` | 5 | Kreditunterlagen.pdf, Bonitats-auskunft.pdf, Einkommens-Nachweis.pdf |
| `/identity/passport/` | 5 | Passport.pdf, Passport.heic, danny passport.pdf |
| `/real-estate/rental/2025/` | 5 | Rent payment Feb 2025.pdf, Mietzahlungsnachweis_April.pdf, Rent January.pdf |
| `/legal/power-of-attorney/` | 5 | 1.1. Poder Daniel Fonnegra CN.docx.pdf, 1.3. Poder Daniel Fonnegra CC.docx.pdf,  |
| `/tools/diagrams/` | 5 | Proposal Android App - Ecoplan Thiede.pdf, Bitrix24 Contacts REST API Documentat |
| `/legal/contracts/` | 4 | Contrato - Daniel Fonnegra.pdf, 20220704_S-Ray Germany Offer Letter_Daniel Fonne |
| `/personal/photos/` | 4 | IMG_0697.jpg, IMG_3560.jpg, IMG_4058.jpg |
| `/business/fonnit/invoices-out/2024/` | 3 | invoice_FONN-10.pdf, invoice_FONN-27.pdf, invoice_FONN-54.pdf |
| `/personal/finance/insurance/` | 3 | 416382638_Ihr Versicherungsvertrag_2025_01_02_4456.pdf, Krankversicherung.pdf, U |
| `/business/fonnit/branding/` | 3 | Logo.png, BlackLogo.png, fonnit-cover.png |
| `/identity/residence-permit/` | 3 | AUFENTHALTSTITEL.pdf, Aufenhaltstitel1.jpg, Permanent residence letter.jpeg |
| `/identity/civil-registry/` | 3 | REGISTRO CIVIL DANIEL 7 JUL 2025.pdf, REGISTRO CIVIL JENNY 7 JUL 2025.pdf, REGIS |
| `/education/diplomas/` | 3 | DiplomaPregrado.pdf, DiplomaPosgrado.pdf, CalificacionesPregrado.pdf |
| `/misc/` | 3 | 6f65ead8-64a4-498c-ae0a-697b1fd3504e.pdf, 1715035700.pdf, Boxing 1.pdf |
| `/real-estate/property-deeds/` | 3 | TerradanDubai_License.pdf, AW REALESTATE 2024 License .pdf, PBP Trade License 20 |
| `/education/certificates/` | 3 | AWS Certified Solutions Architect - Professional certificate.pdf, Telc-Zertifika |
| `/work/cv/` | 3 | Daniel Fonnegra CV.pdf, DanielFonnegraResume.pdf, Bewerbermappe_Daniel_Fonnegra. |

## Tentative folders (1–2 mapped)

Visible to Stage 2 prompt but won't auto-file until 3+ items confirmed.

- `/education/apostilles/` (2 mapped)
- `/business/terradan/dubai/properties/seven-palm-149/` (2 mapped)
- `/personal/screenshots/` (2 mapped)
- `/business/terradan/dubai/properties/seven-palm-49/` (2 mapped)
- `/personal/taxes/2025/` (2 mapped)
- `/business/fonnit/bank-statements/2025/` (1 mapped)
- `/personal/finance/bank-statements/2024/` (1 mapped)
- `/work/employment/esg-book/contracts/` (1 mapped)
- `/work/employment/habyt/contracts/` (1 mapped)
- `/work/employment/other/contracts/` (1 mapped)
- `/work/employment/s-ray/contracts/` (1 mapped)
- `/business/terradan/dubai/properties/seven-palm-24/` (1 mapped)
- `/personal/taxes/2024/` (1 mapped)

## Axes

### `type` (34 values)

`apostille` · `bank-statement` · `boarding-pass` · `brand-asset` · `certificate` · `civil-registry` · `contract` · `credit-application` · `cv-resume` · `diagram` · `diploma` · `employment-contract` · `flight-booking` · `hotel-booking` · `income-proof` · `insurance-policy` · `invoice` · `invoice-outgoing` · `misc` · `national-id` · `passport` · `payslip` · `photo` · `power-of-attorney` · `real-estate-permit` · `receipt` · `rent-payment` · `rental-contract` · `residence-permit` · `screenshot` · `self-disclosure` · `tax-document` · `ticket` · `title-deed`

### `from` (22 values)

`airbnb` · `amazon` · `apple` · `castlabs` · `colombia-government` · `ejari` · `esg-book` · `fonnit` · `germany-residence-office` · `github` · `habyt` · `misc` · `n26` · `s-ray` · `seven-palm` · `stb-munk` · `telc` · `terradan` · `trello` · `uae-government` · `upwork` · `wio-bank`

### `context` (12 values)

`business-finance` · `education` · `family` · `identity` · `legal` · `media-personal` · `personal-finance` · `real-estate` · `taxes` · `tools` · `travel` · `work-employment`

## Sample anchor items (first 30 of 78)

| file | type | from | context | path |
|------|------|------|---------|------|
| `FlightMadridMedellin.pdf` | flight-booking | misc | travel | `/travel/2025/` |
| `HotelKualaLumpur.pdf` | hotel-booking | misc | travel | `/travel/2025/` |
| `boarding-pass (4) 2.pdf` | boarding-pass | misc | travel | `/travel/2025/` |
| `Rechnung_52.pdf` | invoice | misc | business-finance | `/business/fonnit/invoices-in/2025/` |
| `Rechnung_63.pdf` | invoice | misc | business-finance | `/business/fonnit/invoices-in/2025/` |
| `Invoice-3195327959.pdf` | invoice | amazon | business-finance | `/business/fonnit/invoices-in/2025/` |
| `Brutto-Netto-Abrechnung 2025 08 August.pdf` | payslip | s-ray | personal-finance | `/personal/finance/payslips/2025/` |
| `Payroll Sep 2025.pdf` | payslip | s-ray | personal-finance | `/personal/finance/payslips/2025/` |
| `Payslips 2401.pdf` | payslip | s-ray | personal-finance | `/personal/finance/payslips/2025/` |
| `Mietvertrag.pdf` | contract | habyt | real-estate | `/real-estate/rental/contracts/` |
| `Sublet Agreement.pdf` | contract | misc | real-estate | `/real-estate/rental/contracts/` |
| `Mietvertrag.pdf` | rental-contract | habyt | real-estate | `/real-estate/rental/contracts/` |
| `REGISTRO CIVIL JAIME 7 JUL 2025.pdf` | civil-registry | colombia-government | family | `/family/civil-registry/` |
| `REGISTRO CIVIL ALEJANDRO 7 JUL 2025.pdf` | civil-registry | colombia-government | family | `/family/civil-registry/` |
| `REGISTRO CIVIL ALEJANDRO 7 JUL 2025.pdf` | civil-registry | misc | family | `/family/civil-registry/` |
| `Trello-Receipt-30668189.pdf` | receipt | trello | personal-finance | `/personal/finance/receipts/2025/` |
| `github-dfonnegra-receipt-2025-04-22.pdf` | receipt | github | personal-finance | `/personal/finance/receipts/2025/` |
| `github-dfonnegra-receipt-2025-05-22.pdf` | receipt | github | personal-finance | `/personal/finance/receipts/2025/` |
| `Emirates ID Front.pdf` | national-id | uae-government | identity | `/identity/national-ids/` |
| `AUFENTHALTSTITEL.pdf` | national-id | misc | identity | `/identity/national-ids/` |
| `Emirates ID.pdf` | national-id | misc | identity | `/identity/national-ids/` |
| `Invoice_Apple_8.pdf` | invoice | apple | business-finance | `/business/fonnit/invoices-in/2024/` |
| `Invoice_EUINDE24_1380117_AWS.pdf` | invoice | misc | business-finance | `/business/fonnit/invoices-in/2024/` |
| `T656986555_Upwork.pdf` | invoice | upwork | business-finance | `/business/fonnit/invoices-in/2024/` |
| `N26_February.pdf` | bank-statement | n26 | personal-finance | `/personal/finance/bank-statements/2025/` |
| `BankStatementNovember.pdf` | bank-statement | n26 | personal-finance | `/personal/finance/bank-statements/2025/` |
| `Wio_Bank_PJSC_Salary_Transfer_Guide_en.pdf` | bank-statement | wio-bank | personal-finance | `/personal/finance/bank-statements/2025/` |
| `Kreditunterlagen.pdf` | credit-application | misc | personal-finance | `/personal/finance/credit-applications/` |
| `Bonitats-auskunft.pdf` | income-proof | misc | personal-finance | `/personal/finance/credit-applications/` |
| `Einkommens-Nachweis.pdf` | income-proof | s-ray | personal-finance | `/personal/finance/credit-applications/` |
| _…+48 more_ | | | | |

## What's deliberately NOT seeded

- Singleton anchor types with 1–2 examples — they live as tentative folders so Claude's prompt sees them, but they don't get the 3-item auto-file boost yet.
- Vendor-named folders. Apple, Trello, GitHub, Amazon are `from` axis values for search; their invoices/receipts file under the entity that pays for them, by year.
- Personal photos beyond the IMG_* cluster. The 30+ family photos under `~/Documents/IMG_*.jpg` go under `/personal/photos/` as a single anchor folder, not subdivided.
- Software project subdirectories (`apikit/`, `fastrader/`, `esgbook-test/`). Their git/build artifacts shouldn't get filed; their meaningful docs (proposals, diagrams) get repathed elsewhere.
