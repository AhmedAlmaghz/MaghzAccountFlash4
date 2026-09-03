# 🎨 برومبتات الذكاء الاصطناعي لتوليد المواد الإعلانية

> مكتبة برومبتات جاهزة — صور وفيديوهات لكل مادة تسويقية

---

## 📐 دليل الاستخدام

### الأدوات المستهدفة

| النوع | الأدوات الموصى بها |
|---|---|
| **الصور** | Midjourney v7، DALL-E 3، Ideogram 3، Google Imagen/Nano Banana، Flux |
| **الفيديو** | Google Veo 3.1، OpenAI Sora 2، Kling 2.5، Runway Gen-4، Hailuo/MiniMax |
| **الشعارات/النص داخل الصورة** | Ideogram 3 (الأفضل نصياً) — **للنصوص العربية**: ولّد بالإنجليزية وأضف العربية لاحقاً بـ Figma/Canva (الأدوات لا تزال ضعيفة بالعربية المكتوبة) |

### ⚠️ القواعد الذهبية قبل التوليد

1. **النص العربي المولد غالباً مشوه** — ولّد المشهد فارغاً وأضف النص بنفسك (Canva/Figma)
2. **نسبة الأبعاد حسب المنصة** — منصات الصورة تدعم `--ar 16:9` (يوتيوب) / `--ar 9:16` (ريلز/تيك توك) / `--ar 1:1` (بوست)
3. **الاتساق البصري**: استخدم نفس "seed" أو نفس وصف النمط في كل المواد — الهوية تتكرر
4. **الحقوق**: تحقق من ترخيص المنصة للاستخدام التجاري قبل النشر
5. **الأفضل دائماً**: المواد الحية من شاشة النظام (تسجيلات) — الصور المولدة للمشاهد المفهومية والحملات فقط

### 🎨 لوحة الهوية البصرية (الصقها في كل برومبت)

```
Visual Identity:
- Palette: deep emerald green (#0B7A5E) + warm gold accents (#D4A017) + clean white + dark charcoal (#1A1A2E)
- Mood: trustworthy, modern-Arabic, premium but warm, tech-forward
- Typography space: always leave clean area for Arabic text overlay (RTL)
- Style: cinematic lighting, photorealistic, shallow depth of field
```

**استخدم هذا كـ "بادئة ثابتة" (prefix) قبل كل برومبت أدناه لضمان الاتساق.**

---

# 🖼️ PART 1 — برومبتات الصور (Image Prompts)

## A. البطل الرئيسي — Hero Shots

### A1. الغلاف الرئيسي للعلامة

```
[البادئة الثابتة]

A cinematic hero shot of a modern Arab businessman in his 30s, wearing a smart
casual outfit, sitting confidently at a sleek wooden desk in a warm, modern
office. He speaks toward his laptop screen with a relaxed, empowered smile —
as if talking to an intelligent assistant. On the screen: a beautiful Arabic
accounting dashboard glowing softly with emerald and gold interface elements
(blurred, non-readable UI). Golden light particles flow FROM his mouth INTO
the screen, symbolizing words becoming numbers. Floating translucent UI cards
around the screen showing: a checkmark approval card, a balanced scale icon,
a bar chart rising. Dark charcoal background with subtle Arabic geometric
patterns (islamic art style) faintly embossed on walls.

--ar 16:9 --style raw --v 7
```

**الاستخدام:** غلاف الموقع، إعلان فيسبوك رئيسي، thumbnail يوتيوب
**أضف لاحقاً بالعربية:** «تكلم… وهو يفهم»

---

### A2. فكرة «تحديّث لدفاترك»

```
[البادئة الثابتة]

Split-composition metaphor: LEFT side — an old leather accounting ledger book,
dusty, with a vintage calculator, in warm sepia tones, slightly desaturated.
RIGHT side — a sleek floating holographic interface emerging from the same
book, transforming it: glowing emerald 3D charts, golden balanced scales,
floating invoice cards with checkmarks, a subtle AI spark connecting both
worlds. The transformation happens mid-frame with elegant particle dissolve.
Clean emerald-to-charcoal gradient background.

--ar 16:9 --v 7
```

**الاستخدام:** حملة «قبل/بعد»، بوستات LinkedIn، بانر الموقع

---

## B. سلسلة المزايا (Feature Cards) — 6 صور

> كل بطاقة: نفس التكوين، يتغير العنصر المركزي — استخدم نفس seed للاتساق

```
[البادئة الثابتة — نفس الـ seed]

Minimal premium product-shot style: a single glowing 3D icon floating centered
over a dark charcoal-to-emerald gradient background with soft Arabic geometric
grid pattern. The icon is made of emerald glass and gold light. Below it,
a clean empty banner space for Arabic text.

Central icon: [استبدل حسب البطاقة]
```

| # | العنصر المركزي (بالإنجليزية داخل البرومبت) | الميزة (أضفها نصياً لاحقاً) |
|---|---|---|
| B1 | `a golden shield with a checkmark inside, protected by a glowing circle` | «لا كتابة إلا بموافقتك» |
| B2 | `a perfectly balanced golden scale, one side showing a dollar coin, other side showing an invoice card` | «قيد مزدوج متوازن دائماً» |
| B3 | `a golden speech bubble transforming into flowing numbers and charts` | «تكلم بالعربي… يفهم» |
| B4 | `a 3D factory: raw materials entering one side, finished product box exiting the other, connected by glowing cost arrows` | «تكلفة إنتاجك الحقيقية» |
| B5 | `a glowing hourglass, sand turning into gold coins` | «٥ دقائق للجاهزية» |
| B6 | `a crescent moon and a calendar merging with bar charts` | «هجري وميلادي — معاً» |

**الاستخدام:** كاروسيل إنستغرام، سلسلة X، إعلانات مثبتة

---

## C. صور السوشيال ميديا المخصصة

### C1. ريلز/تيك توك خلفية (9:16)

```
[البادئة الثابتة]

Vertical 9:16 mobile-first scene: A close-up of hands holding a smartphone in
portrait mode, screen showing a glowing emerald Arabic chat interface with an
AI assistant (speech bubbles visible, text non-readable), a golden checkmark
approval card popping up with satisfying animation feel. Background: blurred
cozy Arab retail store interior — shelves with products, warm lighting.
Top third of frame: clean space for a bold Arabic hook title.

--ar 9:16 --v 7
```

### C2. ميم/موقف كوميدي (نمادج «المحاسب القديم ضد الجديد»)

```
[البادئة الثابتة]

Humorous editorial illustration style: a tired Arab accountant surrounded by
mountains of paper invoices at midnight, red-eyed, coffee cups everywhere —
while his colleague across the table leans back relaxed, speaking casually
to a laptop that floats completed reports with green checkmarks toward him.
Exaggerated comic expressions, warm colors, Storytelling magazine-illustration
style. Empty top area for Arabic caption.

--ar 1:1 --v 7
```

**السرد المقترح فوقها:** «نفس الشغل… مو نفس الليلة 😅»

### C3. صورة «الأمان» لجمهور B2B

```
[البادئة الثابتة]

Corporate trust visual: An elegant boardroom table seen from above. On one
side, a small glowing golden robot chess-piece (the AI) — facing a human hand
poised over a large, prominent emerald APPROVE button. The composition makes
clear: the human hand is ABOVE, always in control. Subtle contract documents
on the table, warm professional lighting. A thin golden line connects robot
to button, but only the hand can press it.

--ar 16:9 --v 7
```

**النص المقترح:** «الذكاء يجهّز… وأنت توافق»

### C4. صورة الضمان للمحاسبين (شخصية عبدالله)

```
[البادئة الثابتة]

A dramatic close-up: an AI assistant hologram presenting a beautifully
balanced accounting entry (debit = credit) on a glowing holographic screen,
with a golden "VERIFIED BALANCED" seal of approval stamping itself onto it.
Around the screen: a protective emerald force field with subtle lock icons —
symbolizing tamper-proof integrity. Photorealistic, macro lens feel.

--ar 1:1 --v 7
```

---

## D. صور الأسواق والجمهور

### D1. التاجر اليمني/الخليجي (شخصية يوسف)

```
[البادئة الثابتة]

Warm authentic lifestyle photo: A friendly Arab shopkeeper in his 40s with a
light beard wearing a traditional thobe, standing proudly at the counter of
his small grocery store. Behind him: neatly stocked shelves. On the counter:
a tablet showing a glowing emerald dashboard with a rising green profit line.
He looks at the tablet with a satisfied knowing smile. Morning sunlight
streaming through the storefront window. Realistic, documentary photography
style, warm tones.

--ar 4:5 --v 7
```

### D2. المصنع الصغير (شخصية سالم)

```
[البادئة الثابتة]

Industrial documentary style: A small Arab workshop owner in his 30s wearing
a safety vest, standing beside a CNC machine, holding a tablet glowing with
a production dashboard: a BOM tree diagram, a work order card with progress
bar, and a cost report showing profit margin. Workshop in soft background
blur, warm sparks from a distant machine, teal-and-orange cinematic grade.

--ar 4:5 --v 7
```

### D3. سلسلة الأرصدة الافتتاحية

```
[البادئة الثابتة]

Conceptual finance art: A long golden ledger ribbon flowing horizontally
across the frame — its LEFT end emerging from a vintage bank vault door
(the past/opening balance), passing through present-day floating chart
cards, and arriving at a modern dashboard summary on the RIGHT (today).
No break in the ribbon — continuous flow. White marble floor with subtle
green reflections. Fine art photography composition.

--ar 16:9 --v 7
```

---

# 🎬 PART 2 — برومبتات الفيديو (Video Prompts)

## E. الإعلانات القصيرة (15-30 ثانية) — لـ Veo/Sora/Kling

### E1. الإعلان الرئيسي: «تكلم فيفهم» ⭐

> **الهدف:** الحدث الإطلاقي، تيك توك، يوتيوب bumpers

```
[النمط البصري الثابت]

Duration: 15 seconds | Aspect: 9:16 vertical

SHOT 1 (0-3s): Close-up of a young Arab store owner speaking casually
toward camera phone: "سجل فاتورة مبيعات" (subtitles burned in later).

SHOT 2 (3-8s): Cut to phone screen: a beautiful emerald Arabic AI chat
interface — the typed message appears, then three glowing tool cards execute
in sequence: search (customer found), calculate (numbers animating), approve
card slides in with total amount and a big green APPROVE button. Satisfying
UI animation, micro-interactions, soft clicks.

SHOT 3 (8-12s): Finger taps APPROVE. A satisfying ripple effect — then a
real accounting voucher materializes with a golden checkmark stamp "مرحّلة".

SHOT 4 (12-15s): The owner smiles, pockets his phone, tends to a customer.
Text space at top for the logo + tagline.

Mood: fast, satisfying, trustworthy. UI glows in emerald/gold. Camera: smooth
orbital shot on the phone, then locked wide. Sound design placeholder (add
later): soft clicks + one deep confirmation thud.
```

**ملاحظة إنتاجية:** شاشة الواجهة سجّلها من النظام الحقيقي وادمجها — الفيديو المولد للمشاهد المحيطة.

---

### E2. إعلان الأمان: «حارس الدفاتر» ⭐

> **الهدف:** إقناع المحاسبين والشركات (شخصيتا عبدالله وفاطمة)

```
[النمط البصري الثابت]

Duration: 30 seconds | Aspect: 16:9

A tense, cinematic scene: An AI assistant hologram (friendly but confident)
finishes drafting a large invoice card and pushes it toward the viewer —
it hovers, pulsing amber, waiting. A human hand enters frame and hovers
over the APPROVE button, hesitates for dramatic beat.

Then split-second sequence: the system displays what would have been
auto-executed WITHOUT this protection (chaotic red numbers flying) vs WITH
protection (calm, orderly, controlled golden flow).

Final frame: the hand presses APPROVE, everything locks into place with a
satisfying THUD and golden seal. Superseded text space: "ذكاء… ما يوقّع
عنك".

Mood: trustworthy, slightly dramatic, resolving into calm confidence.
Lighting: amber-to-emerald transition. Style: premium fintech commercial.
```

---

### E3. إعلان «٥ دقائق» (شخصية أحمد الناشئ)

```
[النمط البصري الثابت]

Duration: 20 seconds | Aspect: 9:16

A stop-motion-style speed montage: A fresh laptop boots up. A giant golden
stopwatch appears in the corner (starts: 5:00). Rapid satisfying sequence:
installer progress bar completes → language selection (Arabic) → company
name typed → currency (YER) → a checkmark cascade fires like dominoes:
accounts tree populates (nodes appearing), warehouses, first dashboard loads.
The stopwatch stops at 4:47. A hand does a small celebratory fist pump.
Text space: «من التحميل… لدفاترك».

Mood: energetic, satisfying ASMR-like pace, upbeat.
```

---

### E4. إعلان التصنيع (شخصية سالم)

```
[النمط البصري الثابت]

Duration: 25 seconds | Aspect: 16:9

Cinematic industrial film: A small Arab workshop at golden hour. Macro shots
intercut: (1) A BOM recipe card glowing — raw materials listed as ingredients,
(2) a work order card transforms into real action: raw material pellets leave
shelves as glowing particles into a machine, (3) finished product emerges —
each unit stamped with a tiny golden cost tag that reads in animation
"التكلفة الحقيقية", (4) final shot: owner reviewing a profit report on
tablet, margin line climbing green.

Mood: craftsmanship meets technology, warm sparks + emerald UI glows.
Music placeholder: inspiring building percussion.
```

---

### E5. فيديو أعمار الذمم (شخصيات يوسف وفاطمة)

```
[النمط البصري الثابت]

Duration: 20 seconds | Aspect: 9:16

Visual metaphor video: A wall of small golden coins arranged in 4 glass
columns. Camera orbits slowly. Coins begin glowing by age: freshest column
green, then amber, then orange, then the oldest column deep red — with a
small counter above each column ticking up. A hand sweeps away the red
column (collected!) with satisfying motion, counter drops. Tagline space:
«اعرف وين واقفه فلوسك… بالثانية».

Mood: satisfying, wealth-clarity, smooth mechanical motion.
```

---

## F. فيديوهات الخلفيات الحية (للنص فوقها)

### F1. خلفية لافتة الموقع (Loop 10 ثوانٍ)

```
Seamless loop: Slow cinematic dolly through a dark elegant 3D space with
floating translucent emerald UI panels (charts, invoice cards, balanced
scales) arranged like a gallery, gold light particles drifting. No text
anywhere. Subtle depth of field. Calm, premium, 60fps feel.

--ar 16:9 --loop
```

### F2. خلفية نهاية الفيديوهات (Outro)

```
Seamless loop: A single golden balanced scale slowly rotating in emerald
mist with soft bokeh particles, center-right composition leaving left
space for logo lockup. Elegant, minimal.

--ar 16:9 --loop
```

---

## G. برومبتات تحريرية متقدمة (Image-to-Video)

> خذ لقطة شاشة حقيقية من النظام وحرّكها:

### G1. تحريك بطاقة الموافقة

```
Animate this UI screenshot: The approval card gently pulses with amber glow,
the total amount counter rolls up from 0 to its value with satisfying easing,
then the green APPROVE button gets pressed by a realistic finger entering the
frame — card collapses into a golden checkmark burst. Keep all UI text
exactly as-is. 5 seconds, smooth 60fps, subtle camera drift.
```

### G2. تحريك لوحة التحكم

```
Animate this dashboard screenshot: Charts grow organically from baseline,
KPI numbers count up, the map dots pulse. Gentle camera push-in. All Arabic
text preserved pixel-perfect. 8 seconds, premium fintech feel.
```

---

## H. مواصفات النصوص العربية فوق المواد

بما أن النص العربي المولد غير موثوق، اعتمد هذا التدفق:

1. **ولّد** المشهد بلا نص (كما في البرومبتات أعلاه — كلها تتضمن `text space`)
2. **أضف النص** بـ Canva/Figma بخط **Cairo** (هوية المنتج) أو **Tajawal**
3. **ألوان النص:** أبيض فوق الداكن / فحمي فوق الفاتح / ذهبي للتمييز
4. **اجعل زر CTA دائماً:** «حمّله مجاناً» — أخضر زمردي

---

## I. قائمة فحص ما قبل النشر ✅

- [ ] النص العربي المضاف سليم إملائياً (قراءة ثانية!)
- [ ] الاتساق اللوني (زمردي/ذهبي/فحمي)
- [ ] نسبة الأبعاد صحيحة للمنصة
- [ ] مكان واضح للـ CTA
- [ ] الأرقام المذكورة مطابقة للحقيقة (5 دقائق، 58 جدول…)
- [ ] بلا ادعاءات مبالغة — «بطاقة موافقة قبل كل كتابة» صحيحة، «لا يخطئ أبداً» ممنوعة
- [ ] التحقق من ترخيص أداة التوليد للاستخدام التجاري

---

## J. بنك أفكار إضافي (برومبتات مستقبلية)

| الفكرة | نوعها |
|---|---|
| «ليلة نهاية الشهر قبل وبعد» — فيديو مقارنة درامي | فيديو 30 ثانية |
| سلسلة «مصطلح محاسبي بأقل من دقيقة» — أنيميشن رمزي لكل مصطلح | 10 صور متحركة |
| «الخزينة الموحدة» — عملات ذهبية تتدفق في خزائن زجاجية مختلفة | صورة مفهومية |
| «انترنت مقطوع؟ عادي» — صحراء + خيمة + لابتوب يعمل (Ollama محلي) | صورة + ريلز |
| «حارس الهلوسة» — روبوت يمسك روبوتاً آخر يكذب | فيديو 15 ثانية |
| الافتتاحيات في كل مكان — شريط ذهبي يمر بكل التقارير | فيديو 20 ثانية |

---

- العودة إلى **[فهرس التسويق](README.md)**
