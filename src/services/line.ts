// LINE Messaging API Service (Feature 4 - Slip OCR & Account Link)

export interface LineWebhookEvent {
  type: string;
  mode: string;
  timestamp: number;
  source: {
    type: string;
    userId: string;
  };
  replyToken?: string;
  message?: {
    id: string;
    type: string;
    text?: string;
    contentProvider?: {
      type: string;
    };
  };
}

export async function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string
): Promise<boolean> {
  if (!signature) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const base64Sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  return base64Sig === signature;
}

export async function getLineMessageContentBase64(
  messageId: string,
  accessToken: string
): Promise<{ base64: string; mimeType: string }> {
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`LINE image download failed (${res.status}): ${errBody || 'Unknown error'}`);
  }

  const mimeType = res.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await res.arrayBuffer();

  // Convert array buffer to base64
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  return { base64, mimeType };
}

export async function replyLineMessage(
  replyToken: string,
  messages: unknown[],
  accessToken: string
): Promise<boolean> {
  const url = 'https://api.line.me/v2/bot/message/reply';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`LINE Reply Error (${res.status}):`, errorText);
      return false;
    }
    return true;
  } catch (e) {
    console.error('LINE Reply network failure:', e);
    return false;
  }
}

export function createSlipRecordedFlexMessage(params: {
  amount: number;
  type: string;
  category: string;
  date: string;
  time?: string;
  recipient?: string;
  bank?: string;
  netSavings: number;
  webUrl: string;
}): unknown {
  const isIncome = params.type === 'income';
  const headerBg = isIncome ? '#059669' : '#090d16';
  const badgeBg = isIncome ? '#ecfdf5' : '#fff1f2';
  const badgeColor = isIncome ? '#059669' : '#e11d48';
  const typeText = isIncome ? 'รายรับ (Income)' : 'รายจ่าย (Expense)';
  const amountPrefix = isIncome ? '+' : '-';

  return {
    type: 'flex',
    altText: `บันทึกรายการสำเร็จ ฿${params.amount.toLocaleString('th-TH')}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBg,
        paddingAll: '16px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: '✅ บันทึกจากสลิปอัตโนมัติ',
                color: '#ffffff',
                size: 'sm',
                weight: 'bold',
                flex: 1,
              },
              {
                type: 'text',
                text: params.bank || 'Slip OCR',
                color: '#94a3b8',
                size: 'xxs',
                align: 'end',
              },
            ],
          },
          {
            type: 'text',
            text: `${amountPrefix}฿${params.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            color: '#ffffff',
            size: 'xxl',
            weight: 'bold',
            margin: 'md',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: 'ประเภท',
                color: '#94a3b8',
                size: 'xs',
                flex: 3,
              },
              {
                type: 'text',
                text: typeText,
                color: badgeColor,
                size: 'xs',
                weight: 'bold',
                flex: 5,
                align: 'end',
              },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: 'หมวดหมู่',
                color: '#94a3b8',
                size: 'xs',
                flex: 3,
              },
              {
                type: 'text',
                text: params.category,
                color: '#1e293b',
                size: 'xs',
                weight: 'bold',
                flex: 5,
                align: 'end',
              },
            ],
          },
          ...(params.recipient
            ? [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: 'ผู้รับเงิน/ร้าน',
                      color: '#94a3b8',
                      size: 'xs',
                      flex: 3,
                    },
                    {
                      type: 'text',
                      text: params.recipient,
                      color: '#1e293b',
                      size: 'xs',
                      flex: 5,
                      align: 'end',
                    },
                  ],
                },
              ]
            : []),
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: 'วัน/เวลา',
                color: '#94a3b8',
                size: 'xs',
                flex: 3,
              },
              {
                type: 'text',
                text: `${params.date} ${params.time || ''}`.trim(),
                color: '#64748b',
                size: 'xs',
                flex: 5,
                align: 'end',
              },
            ],
          },
          {
            type: 'separator',
            margin: 'md',
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: 'เงินคงเหลือสุทธิ',
                color: '#64748b',
                size: 'xs',
                weight: 'bold',
                flex: 4,
              },
              {
                type: 'text',
                text: `฿${params.netSavings.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                color: '#4f46e5',
                size: 'sm',
                weight: 'bold',
                flex: 5,
                align: 'end',
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#4f46e5',
            height: 'sm',
            action: {
              type: 'uri',
              label: '📊 เปิดดูแดชบอร์ด',
              uri: params.webUrl,
            },
          },
        ],
      },
    },
  };
}

export function createLinkAccountFlexMessage(webUrl: string): unknown {
  return {
    type: 'flex',
    altText: 'กรุณาเชื่อมต่อบัญชี ExpenseTracker Pro ก่อนใช้งาน',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#090d16',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: '🔗 เชื่อมต่อบัญชีกับระบบ',
            color: '#ffffff',
            size: 'md',
            weight: 'bold',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: 'ยังไม่พบบัญชีผู้ใช้ที่เชื่อมต่อกับ LINE นี้',
            color: '#334155',
            size: 'sm',
            weight: 'bold',
            wrap: true,
          },
          {
            type: 'text',
            text: 'วิธีเชื่อมต่อง่ายๆ ใน 1 นาที:\n1. เข้าสู่ระบบที่เว็บไซต์แดชบอร์ด\n2. ไปที่เมนู "การตั้งค่า" หรือ "เชื่อมต่อ LINE"\n3. กดปุ่ม "สร้างรหัสเชื่อมต่อ"\n4. พิมพ์รหัสที่ได้ส่งมาในแชตนี้ เช่น:\n   LINK 123456',
            color: '#64748b',
            size: 'xs',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#4f46e5',
            height: 'sm',
            action: {
              type: 'uri',
              label: '🌐 เปิดเว็บไซต์แดชบอร์ด',
              uri: webUrl,
            },
          },
        ],
      },
    },
  };
}
