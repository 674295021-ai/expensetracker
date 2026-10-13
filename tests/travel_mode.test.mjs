import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

// Quick Reply logic under test
function createQuickReply(isActiveTrip = false) {
  const items = [];

  if (isActiveTrip) {
    items.push({
      type: 'action',
      action: {
        type: 'message',
        label: '🏁 จบทริป',
        text: 'จบทริป',
      },
    });
  } else {
    items.push({
      type: 'action',
      action: {
        type: 'message',
        label: '🚀 เริ่มทริป',
        text: 'เริ่มทริป',
      },
    });
  }

  items.push(
    {
      type: 'action',
      action: {
        type: 'message',
        label: '📊 ดูพอร์ต',
        text: 'พอร์ต',
      },
    },
    {
      type: 'action',
      action: {
        type: 'message',
        label: '❓ เช็กสถานะ',
        text: 'สถานะ',
      },
    }
  );

  return { items };
}

describe('Travel Mode & Active Trip State Tests', () => {
  test('createQuickReply returns start_trip when in normal mode (isActiveTrip = false)', () => {
    const qr = createQuickReply(false);
    assert.ok(qr && qr.items && Array.isArray(qr.items));
    assert.strictEqual(qr.items.length, 3);

    const labels = qr.items.map((i) => i.action.label);
    assert.ok(labels.includes('🚀 เริ่มทริป'), 'Should have start trip button in normal mode');
    assert.ok(labels.includes('📊 ดูพอร์ต'), 'Should have portfolio button');
    assert.ok(labels.includes('❓ เช็กสถานะ'), 'Should have status check button');
  });

  test('createQuickReply returns end_trip when in Active Trip mode (isActiveTrip = true)', () => {
    const qr = createQuickReply(true);
    assert.ok(qr && qr.items && Array.isArray(qr.items));
    assert.strictEqual(qr.items.length, 3);

    const labels = qr.items.map((i) => i.action.label);
    assert.ok(labels.includes('🏁 จบทริป'), 'Should have end trip button in active mode');
    assert.ok(labels.includes('📊 ดูพอร์ต'), 'Should have portfolio button');
    assert.ok(labels.includes('❓ เช็กสถานะ'), 'Should have status check button');
  });

  test('LINE command regex matching for Active Trip triggers', () => {
    // Start trip command
    const startTripRegex = /^(?:เริ่มทริป|เปิดทริป|start\s*trip)(?:\s+(.+))?$/i;
    assert.ok(startTripRegex.test('เริ่มทริป เชียงใหม่'));
    assert.strictEqual('เริ่มทริป เชียงใหม่'.match(startTripRegex)[1], 'เชียงใหม่');
    assert.ok(startTripRegex.test('เริ่มทริป ญี่ปุ่น 2026'));
    assert.strictEqual('เริ่มทริป ญี่ปุ่น 2026'.match(startTripRegex)[1], 'ญี่ปุ่น 2026');
    assert.ok(startTripRegex.test('start trip Phuket'));
    assert.strictEqual('start trip Phuket'.match(startTripRegex)[1], 'Phuket');
    assert.ok(startTripRegex.test('เริ่มทริป'));
    assert.strictEqual('เริ่มทริป'.match(startTripRegex)[1], undefined);

    // End trip command
    const endTripRegex = /^(?:จบทริป|ปิดทริป|สิ้นสุดทริป|end\s*trip)$/i;
    assert.ok(endTripRegex.test('จบทริป'));
    assert.ok(endTripRegex.test('ปิดทริป'));
    assert.ok(endTripRegex.test('สิ้นสุดทริป'));
    assert.ok(endTripRegex.test('end trip'));

    // Status / Mode check command
    const statusRegex = /^(?:สถานะ|โหมด|status|mode|check|เช็กสถานะ|เช็คสถานะ)$/i;
    assert.ok(statusRegex.test('สถานะ'));
    assert.ok(statusRegex.test('โหมด'));
    assert.ok(statusRegex.test('status'));
    assert.ok(statusRegex.test('เช็กสถานะ'));
    assert.ok(statusRegex.test('check'));
  });

  test('Quick Reply item labels adhere to LINE API 20-character limit', () => {
    const qrActive = createQuickReply(true);
    const qrNormal = createQuickReply(false);

    for (const item of [...qrActive.items, ...qrNormal.items]) {
      assert.ok(item.action.label.length <= 20, `Label "${item.action.label}" exceeds LINE limit of 20 chars`);
      assert.strictEqual(item.type, 'action');
      assert.strictEqual(item.action.type, 'message');
      assert.ok(item.action.text && item.action.text.length > 0);
    }
  });

  test('Active Trip expense routing isolation logic (Pattern A: Trip-only)', () => {
    // When active trip is present, an expense must NOT be saved to transactions table
    function determineTargetTables(isExpense, activeTrip) {
      if (activeTrip && isExpense) {
        return { saveToTransactions: false, saveToTripExpenses: true };
      }
      return { saveToTransactions: true, saveToTripExpenses: false };
    }

    const inActiveTrip = determineTargetTables(true, { id: 'trip-1', name: 'เชียงใหม่' });
    assert.strictEqual(inActiveTrip.saveToTransactions, false, 'Must NOT save to transactions in active trip');
    assert.strictEqual(inActiveTrip.saveToTripExpenses, true, 'Must save to trip_expenses in active trip');

    const inNormalMode = determineTargetTables(true, null);
    assert.strictEqual(inNormalMode.saveToTransactions, true, 'Must save to transactions in normal mode');
    assert.strictEqual(inNormalMode.saveToTripExpenses, false, 'Must NOT save to trip_expenses in normal mode');
  });
});
