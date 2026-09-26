# دليل قوالب وتصاميم الإعلانات الجرافيكية (Design System & Creative Briefs)

## 1. موجهات الهوية البصرية للإعلانات (Visual Identity & Style Guide)

### لوحة الألوان المعتمدة (Color Palette):
* **اللون الزمردي الملكي الأساسي (Royal Emerald):** `#0B7A5E` (يرمز للأمان المالي، الثقة، الاتزان المؤسسي والاحترافية).
* **اللون الذهبي النبيل (Noble Gold Accent):** `#D4A017` (يرمز للربحية، القيمة العالية، والفخامة القيادية).
* **لون الفحم الداكن (Charcoal Dark):** `#1A1A2E` (لخلفيات الوضع الداكن الفاخرة والعناوين الجريئة).
* **الرمادي النقي الناعم (Pure Slate):** `#F8FAFC` (لخلفيات التصاميم الفاتحة والبطاقات المريحة للعين).
* **التدرجات المعتمدة (Brand Gradients):**
  - تدرج القيادة: من `#0B7A5E` إلى `#064E3B` بنسبة زاوية `135deg`.
  - تدرج الثراء والتميز: من `#D4A017` إلى `#B45309`.

### النمط البصري ونظام الطباعة (Typography & Art Direction):
* **الخط العربي:** Cairo بتنسيقات (Bold 700 / ExtraBold 800 للعناوين، و Regular 400 للنصوص الفرعية والأرقام المالية).
* **الخط اللاتيني:** Inter (للكلمات التقنية، النسب المئوية، والمصطلحات العالمية).
* **النمط الفني (Art Style):**
  - **Glassmorphism الحديث:** بطاقات زجاجية نصف شفافة (`backdrop-blur-md` مع حدود رقيقة ذهبية أو زمردية).
  - **3D Isometric Floating Elements:** رسوم ثلاثية الأبعاد خفيفة تحاكي شاشات التطبيق العائمة، الرسوم البيانية المتصاعدة، والعملات.
  - **Dark Mode Luxury:** إبراز هيبة النظام المحاسبي بواجهات داكنة مضيئة (Neon-glow) حول مؤشرات الأرباح والنمو.

---

## 2. النماذج الجرافيكية للتواصل الاجتماعي (Design Specifications)

### التصميم 1: «قوة الإدارة المالية الذكية» (LinkedIn & Meta Feed - 1080x1080)
* **المفهوم البصري:** لابتوب فائق الأناقة يعرض لوحة تحكم MaghzAccount Pro برسم بياني صاعد، وخلفية زمردية مظلمة بتدرج عميق مع دوائر نيون مشعة.
* **العناصر النصية (Typography Layout):**
  - **العنوان الرئيسي (Hero):** «المنظومة المالية التي تفكر معك» (خط Cairo 800 باللون الذهبي).
  - **العنوان الفرعي:** ERP محاسبي متكامل مدعوم بالذكاء الاصطناعي التنفيذي ومعايير IFRS.
  - **نقاط القوة (Bullet Badges):** 
    - ⚡ قيود مزدوجة آلية وصارمة.
    - 🔒 تشغيل 100% دون إنترنت.
    - 🤖 مساعد ذكي بأكثر من 250 أداة تنفيذية.
  - **زر الدعوة للإجراء (CTA Button):** «ابدأ تجربتك المجانية اليوم» (زر ذهبي مستطيل بحواف دائرية خفيفة).

---

### التصميم 2: «وداعاً لفوضى المستودعات ونقاط البيع» (Instagram Carousel Slide 1080x1350)
* **المفهوم البصري:** انقسام بصري شاعري (Split-Screen Design):
  - الجانب الأيسر: رمادي داكن وباهت يمثل الفوضى القديمة (فواتير متراكمة، آلة حاسبة، علامات استفهام حمراء).
  - الجانب الأيمن: زمردي مشرق مفعم بالحياة يعرض شاشة الكاشير POS الفائقة اللمس، مع باركود سداسي الأبعاد وتدفقات مخزون متوازنة.
* **النص الرئيسي:** «من فوضى الورق.. إلى دقة المستقبل بضغطة زر واحدة.»

---

### التصميم 3: «المساعد المحاسبي الأذكى في العالم العربي» (Story / Reel Cover 1080x1920)
* **المفهوم البصري:** نافذة محادثة ذكاء اصطناعي أنيقة وعصرية منبثقة من شاشة هاتف ذكي بتأثير زجاجي (Glassmorphic Window)، يعلوها رأس روبوت ناصع مضيء بلمسات ذهبية، مع كتابة نص باللغة العربية:
  - *"أهلاً بك.. تم إنشاء وترحيل فاتورة المبيعات رقم INV-0042 وتحديث تكلفة المخزون وقيد اليومية بنجاح."*
* **الختام البصري:** شعار التطبيق الملكي أسفل الشاشة مع وميض ذهبي خفيف وأيقونة تحميل.

---

## 3. أكواد تصاميم SVG جاهزة للتنفيذ والعرض المباشر

### كود SVG البوستر الإعلاني الرئيسي (Main Hero Ad Poster):
يمكن نسخ هذا الكود وحفظه بصيغة `.svg` لفتحه مباشرة في أي متصفح أو برنامج تصميم (Illustrator / Figma / Canva):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="100%" height="100%">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0B132B" />
      <stop offset="40%" stop-color="#0B3C35" />
      <stop offset="100%" stop-color="#041F1A" />
    </linearGradient>

    <!-- Gold Accent Gradient -->
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCEBA7" />
      <stop offset="50%" stop-color="#D4A017" />
      <stop offset="100%" stop-color="#9A7206" />
    </linearGradient>

    <!-- Emerald Glow Filter -->
    <filter id="emeraldGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="30" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Canvas Background -->
  <rect width="1080" height="1080" fill="url(#bgGrad)" />

  <!-- Abstract Luxury Grid Lines -->
  <g opacity="0.08" stroke="#D4A017" stroke-width="1.5">
    <line x1="0" y1="180" x2="1080" y2="180" />
    <line x1="0" y1="360" x2="1080" y2="360" />
    <line x1="0" y1="540" x2="1080" y2="540" />
    <line x1="0" y1="720" x2="1080" y2="720" />
    <line x1="0" y1="900" x2="1080" y2="900" />
    <line x1="180" y1="0" x2="180" y2="1080" />
    <line x1="360" y1="0" x2="360" y2="1080" />
    <line x1="540" y1="0" x2="540" y2="1080" />
    <line x1="720" y1="0" x2="720" y2="1080" />
    <line x1="900" y1="0" x2="900" y2="1080" />
  </g>

  <!-- Glowing Decorative Orbs -->
  <circle cx="920" cy="180" r="160" fill="#0B7A5E" opacity="0.45" filter="url(#emeraldGlow)" />
  <circle cx="150" cy="850" r="220" fill="#064E3B" opacity="0.6" filter="url(#emeraldGlow)" />
  <circle cx="850" cy="850" r="120" fill="#D4A017" opacity="0.15" filter="url(#emeraldGlow)" />

  <!-- Logo & Brand Header -->
  <g transform="translate(100, 100)">
    <rect width="64" height="64" rx="16" fill="url(#goldGrad)" />
    <path d="M 20 44 L 20 20 L 32 34 L 44 20 L 44 44" fill="none" stroke="#0B132B" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
    <text x="85" y="44" fill="#FFFFFF" font-family="Cairo, Segoe UI, sans-serif" font-size="34" font-weight="800">مـغـزى بـرو</text>
    <text x="260" y="44" fill="url(#goldGrad)" font-family="Inter, sans-serif" font-size="32" font-weight="700">MaghzAccount Pro</text>
  </g>

  <!-- Main Headline Banner -->
  <g transform="translate(100, 260)">
    <!-- Small Category Pill -->
    <rect width="280" height="42" rx="21" fill="#0B7A5E" opacity="0.4" stroke="#0B7A5E" stroke-width="1.5" />
    <text x="140" y="27" fill="#86EFAC" font-family="Cairo, sans-serif" font-size="18" font-weight="700" text-anchor="middle">الجيل الجديد من أنظمة الـ ERP</text>

    <!-- Hero Title -->
    <text x="0" y="110" fill="#FFFFFF" font-family="Cairo, sans-serif" font-size="64" font-weight="900">المنظومة المحاسبية التي</text>
    <text x="0" y="190" fill="url(#goldGrad)" font-family="Cairo, sans-serif" font-size="68" font-weight="900">تـفـكّـر وتـنـفّـذ مـعـك!</text>

    <!-- Subtitle -->
    <text x="0" y="250" fill="#CBD5E1" font-family="Cairo, sans-serif" font-size="24" font-weight="400">
      تحكم متكامل في القيود، المخازن، التصنيع، ونقاط البيع — مدعوم بأول وكيل ذكاء اصطناعي محاسبي عربي.
    </text>
  </g>

  <!-- Interactive Mockup Floating Dashboard (Glassmorphic Card) -->
  <g transform="translate(100, 580)">
    <!-- Card Base -->
    <rect width="880" height="340" rx="28" fill="#132328" fill-opacity="0.8" stroke="#1E3E3B" stroke-width="2" />
    
    <!-- Mini Header inside card -->
    <circle cx="40" cy="40" r="7" fill="#EF4444" />
    <circle cx="65" cy="40" r="7" fill="#F59E0B" />
    <circle cx="90" cy="40" r="7" fill="#10B981" />
    <text x="840" y="46" fill="#94A3B8" font-family="Cairo, sans-serif" font-size="16" text-anchor="end">لوحة التحكم التنفيذية والمؤشرات الحية</text>

    <!-- KPI Widget 1 -->
    <rect x="40" y="80" width="250" height="130" rx="18" fill="#0E2D2B" stroke="#0B7A5E" stroke-width="1" />
    <text x="65" y="120" fill="#94A3B8" font-family="Cairo, sans-serif" font-size="16">صافي المبيعات اليومية</text>
    <text x="65" y="165" fill="#FFFFFF" font-family="Inter, Cairo, sans-serif" font-size="28" font-weight="800">$128,450</text>
    <text x="65" y="195" fill="#10B981" font-family="Cairo, sans-serif" font-size="14" font-weight="700">▲ +18.4% نمو متصاعد</text>

    <!-- KPI Widget 2 -->
    <rect x="315" y="80" width="250" height="130" rx="18" fill="#0E2D2B" stroke="#0B7A5E" stroke-width="1" />
    <text x="340" y="120" fill="#94A3B8" font-family="Cairo, sans-serif" font-size="16">دقة توازن القيود IFRS</text>
    <text x="340" y="165" fill="url(#goldGrad)" font-family="Inter, Cairo, sans-serif" font-size="28" font-weight="800">100.00%</text>
    <text x="340" y="195" fill="#38BDF8" font-family="Cairo, sans-serif" font-size="14" font-weight="700">✓ متطابق دفترياً ونقدياً</text>

    <!-- KPI Widget 3: AI Assistant Bubble -->
    <rect x="590" y="80" width="250" height="130" rx="18" fill="#1A332E" stroke="#D4A017" stroke-width="1.5" />
    <text x="615" y="118" fill="#FCEBA7" font-family="Cairo, sans-serif" font-size="15" font-weight="700">مساعد "مـغـزى" الذكي ⚡</text>
    <text x="615" y="150" fill="#E2E8F0" font-family="Cairo, sans-serif" font-size="13">"تم إقفال الفترة الضريبية</text>
    <text x="615" y="172" fill="#E2E8F0" font-family="Cairo, sans-serif" font-size="13">وترحيل فروق الصرف بنجاح."</text>
    <circle cx="810" cy="185" r="5" fill="#10B981" />
    <text x="800" y="190" fill="#10B981" font-family="Cairo, sans-serif" font-size="12" text-anchor="end">جاهز للأمر التالي</text>

    <!-- Bottom Highlights inside Card -->
    <line x1="40" y1="240" x2="840" y2="240" stroke="#1E3E3B" stroke-width="1" />
    <text x="60" y="285" fill="#A7F3D0" font-family="Cairo, sans-serif" font-size="16" font-weight="700">🛡️ تشغيل كامل بدون إنترنت (Offline)</text>
    <text x="340" y="285" fill="#A7F3D0" font-family="Cairo, sans-serif" font-size="16" font-weight="700">📦 تعدد وحدات المخزون والتصنيع</text>
    <text x="620" y="285" fill="#A7F3D0" font-family="Cairo, sans-serif" font-size="16" font-weight="700">🧾 نقاط بيع هجينة فائقة السرعة</text>
  </g>

  <!-- CTA Banner Bottom -->
  <g transform="translate(100, 955)">
    <!-- Button Glow -->
    <rect width="360" height="68" rx="34" fill="url(#goldGrad)" filter="url(#emeraldGlow)" opacity="0.3" />
    <!-- Main Button -->
    <rect width="360" height="68" rx="34" fill="url(#goldGrad)" />
    <text x="180" y="43" fill="#0B132B" font-family="Cairo, sans-serif" font-size="24" font-weight="900" text-anchor="middle">احجز نسختك التجريبية الآن ➔</text>
    
    <!-- Trust Badge Right -->
    <text x="880" y="44" fill="#94A3B8" font-family="Cairo, sans-serif" font-size="18" text-anchor="end">
      متوافق مع الأنظمة الضريبية في: <tspan fill="#FFFFFF" font-weight="700">اليمن • السعودية • الإمارات • مصر</tspan>
    </text>
  </g>
</svg>
```
