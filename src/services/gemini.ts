// Gemini AI Service (Feature 1 - Financial Chatbot & Feature 4 - Slip OCR)
import { SummaryData, Trip, Investment } from '../types';
import { InvestmentPortfolioSummary } from '../db/investments';

export interface SlipOCRResult {
  is_slip: boolean;
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
}

const CANDIDATE_MODELS = ['gemini-2.5-flash'];

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

  for (const model of CANDIDATE_MODELS) {
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
คุณเป็นระบบ OCR ตรวจจับและอ่านสลิปการโอนเงินธนาคารไทย (Bank Transfer Slip Scanner)
โปรดอ่านรูปภาพสลิปนี้และสกัดข้อมูลออกมาเป็น JSON เท่านั้น (Strict JSON Output):

กติกาการสกัดข้อมูล:
1. ตรวจสอบว่ารูปนี้คือสลิปโอนเงิน/ใบเสร็จทางการเงินหรือไม่ (is_slip: true/false)
2. สกัดจำนวนเงินโอน (amount เป็นตัวเลขทศนิยม เช่น 350.00)
3. ระบุประเภท (type: "expense" สำหรับโอนเงินออก, "income" สำหรับเงินโอนเข้า)
4. สกัดหมวดหมู่ที่เหมาะสมที่สุด (category) จากรายการนี้:
   - "อาหารและเครื่องดื่ม"
   - "การเดินทาง/น้ำมัน"
   - "ช้อปปิ้ง/ของใช้"
   - "ค่าที่พัก/สาธารณูปโภค"
   - "บันเทิง/สังสรรค์"
   - "สุขภาพ/รักษาพยาบาล"
   - "เงินออม/เงินลงทุน"
   - "รายจ่ายอื่นๆ"
5. วันที่ทำรายการ (date ในรูปแบบ YYYY-MM-DD เช่น 2026-10-06 หากไม่ระบุปี ให้ใช้ปีปัจจุบัน 2026)
6. เวลาทำรายการ (time ในรูปแบบ HH:mm)
7. ชื่อผู้รับเงิน/ร้านค้า/บัญชีปลายทาง (recipient)
8. ชื่อผู้โอน/บัญชีต้นทาง (sender)
9. ธนาคารผู้ให้บริการ เช่น KBank, SCB, KTB, BBL, TTB, GSB, PromptPay (bank)
10. หมายเหตุ/ข้อความช่วยจำถ้ามี (note)

ตอบกลับเป็น JSON เท่านั้นในรูปแบบนี้:
{
  "is_slip": true,
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

  for (const model of CANDIDATE_MODELS) {
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
