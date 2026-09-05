-- 0018: Recompute customers/suppliers balances from authoritative ledger
--
-- The incrementally-maintained balance columns drifted: voucher sign bugs,
-- on-account receipts that never touched the balance, cash-invoice handling,
-- and missing sales/purchase returns in the old statement logic all left
-- customers.balance / suppliers.balance stale. The statement (opening +
-- invoices - receipts - returns) is the source of truth — backfill the
-- columns so every consumer that still reads the raw column sees the correct
-- value. The new list queries (sales/purchases api + RPC) now compute the
-- same formula on read, so future drift is harmless — this migration just
-- heals history.

-- Customers: opening + posted/cancelled-excluded invoices - posted receipts - posted sales returns
UPDATE customers c SET balance = sub.computed, updated_at = NOW()
FROM (
  SELECT c2.id,
         (COALESCE(c2.opening_balance,0)
          + COALESCE((SELECT SUM(total_amount) FROM sales_invoices i WHERE i.customer_id = c2.id AND i.company_id = c2.company_id AND i.status <> 'cancelled'),0)
          - COALESCE((SELECT SUM(amount) FROM receipt_vouchers rv WHERE rv.customer_id = c2.id AND rv.company_id = c2.company_id AND rv.status = 'posted'),0)
          - COALESCE((SELECT SUM(total_amount) FROM sales_returns sr WHERE sr.customer_id = c2.id AND sr.company_id = c2.company_id AND sr.status = 'posted'),0)
         ) AS computed
  FROM customers c2
) sub
WHERE c.id = sub.id AND c.balance IS DISTINCT FROM sub.computed;

-- Suppliers: opening + purchase invoices - posted payments - posted purchase returns
UPDATE suppliers s SET balance = sub.computed, updated_at = NOW()
FROM (
  SELECT s2.id,
         (COALESCE(s2.opening_balance,0)
          + COALESCE((SELECT SUM(total_amount) FROM purchase_invoices pi WHERE pi.supplier_id = s2.id AND pi.company_id = s2.company_id AND pi.status <> 'cancelled'),0)
          - COALESCE((SELECT SUM(amount) FROM payment_vouchers pv WHERE pv.supplier_id = s2.id AND pv.company_id = s2.company_id AND pv.status = 'posted'),0)
          - COALESCE((SELECT SUM(total_amount) FROM purchase_returns pr WHERE pr.supplier_id = s2.id AND pr.company_id = s2.company_id AND pr.status = 'posted'),0)
         ) AS computed
  FROM suppliers s2
) sub
WHERE s.id = sub.id AND s.balance IS DISTINCT FROM sub.computed;
