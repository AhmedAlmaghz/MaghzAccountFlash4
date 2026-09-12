import type { ToolDefinition } from '../types';
import { coreApi } from '@/modules/core/api';
import {
  classifyDirection,
  directionBadge,
  mirrorToolFor,
  type DocDirection,
} from '../engine/docDirection';

/**
 * Document-direction tools (Package C).
 *
 * Before registering ANY document that came from a file/photo/message, the
 * model calls ai.classify_document with the extracted issuer identity.
 * The verdict decides the tool:
 * - same     → use the document's own tool (our invoice stays sales)
 * - external → use the MIRROR tool (their sales invoice = our purchase)
 * - ambiguous → ASK the user in text first; registering either way is banned
 *   (prompt rule 40). No silent flips, ever.
 */

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export interface ClassifyDocumentResult {
  direction: DocDirection;
  confidence: number;
  matchedOn: string[];
  reason: string;
  /** Tool to execute: own tool when same, mirror when external, null when ambiguous/unmapped. */
  mappedTool: string | null;
  /** Arabic badge line for the approval card / user question. */
  badge: string;
}

export const directionTools: ToolDefinition[] = [
  {
    name: 'ai.classify_document',
    labelAr: 'تصنيف اتجاه مستند',
    descriptionAr:
      'يصنّف مستنداً وارداً (من مرفق/صورة/نص) قبل تسجيله: قارن اسم المُصدِر المستخرج ورقمه الضريبي وهاتفه مع ملف الشركة. يعيد same (سجّل بأداة المستند نفسها) أو external (سجّل بالأداة المرآة المعادة) أو ambiguous — والغامض يعني: اسأل المستخدم نصاً أولاً، والتسجيل قبله ممنوع.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        docTool: { type: 'string', description: 'أداة المستند كما يبدو (مثل sales.create_invoice)' },
        issuerName: { type: 'string', description: 'اسم المُصدِر المستخرج من المستند (إن وجد)' },
        issuerNameEn: { type: 'string', description: 'اسم المُصدِر بالإنجليزية (إن وجد — يُطابق مع الاسم الإنجليزي للشركة)' },
        issuerTaxNumber: { type: 'string', description: 'الرقم الضريبي للمُصدِر (إن وجد)' },
        issuerPhone: { type: 'string', description: 'هاتف المُصدِر (إن وجد)' },
      },
      required: ['docTool'],
    },
    execute: async (args) => {
      const docTool = str(args.docTool);
      if (!docTool) return { error: 'docTool مطلوب — أداة المستند كما يبدو (مثل sales.create_invoice)' };
      const companyRes = await coreApi.getCompany();
      if (!companyRes.success || !companyRes.data) {
        return { error: companyRes.error || 'تعذّر قراءة ملف الشركة للمقارنة' };
      }
      const company = companyRes.data;
      const verdict = classifyDirection(
        {
          name: str(args.issuerName) ?? null,
          // P3 fix: was hardcoded null — an English issuer name on a document
          // could never hit the nameEn comparison path in bestNameScore.
          nameEn: str(args.issuerNameEn) ?? null,
          taxNumber: str(args.issuerTaxNumber) ?? null,
          phone: str(args.issuerPhone) ?? null,
        },
        {
          name: company.name,
          nameEn: company.nameEn ?? null,
          taxNumber: company.taxNumber ?? null,
          phone: company.phone ?? null,
        },
      );
      const mappedTool =
        verdict.direction === 'same'
          ? docTool
          : verdict.direction === 'external'
            ? mirrorToolFor(docTool)
            : null;
      const result: ClassifyDocumentResult = {
        direction: verdict.direction,
        confidence: Math.round(verdict.confidence * 100) / 100,
        matchedOn: verdict.matchedOn,
        reason: verdict.reason,
        mappedTool,
        badge: directionBadge(verdict, docTool, str(args.issuerName) ?? null),
      };
      return result;
    },
  },
];
