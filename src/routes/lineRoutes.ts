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
import { getAllUsers } from '../db/users';

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
  currentUser: JWTPayload | null,
  ctx?: ExecutionContext
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // Log incoming request headers at the very first line of the handler
  console.log("Incoming request headers:", JSON.stringify(Object.fromEntries(request.headers)));

  const channelSecret = env.LINE_CHANNEL_SECRET;
  const channelAccessToken = env.LINE_CHANNEL_ACCESS_TOKEN;
  const geminiApiKey = env.GEMINI_API_KEY;
  const webUrl = 'https://income-expense-tracker.674295021.workers.dev';

  // Guard: LINE webhook requires credentials
  if (path === '/api/line/webhook' && (!channelSecret || !channelAccessToken)) {
    console.error('[LINE Webhook] LINE credentials not configured in env/secrets: channelSecret=' + !!channelSecret + ', channelAccessToken=' + !!channelAccessToken);
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

    console.log(`[LINE Webhook] Received POST event, body length: ${rawBody.length}, hasSignature: ${!!signature}`);

    // If body contains empty events or no events, return 200 OK immediately for verification probes
    let payload: { events?: LineWebhookEvent[] } = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (parseErr) {
      console.warn('[LINE Webhook] Non-JSON or empty payload received. Returning 200 OK for verification.');
      return new Response('OK', { status: 200 });
    }

    const events = payload.events || [];
    console.log("== New Webhook Event ==", JSON.stringify(events));

    // If events array is empty, this is a LINE webhook verification test from Developer Console
    if (events.length === 0) {
      console.log('[LINE Webhook] Received verification request from LINE Console (empty events). Returning 200 OK immediately.');
      return new Response('OK', { status: 200 });
    }

    const isValid = await verifyLineSignature(rawBody, signature, secret);
    if (!isValid) {
      console.error(`Signature verification failed: receivedSignature=${signature}, secretConfigured=${!!secret}`);
      return new Response('Invalid signature', { status: 401 });
    }

    // Process all events in background using ctx.waitUntil() so we can return 200 to LINE immediately.
    // This prevents LINE from thinking the webhook timed out and retrying delivery repeatedly.
    const processEvents = async () => {
      for (const event of events) {
        if (!event.replyToken || !event.source?.userId) continue;

        const lineUserId = event.source.userId;
        const replyToken = event.replyToken;
        const message = event.message;
        if (!message) continue;

        try {
          // 1. ตรวจจับ Event รูปภาพ: if (event.type === 'message' && event.message.type === 'image')
          if (event.type === 'message' && message.type === 'image') {
            console.log(`[LINE Webhook][Image] Processing image message ID: ${message.id} from user: ${lineUserId}`);

            let linkedUser = await getLineUser(env.DB, lineUserId);

            // If not linked, check if single admin user exists or send linking guide
            if (!linkedUser) {
              console.log(`[LINE Webhook][Image] User ${lineUserId} is not linked yet, checking default user...`);
              // Attempt to link to the primary admin or first registered user in the database
              const allUsers = await getAllUsers(env.DB);
              if (allUsers.length > 0) {
                const primaryUser = allUsers.find(u => u.role === 'admin') || allUsers[0];
                await env.DB.prepare(
                  'INSERT INTO line_users (line_user_id, user_id, display_name) VALUES (?, ?, ?) ON CONFLICT(line_user_id) DO UPDATE SET user_id = excluded.user_id'
                ).bind(lineUserId, primaryUser.id, 'LINE User').run();
                linkedUser = { line_user_id: lineUserId, user_id: primaryUser.id, display_name: 'LINE User', picture_url: null };
                console.log(`[LINE Webhook][Image] Auto-linked LINE user ${lineUserId} to system user ${primaryUser.email} (${primaryUser.id})`);
              } else {
                await replyLineMessage(
                  replyToken,
                  [createLinkAccountFlexMessage(webUrl)],
                  lineToken
                );
                continue;
              }
            }

            console.log(`[LINE Webhook][Image] Active linked user: ${linkedUser.user_id}`);

            if (!gApiKey) {
              console.error('[LINE Webhook][Image] GEMINI_API_KEY is not defined in worker environment!');
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

            // Step 1: Download slip image from LINE
            console.log(`[LINE Webhook][Image] Step 1: Downloading image from LINE content API for message ${message.id}...`);
            let base64: string;
            let mimeType: string;
            try {
              const downloaded = await getLineMessageContentBase64(message.id, lineToken);
              base64 = downloaded.base64;
              mimeType = downloaded.mimeType;
              console.log(`[LINE Webhook][Image] Step 1 Success: Image downloaded (${mimeType}, base64 len: ${base64.length})`);
            } catch (dlErr: unknown) {
              const dlErrMsg = dlErr instanceof Error ? dlErr.message : String(dlErr);
              console.error('[LINE Webhook][Image] Step 1 Failed (Download error):', dlErrMsg);
              await replyLineMessage(
                replyToken,
                [{ type: 'text', text: `❌ ไม่สามารถดาวน์โหลดรูปภาพจาก LINE ได้: ${dlErrMsg}` }],
                lineToken
              );
              continue;
            }

            // Step 2: OCR with Gemini Vision
            console.log(`[LINE Webhook][Image] Step 2: Analyzing slip with Gemini Vision API...`);
            let slipResult;
            try {
              slipResult = await parseSlipWithGeminiVision(gApiKey, base64, mimeType);
              console.log('[LINE Webhook][Image] Step 2 Success: Gemini Vision result:', JSON.stringify(slipResult));
            } catch (ocrErr: unknown) {
              const ocrErrMsg = ocrErr instanceof Error ? ocrErr.message : String(ocrErr);
              console.error('[LINE Webhook][Image] Step 2 Failed (Gemini OCR error):', ocrErrMsg);
              await replyLineMessage(
                replyToken,
                [{ type: 'text', text: `❌ ระบบวิเคราะห์สลิป (Gemini) ขัดข้อง: ${ocrErrMsg.slice(0, 100)}` }],
                lineToken
              );
              continue;
            }

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

                console.log(`[LINE Webhook][Dime] Step 3: Saving Dime investment (${ticker}, ${totalAmount} THB) to D1...`);
                try {
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
                } catch (d1Err: unknown) {
                  const d1ErrMsg = d1Err instanceof Error ? d1Err.message : String(d1Err);
                  console.error('[LINE Webhook][Dime] Step 3 Failed (D1 Database error):', d1ErrMsg);
                  await replyLineMessage(
                    replyToken,
                    [{ type: 'text', text: `❌ เกิดข้อผิดพลาดในการบันทึกฐานข้อมูล D1: ${d1ErrMsg}` }],
                    lineToken
                  );
                  continue;
                }

                const summaryData = await getUserSummary(env.DB, linkedUser.user_id);

                const dimeReplyText =
                  `📈 บันทึกการลงทุน Dime! สำเร็จ\n` +
                  `🔹 สินทรัพย์: ${ticker}\n` +
                  (slipResult.shares ? `🔹 จำนวน: ${slipResult.shares} หุ้น\n` : '') +
                  (slipResult.price_per_share ? `🔹 ราคาต่อหุ้น: ฿${slipResult.price_per_share.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` : '') +
                  `💵 ยอดรวม: ฿${totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `📅 วันที่: ${thaiDateText}\n` +
                  `💎 เงินคงเหลือสุทธิ: ฿${(summaryData?.balance ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `💼 บันทึกเข้าพอร์ต Investments เรียบร้อยแล้ว ✅`;

                await replyLineMessage(replyToken, [{ type: 'text', text: dimeReplyText }], lineToken);
                console.log(`[LINE Webhook][Dime] Step 4 Success: Replied with Dime investment summary.`);
              } else {
                // --- กรณีสลิปโอนเงินทั่วไป ---
                const txType: 'income' | 'expense' = slipResult.type === 'income' ? 'income' : 'expense';
                const txCategory = slipResult.category || (txType === 'income' ? 'รายรับอื่นๆ' : 'รายจ่ายอื่นๆ');
                const txAmount = slipResult.amount;
                const txNote = slipResult.note || (slipResult.recipient ? `โอนให้ ${slipResult.recipient}` : 'จากสลิปโอนเงิน');

                console.log(`[LINE Webhook][Transfer] Step 3: Saving transaction (${txType}, ${txCategory}, ${txAmount} THB) to D1...`);
                try {
                  await createTransaction(env.DB, linkedUser.user_id, {
                    type: txType,
                    category: txCategory,
                    amount: txAmount,
                    note: txNote,
                    transaction_date: txDate,
                  });
                } catch (d1Err: unknown) {
                  const d1ErrMsg = d1Err instanceof Error ? d1Err.message : String(d1Err);
                  console.error('[LINE Webhook][Transfer] Step 3 Failed (D1 Database error):', d1ErrMsg);
                  await replyLineMessage(
                    replyToken,
                    [{ type: 'text', text: `❌ เกิดข้อผิดพลาดในการบันทึกฐานข้อมูล D1: ${d1ErrMsg}` }],
                    lineToken
                  );
                  continue;
                }

                const summaryData = await getUserSummary(env.DB, linkedUser.user_id);
                const currentMonthExpense = await getMonthlyExpense(env.DB, linkedUser.user_id, txDate.slice(0, 7));

                const label = txType === 'income' ? 'รายรับ' : 'รายจ่าย';
                const transferReplyText =
                  `✅ บันทึก${label}สำเร็จ\n` +
                  `💵 จำนวน: ฿${txAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `📊 หมวดหมู่: ${txCategory}\n` +
                  (slipResult.recipient ? `👤 ผู้รับ: ${slipResult.recipient}\n` : '') +
                  (slipResult.bank ? `🏦 ธนาคาร: ${slipResult.bank}\n` : '') +
                  `📅 วันที่: ${thaiDateText}\n` +
                  `📊 รายจ่ายเดือนนี้รวม: ฿${currentMonthExpense.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `💎 เงินคงเหลือสุทธิ: ฿${(summaryData?.balance ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ✅`;

                await replyLineMessage(replyToken, [{ type: 'text', text: transferReplyText }], lineToken);
                console.log(`[LINE Webhook][Transfer] Step 4 Success: Replied with transfer summary.`);
              }
            } else {
              console.log('[LINE Webhook][Image] Image is not recognized as a financial slip.');
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
                      text: `❌ ไม่สามารถเชื่อมต่อบัญชีได้: ${linkResult.error || 'รหัส Token ไม่ถูกต้องหรือหมดอายุแล้วครับ'}\n\nโปรดไปสร้างรหัสใหม่ที่เว็บไซต์แล้วลองอีกครั้ง`,
                    },
                  ],
                  lineToken
                );
              }
              continue;
            }

            // 2. สอบถามข้อมูลสรุป
            if (/^(?:สรุป|ยอด|summary|balance|รายงาน)/.test(text)) {
              const linkedUser = await getLineUser(env.DB, lineUserId);
              if (!linkedUser) {
                await replyLineMessage(
                  replyToken,
                  [createLinkAccountFlexMessage(webUrl)],
                  lineToken
                );
                continue;
              }

              const summaryData = await getUserSummary(env.DB, linkedUser.user_id);
              if (!summaryData) {
                await replyLineMessage(
                  replyToken,
                  [{ type: 'text', text: '⚠️ ยังไม่มีข้อมูลรายรับ-รายจ่ายในระบบครับ' }],
                  lineToken
                );
                continue;
              }

              const income = summaryData.total_income.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const expense = summaryData.total_expense.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const balance = summaryData.balance.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

              await replyLineMessage(
                replyToken,
                [
                  {
                    type: 'text',
                    text: `📊 สรุปการเงินของคุณ:\n\n💰 รายรับทั้งหมด: ฿${income}\n💸 รายจ่ายทั้งหมด: ฿${expense}\n💵 ยอดคงเหลือสุทธิ: ฿${balance}\n\n🔗 ดูรายละเอียดเพิ่มเติมได้ที่: ${webUrl}`,
                  },
                ],
                lineToken
              );
              continue;
            }

            // 3. Default: guide user to use features
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: '👋 สวัสดีครับ! ระบบ ExpenseTracker รองรับ:\n\n📷 ส่งภาพสลิป → บันทึกรายจ่ายอัตโนมัติ\n📊 พิมพ์ "สรุป" → ดูยอดรายรับ-รายจ่าย\n🔗 พิมพ์ "LINK <รหัส>" → เชื่อมต่อบัญชีเว็บ\n\n💡 เยี่ยมชมแดชบอร์ดเพิ่มเติมได้ที่: ' + webUrl,
                },
              ],
              lineToken
            );
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
        } catch (err: unknown) {
          console.error('Unhandled LINE event processing error:', err);
          const errMsg = err instanceof Error ? err.message : String(err);
          try {
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: '❌ เกิดข้อผิดพลาด: ' + errMsg,
                },
              ],
              lineToken
            );
          } catch (replyErr) {
            console.error('Failed to send error notification back to LINE user:', replyErr);
          }
        }
      }
    };

    // Return 200 immediately to LINE, then process events in background
    if (ctx) {
      ctx.waitUntil(processEvents());
    } else {
      // Fallback: process synchronously if no ctx (should not happen in Cloudflare Workers)
      await processEvents();
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
