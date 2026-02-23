# Investigation: GITTEL GRADSTEIN – One Order vs Two Labels on “the 22”

**Vendor page:** `http://localhost:3000/vendors/cccccccc-cccc-cccc-cccc-cccccccccccc`  
**Observation:** GITTEL GRADSTEIN appears to have only one order on the 22nd, but two labels were printed for her for that date.

---

## Script and how to run

- **Script:** `scripts/investigate-gittel-gradstein-labels.ts`
- **Run:**
  ```bash
  npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/investigate-gittel-gradstein-labels.ts
  ```

---

## Findings (run on 2025-02-23)

### 1. Client and dates

- **Client:** GITTEL GRADSTEIN  
  - `client_id`: `f31aa6f4-2ae4-41c9-9db4-83ccbf828f4b`  
  - **Dependant** of parent `dccee7a7-f4a8-4c74-84b2-879f4ae45c2e`.

- **Orders for this vendor (cccccccc-cccc-cccc-cccc-cccccccccccc):**
  - **2025-02-22, 2026-02-22, 2024-02-22:** No orders for GITTEL (and none for the parent on those dates).
  - **2026-02-23:**  
    - **1 order in GITTEL’s name:** Order #101860 (`id`: `23f6a4cd-8add-48bc-8c8f-f21e3e7c6d49`), `client_id` = GITTEL.  
    - The parent also has 1 order on 2026-02-23 (so two separate orders that day: one parent, one GITTEL).

So in the DB, the only order for **GITTEL** with this vendor is on **2026-02-23**, not 2026-02-22. If “the 22” was meant as the 23rd (e.g. timezone or colloquial), that would match this order.

### 2. Why two labels for one order?

On the vendor page there are **two** label actions:

1. **“Download Labels”**  
   - **1 label per order** (and 1 per dependant without their own order).  
   - So 1 order for GITTEL → **1 label** with her name.

2. **“Labels – address + order details (2 per customer)”**  
   - Uses `generateLabelsPDFTwoPerCustomer` in `lib/label-utils.ts`.  
   - **Intentionally prints 2 labels per order:** one row = left label (name, address, QR, notes) + right label (name, driver, stop, full order details).  
   - So **1 order for GITTEL → 2 labels** with her name.

So if the **“Labels – address + order details (2 per customer)”** button was used, **one order for GITTEL producing two labels is expected behavior**, not a bug.

### 3. Dependant vs “one order”

- GITTEL is a **dependant**; the parent also has an order on 2026-02-23.  
- The “Download Labels” flow adds one label per dependant **who does not have their own order**.  
- Here GITTEL **does** have her own order (101860), so she is not added as an extra row from the parent’s order. So we still have exactly **one order** and **one extra “dependant” label** is not the cause of the two labels.  
- The two labels are explained by the **“2 per customer”** option.

---

## Conclusion

- **Why two labels for GITTEL?**  
  Because the **“Labels – address + order details (2 per customer)”** option is designed to print **2 labels per order** (one row = two labels). One order for GITTEL therefore correctly produces 2 labels.

- **Date note:**  
  In the DB, GITTEL’s only order with this vendor is on **2026-02-23**. There are no orders for her on 2026-02-22; if “the 22” was intended as the 23rd, the above still applies.

No code changes are required; the behavior matches the current design of the two-per-customer label export.
