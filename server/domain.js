import { z } from "zod";

export const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(4).max(128).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be 72 UTF-8 bytes or fewer."),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  kraPin: z.string().trim().max(24).optional().default(""),
});

export const businessUserSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(4).max(128).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be 72 UTF-8 bytes or fewer."),
  role: z.enum(["admin", "finance_manager", "accountant", "sales_officer", "cashier", "auditor"]),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const customerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  company: z.string().trim().max(160).optional().default(""),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  billingAddress: z.string().trim().max(500).optional().default(""),
  kraPin: z.string().trim().max(24).optional().default(""),
  notes: z.string().max(5000).optional().default(""),
});

export const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional().default(""),
  category: z.string().trim().max(100).optional().default(""),
  unitPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  taxRateBps: z.number().int().min(0).max(10000).nullable().optional(),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  taxPin: z.string().trim().max(24).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
});

export const expenseSchema = z.object({
  supplierId: z.string().uuid().nullable().optional().default(null),
  expenseDate: z.string().date(),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  reference: z.string().trim().max(120).optional().default(""),
  subtotalCents: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  taxRateBps: z.number().int().min(0).max(10000).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export function calculateExpenseTax(subtotalCents, taxRateBps) {
  return Number((BigInt(subtotalCents) * BigInt(taxRateBps) + 5000n) / 10000n);
}

const invoiceItemSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().finite().positive().max(1_000_000).refine((quantity) => Number.isInteger(quantity * 1000), "Quantity supports up to 3 decimal places."),
  unitPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  discountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().default(0),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
});

export const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  templateId: z.string().uuid().nullable().optional(),
  issueDate: z.string().date().optional(),
  dueDate: z.string().date(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  discountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().default(0),
  notes: z.string().max(5000).optional().default(""),
  terms: z.string().max(5000).optional().default(""),
  items: z.array(invoiceItemSchema).min(1).max(100),
  issueNow: z.boolean().optional().default(false),
});

export const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  method: z.enum(["mpesa", "bank_transfer", "cash", "card", "cheque", "other"]),
  reference: z.string().trim().max(120).optional().default(""),
  receivedAt: z.string().datetime().optional(),
});

export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  kraPin: z.string().trim().max(24).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  invoicePrefix: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9_-]+$/).optional(),
  invoiceLayout: z.enum(["classic", "centered", "compact", "modern"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one setting to update.");

export function calculateInvoice(items, discountCents, defaultTaxRateBps) {
  const preparedItems = items.map((item) => {
    const quantityThousandths = BigInt(Math.round(item.quantity * 1000));
    const grossCents = (quantityThousandths * BigInt(item.unitPriceCents) + 500n) / 1000n;
    const itemDiscount = BigInt(item.discountCents ?? 0);
    if (itemDiscount > grossCents) {
      throw new RangeError("An item discount cannot exceed its line amount.");
    }
    return { item, grossCents, itemDiscount };
  });
  const itemSubtotal = preparedItems.reduce((sum, item) => sum + item.grossCents, 0n);
  const itemDiscounts = preparedItems.reduce((sum, item) => sum + item.itemDiscount, 0n);
  const distributableSubtotal = itemSubtotal - itemDiscounts;
  const invoiceDiscount = BigInt(discountCents);
  if (invoiceDiscount > distributableSubtotal) {
    throw new RangeError("The invoice discount cannot exceed the subtotal after line discounts.");
  }

  const allocations = preparedItems.map(({ grossCents, itemDiscount }) => {
    const amount = grossCents - itemDiscount;
    return distributableSubtotal === 0n ? 0n : (invoiceDiscount * amount) / distributableSubtotal;
  });
  let unallocated = invoiceDiscount - allocations.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; unallocated > 0n; index = (index + 1) % allocations.length) {
    if (preparedItems[index].grossCents > preparedItems[index].itemDiscount + allocations[index]) {
      allocations[index] += 1n;
      unallocated -= 1n;
    }
  }

  let itemTax = 0n;
  let total = 0n;
  const calculatedItems = preparedItems.map(({ item, grossCents, itemDiscount }, index) => {
    const lineDiscount = itemDiscount + allocations[index];
    const taxableCents = grossCents - lineDiscount;
    const taxRateBps = item.taxRateBps ?? defaultTaxRateBps;
    const taxCents = (taxableCents * BigInt(taxRateBps) + 5000n) / 10000n;
    const lineTotalCents = taxableCents + taxCents;
    itemTax += taxCents;
    total += lineTotalCents;
    return {
      ...item,
      taxRateBps,
      lineSubtotalCents: Number(grossCents),
      lineDiscountCents: Number(lineDiscount),
      lineTaxCents: Number(taxCents),
      lineTotalCents: Number(lineTotalCents),
    };
  });
  const totalDiscount = itemDiscounts + invoiceDiscount;
  if ([itemSubtotal, totalDiscount, itemTax, total].some((amount) => amount > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new RangeError("The invoice total exceeds the supported amount.");
  }
  return {
    items: calculatedItems,
    subtotalCents: Number(itemSubtotal),
    discountCents: Number(totalDiscount),
    taxCents: Number(itemTax),
    totalCents: Number(total),
  };
}
