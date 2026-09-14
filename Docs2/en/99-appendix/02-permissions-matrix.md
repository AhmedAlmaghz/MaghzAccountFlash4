# Permissions Matrix

> A complete reference table: what each role can do in each module, with an explanation of the "own documents only" permission and the Reports, Settings, and AI assistant permissions.

## Overview

The system follows the RBAC (Role-Based Access Control) model: every sensitive operation is checked against a string permission such as `sales.create` or `accounting.post`. Permission format: `module.action`.

The actions for each module:

| Action | Meaning |
|---|---|
| `view` | View the module, its lists, and its reports |
| `own` | Restrict viewing and editing to **my own documents only** (see the last section) |
| `create` | Add new documents or records |
| `edit` | Modify existing ones (including editing drafts) |
| `delete` | Delete — in practice for drafts only, as posted documents cannot be deleted |
| `post` | Posting: approving the document and creating its journal entry |

Special additional permissions: `reports.view` / `reports.export` / `reports.custom`; `settings.view` / `settings.edit` / `settings.users` / `settings.roles` / `settings.audit_log`; `ai.use` / `ai.settings`; and `core.view` / `core.edit`.

## The Six Roles

| Role | Description |
|---|---|
| `super_admin` (System Super Admin) | Holds every permission at all times without exception — granted automatically |
| `admin` (Administrator) | Every permission **except** `core.edit` |
| `manager` (General Manager) | Broad operational permissions without delete |
| `accountant` (Accountant) | Full accounting + view and edit for sales and purchases |
| `sales_rep` (Sales Representative) | Sales, POS, and CRM on their own documents only |
| `viewer` (Viewer) | View-only across all modules, with no create, edit, or export |

> A role is defined on the Roles page, and custom roles can be created with manually assigned permissions. System (built-in) roles are protected from editing but can be **cloned** to create a custom role starting from them. If no explicit permissions are assigned to a user, the system applies the default table for their role (shown below); manually assigned permissions apply when present, and the `*` symbol means all permissions.

## Module Matrix (Default Permissions per Role)

| Module | Permission | super_admin | admin | manager | accountant | sales_rep | viewer |
|---|---|---|---|---|---|---|---|
| **Core** | `core.view` | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| | `core.edit` | ✓ | — | — | — | — | — |
| **Accounting** | `accounting.view` | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| | `accounting.create` | ✓ | ✓ | ✓ | ✓ | — | — |
| | `accounting.edit` | ✓ | ✓ | ✓ | ✓ | — | — |
| | `accounting.delete` | ✓ | ✓ | — | — | — | — |
| | `accounting.post` | ✓ | ✓ | ✓ | ✓ | — | — |
| | `accounting.own` | ✓ | ✓ | — | — | — | — |
| **Inventory** | `inventory.view` | ✓ | ✓ | ✓ | ✓ | own | ✓ |
| | `inventory.create` | ✓ | ✓ | ✓ | — | — | — |
| | `inventory.edit` | ✓ | ✓ | ✓ | — | — | — |
| | `inventory.delete` | ✓ | ✓ | — | — | — | — |
| | `inventory.own` | ✓ | ✓ | — | — | ✓ | — |
| **Sales** | `sales.view` | ✓ | ✓ | ✓ | ✓ | own | ✓ |
| | `sales.create` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| | `sales.edit` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| | `sales.delete` | ✓ | ✓ | — | — | — | — |
| | `sales.post` | ✓ | ✓ | ✓ | — | — | — |
| | `sales.own` | ✓ | ✓ | — | — | ✓ | — |
| **POS** | `pos.view` | ✓ | ✓ | ✓ | — | own | ✓ |
| | `pos.create` | ✓ | ✓ | ✓ | — | ✓ | — |
| | `pos.edit` | ✓ | ✓ | ✓ | — | — | — |
| | `pos.delete` | ✓ | ✓ | — | — | — | — |
| | `pos.post` | ✓ | ✓ | ✓ | — | ✓ | — |
| | `pos.own` | ✓ | ✓ | — | — | ✓ | — |
| **Purchases** | `purchases.view` | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| | `purchases.create` | ✓ | ✓ | ✓ | ✓ | — | — |
| | `purchases.edit` | ✓ | ✓ | ✓ | ✓ | — | — |
| | `purchases.delete` | ✓ | ✓ | — | — | — | — |
| | `purchases.own` | ✓ | ✓ | — | — | — | — |
| **Manufacturing** | `manufacturing.view` | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| | `manufacturing.create` | ✓ | ✓ | ✓ | — | — | — |
| | `manufacturing.edit` | ✓ | ✓ | ✓ | — | — | — |
| | `manufacturing.delete` | ✓ | ✓ | — | — | — | — |
| | `manufacturing.post` | ✓ | ✓ | ✓ | — | — | — |
| | `manufacturing.own` | ✓ | ✓ | — | — | — | — |
| **Human Resources (HR)** | `hr.view` | ✓ | ✓ | — | — | — | — |
| | `hr.create` / `hr.edit` / `hr.delete` / `hr.own` | ✓ | ✓ | — | — | — | — |
| **CRM** | `crm.view` | ✓ | ✓ | — | — | own | — |
| | `crm.create` | ✓ | ✓ | — | — | ✓ | — |
| | `crm.edit` | ✓ | ✓ | — | — | ✓ | — |
| | `crm.delete` | ✓ | ✓ | — | — | — | — |
| | `crm.own` | ✓ | ✓ | — | — | ✓ | — |

## Reports, Settings & AI Assistant Permissions

| Permission | super_admin | admin | manager | accountant | sales_rep | viewer |
|---|---|---|---|---|---|---|
| `reports.view` — access to the Reports Hub and the dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reports.export` — Excel/PDF/HTML export | ✓ | ✓ | ✓ | ✓ | — | — |
| `reports.custom` — the Custom Report Builder | ✓ | ✓ | — | — | — | — |
| `settings.view` — view Settings | ✓ | ✓ | ✓ | — | — | — |
| `settings.edit` — edit Settings (VAT, branches, currencies...) | ✓ | ✓ | — | — | — | — |
| `settings.users` — manage users | ✓ | ✓ | — | — | — | — |
| `settings.roles` — manage roles | ✓ | ✓ | — | — | — | — |
| `settings.audit_log` — view the Audit Log | ✓ | ✓ | — | — | — | — |
| `ai.use` — use the "Maghz" AI Assistant | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `ai.settings` — configure the provider and key | ✓ | ✓ | — | — | — | — |

## The "Own Documents Only" Permission Explained

- The `module.own` permission means: this user sees **only their own documents** in the module, not all of the company's documents.
- The practical example: a sales rep holding `sales.own` — they open the invoices list and see only their own invoices; invoices created by their colleagues do not appear to them at all.
- The permission also applies to the AI assistant's tools: the rep cannot use "Maghz" to read or edit other people's invoices.
- The goal: reps and cashiers work on their own data without seeing other people's performance, while `manager` and above see everything.
- Note: the sales rep sees inventory items with `inventory.own` to look up prices and quantities, but cannot edit them.

## Other Important Rules

- **The sidebar adapts automatically**: modules where you hold no view or create permission disappear from the menu — the Viewer does not see the Settings menu, and the rep sees only Sales and CRM.
- **Buttons hide with the permission**: for example, the **New Invoice** button simply does not appear for someone without `sales.create` — it is not merely disabled.
- **Posting is a separate action**: owning `sales.edit` does not allow posting; the `post` permission is independent because posting a document creates an affecting journal entry.
- **Deletion is for drafts**: even holders of the `delete` permission cannot delete a posted document — correction is done with a return or a reversing entry.
- **The AI assistant key**: changing the provider key or disabling the assistant requires `ai.settings` — unavailable to the accountant and the rep.

## Tips

- Start by granting the default roles, then customize them — do not give `*` to anyone who does not need it.
- Review the permissions matrix quarterly and whenever staff change.
- Use cloning of a system role to create a custom role (for example, a "Purchases Accountant") instead of editing the original role.
- When in doubt about why an element appears or disappears for a user, first check: Settings ← Roles ← Permissions.
