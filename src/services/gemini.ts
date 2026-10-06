// Gemini AI Service (Feature 1 - Financial Chatbot & Feature 4 - Slip OCR)
import { SummaryData, Trip, Investment } from '../types';
import { InvestmentPortfolioSummary } from '../db/investments';

export interface SlipOCRResult {
  is_slip: boolean;
  slip_type?: 'transfer' | 'dime';
  amount?: number;
  type?: 'expense' | 'income';
  category?: string;
  date?: string;
  time?: string;
  recipient?: string;
  sender?: string;
  bank?: string;
  note?: string;
  raw_text?: string;
  // Dime! specific investment fields:
  asset_name?: string;
  ticker?: string;
  shares?: number;
  price_per_share?: number;
  currency?: string;
}

const DEFAULT_CANDIDATE_MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'];

/**
 * Auto-detect available Gemini models supporting generateContent from Google API.
 * Falls back to DEFAULT_CANDIDATE_MODELS if fetch fails or no matching model found.
 */
async function getAvailableGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(listUrl, { method: 'GET' });
    if (res.ok) {
      const data = (await res.json()) as {
        models?: Array<{
          name?: string;
          supportedGenerationMethods?: string[];
        }>;
      };

      if (data.models && Array.isArray(data.models)) {
        // Filter models that support generateContent and contain 'flash' or 'pro'
        const matched = data.models
          .filter((m) => {
            const supports = (m.supportedGenerationMethods || []).includes('generateContent');
            const cleanName = (m.name || '').replace(/^models\//, '').toLowerCase();
            return supports && (cleanName.includes('flash') || cleanName.includes('pro'));
          })
          .map((m) => (m.name || '').replace(/^models\//, ''));

        if (matched.length > 0) {
          // Merge matched models with default candidates (deduped, matched models first)
          return Array.from(new Set([...matched, ...DEFAULT_CANDIDATE_MODELS]));
        }
      }
    }
  } catch (err: unknown) {
    console.warn('Failed to auto-detect Gemini models, falling back to defaults:', err);
  }

  return DEFAULT_CANDIDATE_MODELS;
}

export async function askGeminiFinancialAdvisor(
  apiKey: string,
  userMessage: string,
  history: Array<{ role: 'user' | 'model'; content: string }>,
  financialContext: {
    summary: SummaryData;
    investments?: InvestmentPortfolioSummary;
    trips?: Trip[];
    recentTransactions?: Array<{ type: string; category: string; amount: number; transaction_date: string; note: string | null }>;
  }
): Promise<string> {
  const { summary, investments, trips, recentTransactions } = financialContext;

  const contextData = {
    total_income: summary.total_income,
    total_expense: summary.total_expense,
    general_expense: summary.general_expense,
    total_savings_invest: summary.total_savings_invest,
    net_savings: summary.balance,
    net_worth: summary.net_worth,
    category_expense_breakdown: summary.category_breakdown.expense,
    category_income_breakdown: summary.category_breakdown.income,
    recent_transactions: (recentTransactions || []).slice(0, 10),
    investment_portfolio: investments
      ? {
          total_principal: investments.total_principal,
          total_current_value: investments.total_current_value,
          total_profit_loss: investments.total_profit_loss,
          total_profit_loss_pct: investments.total_profit_loss_pct,
          by_institution: investments.by_institution,
          by_asset_type: investments.by_asset_type,
          items: investments.investments.map((i) => ({
            name: i.name,
            institution: i.institution,
            asset_type: i.asset_type,
            principal: i.principal,
            current_value: i.current_value,
            profit_loss: i.profit_loss,
          })),
        }
      : null,
    active_trips: (trips || []).filter((t) => t.status === 'active').map((t) => ({
      name: t.name,
      destination: t.destination,
      budget: t.budget,
      total_spent: t.total_spent,
      remaining: t.remaining_budget,
    })),
  };

  const systemInstruction = `
คุณคือ "MoneySense AI" ผู้เชี่ยวชาญและที่ปรึกษาทางการเงินส่วนบุคคลประจำระบบ ExpenseTracker Pro
คุณมีบุคลิกที่เป็นมิตร สุภาพ เชี่ยวชาญ ให้กำลังใจ และตอบคำถามเป็นภาษาไทยอย่างชัดเจนและมีโครงสร้างสวยงาม (ใช้ Markdown หัวข้อ ข้อย่อย และตารางหากเหมาะสม)

เป้าหมายของคุณคือ:
1. วิเคราะห์สุขภาพทางการเงิน พฤติกรรมการใช้จ่าย อัตราการออม และความเสี่ยง
2. ให้คำแนะนำเรื่องการออมเงิน การตั้งงบประมาณ (เช่น กฎ 50/30/20, กองทุนฉุกเฉิน 3-6 เดือน)
3. ให้คำแนะนำเรื่องการจัดพอร์ตการลงทุน (Asset Allocation) เช่น หุ้นไทย, หุ้นต่างประเทศ (Dime), กองทุนรวม, เงินฝากดอกเบี้ยสูง
4. แนะนำการควบคุมค่าใช้จ่ายในการท่องเที่ยว (Trip budget)
5. อ้างอิงข้อมูลตัวเลขจริงของผู้ใช้ด้านล่างในการตอบเสมอ เพื่อให้คำแนะนำเฉพาะบุคคลอย่างแม่นยำ

ข้อมูลทางการเงินล่าสุดของผู้ใช้ในระบบ D1 Database:
\`\`\`json
${JSON.stringify(contextData, null, 2)}
\`\`\`

หมายเหตุ: รายการประเภท "เงินออม / เงินลงทุน" ถือเป็นการโอนเงินเก็บ ไม่ใช่รายจ่ายทั่วไป และไม่ถูกนำไปหักลบเงินคงเหลือสุทธิ
`;

  // Format contents array
  const contents = [];

  // Add previous conversation turns
  for (const turn of history.slice(-6)) {
    contents.push({
      role: turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.content }],
    });
  }

  // Add current user message
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  const body = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1500,
    },
  };

  let lastError: Error | null = null;
  const modelsToTry = await getAvailableGeminiModels(apiKey);

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API (${model}) Error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!answer) {
        throw new Error(`Gemini API (${model}) returned empty response`);
      }

      return answer;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Model ${model} failed, trying next candidate:`, lastError.message);
    }
  }

  throw lastError || new Error('All candidate Gemini models failed');
}

export async function parseSlipWithGeminiVision(
  apiKey: string,
  imageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<SlipOCRResult> {
  const prompt = `
คุณเป็นระบบ OCR ตรวจจับและอ่านสลิปทางการเงินไทยอัจฉริยะ (Thai Financial Slip & Dime Investment Scanner)
โปรดอ่านรูปภาพนี้อย่างละเอียด และจำแนกว่าเป็น:
1) "transfer" = สลิปโอนเงินธนาคารทั่วไป (เช่น KBank, SCB, Krungthai, BBL, TTB, GSB, TrueMoney, PromptPay ฯลฯ)
2) "dime" = สลิปหรือหลักฐานการซื้อขายหุ้น/กองทุน/สินทรัพย์จากแอป Dime! (KKP / Dime)

กติกาการสกัดข้อมูล:
1. ตรวจสอบว่ารูปนี้คือสลิปโอนเงินหรือสลิปการลงทุนหรือไม่ (is_slip: true/false)
2. จำแนกประเภทสลิป (slip_type: "transfer" หรือ "dime")

--- กรณีที่ 1: สลิปโอนเงินทั่วไป (slip_type = "transfer") ---
- amount: ยอดเงินโอน (ตัวเลขทศนิยม เช่น 350.00)
- type: "expense" สำหรับโอนเงินออก, "income" สำหรับเงินโอนเข้า
- category: สกัดหมวดหมู่ที่เหมาะสมที่สุด:
  - "อาหารและเครื่องดื่ม"
  - "การเดินทาง/น้ำมัน"
  - "ช้อปปิ้ง/ของใช้"
  - "ค่าที่พัก/สาธารณูปโภค"
  - "บันเทิง/สังสรรค์"
  - "สุขภาพ/รักษาพยาบาล"
  - "เงินออม/เงินลงทุน"
  - "รายจ่ายอื่นๆ"
- date: วันที่ทำรายการ (YYYY-MM-DD เช่น 2026-10-06 หากไม่ระบุปี ให้ใช้ปี 2026)
- time: เวลาทำรายการ (HH:mm)
- recipient: ชื่อผู้รับเงิน/ร้านค้า/บัญชีปลายทาง
- sender: ชื่อผู้โอน/บัญชีต้นทาง
- bank: ธนาคาร เช่น KBank, SCB, KTB, BBL, TTB, GSB, PromptPay
- note: หมายเหตุ/ข้อความช่วยจำถ้ามี

--- กรณีที่ 2: สลิปการลงทุน Dime! (slip_type = "dime") ---
- ticker: สัญลักษณ์หุ้นหรือชื่อย่อสินทรัพย์ เช่น "AAPL", "NVDA", "TSLA", "DIME-US500", "TLG"
- asset_name: ชื่อเต็มของหุ้นหรือสินทรัพย์
- shares: จำนวนหุ้น/หน่วยที่ซื้อ (ตัวเลขทศนิยม เช่น 0.25 หรือ 10)
- price_per_share: ราคาต่อหุ้นหรือราคาเฉลี่ยที่ซื้อ (ตัวเลขทศนิยม)
- amount: ยอดเงินรวมที่ลงทุน (ตัวเลขทศนิยม)
- date: วันที่ทำรายการ (YYYY-MM-DD)
- time: เวลาทำรายการ (HH:mm)
- note: รายละเอียดเพิ่มเติม เช่น "ซื้อสำเร็จผ่าน Dime!"

ตอบกลับเป็น JSON เท่านั้น (Strict JSON Output):
ตัวอย่างกรณีสลิปทั่วไป:
{
  "is_slip": true,
  "slip_type": "transfer",
  "amount": 150.00,
  "type": "expense",
  "category": "อาหารและเครื่องดื่ม",
  "date": "2026-10-06",
  "time": "12:30",
  "recipient": "ร้านข้าวมันไก่",
  "sender": "นายสมชาย",
  "bank": "KBank",
  "note": "ค่าอาหารกลางวัน"
}

ตัวอย่างกรณีสลิป Dime!:
{
  "is_slip": true,
  "slip_type": "dime",
  "ticker": "AAPL",
  "asset_name": "Apple Inc. (AAPL)",
  "shares": 0.5,
  "price_per_share": 7800.00,
  "amount": 3900.00,
  "date": "2026-10-06",
  "time": "21:30",
  "note": "ซื้อสำเร็จผ่าน Dime!"
}
`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };

  let lastError: Error | null = null;
  const modelsToTry = await getAvailableGeminiModels(apiKey);

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini Vision (${model}) Error (${response.status}): ${errText}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawJson) {
        throw new Error(`Gemini Vision (${model}) returned empty text`);
      }

      try {
        const parsed = JSON.parse(rawJson) as SlipOCRResult;
        return parsed;
      } catch (e) {
        const clean = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(clean) as SlipOCRResult;
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Vision model ${model} failed, trying next candidate:`, lastError.message);
    }
  }

  throw lastError || new Error('All candidate Gemini models failed for vision OCR');
}
