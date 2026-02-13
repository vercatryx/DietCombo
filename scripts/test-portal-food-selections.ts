/**
 * Unit test for portal Food selection logic: when orderConfig has empty vendorSelections
 * and items in deliveryDayOrders, the UI must show items from deliveryDayOrders.
 *
 * Run: npm run debug-portal-food (or npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/test-portal-food-selections.ts)
 */

// Same logic as ClientPortalInterface renderFoodOrderSection (selectionsToRender)
function getSelectionsToRender(orderConfig: any): any[] {
  const isAlreadyMultiDay = orderConfig.deliveryDayOrders && typeof orderConfig.deliveryDayOrders === 'object';
  let currentSelections = orderConfig.vendorSelections || [];

  if (isAlreadyMultiDay) {
    const deliveryDays = Object.keys(orderConfig.deliveryDayOrders).sort();
    const vendorMap = new Map<string, any>();
    const vendorsByDay: { [day: string]: any[] } = {};
    for (const day of deliveryDays) {
      const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
      for (const sel of daySelections) {
        if (!sel.vendorId) continue;
        if (!vendorsByDay[day]) vendorsByDay[day] = [];
        vendorsByDay[day].push(sel);
      }
    }
    for (const day of deliveryDays) {
      for (const sel of vendorsByDay[day] || []) {
        if (!vendorMap.has(sel.vendorId)) {
          vendorMap.set(sel.vendorId, {
            vendorId: sel.vendorId,
            selectedDeliveryDays: [],
            itemsByDay: {},
          });
        }
        const vendorSel = vendorMap.get(sel.vendorId);
        if (!vendorSel.selectedDeliveryDays.includes(day)) {
          vendorSel.selectedDeliveryDays.push(day);
        }
        vendorSel.itemsByDay[day] = sel.items || {};
      }
    }
    if (Array.from(vendorMap.values()).length > 0) {
      currentSelections = Array.from(vendorMap.values());
    }
  }

  const hasItemsInVendorSelections =
    orderConfig.vendorSelections?.some((s: any) => s?.items && Object.keys(s.items || {}).length > 0) ?? false;
  const selectionsToRender =
    orderConfig.vendorSelections &&
    orderConfig.vendorSelections.length > 0 &&
    hasItemsInVendorSelections
      ? orderConfig.vendorSelections
      : currentSelections;

  return selectionsToRender;
}

function countItems(selections: any[]): number {
  let n = 0;
  for (const sel of selections) {
    const items = sel?.items ?? {};
    if (typeof items === 'object') n += Object.keys(items).length;
    const byDay = sel?.itemsByDay;
    if (byDay && typeof byDay === 'object') {
      for (const day of Object.keys(byDay)) {
        const dayItems = byDay[day] ?? {};
        n += Object.keys(dayItems).length;
      }
    }
  }
  return n;
}

// Order shape for client 70e5781b: empty vendorSelections, items in deliveryDayOrders.Wednesday
const orderConfigFromDb = {
  serviceType: 'Food',
  caseId: '9632b172-3e91-4052-b950-f51f47d85c2a',
  vendorSelections: [{ items: {}, vendorId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }],
  deliveryDayOrders: {
    Wednesday: {
      vendorSelections: [
        {
          items: {
            '8088cf2b-8314-4f1c-b50c-88059163d80d': 1,
            'aeb62acc-5576-4fa8-8ed6-c132bb6bc9e5': 3,
            'item2222-2222-2222-2222-222222222221': 1,
            'item2222-2222-2222-2222-222222222223': 2,
            'item3333-3333-3333-3333-333333333332': 1,
          },
          vendorId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        },
      ],
    },
  },
};

const selections = getSelectionsToRender(orderConfigFromDb);
const totalItems = countItems(selections);

if (selections.length === 0) {
  console.error('FAIL: selectionsToRender is empty; portal would show zero.');
  process.exit(1);
}
if (totalItems === 0) {
  console.error('FAIL: selections have 0 items; portal would show zero.');
  process.exit(1);
}

console.log('PASS: selectionsToRender has', selections.length, 'selection(s) with', totalItems, 'item entries.');
console.log('Portal will display these items (missing menu_item IDs may show as "contact support").');
