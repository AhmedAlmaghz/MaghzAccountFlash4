# MaghzAccountPro — User Documentation / توثيق المستخدم

> Official user guide for **MaghzAccountPro** — an integrated ERP accounting system for SMEs.
> الدليل الرسمي لنظام **MaghzAccountPro** — نظام ERP محاسبي متكامل للمنشآت الصغيرة والمتوسطة.

| Language / اللغة | Guide / الدليل |
|---|---|
| 🇬🇧 **English** | [en/README.md](./en/README.md) |
| 🇸🇦 **العربية** | [ar/README.md](./ar/README.md) |

Both guides mirror the same 17 sections + appendices, with 80 app screenshots in each language folder (`en/assets/`, `ar/assets/`).

كلا الدليلين يغطي نفس الأقسام الـ17 + الملحقات، مع 80 لقطة شاشة في مجلد اللغة (`en/assets/`، `ar/assets/`).

---

## Structure / البنية

```
Docs/
├── README.md          ← this landing page / هذه الصفحة
├── ar/                ← Arabic guide (source) / الدليل العربي (المصدر)
│   ├── CONVENTIONS.md
│   ├── README.md
│   ├── 01-introduction … 17-tax-jurisdictions, Examples/, 99-appendix
│   └── assets/        ← 80 screenshots
└── en/                ← English guide / الدليل الإنجليزي
    ├── CONVENTIONS.md
    ├── README.md
    ├── 01-introduction … 17-tax-jurisdictions, Examples/, 99-appendix
    └── assets/        ← 80 screenshots
```

## Maintenance rule / قاعدة الصيانة

Any feature change must be reflected in **both** guides (`ar/` first, then `en/`), keeping the section structure, image paths, and terminology tables of each guide's `CONVENTIONS.md` in sync.
أي تغيير في الميزات يجب أن ينعكس على **الدليلين** (العربي أولاً ثم الإنجليزي)، مع الحفاظ على تطابق البنية ومسارات الصور وجدولي المصطلحات في `CONVENTIONS.md` لكل دليل.

## Version history / سجل الإصدارات

See [CHANGELOG.md](./CHANGELOG.md) — guide version always matches `package.json` (`version`).
راجع [CHANGELOG.md](./CHANGELOG.md) — رقم الدليل يطابق `package.json` دائماً.
