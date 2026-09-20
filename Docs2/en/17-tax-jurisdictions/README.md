# Tax Jurisdictions — User Guide

> One file per country (rates, thresholds, filing, e-invoicing), and the jurisdiction card in company profile is the single rate source — a law change = one file.

## Overview

The tax engine (`src/modules/tax/`) separates **law** (each country's data in `countries/`) from **mechanics** (the neutral `engine.ts`: periods, returns, locks). The company's set country (`tax.country_code`) determines the invoice rate, the tax-calendar timezone, and document validation rules. Configure at: **Sidebar ← Settings ← Company** (the `TaxJurisdictionCard` jurisdiction card).

## Access & Permissions

| Action | Permission |
|---|---|
| View jurisdiction card and country profiles | `settings.view` |
| Change the country (`tax.country_code`) | `settings.edit` |
| Automatic document validation (`validateDocument`) | Runs automatically at posting — no separate permission |

## Supported Countries

| Country | Code | Rate | Mandatory registration | Filing | E-invoicing |
|---|---|---:|---|---|---|
| Saudi Arabia | `SA` | 15% | SAR 375,000 (voluntary 187,500) | Monthly above 40M annual supplies, else quarterly | Mandatory — Fatoorah (ZATCA) in two phases: generation then integration |
| UAE | `AE` | 5% | AED 375,000 (voluntary 187,500) | Quarterly (monthly for large taxpayers) | Announced (Peppol) — not mandatory at time of writing |
| Egypt | `EG` | 14% + schedule tax on listed goods | EGP 500,000 | Monthly | Mandatory via ETA portal (digital signature + item coding) |
| Yemen | `YE` | 0% (a true zero) | No registration regime | No filing | None |

### Country details

**Saudi Arabia (`SA` — Asia/Riyadh):** 15% since July 2020. Exports, international transport, qualifying medicines, and investment gold are **zero-rated**; financial services, residential leases, and qualifying healthcare/education are **exempt**. Simplified (B2C) invoices need a QR code; tax (B2B) invoices need the buyer's VAT number. Auto-validation rejects: missing seller VAT number, missing date, non-positive total, and tax not equal to 15% of net (0.02 tolerance).

**UAE (`AE` — Asia/Dubai):** 5% since January 2018. Auto-validation: TRN, date, positive total, and 5% of net.

**Egypt (`EG` — Africa/Cairo):** 14% + schedule tax, with a reduced 5% band. Portal invoicing is mandatory with digital signature, item coding (GS1/EGS), and invoice UUID. Note: withholding tax (1%/3%/5%) is handled outside the return.

**Yemen (`YE` — Asia/Aden):** no VAT regime — documents are tax-free by default. Any tax recorded under this profile is flagged (`vat-charged-under-zero-rate-profile`) — zero is a real rate, not absence.

## Step-by-Step Workflow — numeric example (setting up a Saudi company)

1. Sidebar ← Settings ← Company ← **Tax jurisdiction** card.
2. Pick country `SA` — the card shows live: 15% rate, 375,000 SAR threshold, mandatory invoicing.
3. Save — the key `tax.country_code = SA` is written and audit-logged.
4. Create a 100,000 sales invoice + tax: the system computes **15,000** (not a constant — from the country profile).
5. Later switch to `AE`? New invoices compute at 5%; previously posted ones are **never repriced retroactively**.

## Key Rules — quick summary

| Rule | Detail |
|---|---|
| Law is data, not code | A legislative update = edit the country file and its tests — the engine is untouched |
| `YE` is zero-rated, not exceptional | The engine knows no "no tax" special case — a zero profile like the rest |
| Missing country = ask, never assume | Never default to 15% — ask the user for their country before any tax posting |
| Validation runs at posting | `validateDocument` checks tax number, date, total, and rate before acceptance |

## Common Errors & Fixes

| Message | Cause | Fix |
|---|---|---|
| `missing-seller-vat-number` | No seller tax number in company profile | Enter the tax number on the company card |
| `vat-not-15pct-of-net` (or equivalent) | Manual tax mismatching the country rate | Let the system compute it, or fix the net |
| `vat-charged-under-zero-rate-profile` | Tax on a document while the company is Yemeni | Zero the tax — Yemen has no VAT |
| Unexpected rate on a new invoice | The set country is not what you think | Check `tax.country_code` on the jurisdiction card |

## Tips

- Record your tax number in the company profile from day one — it prints on every tax invoice and e-invoicing document.
- Review your country file's notes (exemptions and zero-rating) before classifying items — wrong classification means wrong tax on every invoice.
- Expanding to a second country: one company carries one jurisdiction — open a separate company per tax jurisdiction.
