import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';

export async function POST(request) {
  try {
    const { fileData, fileName } = await request.json();

    if (!fileData) {
      return NextResponse.json(
        { error: 'No file data provided' },
        { status: 400 }
      );
    }

    const base64Data = fileData.split(',')[1] || fileData;
    const pdfBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();
    
    console.log(`Processing PDF with ${totalPages} pages`);
    
    if (totalPages <= 12) {
      console.log('Small file detected - processing without chunking');
      return await processSingleChunk(fileData, fileName, false, 1, 1);
    }
    
    console.log('Large file detected - splitting into chunks');
    const chunkSize = 12;
    const chunks = [];
    
    for (let i = 0; i < totalPages; i += chunkSize) {
      const chunkDoc = await PDFDocument.create();
      const endPage = Math.min(i + chunkSize, totalPages);
      const pageIndices = Array.from({ length: endPage - i }, (_, j) => i + j);
      
      const copiedPages = await chunkDoc.copyPages(pdfDoc, pageIndices);
      copiedPages.forEach(page => chunkDoc.addPage(page));
      
      const chunkBytes = await chunkDoc.save();
      const chunkBase64 = Buffer.from(chunkBytes).toString('base64');
      chunks.push(chunkBase64);
    }
    
    console.log(`Split into ${chunks.length} chunks`);
    
    const results = [];
    
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}`);
      
      try {
        const chunkResult = await processSingleChunk(
          `data:application/pdf;base64,${chunks[i]}`,
          `${fileName}_chunk_${i + 1}`,
          true,
          i + 1,
          chunks.length
        );
        
        if (chunkResult.ok) {
          const data = await chunkResult.json();
          if (data.success && data.data) {
            results.push(data.data);
          }
        }
      } catch (error) {
        console.error(`Error processing chunk ${i + 1}:`, error);
      }
      
      if (i < chunks.length - 1) {
        console.log('Waiting 90 seconds before next chunk...');
        await new Promise(resolve => setTimeout(resolve, 90000));
      }
    }
    
    if (results.length === 0) {
      throw new Error('No chunks processed successfully');
    }
    
    const mergedResult = mergeResults(results);
    
    return NextResponse.json({
      success: true,
      data: mergedResult,
      chunksProcessed: chunks.length
    });
    
  } catch (error) {
    console.error('Error in chunked processing:', error);
    return NextResponse.json(
      {
        error: 'Failed to process document',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

async function processSingleChunk(fileData, fileName, isLargeFile = false, chunkNumber = 1, totalChunks = 1) {
  const base64Data = fileData.split(',')[1] || fileData;
  
  let mimeType = 'application/pdf';
  if (fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg')) {
    mimeType = 'image/jpeg';
  } else if (fileName.toLowerCase().endsWith('.png')) {
    mimeType = 'image/png';
  }
  
  const prompt = isLargeFile
    ? getLongPrompt(chunkNumber, totalChunks)
    : getShortPrompt();

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        topK: 1,
        topP: 1,
        maxOutputTokens: 16384
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Gemini API error: ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  const text = data.candidates[0].content.parts[0].text;

  let jsonText = text.trim();
  
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/```\n?/g, '');
  }

  const analysisResult = JSON.parse(jsonText);

  return NextResponse.json({
    success: true,
    data: analysisResult,
  });
}

// ─── SHORT PROMPT (files 12 pages or fewer) ───────────────────────────────────
function getShortPrompt() {
  return `You are a financial analyst extracting ONLY income deposits from a bank statement.

YOUR SINGLE RULE: Only include money COMING IN to the account. When in doubt, EXCLUDE it.

===================================================================
WARNING: SPECIAL REPORT FORMAT HANDLING (TURBOPASS / BRAVO / PLAID)
===================================================================

Some documents are pre-formatted verification reports (TurboPass BRAVO, Plaid, etc.)
that contain TWO sections showing the same transactions:

SECTION 1 - "Deposits" (or "Credits"): Already pre-filtered BY THE BANK to show
  ONLY money coming IN. If you see this section, USE IT AS YOUR PRIMARY SOURCE.

  *** CRITICAL RULE FOR TURBOPASS/BRAVO DEPOSITS SECTION ***
  EVERY SINGLE ROW in the Deposits section is income. Do not skip any row.
  ALL THREE deposit types must be extracted - include every single one:
    - P2PCredits rows      -> INCLUDE ALL as "Zelle Transfer"
    - General Deposit rows -> INCLUDE ALL as "ACH Deposit" or "Business Deposit"
    - ATMDeposits rows     -> INCLUDE ALL as "Bank Deposit"
  Do NOT filter, skip, or exclude any row from the Deposits section for any reason.
  The bank already did the filtering. Every row shown is a legitimate deposit.
  Even small P2PCredits amounts like $5, $7, $10 MUST be included.

SECTION 2 - "Transaction History" (full ledger with Debit/Credit columns):
  Shows ALL transactions including outgoing.
  IF a Deposits section exists above, IGNORE the Transaction History section entirely.
  Do not use it to add or remove any transactions.

CRITICAL PASS-THROUGH RULE: If a person received $1,000 from someone and then
sent $1,000 to someone else on the same day, that is STILL $1,000 in income.
The receipt and the payment are two completely separate events.
NEVER cancel out a deposit because a matching outflow exists on the same date.
NEVER zero out a month because inflows and outflows look similar in size.

TurboPass/BRAVO category labels - map them exactly as follows:
  "P2PCredits"         -> "Zelle Transfer"   (Zelle/Venmo/peer payments received)
  "General Deposit"    -> "ACH Deposit"      (payroll, gig platforms, misc ACH)
  "ATMDeposits"        -> "Bank Deposit"     (ATM deposits, mobile, branch)
  "Internal Transfers" -> EXCLUDE
  "Refunds"            -> EXCLUDE
  "Loan Advances"      -> EXCLUDE

===================================================================
ALWAYS INCLUDE THESE (income/deposits)
===================================================================
- ACH Deposits from employers or payroll processors
  Payroll processors: ADP, PAYCHEX, GUSTO, CERIDIAN, KRONOS, PAYLOCITY, HEARTLAND
  UNITED MAINTENAN, DANDELION PAYMEN = payroll ACH -> "ACH Deposit"
  Keywords: PPD, CCD, PAYROLL, DIRECT DEP
- Wire Transfers RECEIVED
- Zelle / Venmo / Cash App / PayPal RECEIVED from someone
  "Zelle payment from [name]" = INCLUDE
  "Zelle payment to [name]" = EXCLUDE
- Check Deposits, Mobile Deposits, ATM Deposits (BKOFAMERICA ATM DEPOSIT = INCLUDE)
- Gig platform payouts: Lyft, DoorDash, Payfare, Uber Driver -> "Business Deposit"
  Keywords: PMNT RCVD, Payfare/Lyft Dir DES:Deposit, Doordash Inc PMNT RCVD
- Government benefits: SSA, SSDI, SSI, VA BENEFIT, UNEMPLOYMENT, EDD

===================================================================
ALWAYS EXCLUDE THESE (not income)
===================================================================
- Any outgoing payment: PMT, PAYMENT, BILL PAY, TO [name], WITHDRWL, PMNT SENT
- Zelle / Venmo / Cash App TO someone (outgoing)
- PURCHASE, CHECKCARD, MOBILE PURCHASE, DEBIT
- Bank fees, service charges, overdraft fees, NSF fees, RETURN FEE, RETRY PYMT
- Temporary Credit Adjustment (bank dispute credit, not income)
- PURCHASE REFUND, REFUND, REVERSAL, CHARGEBACK
- CHECKCARD entries showing a positive amount for a merchant name
  (these are subscription reversals, not income)
- Loan proceeds, cash advances: LOAN PROCEEDS, ADVANCE, DRAW, CREDIT LINE

===================================================================
CATEGORY RULES
===================================================================
- Employer / payroll / UNITED MAINTENAN / DANDELION PAYMEN -> "ACH Deposit"
- Zelle payment from [name] -> "Zelle Transfer"
- Venmo received -> "Venmo"
- Cash App received -> "Cash App"
- PayPal received -> "PayPal"
- Wire received -> "Wire Transfer"
- SSA, SSDI, VA, EDD, unemployment -> "Government Benefit"
- ATM deposit, branch deposit, BKOFAMERICA ATM DEPOSIT -> "Bank Deposit"
- BKOFAMERICA MOBILE DEPOSIT, mobile check -> "Mobile Deposit"
- Lyft, DoorDash, Payfare, Uber Driver payout -> "Business Deposit"
- Transfer IN from external bank -> "Transfer In"
- NEVER use "Other" - if no category fits, EXCLUDE it

===================================================================
OUTPUT
===================================================================
Find the account number (last 4 digits only). Return ONLY this JSON, no other text:

{
  "accountNumber": "5475",
  "totalIncome": 0.00,
  "totalTransactions": 0,
  "months": [
    {
      "month": "January 2026",
      "total": 0.00,
      "categories": {
        "ACH Deposit": { "amount": 0.00, "count": 0 },
        "Zelle Transfer": { "amount": 0.00, "count": 0 },
        "Bank Deposit": { "amount": 0.00, "count": 0 }
      },
      "transactions": [
        {
          "date": "2026-01-09",
          "type": "ACH Deposit",
          "source": "UNITED MAINTENAN",
          "amount": 843.19,
          "description": "UNITED MAINTENAN DES:PAYROLL PPD"
        },
        {
          "date": "2026-01-05",
          "type": "Zelle Transfer",
          "source": "KAROLL SANMIGUEL",
          "amount": 7.00,
          "description": "Zelle payment from KAROLL SANMIGUEL"
        }
      ]
    }
  ]
}`;
}

// ─── LONG PROMPT (large files, chunked) ───────────────────────────────────────
function getLongPrompt(chunkNumber = 1, totalChunks = 1) {
  const chunkContext = totalChunks > 1
    ? `NOTE: You are processing CHUNK ${chunkNumber} of ${totalChunks} from a large document. Extract all months and transactions visible in this chunk only. The account number may appear on any page - use the first one you find.`
    : '';

  return `You are a financial analyst AI. Your job is to extract ONLY INCOMING INCOME from a bank statement.

${chunkContext ? `WARNING: ${chunkContext}\n` : ''}
MASTER RULE: When you are uncertain whether a transaction is income - EXCLUDE IT.

===================================================================
WARNING: SPECIAL REPORT FORMAT HANDLING (TURBOPASS / BRAVO / PLAID)
===================================================================

Some documents are pre-formatted verification reports (TurboPass BRAVO, Plaid, etc.)
that contain TWO sections showing the same transactions:

SECTION 1 - "Deposits" (or "Credits"): Already pre-filtered BY THE BANK to show
  ONLY money coming IN. This section is the authoritative income list.
  USE THIS SECTION AS YOUR PRIMARY SOURCE.

  *** CRITICAL RULE FOR TURBOPASS/BRAVO DEPOSITS SECTION ***
  EVERY SINGLE ROW in the Deposits section is income. Do not skip any row.
  ALL THREE deposit types must be extracted - include every single one:
    - P2PCredits rows      -> INCLUDE ALL as "Zelle Transfer"
    - General Deposit rows -> INCLUDE ALL as "ACH Deposit" or "Business Deposit"
    - ATMDeposits rows     -> INCLUDE ALL as "Bank Deposit"
  Do NOT filter, skip, or exclude any row from the Deposits section for any reason.
  The bank already did the filtering. Every row shown is a legitimate deposit.
  Even small P2PCredits amounts like $5, $7, $10 MUST be included.
  A month with 20 P2PCredit rows should return 20 Zelle Transfer transactions.

SECTION 2 - "Transaction History" (or full ledger with Debit/Credit columns):
  Shows ALL transactions including outgoing.
  IF a Deposits section exists in this document, IGNORE the Transaction History
  section entirely. Do not use it to add or remove any transactions whatsoever.

CRITICAL PASS-THROUGH RULE: If a person received $1,000 from someone and then
sent $1,000 to someone else on the same day, that is STILL $1,000 in income.
The receipt and the payment are two completely separate events.
NEVER cancel out a deposit because a matching outflow exists on the same date.
NEVER zero out a month because inflows and outflows look similar in size.
A person who runs money through their account (receives $1,000, sends $1,000)
still received $1,000 in income - include the receipt, exclude the payment.

TurboPass/BRAVO category labels - map them exactly as follows:
  "P2PCredits"         -> "Zelle Transfer"   (Zelle/Venmo/peer payments received)
  "General Deposit"    -> "ACH Deposit"      (payroll, gig platforms, misc ACH)
  "ATMDeposits"        -> "Bank Deposit"     (ATM deposits, mobile, branch)
  "Internal Transfers" -> EXCLUDE
  "Refunds"            -> EXCLUDE
  "Loan Advances"      -> EXCLUDE

===================================================================
WHAT TO INCLUDE - Money COMING IN to the account
===================================================================

1. ACH DEPOSITS (employer payroll / direct deposit)
   - Any company name paying an employee via ACH
   - Known payroll processors: ADP, PAYCHEX, GUSTO, CERIDIAN, KRONOS,
     PAYLOCITY, HEARTLAND, BAMBOOHR, RIPPLING, TRINET, JUSTWORKS
   - Keywords that confirm income: PPD, CCD, PAYROLL, DIRECT DEP, DIRECT DEPOSIT
   - HYCITE and PPD HYCITE are ALWAYS "ACH Deposit" - never categorize as "Other"
   - UNITED MAINTENAN, DANDELION PAYMEN = employer/payroll ACH -> "ACH Deposit"

2. WIRE TRANSFERS RECEIVED
   - Keywords: WIRE IN, WIRE CREDIT, INCOMING WIRE, FEDWIRE CREDIT

3. PEER-TO-PEER PAYMENTS RECEIVED
   - "Zelle payment from [name]" = INCLUDE (note: FROM not TO)
   - "Zelle payment to [name]" = EXCLUDE (outgoing)
   - Venmo FROM [name], Cash App FROM [name], PayPal TRANSFER FROM
   - Even small amounts ($5, $7, $10) are valid if they are FROM someone
   - In TurboPass reports, ALL P2PCredits rows = income, include every single one

4. PHYSICAL / CHECK DEPOSITS
   - Check deposit, mobile check deposit, ATM check deposit
   - BKOFAMERICA ATM DEPOSIT = Bank Deposit - INCLUDE
   - BKOFAMERICA MOBILE DEPOSIT = Mobile Deposit - INCLUDE

5. GIG / PLATFORM INCOME
   - Lyft, Uber Driver, DoorDash, Instacart, Amazon Flex payouts
   - Payfare/Lyft Dir DES:Deposit, PayFare PMNT RCVD -> "Business Deposit"
   - Doordash, Inc. PMNT RCVD -> "Business Deposit"
   - Keywords: PMNT RCVD, DES:Deposit (from gig platform)

6. GOVERNMENT BENEFITS
   - SSA, SSDI, SSI, VA BENEFIT, UNEMPLOYMENT, EDD, STATE UI, TAX REFUND (IRS)

===================================================================
WHAT TO EXCLUDE - Money GOING OUT or Not Income
===================================================================

1. OUTGOING PAYMENTS (any kind)
   - "Zelle payment to [name]" - the word TO confirms outgoing
   - Keywords: PMT, PAYMENT, BILL PAY, AUTO PAY, AUTOPAY
   - WITHDRWL, WITHDRAWAL, ATM WITHDRWL
   - PURCHASE, CHECKCARD, MOBILE PURCHASE, DEBIT
   - PMNT SENT (outgoing wire/remittance like Western Union)

2. BANK FEES AND CHARGES
   - SERVICE CHARGE, MONTHLY FEE, OVERDRAFT FEE, NSF FEE, RETURN FEE, RETRY PYMT

3. INTERNAL TRANSFERS (same bank)
   - Only exclude if clearly same-bank internal movement

4. LOAN PROCEEDS AND CASH ADVANCES (not earned income)
   - Keywords: LOAN PROCEEDS, PERSONAL LOAN, CASH ADVANCE, DRAW, CREDIT LINE,
     OVERDRAFT TRANSFER, OVERDRAFT ADVANCE

5. REFUNDS AND REVERSALS (not earned income)
   - PURCHASE REFUND = EXCLUDE
   - REFUND, REVERSAL, CHARGEBACK, RETURN = EXCLUDE
   - "Temporary Credit Adjustment" = EXCLUDE (bank dispute credit, not income)
   - CHECKCARD entry showing a POSITIVE amount for a merchant/subscription name
     = EXCLUDE (e.g., "CHECKCARD 1117 EQT*AMBETTER&WELL" as a credit is a
       subscription reversal - not income)

===================================================================
CATEGORY MAPPING - Use exactly these category names
===================================================================
- UNITED MAINTENAN, DANDELION PAYMEN, employer via ACH -> "ACH Deposit"
- Zelle payment from [name]                            -> "Zelle Transfer"
- Venmo received from someone                          -> "Venmo"
- Cash App received from someone                       -> "Cash App"
- PayPal received                                      -> "PayPal"
- Wire transfer received                               -> "Wire Transfer"
- SSA, SSDI, SSI, VA, EDD, unemployment                -> "Government Benefit"
- ATM deposit, branch deposit, BKOFAMERICA ATM DEPOSIT -> "Bank Deposit"
- BKOFAMERICA MOBILE DEPOSIT, mobile check             -> "Mobile Deposit"
- Lyft, DoorDash, Payfare, Uber Driver, gig payout     -> "Business Deposit"
- Transfer IN from external bank                       -> "Transfer In"
- NEVER use "Other" - if it does not fit a category above, EXCLUDE it

===================================================================
DECISION GUIDE - For ambiguous transactions
===================================================================
Q1: Is this document a TurboPass/BRAVO report with a Deposits section?
    -> YES: Extract EVERY row in the Deposits section. Skip to INSTRUCTIONS.
    -> NO: Continue to Q2.

Q2: Does the description say "payment TO", "WITHDRWL", "PURCHASE", "DEBIT",
    or "PMNT SENT"?
    -> YES: EXCLUDE (outgoing)

Q3: Is this a "Temporary Credit Adjustment", "PURCHASE REFUND", or "REFUND"?
    -> YES: EXCLUDE (not income)

Q4: Is this a CHECKCARD entry showing a positive/credit amount for a merchant?
    -> YES: EXCLUDE (subscription reversal, not income)

Q5: Does it say "Zelle payment from [name]", "PMNT RCVD" from Lyft/DoorDash,
    or show a clear deposit/credit FROM an external source?
    -> YES: INCLUDE

Q6: Is money clearly arriving FROM an employer, person, gig platform, or
    government into this account?
    -> YES: INCLUDE
    -> NOT SURE: EXCLUDE

===================================================================
INSTRUCTIONS
===================================================================
1. Find the account number - last 4 digits only (or "N/A")
2. If a "Deposits" section exists, extract EVERY row from it as income
3. Process ALL months visible in this document - do not skip any month
4. All amounts must be positive numbers
5. Dates must be in YYYY-MM-DD format
6. "source" should be the payer name (e.g., "ARIZONA BROTHERS MAINTENANCE LLC")
7. "description" should be the raw transaction text from the statement

Return ONLY valid JSON - no explanations, no markdown fences, no other text:

{
  "accountNumber": "5475",
  "totalIncome": 0.00,
  "totalTransactions": 0,
  "months": [
    {
      "month": "February 2026",
      "total": 0.00,
      "categories": {
        "ACH Deposit": { "amount": 0.00, "count": 0 },
        "Zelle Transfer": { "amount": 0.00, "count": 0 },
        "Bank Deposit": { "amount": 0.00, "count": 0 }
      },
      "transactions": [
        {
          "date": "2026-02-20",
          "type": "ACH Deposit",
          "source": "UNITED MAINTENAN",
          "amount": 624.52,
          "description": "UNITED MAINTENAN DES:PAYROLL PPD"
        },
        {
          "date": "2026-02-23",
          "type": "Zelle Transfer",
          "source": "ARIZONA BROTHERS MAINTENANCE LLC",
          "amount": 1017.00,
          "description": "Zelle payment from ARIZONA BROTHERS MAINTENANCE LLC"
        },
        {
          "date": "2026-02-02",
          "type": "Bank Deposit",
          "source": "BKOFAMERICA ATM",
          "amount": 50.00,
          "description": "BKOFAMERICA ATM 01/31 DEPOSIT ENGLEWOOD"
        }
      ]
    }
  ]
}`;
}

// ─── MERGE LOGIC ──────────────────────────────────────────────────────────────
function mergeResults(results) {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];
  
  const merged = {
    accountNumber: results[0].accountNumber || 'N/A',
    totalIncome: 0,
    totalTransactions: 0,
    months: []
  };
  
  const monthMap = new Map();
  
  const normalizeDescription = (desc) => {
    return desc
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[^\w\s]/g, '');
  };
  
  const normalizeCategory = (type) => {
    const normalized = type.toLowerCase().trim();
    
    if (normalized.includes('transfer in') || normalized === 'transfer in') return 'Transfer In';
    if (normalized.includes('zelle'))          return 'Zelle Transfer';
    if (normalized.includes('ach'))            return 'ACH Deposit';
    if (normalized.includes('wire'))           return 'Wire Transfer';
    if (normalized.includes('venmo'))          return 'Venmo';
    if (normalized.includes('cash app'))       return 'Cash App';
    if (normalized.includes('paypal'))         return 'PayPal';
    if (normalized.includes('government'))     return 'Government Benefit';
    if (normalized.includes('business'))       return 'Business Deposit';
    if (normalized.includes('bank deposit') || normalized.includes('atm')) return 'Bank Deposit';
    if (normalized.includes('mobile'))         return 'Mobile Deposit';
    if (normalized.includes('check'))          return 'Check Deposit';
    if (normalized.includes('direct deposit')) return 'Direct Deposit';
    
    return type;
  };
  
  results.forEach(result => {
    if (result.months && Array.isArray(result.months)) {
      result.months.forEach(month => {
        const monthKey = month.month;
        
        if (monthMap.has(monthKey)) {
          const existing = monthMap.get(monthKey);
          
          const existingTxSet = new Set(
            existing.transactions.map(tx => {
              const normalizedDesc = normalizeDescription(tx.description || '');
              const amount = Number(tx.amount).toFixed(2);
              const date = tx.date;
              return `${date}|${amount}|${normalizedDesc}`;
            })
          );
          
          if (month.transactions) {
            month.transactions.forEach(tx => {
              const normalizedDesc = normalizeDescription(tx.description || '');
              const amount = Number(tx.amount).toFixed(2);
              const date = tx.date;
              const txKey = `${date}|${amount}|${normalizedDesc}`;
              
              if (!existingTxSet.has(txKey)) {
                const normalizedTx = {
                  ...tx,
                  type: normalizeCategory(tx.type),
                  amount: Number(tx.amount)
                };
                existing.transactions.push(normalizedTx);
                existingTxSet.add(txKey);
              }
            });
          }
          
          existing.total = existing.transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
          
          existing.categories = {};
          existing.transactions.forEach(tx => {
            const catType = tx.type;
            if (!existing.categories[catType]) {
              existing.categories[catType] = { amount: 0, count: 0 };
            }
            existing.categories[catType].amount += Number(tx.amount);
            existing.categories[catType].count += 1;
          });
          
        } else {
          const normalizedTransactions = (month.transactions || []).map(tx => ({
            ...tx,
            type: normalizeCategory(tx.type),
            amount: Number(tx.amount)
          }));
          
          const normalizedCategories = {};
          normalizedTransactions.forEach(tx => {
            if (!normalizedCategories[tx.type]) {
              normalizedCategories[tx.type] = { amount: 0, count: 0 };
            }
            normalizedCategories[tx.type].amount += Number(tx.amount);
            normalizedCategories[tx.type].count += 1;
          });
          
          monthMap.set(monthKey, {
            month: month.month,
            total: normalizedTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0),
            categories: normalizedCategories,
            transactions: normalizedTransactions
          });
        }
      });
    }
  });
  
  merged.months = Array.from(monthMap.values()).sort((a, b) => {
    const dateA = new Date(a.month);
    const dateB = new Date(b.month);
    return dateB - dateA;
  });
  
  merged.months.forEach(month => {
    merged.totalIncome += month.total;
    merged.totalTransactions += month.transactions.length;
  });
  
  return merged;
}