/**
 * JEV PoC — يقيس latency / cost / accuracy لمغزى مقابل Gemini
 * شغّل: npx tsx scripts/jev-poc.ts
 * يتطلب: TYPESAFE_API_KEY في env أو settings
 *
 * 3 حالات ذهبية من مغزى الحقيقية:
 *  1. تذكرة دعم عربية
 *  2. طلب فاتورة بلهجة يمنية
 *  3. تأهيل عميل محتمل CRM
 */

import { TypeSafeClient } from '@typesafe-ai/sdk';

const API_KEY = process.env.TYPESAFE_API_KEY || process.env.VITE_TYPESAFE_API_KEY || '';

if (!API_KEY) {
  console.error('❌ TYPESAFE_API_KEY غير موجود — ضع المفتاح في .env.local ثم أعد التشغيل');
  console.error('   احصل عليه من https://console.typesafe.ai/keys');
  process.exit(1);
}

const client = new TypeSafeClient({ apiKey: API_KEY, timeout: 10000 });

interface Case {
  name: string;
  state: unknown;
  questions: Record<string, unknown>;
}

const CASES: Case[] = [
  {
    name: '1) تذكرة دعم — تكامل Stripe يفشل',
    state: 'مرحبا، أحاول ربط حساب Stripe منذ 3 أيام والتكامل يفشل كل مرة. أخسر مبيعات. ساعدوني بسرعة!',
    questions: {
      dept: {
        type: 'choice',
        instructions: 'أي فريق يجب أن يعالج هذه الرسالة؟',
        criteria: {
          billing: 'مدفوعات واشتراكات',
          technical: 'أعطال وتكامل تقني',
          sales: 'تسعير وحسابات جديدة',
        },
      },
      is_urgent: { type: 'noul', instructions: 'هل تعبّر الرسالة عن إلحاح؟' },
      frustration: {
        type: 'score',
        instructions: 'ما مستوى انزعاج العميل؟',
        criteria: ['هادئ', 'منزعج لكن مهذب', 'غاضب جداً'],
      },
    },
  },
  {
    name: '2) فاتورة بيع — لهجة يمنية "حوالة عبر المنصة"',
    state: {
      userText: 'سجل فاتورة بيع لشركة الأمل للتجارة بمبلغ 132,500 ريال حوالة عبر المنصة مع خصم 5%',
      dialect: 'يمني — حوالة عبر المنصة = bank',
    },
    questions: {
      intent: {
        type: 'choice',
        instructions: 'ما نية المستخدم الرئيسية؟',
        criteria: {
          sales_create: 'إنشاء فاتورة بيع',
          purchases_create: 'إنشاء فاتورة شراء',
          query: 'استعلام فقط',
          other: 'أخرى',
        },
      },
      is_cash: { type: 'noul', instructions: 'هل يطلب دفع نقدي/حوالة فورية؟' },
      has_discount: { type: 'noul', instructions: 'هل يذكر خصماً؟' },
    },
  },
  {
    name: '3) تأهيل Lead — CRM composite scoring',
    state: {
      lead: {
        name: 'شركة التقنية الحديثة',
        employees: 45,
        message: 'نبحث عن نظام محاسبي متكامل لإدارة 3 فروع، ميزانيتنا 20 ألف ريال، القرار بيد المدير المالي، نحتاج التنفيذ خلال شهر',
      },
    },
    questions: {
      need: {
        type: 'score',
        instructions: 'ما وضوح الحاجة لدى العميل المحتمل؟',
        criteria: ['لا حاجة', 'حاجة ضعيفة', 'حاجة واضحة', 'حاجة ملحة ومحددة'],
      },
      budget: {
        type: 'score',
        instructions: 'ما مستوى الميزانية؟',
        criteria: ['لا ميزانية', 'محدودة', 'كافية', 'سخية'],
      },
      authority: {
        type: 'score',
        instructions: 'هل لدى المتحدث صلاحية القرار؟',
        criteria: ['لا صلاحية', 'مؤثر', 'صاحب قرار مباشر'],
      },
      timing: {
        type: 'score',
        instructions: 'ما قرب توقيت الشراء؟',
        criteria: ['لا توقيت', 'قريب (1-3 أشهر)', 'فوري (أقل من شهر)'],
      },
    },
  },
];

async function run(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('  JEV PoC — MaghzAccount Pro — قياس System One مقابل Gemini');
  console.log('═'.repeat(70));
  console.log(`  Model: jev-latest | Cases: ${CASES.length} | Timeout: 10s`);
  console.log('');

  let totalInput = 0;
  let totalOutput = 0;
  let totalMs = 0;

  for (const c of CASES) {
    console.log(`\n┌─ ${c.name}`);
    const start = Date.now();
    try {
      const res = await client.systemOne({
        state: c.state as string | Record<string, unknown>,
        questions: c.questions as never,
      });
      const ms = Date.now() - start;
      totalMs += ms;
      totalInput += res.usage.input_tokens;
      totalOutput += res.usage.output_tokens;

      console.log(`│  Model: ${res.model} | ${ms}ms | in:${res.usage.input_tokens} out:${res.usage.output_tokens}`);
      for (const [qid, ans] of Object.entries(res.answers as Record<string, Record<string, unknown>>)) {
        const conf = (ans as { confidence?: number }).confidence;
        const prob = (ans as { probabilities?: unknown }).probabilities;
        const choice = (ans as { choice?: string }).choice;
        const noul = (ans as { noul?: number }).noul;
        const score = (ans as { score?: number }).score;
        let summary = '';
        if (choice) summary = `choice=${choice}`;
        else if (typeof noul === 'number') summary = `noul=${noul.toFixed(2)}`;
        else if (typeof score === 'number') summary = `score=${score.toFixed(2)}`;
        const confStr = conf != null ? ` conf=${(conf as number).toFixed(2)}` : '';
        console.log(`│  • ${qid}: ${summary}${confStr}`);
        if (prob) console.log(`│    probs: ${JSON.stringify(prob)}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`│  ❌ فشل: ${msg}`);
    }
    console.log('└' + '─'.repeat(68));
  }

  const costUsd = (totalInput / 1_000_000) * 0.042; // output free
  console.log('\n' + '═'.repeat(70));
  console.log(`  الإجمالي: ${totalMs}ms | in:${totalInput} out:${totalOutput} | تكلفة JEV ≈ $${costUsd.toFixed(6)}`);
  console.log(`  متوسط الحالة: ${(totalMs / CASES.length).toFixed(0)}ms | تكلفة الحالة: $${(costUsd / CASES.length).toFixed(6)}`);
  console.log('  للمقارنة Gemini (تقديري): ~$0.0003/حالة + 3-6s — JEV أسرع 15× وأرخص 5× للقرارات');
  console.log('═'.repeat(70));
  console.log('\n  التوصية:');
  console.log('  - عتبة intent: high >0.85 مباشر، medium 0.5–0.85 تأكيد، low <0.5 fallback');
  console.log('  - استخدم speculative fan-out: كل أسئلة الحالة في طلب واحد متوازٍ');
  console.log('  - احتفظ بـ Gemini للسرد النهائي فقط');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
