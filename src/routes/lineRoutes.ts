// LINE Routes & Webhook (Feature 4 - Slip OCR, Account Linking & Active Trip State)
import { Env, JWTPayload } from '../types';
import { jsonSuccess, jsonError } from '../utils/response';
import {
  verifyLineSignature,
  getLineMessageContentBase64,
  replyLineMessage,
  createSlipRecordedFlexMessage,
  createLinkAccountFlexMessage,
  createQuickReply,
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
import { upsertStockInvestment, getInvestments } from '../db/investments';
import { getAllUsers } from '../db/users';
import { syncPortfolioStockPrices } from '../services/stock';
import {
  findActiveTripForDate,
  findTripByKeyword,
  createTripExpense,
  getTripById,
  getUserActiveTrip,
  setActiveTrip,
  deactivateActiveTrip,
  startTripByNameOrKeyword,
  getLatestTrip,
} from '../db/trips';

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

  // Log incoming request headers
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
    const processEvents = async () => {
      for (const event of events) {
        if (!event.replyToken || !event.source?.userId) continue;

        const lineUserId = event.source.userId;
        const replyToken = event.replyToken;
        const message = event.message;

        try {
          // ---------------------------------------------------------------
          // 1. ตรวจจับ Event รูปภาพ: if (event.type === 'message' && message.type === 'image')
          // ---------------------------------------------------------------
          if (event.type === 'message' && message && message.type === 'image') {
            console.log(`[LINE Webhook][Image] Processing image message ID: ${message.id} from user: ${lineUserId}`);

            let linkedUser = await getLineUser(env.DB, lineUserId);

            // If not linked, check if single admin user exists or send linking guide
            if (!linkedUser) {
              console.log(`[LINE Webhook][Image] User ${lineUserId} is not linked yet, checking default user...`);
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
              const isInvestment =
                slipResult.slip_type === 'dime' ||
                slipResult.slip_type === 'investment' ||
                /dime|streaming|settrade|innovestx|หุ้น|หลักทรัพย์|กองทุน/i.test(
                  `${slipResult.bank || ''} ${slipResult.note || ''} ${slipResult.recipient || ''} ${slipResult.institution || ''}`
                );
              const txDate = slipResult.date || new Date().toISOString().split('T')[0];
              const thaiDateText = formatThaiDate(txDate);

              if (isInvestment) {
                // --- กรณีสลิปการลงทุน / หุ้น / กองทุน (Dime! หรือ Streaming) ---
                let institution = slipResult.institution || 'Dime!';
                if (/streaming|settrade/i.test(`${slipResult.bank || ''} ${slipResult.note || ''} ${slipResult.recipient || ''} ${institution}`)) {
                  institution = 'Streaming';
                } else if (/dime/i.test(`${slipResult.bank || ''} ${slipResult.note || ''} ${institution}`)) {
                  institution = 'Dime!';
                }

                const ticker = slipResult.ticker || slipResult.asset_name || (institution === 'Streaming' ? 'Thai Stock' : 'US Stock');
                const sharesText = slipResult.shares ? `${slipResult.shares}` : '-';
                const priceText = slipResult.price_per_share ? slipResult.price_per_share.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
                const totalAmount = slipResult.amount;

                let investNote = `${institution} ${ticker}`;
                if (slipResult.shares && slipResult.price_per_share) {
                  investNote += ` (${slipResult.shares} หุ้น @ ${priceText})`;
                }

                console.log(`[LINE Webhook][Investment] Step 3: Saving ${institution} investment (${ticker}, ${totalAmount} THB) to D1...`);
                try {
                  // 1. บันทึก/อัปเดตลงตาราง investments
                  await upsertStockInvestment(env.DB, linkedUser.user_id, {
                    name: ticker,
                    institution,
                    asset_type: institution === 'Streaming' ? 'หุ้นไทย (Thai Stock)' : 'หุ้น (Stock)',
                    shares: slipResult.shares,
                    price: slipResult.price_per_share,
                    amount: totalAmount,
                    note: investNote,
                  });

                  // 2. บันทึกประวัติธุรกรรมซื้อขายลงตาราง transactions เพื่อติดตามกระแสเงิน
                  await createTransaction(env.DB, linkedUser.user_id, {
                    type: 'expense',
                    category: 'เงินออม/เงินลงทุน',
                    amount: totalAmount,
                    note: investNote,
                    transaction_date: txDate,
                  });
                } catch (d1Err: unknown) {
                  const d1ErrMsg = d1Err instanceof Error ? d1Err.message : String(d1Err);
                  console.error('[LINE Webhook][Investment] Step 3 Failed (D1 Database error):', d1ErrMsg);
                  await replyLineMessage(
                    replyToken,
                    [{ type: 'text', text: `❌ เกิดข้อผิดพลาดในการบันทึกฐานข้อมูล D1: ${d1ErrMsg}` }],
                    lineToken
                  );
                  continue;
                }

                const summaryData = await getUserSummary(env.DB, linkedUser.user_id);
                const currentActiveTrip = await getUserActiveTrip(env.DB, linkedUser.user_id);

                const investReplyText =
                  `📈 บันทึกการลงทุน ${institution} สำเร็จ\n` +
                  `🔹 สินทรัพย์: ${ticker}\n` +
                  `🏛️ สถาบัน/แอป: ${institution}\n` +
                  (slipResult.shares ? `🔹 จำนวน: ${slipResult.shares} หุ้น\n` : '') +
                  (slipResult.price_per_share ? `🔹 ราคาต่อหุ้น: ฿${slipResult.price_per_share.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` : '') +
                  `💵 ยอดรวม: ฿${totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `📅 วันที่: ${thaiDateText}\n` +
                  `💎 เงินคงเหลือสุทธิ: ฿${(summaryData?.balance ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `💼 บันทึกเข้าพอร์ต Investments เรียบร้อยแล้ว ✅`;

                await replyLineMessage(
                  replyToken,
                  [{ type: 'text', text: investReplyText, quickReply: createQuickReply(Boolean(currentActiveTrip)) }],
                  lineToken
                );
                console.log(`[LINE Webhook][Investment] Step 4 Success: Replied with ${institution} investment summary.`);
              } else {
                // --- กรณีสลิปโอนเงิน / สแกนจ่ายทั่วไป ---
                const txType: 'income' | 'expense' = slipResult.type === 'income' ? 'income' : 'expense';
                const txCategory = slipResult.category || (txType === 'income' ? 'รายรับอื่นๆ' : 'รายจ่ายอื่นๆ');
                const txAmount = slipResult.amount;
                const txNote = slipResult.note || (slipResult.recipient ? `โอนให้ ${slipResult.recipient}` : 'จากสลิปโอนเงิน');

                // ตรวจสอบ Active Trip State ของผู้ใช้ (แยกงบเด็ดขาด - รูปแบบ A)
                const activeTrip = await getUserActiveTrip(env.DB, linkedUser.user_id);

                if (activeTrip && txType === 'expense') {
                  // ========================================================
                  // 1. โหมด ACTIVE TRIP (แยกงบเด็ดขาด - รูปแบบ A)
                  // สลิปทริปทั้งหมดลงเฉพาะตาราง trip_expenses เท่านั้น
                  // ห้ามบันทึกลงตาราง transactions หลักเด็ดขาด 100%!
                  // ========================================================
                  console.log(`[LINE Webhook][ActiveTrip] Active Trip "${activeTrip.name}" detected. Saving to trip_expenses ONLY...`);
                  try {
                    await createTripExpense(env.DB, activeTrip.id, linkedUser.user_id, {
                      category: txCategory,
                      amount: txAmount,
                      note: txNote,
                      expense_date: txDate,
                    });
                  } catch (tripErr: unknown) {
                    const tripErrMsg = tripErr instanceof Error ? tripErr.message : String(tripErr);
                    console.error('[LINE Webhook][ActiveTrip] Failed to record trip expense:', tripErrMsg);
                    await replyLineMessage(
                      replyToken,
                      [{ type: 'text', text: `❌ บันทึกค่าใช้จ่ายเข้าทริปไม่สำเร็จ: ${tripErrMsg}` }],
                      lineToken
                    );
                    continue;
                  }

                  const tripDetail = await getTripById(env.DB, activeTrip.id, linkedUser.user_id);
                  const remaining = tripDetail?.trip.remaining_budget ?? 0;
                  const spent = tripDetail?.trip.total_spent ?? 0;
                  const budget = tripDetail?.trip.budget ?? 0;

                  const tripReplyText =
                    `✈️ บันทึกค่าใช้จ่ายเข้าทริป "${activeTrip.name}" สำเร็จ\n` +
                    `💵 จำนวน: ฿${txAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                    `📊 หมวดหมู่: ${txCategory}\n` +
                    (slipResult.recipient ? `👤 ผู้รับ: ${slipResult.recipient}\n` : '') +
                    (slipResult.bank ? `🏦 ธนาคาร: ${slipResult.bank}\n` : '') +
                    `📅 วันที่: ${thaiDateText}\n` +
                    `🎯 งบทริปคงเหลือ: ฿${remaining.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
                    (budget > 0 ? ` (ใช้ไป ฿${spent.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ฿${budget.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : '') +
                    `\n🔒 (แยกงบเดินทางเด็ดขาด ไม่กระทบกระเป๋าเงินหลัก) ✅`;

                  await replyLineMessage(
                    replyToken,
                    [{ type: 'text', text: tripReplyText, quickReply: createQuickReply(true) }],
                    lineToken
                  );
                  console.log(`[LINE Webhook][ActiveTrip] Step 4 Success: Replied with Active Trip expense.`);
                } else {
                  // ========================================================
                  // 2. โหมดปกติ (NORMAL MODE)
                  // บันทึกลงตาราง transactions หลักตามเดิม
                  // ========================================================
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

                  // ตรวจสอบการผูกเข้าทริปเดินทาง (Travel Mode) อัตโนมัติ:
                  // 1) หากมีชื่อทริป/แฮชแท็ก เช่น "เชียงใหม่", "#เชียงใหม่", "โรงแรม", "ตั๋วบิน" (จ่ายล่วงหน้าข้ามวัน)
                  // 2) หรือหากวันที่ทำรายการอยู่ในช่วงวันเดินทางของทริปที่กำลังเดินทางอยู่
                  let matchedTrip = null;
                  let tripRemaining = 0;
                  if (txType === 'expense') {
                    const keyword = [slipResult.trip_hint, slipResult.note, slipResult.recipient].filter(Boolean).join(' ');
                    if (keyword) {
                      matchedTrip = await findTripByKeyword(env.DB, linkedUser.user_id, keyword);
                    }
                    if (!matchedTrip) {
                      matchedTrip = await findActiveTripForDate(env.DB, linkedUser.user_id, txDate);
                    }

                    if (matchedTrip) {
                      try {
                        await createTripExpense(env.DB, matchedTrip.id, linkedUser.user_id, {
                          category: txCategory,
                          amount: txAmount,
                          note: txNote,
                          expense_date: txDate,
                        });
                        const tripDetail = await getTripById(env.DB, matchedTrip.id, linkedUser.user_id);
                        tripRemaining = tripDetail?.trip.remaining_budget ?? 0;
                        console.log(`[LINE Webhook][Trip] Auto-linked ${txAmount} THB to trip: ${matchedTrip.name}`);
                      } catch (tripErr) {
                        console.warn('[LINE Webhook][Trip] Failed to auto-link expense to trip:', tripErr);
                      }
                    }
                  }

                  const summaryData = await getUserSummary(env.DB, linkedUser.user_id);
                  const currentMonthExpense = await getMonthlyExpense(env.DB, linkedUser.user_id, txDate.slice(0, 7));

                  const label = txType === 'income' ? 'รายรับ' : 'รายจ่าย';
                  const tripTag = matchedTrip
                    ? `\n✈️ ผูกเข้าทริป: ${matchedTrip.name} (คงเหลืองบ ฿${tripRemaining.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                    : '';

                  const transferReplyText =
                    `✅ บันทึก${label}สำเร็จ\n` +
                    `💵 จำนวน: ฿${txAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                    `📊 หมวดหมู่: ${txCategory}\n` +
                    (slipResult.recipient ? `👤 ผู้รับ: ${slipResult.recipient}\n` : '') +
                    (slipResult.bank ? `🏦 ธนาคาร: ${slipResult.bank}\n` : '') +
                    `📅 วันที่: ${thaiDateText}\n` +
                    `📊 รายจ่ายเดือนนี้รวม: ฿${currentMonthExpense.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                    `💎 เงินคงเหลือสุทธิ: ฿${(summaryData?.balance ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
                    tripTag +
                    ` ✅`;

                  await replyLineMessage(
                    replyToken,
                    [{ type: 'text', text: transferReplyText, quickReply: createQuickReply(false) }],
                    lineToken
                  );
                  console.log(`[LINE Webhook][Transfer] Step 4 Success: Replied with transfer summary.`);
                }
              }
            } else {
              console.log('[LINE Webhook][Image] Image is not recognized as a financial slip.');
              await replyLineMessage(
                replyToken,
                [
                  {
                    type: 'text',
                    text: '⚠️ ตรวจสอบรูปภาพแล้วไม่พบข้อมูลสลิปโอนเงินหรือสลิป Dime! ที่ชัดเจน\n\nโปรดตรวจสอบว่าเป็นภาพสลิปที่มีตัวเลขยอดเงินชัดเจน แล้วลองส่งใหม่อีกครั้งครับ',
                    quickReply: createQuickReply(false),
                  },
                ],
                lineToken
              );
            }
            continue;
          }

          // ---------------------------------------------------------------
          // 2. Handling Text & Postback Messages (Commands & Rich Menu)
          // ---------------------------------------------------------------
          let text = '';
          if (event.type === 'message' && message && message.type === 'text' && message.text) {
            text = message.text.trim();
          } else if (event.type === 'postback' && event.postback?.data) {
            const pbData = event.postback.data.trim();
            if (/^(?:action=)?status$/i.test(pbData)) text = 'สถานะ';
            else if (/^(?:action=)?portfolio|port$/i.test(pbData)) text = 'พอร์ต';
            else if (/^(?:action=)?end_trip$/i.test(pbData)) text = 'จบทริป';
            else if (/^(?:action=)?start_trip$/i.test(pbData)) text = 'เริ่มทริป';
            else text = pbData;
          }

          if (text) {
            // A. Account linking command: "LINK 123456" or "เชื่อมต่อ 123456"
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
                      quickReply: createQuickReply(false),
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

            // Ensure linked user
            let linkedUser = await getLineUser(env.DB, lineUserId);
            if (!linkedUser) {
              const allUsers = await getAllUsers(env.DB);
              if (allUsers.length > 0) {
                const primaryUser = allUsers.find(u => u.role === 'admin') || allUsers[0];
                await env.DB.prepare(
                  'INSERT INTO line_users (line_user_id, user_id, display_name) VALUES (?, ?, ?) ON CONFLICT(line_user_id) DO UPDATE SET user_id = excluded.user_id'
                ).bind(lineUserId, primaryUser.id, 'LINE User').run();
                linkedUser = { line_user_id: lineUserId, user_id: primaryUser.id, display_name: 'LINE User', picture_url: null };
              }
            }

            if (!linkedUser) {
              await replyLineMessage(
                replyToken,
                [createLinkAccountFlexMessage(webUrl)],
                lineToken
              );
              continue;
            }

            // B. คำสั่งเริ่มทริปเดินทาง: "เริ่มทริป [ชื่อทริป]", "start trip [name]", "เริ่มทริป"
            const startTripMatch = text.match(/^(?:เริ่มทริป|เปิดทริป|start\s*trip)(?:\s+(.+))?$/i);
            if (startTripMatch) {
              const tripName = startTripMatch[1]?.trim();
              if (tripName) {
                const trip = await startTripByNameOrKeyword(env.DB, linkedUser.user_id, tripName);
                const replyText =
                  `🚀 เปิดโหมด Active Trip สำเร็จ!\n\n` +
                  `✈️ ทริป: ${trip.name}\n` +
                  (trip.destination ? `📍 ปลายทาง: ${trip.destination}\n` : '') +
                  `📅 ช่วงเวลา: ${trip.start_date} ถึง ${trip.end_date}\n` +
                  `💰 งบประมาณ: ฿${(trip.budget || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
                  `🔒 ระบบเปิดโหมดแยกงบเด็ดขาดแล้ว สลิปโอนเงิน/สแกนจ่ายหลังจากนี้จะถูกบันทึกเข้าทริปนี้โดยอัตโนมัติ 100% (ไม่บันทึกลงบัญชีหลัก)\n\n` +
                  `เมื่อสิ้นสุดการเดินทาง สามารถพิมพ์ "จบทริป" หรือกดปุ่ม [🏁 จบทริป] ได้ตลอดเวลาครับ ✨`;

                await replyLineMessage(
                  replyToken,
                  [{ type: 'text', text: replyText, quickReply: createQuickReply(true) }],
                  lineToken
                );
                continue;
              } else {
                // ไม่ได้ระบุชื่อทริป ตรวจสอบสถานะปัจจุบัน
                const currentActive = await getUserActiveTrip(env.DB, linkedUser.user_id);
                if (currentActive) {
                  const replyText =
                    `✈️ คุณอยู่ในโหมด Active Trip อยู่แล้วครับ!\n\n` +
                    `📍 ทริปปัจจุบัน: ${currentActive.name}\n` +
                    `💰 งบประมาณ: ฿${(currentActive.budget || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                    `💸 ใช้จ่ายไปแล้ว: ฿${(currentActive.total_spent || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
                    `💡 หากต้องการเปลี่ยนทริป ให้พิมพ์ "เริ่มทริป [ชื่อทริปใหม่]" หรือพิมพ์ "จบทริป" เพื่อปิดทริปเดิมครับ`;

                  await replyLineMessage(
                    replyToken,
                    [{ type: 'text', text: replyText, quickReply: createQuickReply(true) }],
                    lineToken
                  );
                  continue;
                } else {
                  const latestTrip = await getLatestTrip(env.DB, linkedUser.user_id);
                  if (latestTrip) {
                    await setActiveTrip(env.DB, linkedUser.user_id, latestTrip.id);
                    const replyText =
                      `🚀 เปิดโหมด Active Trip: "${latestTrip.name}" สำเร็จ!\n\n` +
                      `📅 ช่วงเวลา: ${latestTrip.start_date} ถึง ${latestTrip.end_date}\n` +
                      `💰 งบประมาณ: ฿${(latestTrip.budget || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
                      `🔒 สลิปโอนเงิน/สแกนจ่ายหลังจากนี้จะถูกบันทึกเข้าทริปนี้โดยอัตโนมัติ 100%`;

                    await replyLineMessage(
                      replyToken,
                      [{ type: 'text', text: replyText, quickReply: createQuickReply(true) }],
                      lineToken
                    );
                    continue;
                  } else {
                    const replyText =
                      `💡 กรุณาระบุชื่อทริปที่ต้องการเริ่ม เช่น:\n` +
                      `• เริ่มทริป เชียงใหม่\n` +
                      `• เริ่มทริป ญี่ปุ่น 2026\n\n` +
                      `หรือสร้างทริปใหม่บนหน้าเว็บได้ที่: ${webUrl}`;

                    await replyLineMessage(
                      replyToken,
                      [{ type: 'text', text: replyText, quickReply: createQuickReply(false) }],
                      lineToken
                    );
                    continue;
                  }
                }
              }
            }

            // C. คำสั่งจบทริป: "จบทริป", "ปิดทริป", "สิ้นสุดทริป", "end trip"
            if (/^(?:จบทริป|ปิดทริป|สิ้นสุดทริป|end\s*trip)$/i.test(text)) {
              const deactivated = await deactivateActiveTrip(env.DB, linkedUser.user_id);
              if (deactivated) {
                const replyText =
                  `🏁 ปิดโหมด Active Trip เรียบร้อยแล้ว!\n\n` +
                  `✈️ สรุปค่าใช้จ่ายทริป "${deactivated.name}":\n` +
                  `💵 ใช้จ่ายทั้งหมด: ฿${(deactivated.total_spent || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `🎯 งบประมาณที่ตั้งไว้: ฿${(deactivated.budget || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `💰 งบคงเหลือ: ฿${(deactivated.remaining_budget || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
                  `🟢 กลับสู่โหมดบันทึกปกติเรียบร้อยแล้ว สลิปหลังจากนี้จะบันทึกลงบัญชีหลักตามปกติครับ 🎉`;

                await replyLineMessage(
                  replyToken,
                  [{ type: 'text', text: replyText, quickReply: createQuickReply(false) }],
                  lineToken
                );
                continue;
              } else {
                await replyLineMessage(
                  replyToken,
                  [{
                    type: 'text',
                    text: '🟢 ปัจจุบันคุณไม่ได้อยู่ในโหมดทริปเดินทาง (อยู่ในโหมดปกติอยู่แล้วครับ)',
                    quickReply: createQuickReply(false),
                  }],
                  lineToken
                );
                continue;
              }
            }

            // D. เช็กสถานะระบบ: "สถานะ", "โหมด", "status", "mode", "check"
            if (/^(?:สถานะ|โหมด|status|mode|check|เช็กสถานะ|เช็คสถานะ)$/i.test(text)) {
              const activeTrip = await getUserActiveTrip(env.DB, linkedUser.user_id);
              if (activeTrip) {
                const statusReplyText =
                  `✈️ สถานะระบบ: โหมดทริปเดินทาง (Active Trip)\n\n` +
                  `📍 ทริปที่กำลังเดินทาง: ${activeTrip.name}\n` +
                  (activeTrip.destination ? `🚩 ปลายทาง: ${activeTrip.destination}\n` : '') +
                  `📅 ช่วงเวลา: ${activeTrip.start_date} ถึง ${activeTrip.end_date}\n` +
                  `💰 งบประมาณ: ฿${(activeTrip.budget || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `💸 ใช้จ่ายไปแล้ว: ฿${(activeTrip.total_spent || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
                  `🎯 งบคงเหลือ: ฿${(activeTrip.remaining_budget || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
                  `🔒 ระบบกำลังแยกงบเดินทางเด็ดขาด สลิปทั้งหมดจะบันทึกเข้าทริปนี้โดยอัตโนมัติ (ไม่บันทึกลงบัญชีหลัก)\n\n` +
                  `พิมพ์ "จบทริป" หรือกด [🏁 จบทริป] เมื่อเดินทางเสร็จสิ้นครับ`;

                await replyLineMessage(
                  replyToken,
                  [{ type: 'text', text: statusReplyText, quickReply: createQuickReply(true) }],
                  lineToken
                );
                continue;
              } else {
                const statusReplyText =
                  `🟢 สถานะระบบ: โหมดบันทึกปกติ (Normal Mode)\n\n` +
                  `💡 สลิปและรายจ่ายทั้งหมดจะบันทึกลงในกระเป๋าเงินและบัญชีรายรับ-รายจ่ายหลัก\n\n` +
                  `✈️ หากต้องการเดินทางและแยกงบเฉพาะทริป:\n` +
                  `พิมพ์ "เริ่มทริป [ชื่อทริป]" หรือกดปุ่ม [🚀 เริ่มทริป] ด้านล่างได้เลยครับ`;

                await replyLineMessage(
                  replyToken,
                  [{ type: 'text', text: statusReplyText, quickReply: createQuickReply(false) }],
                  lineToken
                );
                continue;
              }
            }

            // E. สอบถามข้อมูลสรุปยอดเงิน และพอร์ตการลงทุน: "พอร์ต", "สรุป", "port", "portfolio"
            if (/^(?:พอร์ต|พอร์ท|port|portfolio|สรุป|ยอด|summary|balance|รายงาน)/i.test(text)) {
              // ซิงค์ราคาหุ้น Real-time ล่าสุดถ้ามี STOCK_API_KEY
              if (env.STOCK_API_KEY) {
                try {
                  await syncPortfolioStockPrices(env.DB, linkedUser.user_id, env.STOCK_API_KEY);
                } catch (stockErr) {
                  console.warn('[LINE Text] Failed to sync stock prices for summary:', stockErr);
                }
              }

              const summaryData = await getUserSummary(env.DB, linkedUser.user_id);
              const portfolio = await getInvestments(env.DB, linkedUser.user_id);
              const currentActiveTrip = await getUserActiveTrip(env.DB, linkedUser.user_id);

              const income = (summaryData?.total_income ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const expense = (summaryData?.total_expense ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const balance = (summaryData?.balance ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

              const invTotalVal = portfolio.total_current_value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const invPrincipal = portfolio.total_principal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const invPl = portfolio.total_profit_loss;
              const invPlSign = invPl >= 0 ? '+' : '';
              const invPlText = `${invPlSign}฿${invPl.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              const invPlPctText = `${invPlSign}${portfolio.total_profit_loss_pct.toFixed(2)}%`;
              const netWorth = ((summaryData?.balance ?? 0) + portfolio.total_current_value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

              let stockLines = '';
              if (portfolio.investments && portfolio.investments.length > 0) {
                stockLines = '\n📋 รายการสินทรัพย์:\n' + portfolio.investments.map((inv) => {
                  const pl = inv.profit_loss ?? 0;
                  const s = pl >= 0 ? '+' : '';
                  const pct = (inv.profit_loss_pct ?? 0).toFixed(2);
                  return `• ${inv.name} (${inv.institution}): ฿${inv.current_value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${s}฿${pl.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${s}${pct}%)`;
                }).join('\n');
              } else {
                stockLines = '\n📋 รายการสินทรัพย์: ยังไม่มีสินทรัพย์ในพอร์ต';
              }

              const activeTripTag = currentActiveTrip
                ? `\n\n✈️ [ทริปที่กำลังเดินทาง: ${currentActiveTrip.name}]\n• ใช้งบไปแล้ว: ฿${(currentActiveTrip.total_spent || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (คงเหลือ ฿${(currentActiveTrip.remaining_budget || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                : '';

              const replyText =
                `📊 สรุปสถานะการเงิน & พอร์ตการลงทุน\n\n` +
                `💰 [กระเป๋าเงิน]\n` +
                `• รายรับทั้งหมด: ฿${income}\n` +
                `• รายจ่ายทั้งหมด: ฿${expense}\n` +
                `• เงินคงเหลือสุทธิ: ฿${balance}\n\n` +
                `📈 [พอร์ตการลงทุน]\n` +
                `• มูลค่าพอร์ตปัจจุบัน: ฿${invTotalVal}\n` +
                `• เงินต้นรวม: ฿${invPrincipal}\n` +
                `• กำไร/ขาดทุนรวม: ${invPlText} (${invPlPctText})` +
                `${stockLines}\n\n` +
                `💎 [ความมั่งคั่งสุทธิ (Net Worth)]\n` +
                `• รวมความมั่งคั่งสุทธิ: ฿${netWorth}` +
                activeTripTag +
                `\n\n🔗 ดูรายละเอียด: ${webUrl}`;

              await replyLineMessage(
                replyToken,
                [{ type: 'text', text: replyText, quickReply: createQuickReply(Boolean(currentActiveTrip)) }],
                lineToken
              );
              continue;
            }

            // F. Default response: Feature Guide
            const currentActiveTrip = await getUserActiveTrip(env.DB, linkedUser.user_id);
            const modeText = currentActiveTrip
              ? `✈️ โหมดปัจจุบัน: Active Trip ("${currentActiveTrip.name}")\n💡 สลิปทั้งหมดจะแยกงบเข้าทริปนี้โดยอัตโนมัติ`
              : `🟢 โหมดปัจจุบัน: บันทึกปกติ`;

            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `👋 สวัสดีครับ! ระบบ ExpenseTracker พร้อมใช้งาน:\n\n${modeText}\n\n📷 ส่งภาพสลิป → บันทึกรายการ / พอร์ตลงทุนอัตโนมัติ\n🚀 พิมพ์ "เริ่มทริป [ชื่อ]" → เปิดโหมดแยกงบเดินทาง\n🏁 พิมพ์ "จบทริป" → ปิดโหมดทริปและสรุปงบ\n📊 พิมพ์ "พอร์ต" หรือ "สรุป" → ดูยอดเงินและพอร์ต\n❓ พิมพ์ "สถานะ" → ตรวจสอบโหมดปัจจุบัน\n\n🌐 แดชบอร์ด: ${webUrl}`,
                  quickReply: createQuickReply(Boolean(currentActiveTrip)),
                },
              ],
              lineToken
            );
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
