// LINE Routes & Webhook (Feature 4 - Slip OCR & Account Linking)
import { Env, JWTPayload } from '../types';
import { jsonSuccess, jsonError } from '../utils/response';
import {
  verifyLineSignature,
  getLineMessageContentBase64,
  replyLineMessage,
  createSlipRecordedFlexMessage,
  createLinkAccountFlexMessage,
  LineWebhookEvent,
} from '../services/line';
import { parseSlipWithGeminiVision } from '../services/gemini';
import {
  getLineUser,
  generateLineLinkToken,
  verifyAndLinkLineUser,
  getLineUserByUserId,
  unlinkLineUser,
} from '../db/line';
import { createTransaction, getUserSummary, getMonthlyExpense } from '../db/transactions';
import { upsertDimeInvestment } from '../db/investments';

// Helper to format date in Thai format: "06 ต.ค. 2569"
function formatThaiDate(dateStr?: string): string {
  try {
    const d = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(d.getTime())) return dateStr || '';
    const months = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const day = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];
    const thaiYear = d.getFullYear() + 543;
    return `${day} ${month} ${thaiYear}`;
  } catch {
    return dateStr || '';
  }
}

export async function handleLineRoutes(
  request: Request,
  env: Env,
  url: URL,
  currentUser: JWTPayload | null
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  const channelSecret = env.LINE_CHANNEL_SECRET;
  const channelAccessToken = env.LINE_CHANNEL_ACCESS_TOKEN;
  const geminiApiKey = env.GEMINI_API_KEY;
  const webUrl = 'https://income-expense-tracker.674295021.workers.dev';

  // Guard: LINE webhook requires credentials
  if (path === '/api/line/webhook' && (!channelSecret || !channelAccessToken)) {
    return new Response('LINE credentials not configured', { status: 500 });
  }

  // Type-narrowed aliases for use inside the webhook handler blocks
  const secret = (channelSecret ?? '') as string;
  const lineToken = (channelAccessToken ?? '') as string;
  const gApiKey = (geminiApiKey ?? '') as string;

  // 1. GET /api/line/webhook - LINE Webhook Verification & Healthcheck
  if (path === '/api/line/webhook' && method === 'GET') {
    return new Response('LINE Webhook is live and healthy', { status: 200 });
  }

  // 2. POST /api/line/webhook - Main LINE Webhook Event Handler
  if (path === '/api/line/webhook' && method === 'POST') {
    const signature = request.headers.get('x-line-signature');
    const rawBody = await request.text();

    const isValid = await verifyLineSignature(rawBody, signature, secret);
    if (!isValid) {
      console.warn('Invalid LINE signature attempt');
      return new Response('Invalid signature', { status: 403 });
    }

    let payload: { events?: LineWebhookEvent[] };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const events = payload.events || [];

    for (const event of events) {
      if (event.type !== 'message' || !event.replyToken || !event.source?.userId) continue;

      const lineUserId = event.source.userId;
      const replyToken = event.replyToken;
      const message = event.message;

      if (!message) continue;

      try {
        // A. Handling Image Messages (Slip OCR)
        if (message.type === 'image') {
          const linkedUser = await getLineUser(env.DB, lineUserId);

          if (!linkedUser) {
            // User not linked yet
            await replyLineMessage(
              replyToken,
              [createLinkAccountFlexMessage(webUrl)],
              lineToken
            );
            continue;
          }

          if (!gApiKey) {
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: '⚠️ ยังไม่ได้กำหนดค่า GEMINI_API_KEY ในระบบหลังบ้าน กรุณาติดต่อผู้ดูแลระบบครับ',
                },
              ],
              lineToken
            );
            continue;
          }

          // Download slip image from LINE
          const { base64, mimeType } = await getLineMessageContentBase64(message.id, lineToken);

          // OCR with Gemini Vision
          const slipResult = await parseSlipWithGeminiVision(gApiKey, base64, mimeType);

          if (slipResult.is_slip && slipResult.amount && slipResult.amount > 0) {
            const isDime = slipResult.slip_type === 'dime' || /dime/i.test(slipResult.bank || slipResult.note || '');
            const txDate = slipResult.date || new Date().toISOString().split('T')[0];
            const thaiDateText = formatThaiDate(txDate);

            if (isDime) {
              // --- กรณีสลิป Dime! (การลงทุน/หุ้น/กองทุน) ---
              const ticker = slipResult.ticker || slipResult.asset_name || 'US Stock';
              const sharesText = slipResult.shares ? `${slipResult.shares}` : '-';
              const priceText = slipResult.price_per_share ? slipResult.price_per_share.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
              const totalAmount = slipResult.amount;

              let dimeNote = `Dime! ${ticker}`;
              if (slipResult.shares && slipResult.price_per_share) {
                dimeNote += ` (${slipResult.shares} หุ้น @ ${priceText})`;
              }

              // 1. บันทึก/อัปเดตลงตาราง investments
              await upsertDimeInvestment(env.DB, linkedUser.user_id, {
                name: ticker,
                shares: slipResult.shares,
                price: slipResult.price_per_share,
                amount: totalAmount,
                note: dimeNote,
              });

              // 2. บันทึกประวัติธุรกรรมซื้อขายลงตาราง transactions เพื่อติดตามกระแสเงิน
              await createTransaction(env.DB, linkedUser.user_id, {
                type: 'expense',
                category: 'เงินออม/เงินลงทุน',
                amount: totalAmount,
                note: dimeNote,
                transaction_date: txDate,
              });

              // 3. ส่งข้อความตอบกลับสรุปการลงทุน Dime!
              const dimeReplyText =
                `📈 บันทึกการลงทุน Dime! สำเร็จ\n` +
                `🔹 สินทรัพย์: ${ticker}\n` +
                `🔹 จำนวน: ${sharesText} หุ้น @ ${priceText} บาท\n` +
                `💵 ยอดรวม: ${totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท\n` +
                `💼 บันทึกเข้าพอร์ต Investments เรียบร้อยแล้ว`;

              await replyLineMessage(replyToken, [{ type: 'text', text: dimeReplyText }], lineToken);
            } else {
              // --- กรณีสลิปโอนเงินทั่วไป ---
              const txType = slipResult.type === 'income' ? 'income' : 'expense';
              const txCategory = slipResult.category || (txType === 'income' ? 'รายรับอื่นๆ' : 'อาหารและเครื่องดื่ม');

              let note = slipResult.note || '';
              if (slipResult.recipient) note += ` (ผู้รับ: ${slipResult.recipient})`;
              if (slipResult.bank) note += ` [${slipResult.bank}]`;

              // 1. บันทึกลงตาราง transactions
              await createTransaction(env.DB, linkedUser.user_id, {
                type: txType,
                category: txCategory,
                amount: slipResult.amount,
                note: note.trim() || null,
                transaction_date: txDate,
              });

              // 2. คำนวณยอดรวมรายจ่ายเดือนนี้จาก D1
              const currentMonthExpense = await getMonthlyExpense(env.DB, linkedUser.user_id, txDate.slice(0, 7));

              // 3. ส่งข้อความตอบกลับสรุปตามรูปแบบที่กำหนด
              const label = txType === 'income' ? 'รายรับ' : 'รายจ่าย';
              const replyText =
                `✅ บันทึก${label}สำเร็จ: ${slipResult.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท\n` +
                `📅 วันที่: ${thaiDateText}\n` +
                `📊 สรุปรายจ่ายเดือนนี้: ${currentMonthExpense.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;

              await replyLineMessage(replyToken, [{ type: 'text', text: replyText }], lineToken);
            }
          } else {
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: '⚠️ ตรวจสอบรูปภาพแล้วไม่พบข้อมูลสลิปโอนเงินหรือสลิป Dime! ที่ชัดเจน\n\nโปรดตรวจสอบว่าเป็นภาพสลิปที่มีตัวเลขยอดเงินชัดเจน แล้วลองส่งใหม่อีกครั้งครับ',
                },
              ],
              lineToken
            );
          }
        }

        // B. Handling Text Messages (Linking and Querying)
        if (message.type === 'text' && message.text) {
          const text = message.text.trim();

          // 1. Account linking command: "LINK 123456" or "เชื่อมต่อ 123456"
          const linkMatch = text.match(/^(?:link|เชื่อมต่อ)\s+([a-zA-Z0-9]{4,8})$/i);
          if (linkMatch) {
            const token = linkMatch[1];
            const linkResult = await verifyAndLinkLineUser(env.DB, token, lineUserId);

            if (linkResult.success) {
              await replyLineMessage(
                replyToken,
                [
                  {
                    type: 'text',
                    text: '🎉 เชื่อมต่อบัญชีสำเร็จเรียบร้อยแล้วครับ!\n\nตอนนี้คุณสามารถส่งภาพสลิปโอนเงินเข้ามาในแชตนี้ได้ทันที ระบบจะสแกนและบันทึกลงแดชบอร์ดให้คุณโดยอัตโนมัติ ✨',
                  },
                ],
                lineToken
              );
            } else {
              await replyLineMessage(
                replyToken,
                [
                  {
                    type: 'text',
                    text: `❌ ${linkResult.error || 'รหัสเชื่อมต่อไม่ถูกต้อง'}\n\nกรุณาเข้าสู่ระบบหน้าเว็บและกด "สร้างรหัสเชื่อมต่อ" ใหม่อีกครั้งครับ`,
                  },
                ],
                lineToken
              );
            }
            continue;
          }

          // 2. Summary query: "ยอดเงิน", "สรุป", "balance"
          if (/^(?:ยอดเงิน|สรุป|เงินคงเหลือ|balance|รายงาน)$/i.test(text)) {
            const linkedUser = await getLineUser(env.DB, lineUserId);
            if (!linkedUser) {
              await replyLineMessage(
                replyToken,
                [createLinkAccountFlexMessage(webUrl)],
                lineToken
              );
              continue;
            }

            const summary = await getUserSummary(env.DB, linkedUser.user_id);
            const replyText =
              `📊 สรุปสถานะการเงินล่าสุด:\n\n` +
              `💰 รายรับทั้งหมด: ฿${summary.total_income.toLocaleString('th-TH')}\n` +
              `💳 รายจ่ายทั่วไป: ฿${summary.general_expense.toLocaleString('th-TH')}\n` +
              `🏦 เงินออม/ลงทุน: ฿${summary.total_savings_invest.toLocaleString('th-TH')}\n` +
              `------------------------\n` +
              `⚖️ เงินคงเหลือสุทธิ (Net Savings): ฿${summary.balance.toLocaleString('th-TH')}\n` +
              `💎 สินทรัพย์สุทธิรวม (Net Worth): ฿${summary.net_worth.toLocaleString('th-TH')}\n\n` +
              `🌐 ดูรายละเอียดเพิ่มเติมได้ที่:\n${webUrl}`;

            await replyLineMessage(replyToken, [{ type: 'text', text: replyText }], lineToken);
            continue;
          }

          // 3. Help message
          if (/^(?:วิธีใช้|help|เมนู|คำสั่ง)$/i.test(text)) {
            const helpText =
              `🤖 บอทผู้ช่วย ExpenseTracker Pro\n\n` +
              `คำสั่งที่ใช้งานได้:\n` +
              `📸 ส่งรูปสลิปโอนเงิน หรือ สลิป Dime! → บันทึกรายการอัตโนมัติ\n` +
              `🔗 พิมพ์ "LINK รหัส6หลัก" → เชื่อมต่อบัญชี\n` +
              `📊 พิมพ์ "สรุป" หรือ "ยอดเงิน" → ดูยอดคงเหลือและสินทรัพย์\n\n` +
              `🌐 เข้าเว็บไซต์: ${webUrl}`;

            await replyLineMessage(replyToken, [{ type: 'text', text: helpText }], lineToken);
            continue;
          }

          // Default response for unlinked users
          const linkedUser = await getLineUser(env.DB, lineUserId);
          if (!linkedUser) {
            await replyLineMessage(
              replyToken,
              [createLinkAccountFlexMessage(webUrl)],
              lineToken
            );
          }
        }
      } catch (err: unknown) {
        console.error('Unhandled LINE event processing error:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        try {
          await replyLineMessage(
            replyToken,
            [
              {
                type: 'text',
                text: `❌ เกิดข้อผิดพลาดในการประมวลผล: ${errMsg}\n\nกรุณาลองใหม่อีกครั้ง หรือบันทึกรายการผ่านหน้าเว็บครับ`,
              },
            ],
            lineToken
          );
        } catch (replyErr) {
          console.error('Failed to send error notification back to LINE user:', replyErr);
        }
      }
    }

    return new Response('OK', { status: 200 });
  }

  // Authenticated Web API Endpoints for current user
  if (!currentUser) {
    return jsonError('Authentication required', 'UNAUTHORIZED', 401);
  }

  // POST /api/line/link-token - Generate linking code on web
  if (path === '/api/line/link-token' && method === 'POST') {
    const token = await generateLineLinkToken(env.DB, currentUser.sub);
    return jsonSuccess({
      token,
      expires_in_minutes: 15,
      instruction: `พิมพ์ "LINK ${token}" ในห้องแชต LINE Official Account เพื่อเชื่อมต่อบัญชี`,
    });
  }

  // GET /api/line/status - Check if web user is linked to LINE
  if (path === '/api/line/status' && method === 'GET') {
    const lineUser = await getLineUserByUserId(env.DB, currentUser.sub);
    return jsonSuccess({
      is_linked: !!lineUser,
      line_user: lineUser
        ? {
            display_name: lineUser.display_name,
            picture_url: lineUser.picture_url,
            created_at: lineUser.created_at,
          }
        : null,
    });
  }

  // POST /api/line/unlink - Unlink LINE account
  if (path === '/api/line/unlink' && method === 'POST') {
    await unlinkLineUser(env.DB, currentUser.sub);
    return jsonSuccess({ message: 'ยกเลิกการเชื่อมต่อ LINE สำเร็จ' });
  }

  return jsonError('Not Found', 'NOT_FOUND', 404);
}
