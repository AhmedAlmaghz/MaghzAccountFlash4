import type { Skill } from './types';

/**
 * Theme designer skill — guides the agent through generating, customizing,
 * and managing UI themes. Themes live in the app store (zustand +
 * localStorage), NOT in the database: the settings.*_theme tools operate
 * on the store directly, so no company scoping is needed.
 */
export const themeDesignerSkill: Skill = {
  id: 'theme-designer',
  nameAr: 'مصمم الثيمات',
  descriptionAr: 'دليل توليد وإدارة ثيمات الواجهة: التشريح، أدوات settings.*_theme، وقواعد التصميم الآمن.',
  loadingMode: 'trigger',
  triggers: [
    'ثيم', 'ثيمات', 'مظهر', 'المظهر', 'سمة', 'سمات', 'ألوان الواجهة', 'ألوان',
    'لون', 'تصميم الواجهة', 'الوضع الليلي', 'الوضع الداكن', 'داكن', 'فاتح',
    'theme', 'themes', 'dark mode', 'darkmode', 'appearance', 'أزرق', 'أخضر',
  ],
  tags: ['settings', 'theme'],
  priority: 70,
  content: `## دليل مصمم الثيمات

### 1. تشريح الثيم (14 حقلاً)
- الهوية: nameAr + nameEn (مطلوبان عند الإنشاء اليدوي)، mode (light/dark)، font (cairo/inter/plex/system).
- الألوان التسعة: primary (الأساسي)، accent (التمييز)، background (الخلفية)، surface (البطاقات)، sidebarBg، headerBg، navText، navActive، navIcon.
- كلها hex (#rgb أو #rrggbb). الثيمات المدمجة (emerald-light / emerald-dark) محمية: لا تعديل ولا حذف.

### 2. خريطة الأدوات (كلها route: /settings/themes)
| الأداة | متى |
|---|---|
| settings.list_themes (قراءة) | أول خطوة دائماً — اعرف المعرفات والنشط قبل أي تعديل/تفعيل/حذف |
| settings.generate_theme (كتابة) | المسار المفضل: اسم/وضع/لون أساسي أو نمط جاهز (ocean/desert/forest/royal/sunset/rose) — يشتق الباقي ويُفعَّل |
| settings.create_theme (كتابة) | لوحة كاملة يدوية — الفارغ يُشتق من الأساسي |
| settings.update_theme (كتابة) | تعديل مخصص فقط — مرفوض على المدمج |
| settings.activate_theme (كتابة) | تفعيل مدمج أو مخصص (المعاينة = التفعيل، وكلها قابلة للعكس) |
| settings.delete_theme (كتابة) | حذف مخصص فقط — يتراجع تلقائياً لثيم مدمج |

### 3. قواعد التوليد الآمن
- اسأل عن الوضع (فاتح/داكن) واللون الأساسي فقط إن غابا؛ لا تسأل عن التسعة — اشتقها.
- تحقق من hex قبل الإرسال (الأداة ترفض غير الصالح برسالة عربية).
- بعد الإنشاء/التوليد اعرض: الاسم + الوضع + الأساسي + أنه مفعّل الآن.
- للحذف: أكّد أنه مخصص عبر list أولاً؛ الثيم النشط المحذوف يتراجع تلقائياً.
- لا تعد الثيمات مخزنة في قاعدة البيانات — هي تفضيل جهاز (localStorage) ولا تحتاج companyId.

### 4. أفضل ممارسات التصميم
- تباين النص ≥ 4.5:1 (الداكن: نصوص فاتحة على خلفيات عميقة، لا رمادياً على رمادي).
- accent متمم للـ primary (الأداة تدير hue+35° تلقائياً) — لا لونين متصارعين.
- الوضع الداكن ليس "فاتحاً معكوساً": خلفية charcoal عميقة (#1A1A2E) وسطح أفتح بدرجة.
- الخط الافتراضي cairo للعربية؛ inter للمحتوى اللاتيني الكثيف.`,
  examples: [
    {
      user: 'اجعل الواجهة داكنة بلون أزرق',
      assistant: 'سأستدعي settings.generate_theme بالوضع dark والأساسي #0E7490 ثم أعرض النتيجة المفعّلة.',
    },
    {
      user: 'ما الثيمات المتاحة؟',
      assistant: 'سأستدعي settings.list_themes لعرض المدمجة والمخصصة مع تمييز النشط.',
    },
  ],
};
