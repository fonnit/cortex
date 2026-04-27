# Cortex base-taxonomy seed proposal

**Sources:** Documents (809 files), Downloads (2284 files), 174 subdirs analyzed.

**Output if approved:** 60 type / 64 from / 28 context labels written to TaxonomyLabel; 43 stable anchor folders populated with 129 `status='filed'` items so the h9w auto-file gate fires on day 1.

## Axes — proposed TaxonomyLabel rows

### `type` axis (60 values)

| value | sources | examples | rationale (truncated) |
|-------|---------|----------|----------------------|
| `photo` | documents+downloads | IMG_0697.jpg, IMG_0736.jpg | [documents] IMG_*.jpg phone-camera photos with no obvious document semantics — bucket for the residu |
| `bank-statement` | documents+downloads | BusinessKonto_April.pdf, BusinessKonto_Feb.pdf | [documents] BusinessKonto_*, N26_*, BankStatement* recurring; monthly statements bundled for credit/ |
| `invoice` | documents+downloads | Rechnung_52.pdf, Rechnung_63.pdf | [documents] Dominant pattern: ~210 expense invoice PDFs (Steuererklaerung 2024/Expenses + Steuern +  |
| `payslip` | documents+downloads | Brutto-Netto-Abrechnung 2025 08 August.pdf, Payroll Sep 2025 | [documents] Multiple naming conventions converge: Brutto-Netto-Abrechnung_*, Payroll_*, Payslips_240 |
| `passport` | documents+downloads | Passport.pdf, Passport.heic | [documents] Multiple Passport.* files (jpg/pdf/png/heic) plus 'danny passport*' variants. Core ident |
| `boarding-pass` | documents+downloads | boarding-pass (4) 2.pdf, boarding-pass (6).pdf | [documents] Explicit Boarding passes/ folder + boarding-pass*.pdf naming pattern at root. \| [downloa |
| `screenshot` | documents+downloads | Bildschirmfoto 2024-04-13 um 09.12.11.jpeg.png, Bildschirmfo | [documents] Bildschirmfoto * + IMG_6708.png + The Anmeldung.jpeg.png — UI screenshots saved as refer |
| `civil-registry` | documents+downloads | REGISTRO CIVIL DANIEL 7 JUL 2025.pdf, REGISTRO CIVIL JAIME 7 | [documents] REGISTRO CIVIL * 7 JUL 2025.pdf for four family members — Colombian birth records cluste |
| `power-of-attorney` | documents+downloads | 1.1. Poder Daniel Fonnegra CN.docx.pdf, 1.3. Poder Daniel Fo | [documents] Poder Daniel Fonnegra CC/CN.docx.pdf — Spanish-language powers of attorney, duplicated b |
| `title-deed` | documents+downloads | SEVEN PALM 149 TITLE DEED.pdf, SHA724 - TITLE DEED.pdf | [documents] SEVEN PALM 149 TITLE DEED.pdf — real-estate ownership deed (Dubai property). \| [download |
| `rent-receipt` | documents | Rent payment Feb 2025.pdf, Rent payment Dec 2024.pdf | [documents] Rent payment * + Rent January/February/March/May/June + Mietzahlungsnachweis_*.pdf — pro |
| `contract` | documents | Daniel Fonnegra - 00061029 + Habyt contract.pdf, Employment  | [documents] Multiple 'contract' / 'Contrato' / 'agreement' / 'Mietvertrag' / 'Offer Letter' / 'MSA'  |
| `misc` | documents | 6f65ead8-64a4-498c-ae0a-697b1fd3504e.pdf, 1715035700.pdf | [documents] Catch-all for opaque/unidentifiable filenames (UUID PDFs, raw numeric IDs, junk like Box |
| `hotel-booking` | documents | HotelKualaLumpur.pdf, Hotel-Florence.pdf | [documents] Hotel*.pdf and Airbnb*.pdf bookings in trip and visa folders. |
| `residence-permit` | documents | AUFENTHALTSTITEL.pdf, Aufenhaltstitel1.jpg | [documents] AUFENTHALTSTITEL.pdf + Aufenhaltstitel1/2.jpg/jpeg variants used as supporting docs in K |
| `logo-asset` | documents | Logo.png, BlackLogo.png | [documents] FonnIT/Logo*.png, BrowserLogo.png, Colors.png, fonnit-cover.png — brand assets for Danie |
| `flight-booking` | documents | FlightMadridMedellin.pdf, FlightBerlinMadrid.pdf | [documents] Flight*.pdf naming used heavily inside Malaysia Visa/ and Documents Trip Grandparents/ — |
| `diploma` | documents | DiplomaPregrado.pdf, DiplomaPosgrado.pdf | [documents] Visa UAE folder packs DiplomaPregrado/Posgrado plus Calificaciones (transcripts) and Leg |
| `trip-itinerary` | documents | Train-Florence-Venice.pdf, Train-Rome-Florence.pdf | [documents] Train-* and SGArrivalCard_* and NCM-WEATHER schedule docs — trip-leg information that is |
| `payment-confirmation` | downloads | Transfer_Confirmation_USD-AED_16-Jan.-2025_01.54.42.pdf, Com | [downloads] 'Transfer Confirmation_*', 'Transfer_Confirmation_EUR_*', 'Comprobante_Transferencia_PSE |
| `booking-confirmation` | downloads | Hotel_Confirmation.pdf, Booking #5356276762.pdf | [downloads] 'Hotel_Confirmation*', 'Booking #*.pdf', 'Booking.com_ Confirmation*', '12go_booking_*.p |
| `tax-document` | downloads | Einkommensteuerbescheid.pdf, Einkommensteuererklaerung2023.p | [downloads] 'Einkommensteuerbescheid*', 'Einkommensteuererklaerung2023.pdf', 'AnlageEUR2023.pdf', 'U |
| `id-document` | downloads | AUFENTHALTSTITEL.pdf, German ID.pdf | [downloads] 'AUFENTHALTSTITEL*' (German residence permit), 'Aufenhaltstitel*.jpg', 'German ID.pdf',  |
| `rental-contract` | downloads | Mietvertrag.pdf, Mietvertrag Fonnegra _ McManus DRUCKVERSION | [downloads] 'Mietvertrag.pdf', 'Mietvertrag Fonnegra _ McManus DRUCKVERSION.pdf', '2.01.11 Stralauer |
| `employment-contract` | downloads | 20220608_S-Ray GmbH_Contractual Terms of Employment_MASTER.p | [downloads] '20220608_S-Ray GmbH_Contractual Terms of Employment_MASTER.pdf', '20220704_S-Ray German |
| `rent-payment` | downloads | Rent January.pdf, Rent February.pdf | [downloads] 'Rent January.pdf', 'Rent February.pdf', 'Rent March.pdf', 'MietzahlungApril.pdf', 'Miet |
| `real-estate-permit` | downloads | PAL-SEV-6EGNE_UnitPermit.pdf, PAL-SEV-GADRF_UnitPermit.pdf | [downloads] 'PAL-SEV-6EGNE_UnitPermit.pdf', 'PAL-SEV-GADRF_UnitPermit.pdf', 'PAL-SEV-SON5M_UnitPermi |
| `self-disclosure-form` | downloads | Selbstauskunft.pdf, Selbstauskunft Zweckentfremdung.pdf | [downloads] 'Selbstauskunft.pdf', 'Selbstauskunft Zweckentfremdung.pdf', '1.Mieterselbstauskunft_Sel |
| `cv-resume` | downloads | Daniel Fonnegra CV.pdf, Daniel Fonnegra Resume.pdf | [downloads] 'Daniel Fonnegra CV.pdf', 'Daniel Fonnegra Resume.pdf', 'DanielFonnegraResume*.pdf', 'Da |
| `certificate` | downloads | AWS Certified Solutions Architect - Professional certificate | [downloads] 'AWS Certified Solutions Architect - Professional certificate.pdf', '108_3_*_AWS Course  |
| `expense-receipt` | downloads | Receipt_1027-360-891.pdf, github-dfonnegra-receipt-2025-04-2 | [downloads] 'Receipt_1027-360-891.pdf', 'github-dfonnegra-receipt-2025-04-22.pdf' x3, 'github-fonnit |
| `installer` | downloads | Antigravity.dmg, Claude.dmg | [downloads] *.dmg, *.pkg, *.exe installers ('AirDroid_Cast_Desktop_Client_1.2.2.0.dmg', 'Antigravity |
| `diagram` | downloads | Arch Diagram.drawio, BD_Nuvant.drawio | [downloads] *.drawio files (architecture diagrams) e.g. 'Arch Diagram.drawio', 'BD_Nuvant.drawio', ' |
| `android-apk` | downloads | ECOPLAN-2-apr-2024.apk, ecoplan-dev.apk | [downloads] Many ecoplan-* APK builds and ECOPLAN-* dated APKs (15+ files) representing Android buil |
| `ticket` | downloads | bassliner_ticket_564145.pdf, bassliner_ticket_564146.pdf | [downloads] 'bassliner_ticket_564145.pdf' x3, 'eticket.pdf', 'E-Ticket.pdf', 'Tickets Antalya.pdf',  |
| `national-id` | documents | Emirates ID Back.pdf, Emirates ID Front.pdf | [documents] Emirates ID front/back + Cedula Antonia.pdf — government-issued ID cards distinct from p |
| `apostille` | documents | LegalizacionDiplomaPregrado.pdf, LegalizacionDiplomaPosgrado | [documents] Repeated Legalizacion*.pdf prefix — legal apostilles/authentications of diplomas, distin |
| `income-proof` | documents | Einkommens-Nachweis.pdf, Employment Confirmation Letter.pdf | [documents] Einkommens-Nachweis.pdf, Employment Confirmation Letter.pdf, Bonitats-auskunft.pdf — let |
| `business-registration` | documents | Bestaetigung Gewerbeanmeldung.pdf, RUT Daniel Fonnegra.pdf | [documents] Bestaetigung Gewerbeanmeldung.pdf + RUT Daniel Fonnegra.pdf + RUT Terradan.pdf + Certifi |
| `ebook` | documents | Manual order flow.pdf, Los 20 errores mas comunes del trader | [documents] Trading/Manual order flow.pdf + Trading/Los 20 errores mas comunes del trader.pdf + Steu |
| `schufa` | downloads | Schufa Bestellbestaetigung.pdf, SCHUFA Daniel Mc Manus.jpeg | [downloads] 'Schufa Bestellbestaetigung.pdf', 'SCHUFA Daniel Mc Manus.jpeg', 'Bonitats-auskunft.pdf' |
| `transcript` | downloads | CalificacionesPosgrado-Eng-Stamped.pdf, CalificacionesPregra | [downloads] 'CalificacionesPosgrado-Eng-Stamped.pdf', 'CalificacionesPosgrado_ES_EN.pdf', 'Calificac |
| `ai-generated-image` | downloads | ChatGPT Image Apr 1, 2026, 01_20_47 PM.png, ChatGPT Image Ma | [downloads] 'ChatGPT Image Apr 1, 2026, 01_20_47 PM.png' (10+ files), 'DALL·E 2023-10-17 00.00.08 -  |
| `kyc-document` | downloads | KYC - Tenant 331 Seven Hotel & Aprt. The Palm A.pdf, Fatima  | [downloads] 'KYC - Tenant 331 Seven Hotel & Aprt. The Palm A.pdf' (x2), 'Fatima Zahrae - Broker Card |
| `outgoing-invoice` | documents | invoice_FONN-10.pdf, invoice_FONN-27.pdf | [documents] Daniel's own invoices to clients via FonnIT freelance — distinct from incoming vendor in |
| `tax-return` | documents | Steuer Erklaerung 2023.pdf, Steuer Bescheid 2023.pdf | [documents] Steuer Erklaerung/Steuer Bescheid/Einkommensteuerbescheid pattern — annual filings + ass |
| `insurance-policy` | documents | Krankversicherung.pdf, 416382638_Ihr Versicherungsvertrag_20 | [documents] Krankversicherung.pdf, 416382638_Ihr Versicherungsvertrag*.pdf, Unterlagen_Zusatzversich |
| `proof-of-address` | documents | ProofOfResidenceKualaLumpur.pdf, ChatWithStarResidence.pdf | [documents] ProofOfResidenceKualaLumpur.pdf + ChatWithStarResidence.pdf in visa packet, plus Bestaet |
| `config-backup` | documents | Fastrader Ubuntu.nxs, Fastrader Windows.nxs | [documents] NoMachine/*.nxs and *.nxs.recover* — saved RDP/SSH session config files. |
| `insurance-document` | downloads | Versicherungsbescheinigung_3208987875.pdf, 416382638_Ihr Ver | [downloads] 'Versicherungsbescheinigung_3208987875.pdf', '416382638_Ihr Versicherungsvertrag_2025_01 |
| _…+10 more_ | | | |

### `from` axis (64 values)

| value | sources | examples | rationale (truncated) |
|-------|---------|----------|----------------------|
| `fonnit` | documents+downloads+hierarchy | invoice_FONN-10.pdf, invoice_FONN-27.pdf | [documents] invoice_FONN-*.pdf — Daniel's own freelance entity issuing client invoices, plus brand a |
| `terradan` | documents+downloads+hierarchy | RUT Terradan.pdf, Contrato - Daniel Fonnegra.pdf | [documents] Terradan Colombia/ + Terradan Dubai/ folders — Daniel's other business entity. \| [downlo |
| `apple` | documents+downloads | Invoice_Apple_8.pdf, Apple May.pdf | [documents] Invoice_Apple_*.pdf, Apple May/Jun/March.pdf, AppleJan2024.pdf, BA85380077_Apple.pdf — A |
| `grover` | documents+downloads | Laptop_Grover_1.pdf, Laptop_Grover_8.pdf | [documents] Laptop_Grover_*.pdf — Grover hardware-rental subscription. \| [downloads] 'Grover Nov.pdf |
| `aws` | documents+downloads | Invoice_EUINDE24_1380117_AWS.pdf, Invoice_EUINDE24_2017282_A | [documents] Invoice_EUINDE24_*_AWS.pdf — AWS hosting bills. \| [downloads] 'AWS Certified Solutions A |
| `github` | documents+downloads | github-dfonnegra-receipt-2024-09-22.pdf, github-dfonnegra-re | [documents] github-dfonnegra-receipt-2024-MM-22.pdf monthly receipts. \| [downloads] 'github-dfonnegr |
| `amazon` | documents+downloads | Amazon_1.pdf, Amazon_2.pdf | [documents] Amazon_1..8.pdf — Amazon order invoices. \| [downloads] 'Amazon 1.pdf' through 'Amazon 5. |
| `trello` | documents+downloads | CcW2hPlnDNn75PYqGbKqFi_1D05cPvu4_WIV_Trello.pdf, 9BRu0ebJi98 | [documents] *_Trello.pdf — Atlassian/Trello subscription. \| [downloads] 'Trello-Receipt-30668189.pdf |
| `nuvant` | downloads+hierarchy | Nuvant.drawio, BD_Nuvant.drawio | [downloads] 'Nuvant.drawio', 'BD_Nuvant.drawio', 'Especificacion_Software_Carga_DCS_Nuvant-3.docx',  |
| `wio-bank` | documents+downloads | Wio_Bank_PJSC_Salary_Transfer_Guide_en.pdf, Wio_Bank_PJSC_Sa | [documents] Wio_Bank_PJSC_Salary_Transfer_Guide_en.pdf — UAE bank. \| [downloads] 'Wio_Bank_PJSC_Sala |
| `s-ray` | documents+downloads | 20220704_S-Ray Germany Offer Letter_Daniel Fonnegra Signed.p | [documents] 20220704_S-Ray Germany Offer Letter_*.pdf — German employer. \| [downloads] '20220608_S-R |
| `habyt` | documents+downloads | Daniel Fonnegra - 00061029 + Habyt contract.pdf, Daniel Fonn | [documents] Filename embeds 'Habyt contract' — Habyt is Daniel's housing/co-living provider. \| [down |
| `revolut` | documents | RevolutJan2024.pdf, RevolutFeb.pdf | [documents] RevolutJan2024.pdf, invoice_2024-*-21_Revolut.pdf — fintech subscription provider. |
| `esgbook` | downloads | Daniel Fonnegra_ESGBook contract_signed.pdf, esgbctl-darwin. | [downloads] 'Daniel Fonnegra_ESGBook contract_signed.pdf', 'esgbook_logo.png', 'esgbook_logo white.p |
| `ecoplan` | downloads | ECOPLAN-2-apr-2024.apk, ecoplan-dev.apk | [downloads] 'ECOPLAN-2-apr-2024.apk', 'ecoplan-dev.apk', 'ecoplan-prod.apk', 'ecoplan-release.apk',  |
| `bitrix24` | downloads | Bitrix24 Contacts REST API Documentation.pdf, Bitrix24.postm | [downloads] 'Bitrix24 Contacts REST API Documentation.pdf', 'Bitrix24.postman_collection.json', 'CAM |
| `seven-palm` | downloads | SEVEN PALM 149 TITLE DEED.pdf, SevenPalm149_TitleDeed.pdf | [downloads] Dubai Seven Palm property cluster: 'SEVEN PALM 149 TITLE DEED.pdf', 'SHA724 - TITLE DEED |
| `aldi` | documents | AldiMar2024.pdf, AldiJun2024.pdf | [documents] AldiMar2024.pdf + DataPlan_Aldi_*.pdf — Aldi grocery + Aldi Talk mobile data plan. |
| `google` | documents | 5006949298_Google.pdf, 4962804418_Google.pdf | [documents] *_Google.pdf and 4946130332.pdf-style numeric IDs — Google Workspace / Cloud invoices. |
| `airbnb` | documents | Airbnb-Rome.pdf, Airbnb-Venice.pdf | [documents] Airbnb-Rome/Venice/Madrid + CARTA AIRBNB OSLO booking confirmations. |
| `metrofibre` | downloads | MET15678_DF_Vertragsdokumente_LA3.pdf, MET15678_RF_Vertragsd | [downloads] 'MET15678_DF_Vertragsdokumente_LA3.pdf' (5 dups), 'MET15678_RF_Vertragsdokumente_LA4.pdf |
| `ruhrfibre` | downloads | ruhrfibre_essen_RV_daniel-fonnegra_228ad9b1.xlsx, ruhrfibre_ | [downloads] 'ruhrfibre_essen_RV_daniel-fonnegra_228ad9b1.xlsx', 'ruhrfibre_essen_RV_daniel-fonnegra_ |
| `ecoplan-thiede` | downloads | Proposal Android App - Ecoplan Thiede.pdf, ecoplan_thiede-01 | [downloads] Subdomain of ecoplan client - 'Proposal Android App - Ecoplan Thiede.pdf' x2, 'ecoplan_t |
| `habyt-employer` | downloads | Brutto-Netto-Abrechnung 2025 01 Januar.pdf, Brutto-Netto-Abr | [downloads] Multiple monthly payslips and payroll docs from Habyt as employer: 'Brutto-Netto-Abrechn |
| `edificio-oslo` | downloads | Edificio_Oslo_Operational_Audit. OSLO (1).pdf, INFORME DE IN | [downloads] 'Edificio_Oslo_Operational_Audit. OSLO (1).pdf', 'INFORME DE INSPECCIÓN EDIFICIO OSLO.pd |
| `kuo` | downloads | OTROSI SIN REAJUSTE PRECIO FIJO KUO - APTO3001_1748998477-f- | [downloads] 'OTROSI SIN REAJUSTE PRECIO FIJO KUO - APTO3001_*.pdf', 'PROMESA COMPRAVENTA KÃ_O - APTO |
| `whatsapp` | downloads | WhatsApp Image 2025-02-07 at 22.27.11.jpeg, WhatsApp Image 2 | [downloads] WhatsApp Image 2025-* and WhatsApp Video 2024-* are the source/sender for many photos/vi |
| `deutsche-bahn` | downloads | GVQFYT_Berlin_Hbf_(tief)_16_Apr_2023_Ticket1.pdf, XMDLHT_Han | [downloads] 'GVQFYT_Berlin_Hbf_(tief)_16_Apr_2023_Ticket1.pdf', 'XMDLHT_Hanover_16_Apr_2023_Ticket1. |
| `n26` | documents | N26_February.pdf, N26_March.pdf | [documents] N26_February/March/April.pdf — German neobank statements. |
| `openai` | documents | Receipt-2345-9025_OpenAI.pdf, Receipt-2622-4456_OpenAI.pdf | [documents] Receipt-####-####_OpenAI.pdf — OpenAI API/ChatGPT receipts. |
| `upwork` | documents | T656986555_Upwork.pdf, T685723331_Upwork.pdf | [documents] T######_Upwork.pdf bulk pattern in expenses — freelance platform. |
| `germany-residence-office` | documents | AUFENTHALTSTITEL.pdf, Anfrage an das Referat S 4 - Berlin.de | [documents] AUFENTHALTSTITEL.pdf, Anfrage an das Referat S 4 - Berlin.de.pdf, Bestaetigung Niederlas |
| `uae-government` | documents | Emirates ID Front.pdf, Emirates ID Back.pdf | [documents] Emirates ID Front/Back, UNITED ARAB EMIRATES.pdf, License .pdf in Terradan Dubai/ — UAE  |
| `colombia-government` | documents | REGISTRO CIVIL DANIEL 7 JUL 2025.pdf, RUT Daniel Fonnegra.pd | [documents] REGISTRO CIVIL * (Registraduría) + RUT (DIAN) + Cedula — Colombian state issuers. |
| `habyt-stralauer` | downloads | 2.01.11 Stralauer Platz 35, Fr. Jankkila, Hr. Fonnegra Garci | [downloads] '2.01.11 Stralauer Platz 35, Fr. Jankkila, Hr. Fonnegra Garcia, ab 01.07.2025.pdf' (x2), |
| `chatgpt` | downloads | ChatGPT Image Apr 1, 2026, 01_20_47 PM.png, ChatGPT Image Ma | [downloads] 'ChatGPT Image Apr 1, 2026, 01_20_47 PM.png' (10+ generated assets) |
| `booking-com` | downloads | Booking.com_ Confirmation.pdf, Booking.com_ Confirmation (1) | [downloads] 'Booking.com_ Confirmation.pdf' (x2), 'Booking #5356276762.pdf' (x2) |
| `hostelworld` | downloads | Confirmed booking from hostelworld.com - Alessandro Palace & | [downloads] 'Confirmed booking from hostelworld.com - Alessandro Palace & Bar, Rome.eml', 'Gmail - C |
| `elster` | downloads | dfonnegr_elster_03.10.2023_13.57.pfx, dfonnegr_elster_03.10. | [downloads] 'dfonnegr_elster_03.10.2023_13.57.pfx' x3 - German tax filing certificate exports |
| `alditalk` | downloads | blob_https___www.alditalk-kundenportal.de_2caba22c-bc2b-449f | [downloads] 'blob_https___www.alditalk-kundenportal.de_2caba22c-bc2b-449f-a5b5-b6dd2120ddab.pdf' x3  |
| `dubai-det` | downloads | ES-289307 Request to Reset Login Credentials for hh.det.gov. | [downloads] 'ES-289307 Request to Reset Login Credentials for hh.det.gov.ae.pdf' x3 - Dubai Departme |
| `stb-munk` | downloads | Vollmacht_STB-Munk.pdf, Vollmacht_STB-Munk (1).pdf | [downloads] 'Vollmacht_STB-Munk.pdf', 'Vollmacht_Beiblatt_STB-Munk.pdf' (x2 each) - German Steuerber |
| `ejari` | downloads | SevenPalm149_Ejari.pdf, Ejari TC and Addendum - 149 - Seven  | [downloads] 'SevenPalm149_Ejari.pdf', 'Ejari TC and Addendum - 149 - Seven Hotel - The Palm A - Revi |
| `accountable` | documents | STRIPE-in_1PBtYkD9hfeKN8ylk9Ihnn92_Accountable.pdf, STRIPE-i | [documents] STRIPE-in_*_Accountable.pdf — German tax-filing SaaS. |
| `ostrom` | downloads | Du bist dabei! Vertrag bei Ostrom bestätigt.eml, Ostrom vert | [downloads] 'Du bist dabei! Vertrag bei Ostrom bestätigt.eml', 'Ostrom vertrag bestätigung.pdf' - el |
| `duesselfibre` | downloads | duesselfibre_duesseldorf_RV_d-f_19fd42f1.xlsx, duesselfibre_ | [downloads] 'duesselfibre_duesseldorf_RV_d-f_19fd42f1.xlsx' (x2) |
| `telc` | downloads | Telc-Zertifikat.jpg, Gmail - Bestätigung Anmeldung telc Deut | [downloads] 'Telc-Zertifikat.jpg', 'Gmail - Bestätigung Anmeldung telc Deutsch B1.pdf' - German lang |
| `castlabs` | documents | PayslipsCastlabs2021.pdf | [documents] PayslipsCastlabs2021.pdf — past employer. |
| `bvfa` | documents | 64557 - BvFA Mahnung USt 2024.pdf | [documents] BvFA Mahnung USt 2024 — German tax debt collection agency. |
| `redsys` | documents | Ticket de pago Redsys.pdf | [documents] Ticket de pago Redsys.pdf — Spanish payment processor. |
| _…+14 more_ | | | |

### `context` axis (28 values)

| value | sources | examples | rationale (truncated) |
|-------|---------|----------|----------------------|
| `travel` | documents+downloads+hierarchy | boarding-pass (4) 2.pdf, Hotel-Madrid.pdf | [documents] Boarding passes/, Documents Trip Grandparents/, hotels, flights, trains. Distinguishable |
| `real-estate` | documents+downloads+hierarchy | Mietvertrag.pdf, Bewerbermappe_Daniel_Fonnegra.pdf | [documents] Wohnungssuche Unterlagen/ (apartment-search), Mietvertrag, rent payments, sublet agreeme |
| `taxes` | documents+downloads+hierarchy | Steuer Erklaerung 2023.pdf, Steuer Bescheid 2023.pdf | [documents] Steuererklaerung 2024/, Steuern/, Steuer Erklaerung/Bescheid, expense PDFs collected for |
| `personal-finance` | documents+downloads | Brutto-Netto-Abrechnung 2025 08 August.pdf, 416382638_Ihr Ve | [documents] Personal banking, insurance, demand letters, credit applications, personal payslips. Exc |
| `work-employment` | documents+downloads | 20220704_S-Ray Germany Offer Letter_Daniel Fonnegra Signed.p | [documents] Employment contracts, offer letters, employment confirmation, CV — work/career documents |
| `identity` | documents+downloads | Passport.pdf, AUFENTHALTSTITEL.pdf | [documents] Passport, Aufenthaltstitel, Emirates ID, Cedula, civil registry, passport photo, drivers |
| `education` | documents+downloads | DiplomaPregrado.pdf, DiplomaPosgrado.pdf | [documents] Diplomas + transcripts + apostilles for university credentials, plus Trading/ ebooks and |
| `family` | documents+downloads | REGISTRO CIVIL JENNY 7 JUL 2025.pdf, REGISTRO CIVIL JAIME 7  | [documents] Civil-registry records for Daniel + Jenny + Jaime + Alejandro, Cedula Antonia, 'Document |
| `immigration` | documents+hierarchy | FlightMadridMedellin.pdf, ProofOfResidenceKualaLumpur.pdf | [documents] Visa application packets (Malaysia Visa/, Visa UAE/), Einbürgerung/naturalization (Unfeb |
| `work-projects` | downloads+hierarchy | esgbook-infra-1db023e-plan.tar, Mapa Histórico (1).dxf | [downloads] Active engineering project artifacts - ESGBook tooling/data, esgbook-infra plans, dxf ma |
| `business-finance` | documents | invoice_FONN-10.pdf, invoice_FONN-54.pdf | [documents] FonnIT freelance income invoices, Terradan corporate registrations, business bank statem |
| `tools-software` | documents | Logo.png, fonnit-cover.png | [documents] FonnIT/Logo*, NoMachine/*.nxs configs, AirDroid Cast cache, RetroArch playlists, drawio  |
| `personal-photos` | documents | IMG_0697.jpg, IMG_3560.jpg | [documents] IMG_*.jpg phone-camera shots and screenshots — non-document captures. |
| `work-freelance` | downloads | 2505-FONN-70-FonnIT-Daniel-Fonnegra-Garcia.pdf, invoice_FONN | [downloads] FonnIT freelance invoicing - '2505-FONN-70-FonnIT-Daniel-Fonnegra-Garcia.pdf' x10+, 'inv |
| `housing-rental` | downloads | Mietvertrag.pdf, Selbstauskunft.pdf | [downloads] Berlin/Germany apartment search and tenancy paperwork - 'Mietvertrag.pdf', 'Selbstauskun |
| `shopping` | downloads | Amazon 1.pdf, Amazon.de - Order 303-3497912-0043507.pdf | [downloads] Online shopping receipts and shipping labels - 'Amazon 1-5.pdf', 'Amazon.de - Order *.pd |
| `vehicle-licensing` | downloads | Mi licencia .pdf, Licence 2026 .pdf | [downloads] 'Mi licencia .pdf', 'Licence 2026 .pdf', 'NMA3041_25-F-511_403-FON-NMN.pdf', 'NMA3538_25 |
| `media-personal` | downloads | WhatsApp Image 2025-02-07 at 22.27.11.jpeg, IMG_3093.HEIC | [downloads] WhatsApp images/videos, IMG_* phone photos, Screen Recording, ChatGPT generated images - |
| `housing` | hierarchy |  | [hierarchy] Apartment-search documents — life-admin housing context |
| `finance` | hierarchy |  | [hierarchy] Loan, money-legalization, and trading directories indicate a personal-finance context |
| `company-ops` | hierarchy |  | [hierarchy] Operational subfolders (expenses, salaries, costs, certifications) indicate a company-op |
| `invoices` | hierarchy |  | [hierarchy] Recurring invoice/billing patterns show invoicing as a tracked context |
| `gis-mapping` | hierarchy |  | [hierarchy] _shp suffixes (shapefile) indicate a GIS-mapping context — likely tied to a specific wor |
| `gaming` | hierarchy |  | [hierarchy] Emulator config/save folders for multiple consoles (PSX, PSP) indicate a gaming context |
| `meetings` | hierarchy |  | [hierarchy] Zoom recording of a German B2.1 conversation course implies meeting/class recordings as  |
| `language-learning` | hierarchy |  | [hierarchy] B2.1 Konversationskurs suggests a language-learning sub-context (German classes) |
| `fonts-assets` | hierarchy |  | [hierarchy] Font webfont package — design/dev asset context |
| `design-references` | hierarchy |  | [hierarchy] Reference imagery/design folders co-located with project work |

## Stable folders — anchor seeds (≥3 mapped items each)

43 folders qualify for anchor seeding. Each will receive 3 `status='filed'` items so h9w's parent-≥3-siblings gate fires on the next matching ingestion.

| folder | mapped | anchor files |
|--------|--------|--------------|
| `/taxes/2024/expenses/` | 6 | Rechnung_52.pdf, Rechnung_63.pdf, Invoice_Apple_8.pdf |
| `/personal/finance/bank-statements/` | 6 | N26_February.pdf, BusinessKonto_April.pdf, BankStatementNovember.pdf |
| `/education/diplomas/` | 5 | DiplomaPregrado.pdf, DiplomaPosgrado.pdf, CalificacionesPregrado.pdf |
| `/real-estate/rental/` | 5 | Daniel Fonnegra - 00061029 + Habyt contract.pdf, Mietvertrag.pdf, Rent payment Feb 2025.pd |
| `/real-estate/dubai/seven-palm-149/` | 5 | SEVEN PALM 149 TITLE DEED.pdf, SevenPalm149_TitleDeed.pdf, SevenPalm149_UnitPermit.pdf |
| `/personal/finance/payslips/` | 4 | Brutto-Netto-Abrechnung 2025 08 August.pdf, Payroll Sep 2025.pdf, Payslips 2401.pdf |
| `/personal/finance/credit-applications/` | 4 | Kreditunterlagen.pdf, Bonitats-auskunft.pdf, Einkommens-Nachweis.pdf |
| `/identity/civil-registry/` | 4 | REGISTRO CIVIL DANIEL 7 JUL 2025.pdf, REGISTRO CIVIL JENNY 7 JUL 2025.pdf, REGISTRO CIVIL  |
| `/travel/boarding-passes/` | 4 | boarding-pass (4) 2.pdf, boarding-pass (6).pdf, your-mobile-tickets-9250272.pdf |
| `/travel/trip-grandparents/` | 4 | Flight-Madrid-Rom.pdf, Hotel-Florence.pdf, Airbnb-Rome.pdf |
| `/personal/photos/` | 4 | IMG_0697.jpg, IMG_3560.jpg, IMG_4058.jpg |
| `/personal/finance/invoices/` | 4 | Invoice-3195327959.pdf, Invoice_EUINDE25_1173555.pdf, Gmail - Deine Rechnung von Apple 1.p |
| `/work/freelance/fonnit/invoices/` | 4 | Rechnung_53.pdf, 2505-FONN-70-FonnIT-Daniel-Fonnegra-Garcia.pdf, 2510-FONN-82-FonnIT-Danie |
| `/work/employment/habyt/payslips/` | 4 | Brutto-Netto-Abrechnung 2025 01 Januar.pdf, Brutto-Netto-Abrechnung 2025 06 Juni.pdf, Payr |
| `/business/fonnit/invoices-out/` | 3 | invoice_FONN-10.pdf, invoice_FONN-27.pdf, invoice_FONN-54.pdf |
| `/personal/finance/insurance/` | 3 | 416382638_Ihr Versicherungsvertrag_2025_01_02_4456.pdf, Krankversicherung.pdf, Unterlagen_ |
| `/personal/finance/correspondence/` | 3 | 64557 - BvFA Mahnung USt 2024.pdf, BMV Kündigung.png, Anfrage an das Referat S 4 - Berlin. |
| `/business/fonnit/registrations/` | 3 | Bestaetigung Gewerbeanmeldung.pdf, Steuer Bescheid 2023.pdf, Steuer Erklaerung 2023.pdf |
| `/business/fonnit/branding/` | 3 | Logo.png, BlackLogo.png, fonnit-cover.png |
| `/business/terradan/registrations/` | 3 | RUT Terradan.pdf, CertificadoDeExistenciaYRepresentacion.pdf, Contrato - Daniel Fonnegra.p |
| `/business/terradan/dubai/` | 3 | Emirates ID Front.pdf, License .pdf, Wio_Bank_PJSC_Salary_Transfer_Guide_en.pdf |
| `/identity/passport/` | 3 | Passport.pdf, Passport.heic, danny passport.pdf |
| `/identity/residence-permit/` | 3 | AUFENTHALTSTITEL.pdf, Aufenhaltstitel1.jpg, Permanent residence letter.jpeg |
| `/immigration/visa-malaysia/` | 3 | FlightMadridMedellin.pdf, HotelKualaLumpur.pdf, ProofOfResidenceKualaLumpur.pdf |
| `/work/cv/` | 3 | DanielFonnegraCV.pdf, Daniel Fonnegra CV.pdf, Bewerbermappe_Daniel_Fonnegra.pdf |
| `/education/reading/` | 3 | Manual order flow.pdf, Los 20 errores mas comunes del trader.pdf, Implementing domain driv |
| `/tools/configs/` | 3 | Fastrader Ubuntu.nxs, Fastrader Windows.nxs, TruckIdArch.drawio |
| `/misc/` | 3 | 6f65ead8-64a4-498c-ae0a-697b1fd3504e.pdf, 1715035700.pdf, Boxing 1.pdf |
| `/personal/identity/civil-registry/` | 3 | REGISTRO CIVIL DANIEL 7 JUL 2025.pdf, REGISTRO CIVIL ALEJANDRO 7 JUL 2025.pdf, REGISTRO CI |
| `/personal/family/medellin-elders/` | 3 | ALBA NUBIA FRANCO DE GARCIA, 20MAY 1940 MEDELLIN.pdf, MARIA INES VELEZ DE FONNEGRA, 20MAY  |
| `/personal/housing/berlin-stralauer-platz/` | 3 | Mietvertrag.pdf, 2.01.11 Stralauer Platz 35, Fr. Jankkila, Hr. Fonnegra Garcia, ab 01.07.2 |
| `/personal/housing/apartment-search/` | 3 | Selbstauskunft.pdf, Schufa Bestellbestaetigung.pdf, SCHUFA Daniel Mc Manus.jpeg |
| `/personal/housing/rent-payments/` | 3 | Rent January.pdf, Mietzahlungsnachweis Juni.pdf, MietzahlungApril.pdf |
| `/real-estate/dubai/terradan/licenses/` | 3 | TerradanDubai_License.pdf, AW REALESTATE 2024 License .pdf, PBP Trade License 2026.pdf |
| `/personal/taxes/germany/` | 3 | Einkommensteuerbescheid.pdf, Einkommensteuererklaerung2023.pdf, Gewinnermittlung 2024.pdf |
| `/personal/travel/boarding-passes/` | 3 | boarding-pass.pdf, boarding-pass (3).pdf, BP_552630111_BOG-MAD_SP53282360_62859859_8915608 |
| `/personal/finance/receipts/` | 3 | Trello-Receipt-30668189.pdf, github-dfonnegra-receipt-2025-04-22.pdf, github-dfonnegra-rec |
| `/personal/education/diplomas-transcripts/` | 3 | DiplomaPosgrado-Eng-Stamped.pdf, CalificacionesPosgrado-Eng-Stamped.pdf, CalificacionesPre |
| `/personal/job-search/cv-versions/` | 3 | Daniel Fonnegra CV.pdf, DanielFonnegraResume.pdf, Bewerbermappe_Daniel_Fonnegra.pdf |
| `/work/projects/ecoplan-thiede/` | 3 | ECOPLAN-2-apr-2024.apk, ecoplan-prod.apk, Proposal Android App - Ecoplan Thiede.pdf |
| `/work/projects/bitrix24/` | 3 | Bitrix24 Contacts REST API Documentation.pdf, Bitrix24.postman_collection.json, CAMPOS BIT |
| `/personal/legal/power-of-attorney/` | 3 | Vollmacht_STB-Munk.pdf, POA - Mustafa to Haidar.pdf, POA Emirates ID.pdf |
| `/personal/utilities/` | 3 | Du bist dabei! Vertrag bei Ostrom bestätigt.eml, Ostrom vertrag bestätigung.pdf, Vertragsz |

## Tentative folders — proposed but not anchored (1–2 mapped items)

20 folders have signal but not enough for the cold-start gate. They appear in the prompt's "Existing folders" tree (visible to Stage 2 even with 0 confirmed siblings), so Claude can still propose paths into them — items just won't auto-file until the user manually confirms 3+ items there.

- `/work/contracts/` (2 mapped)
- `/legal/power-of-attorney/` (2 mapped)
- `/personal/screenshots/` (2 mapped)
- `/work/employment/esgbook/` (2 mapped)
- `/work/employment/habyt/contracts/` (2 mapped)
- `/personal/identity/national-ids/` (2 mapped)
- `/personal/identity/passport/` (2 mapped)
- `/personal/travel/train-tickets/` (2 mapped)
- `/personal/travel/hotel-bookings/` (2 mapped)
- `/personal/shopping/grover/` (2 mapped)
- `/personal/shopping/amazon/` (2 mapped)
- `/personal/education/certifications/` (2 mapped)
- `/personal/identity/driving-license/` (2 mapped)
- `/real-estate/property-deeds/` (1 mapped)
- `/taxes/forms/` (1 mapped)
- `/work/employment/s-ray/` (1 mapped)
- `/personal/identity/residence-permits/` (1 mapped)
- `/real-estate/dubai/seven-palm-1220/` (1 mapped)
- `/real-estate/dubai/seven-palm-724/` (1 mapped)
- `/personal/travel/hostel-bookings/` (1 mapped)

## Anchor items — first 30 of 129

These will be inserted as `Item` rows with `status='filed'` + `confirmed_drive_path` set + `axis_*` filled. They become the substrate the h9w gate counts against.

| file | type | from | context | path |
|------|------|------|---------|------|
| `Rechnung_52.pdf` | invoice | misc | taxes | `/taxes/2024/expenses/Rechnung_52.pdf` |
| `Rechnung_63.pdf` | invoice | misc | taxes | `/taxes/2024/expenses/Rechnung_63.pdf` |
| `Invoice_Apple_8.pdf` | invoice | apple | taxes | `/taxes/2024/expenses/Invoice_Apple_8.pdf` |
| `N26_February.pdf` | bank-statement | n26 | personal-finance | `/personal/finance/bank-statements/N26_February.pdf` |
| `BusinessKonto_April.pdf` | bank-statement | fonnit | business-finance | `/personal/finance/bank-statements/BusinessKonto_April.pdf` |
| `BankStatementNovember.pdf` | bank-statement | n26 | personal-finance | `/personal/finance/bank-statements/BankStatementNovember.pdf` |
| `DiplomaPregrado.pdf` | diploma | colombia-government | education | `/education/diplomas/DiplomaPregrado.pdf` |
| `DiplomaPosgrado.pdf` | diploma | colombia-government | education | `/education/diplomas/DiplomaPosgrado.pdf` |
| `CalificacionesPregrado.pdf` | diploma | colombia-government | education | `/education/diplomas/CalificacionesPregrado.pdf` |
| `Daniel Fonnegra - 00061029 + Habyt contract.pdf` | contract | habyt | real-estate | `/real-estate/rental/Daniel Fonnegra - 00061029 + Habyt contract.pdf` |
| `Mietvertrag.pdf` | contract | habyt | real-estate | `/real-estate/rental/Mietvertrag.pdf` |
| `Rent payment Feb 2025.pdf` | rent-receipt | habyt | real-estate | `/real-estate/rental/Rent payment Feb 2025.pdf` |
| `SEVEN PALM 149 TITLE DEED.pdf` | title-deed | seven-palm | real-estate | `/real-estate/dubai/seven-palm-149/SEVEN PALM 149 TITLE DEED.pdf` |
| `SevenPalm149_TitleDeed.pdf` | title-deed | seven-palm | real-estate | `/real-estate/dubai/seven-palm-149/SevenPalm149_TitleDeed.pdf` |
| `SevenPalm149_UnitPermit.pdf` | real-estate-permit | seven-palm | real-estate | `/real-estate/dubai/seven-palm-149/SevenPalm149_UnitPermit.pdf` |
| `Brutto-Netto-Abrechnung 2025 08 August.pdf` | payslip | s-ray | personal-finance | `/personal/finance/payslips/Brutto-Netto-Abrechnung 2025 08 August.pdf` |
| `Payroll Sep 2025.pdf` | payslip | s-ray | personal-finance | `/personal/finance/payslips/Payroll Sep 2025.pdf` |
| `Payslips 2401.pdf` | payslip | s-ray | personal-finance | `/personal/finance/payslips/Payslips 2401.pdf` |
| `Kreditunterlagen.pdf` | credit-application | misc | personal-finance | `/personal/finance/credit-applications/Kreditunterlagen.pdf` |
| `Bonitats-auskunft.pdf` | income-proof | misc | personal-finance | `/personal/finance/credit-applications/Bonitats-auskunft.pdf` |
| `Einkommens-Nachweis.pdf` | income-proof | s-ray | personal-finance | `/personal/finance/credit-applications/Einkommens-Nachweis.pdf` |
| `REGISTRO CIVIL DANIEL 7 JUL 2025.pdf` | civil-registry | colombia-government | family | `/identity/civil-registry/REGISTRO CIVIL DANIEL 7 JUL 2025.pdf` |
| `REGISTRO CIVIL JENNY 7 JUL 2025.pdf` | civil-registry | colombia-government | family | `/identity/civil-registry/REGISTRO CIVIL JENNY 7 JUL 2025.pdf` |
| `REGISTRO CIVIL JAIME 7 JUL 2025.pdf` | civil-registry | colombia-government | family | `/identity/civil-registry/REGISTRO CIVIL JAIME 7 JUL 2025.pdf` |
| `boarding-pass (4) 2.pdf` | boarding-pass | misc | travel | `/travel/boarding-passes/boarding-pass (4) 2.pdf` |
| `boarding-pass (6).pdf` | boarding-pass | misc | travel | `/travel/boarding-passes/boarding-pass (6).pdf` |
| `your-mobile-tickets-9250272.pdf` | boarding-pass | misc | travel | `/travel/boarding-passes/your-mobile-tickets-9250272.pdf` |
| `Flight-Madrid-Rom.pdf` | flight-booking | misc | travel | `/travel/trip-grandparents/Flight-Madrid-Rom.pdf` |
| `Hotel-Florence.pdf` | hotel-booking | misc | travel | `/travel/trip-grandparents/Hotel-Florence.pdf` |
| `Airbnb-Rome.pdf` | hotel-booking | airbnb | travel | `/travel/trip-grandparents/Airbnb-Rome.pdf` |
| _…+99 more_ | | | | |

## Risks + open decisions

1. **TaxonomyLabel-write bug (#1).** Confirming an item via `/api/triage` does not insert TaxonomyLabel rows. The seed plants the labels but future approvals won't grow them. Bug fix is a separate quick task.
2. **`status='filed'` requires `drive_inbox_id` (#2).** No code path sets that today. The seed sidesteps it by writing `status='filed'` + `confirmed_drive_path` directly to the Item. Future items still won't reach `'filed'` until the upload step exists. Bug fix is a separate quick task.
3. **Anchor files are local paths, not Drive paths.** `confirmed_drive_path` becomes `/work/fonnit/invoices/...` — virtual until Drive upload exists. The h9w gate only cares about the prefix match, so this is fine for cold-start.
4. **Multilingual filenames.** Anchor file basenames keep the user's German/Spanish/English originals (e.g. `Brutto-Netto-Abrechnung 2025 08 August.pdf`). Folder names are English+lowercase per the existing convention.
