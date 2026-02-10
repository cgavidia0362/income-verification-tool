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
      return await processSingleChunk(fileData, fileName, false);
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
          true
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

async function processSingleChunk(fileData, fileName, isLargeFile = false) {
  const base64Data = fileData.split(',')[1] || fileData;
  
  let mimeType = 'application/pdf';
  if (fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg')) {
    mimeType = 'image/jpeg';
  } else if (fileName.toLowerCase().endsWith('.png')) {
    mimeType = 'image/png';
  }
  
  const prompt = isLargeFile ? getLongPrompt() : getShortPrompt();

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

function getShortPrompt() {
  return `Extract income transactions from this bank statement.

ONLY include money COMING IN (deposits, credits):
✅ ACH Deposits (HYCITE, PPD = ACH Deposit, not "Other")
✅ Zelle FROM someone (income)
✅ Wire transfers received
✅ Bank deposits, check deposits
✅ Transfers IN

EXCLUDE money GOING OUT:
❌ Payments TO someone (ZELLE TO, HONDA PMT)
❌ Bills, fees, withdrawals
❌ Any transaction with "PMT", "PAYMENT", "TO [name]"

Extract account number (last 4 digits) and return JSON:
{
  "accountNumber": "1514",
  "totalIncome": 0.00,
  "totalTransactions": 0,
  "months": [{
    "month": "January 2026",
    "total": 0.00,
    "categories": {"ACH Deposit": {"amount": 0.00, "count": 0}},
    "transactions": [{
      "date": "2026-01-15",
      "type": "ACH Deposit",
      "source": "HYCITE",
      "amount": 1000.00,
      "description": "ACH DEPOSIT PPD HYCITE"
    }]
  }]
}`;
}

function getLongPrompt() {
  return `You are a financial analyst AI specialized in extracting ONLY INCOMING INCOME from bank statements.

CRITICAL: YOU MUST ONLY EXTRACT MONEY COMING INTO THE ACCOUNT (DEPOSITS/CREDITS)

===== WHAT TO INCLUDE (INCOME) =====
✅ ACH Deposits from employers (HYCITE, PPD HYCITE, payroll companies)
✅ Wire Transfers RECEIVED (incoming wires)
✅ Zelle/Venmo/Cash App/PayPal RECEIVED (FROM someone, not TO someone)
✅ Direct Deposits
✅ Check Deposits
✅ Mobile Deposits  
✅ Bank Deposits / ATM Deposits
✅ Transfers IN (money coming into this account)
✅ Any transaction with: "DEPOSIT", "CR", "CREDIT", positive balance increase

===== WHAT TO EXCLUDE (NOT INCOME) =====
❌ Payments TO someone (ZELLE TO, VENMO TO, PAYMENT TO)
❌ Withdrawals / Debits / Money going OUT
❌ Bills paid (utilities, rent, car payment like HONDA PMT, insurance)
❌ ATM Withdrawals
❌ Purchase transactions
❌ Fees (monthly fees, overdraft fees, service charges)
❌ Transfers OUT to other accounts
❌ Any transaction with: "PMT", "PAYMENT", "WITHDRAWAL", "FEE", "CHARGE", "DEBIT", "TO [person name]"

===== SPECIAL CATEGORY RULES =====
- HYCITE, PPD HYCITE = "ACH Deposit" (this is employer payroll - NEVER categorize as "Other")
- Any employer name = "ACH Deposit"
- Zelle FROM [name] = "Zelle Transfer" (income)
- Zelle TO [name] = EXCLUDE COMPLETELY (outgoing payment)
- Transfer IN, TRANSFER (without "TO") = "Transfer In"
- ATM Deposit = "Bank Deposit"
- Mobile Check = "Mobile Deposit"
- Anything with "PMT" = EXCLUDE COMPLETELY (payments going out)

===== CRITICAL INSTRUCTIONS =====
1. This document may contain MULTIPLE bank statements covering DIFFERENT MONTHS
2. You MUST extract transactions from ALL MONTHS present in the document
3. Look for month/year headers throughout the ENTIRE document
4. Each month should be processed separately in the output

FIRST: Find the bank account number and extract ONLY THE LAST 4 DIGITS (or return "N/A" if not found).

THEN: Analyze this ENTIRE document and extract ALL INCOME transactions from ALL months present.

For EACH INCOME transaction, ask yourself:
- Is this money COMING IN (deposit/credit)? ✅ INCLUDE
- Is this money GOING OUT (payment/debit)? ❌ EXCLUDE

Return ONLY valid JSON with this structure:
{
  "accountNumber": "1514",
  "totalIncome": 0.00,
  "totalTransactions": 0,
  "months": [
    {
      "month": "January 2026",
      "total": 0.00,
      "categories": {
        "ACH Deposit": { "amount": 0.00, "count": 0 },
        "Zelle Transfer": { "amount": 0.00, "count": 0 }
      },
      "transactions": [
        {
          "date": "2026-01-15",
          "type": "ACH Deposit",
          "source": "HYCITE",
          "amount": 1000.00,
          "description": "ACH DEPOSIT PPD HYCITE"
        }
      ]
    }
  ]
}

IMPORTANT: 
- Return ONLY the JSON object, no other text
- Include ALL months found in the document
- NEVER include transactions with "PMT", "PAYMENT TO", "ZELLE TO", or other outgoing indicators`;
}

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
    
    if (normalized.includes('transfer in') || normalized === 'transfer in') {
      return 'Transfer In';
    }
    if (normalized.includes('zelle')) {
      return 'Zelle Transfer';
    }
    if (normalized.includes('ach')) {
      return 'ACH Deposit';
    }
    if (normalized.includes('wire')) {
      return 'Wire Transfer';
    }
    if (normalized.includes('venmo')) {
      return 'Venmo';
    }
    if (normalized.includes('cash app')) {
      return 'Cash App';
    }
    if (normalized.includes('paypal')) {
      return 'PayPal';
    }
    if (normalized.includes('bank deposit') || normalized.includes('atm')) {
      return 'Bank Deposit';
    }
    if (normalized.includes('check')) {
      return 'Check Deposit';
    }
    if (normalized.includes('mobile')) {
      return 'Mobile Deposit';
    }
    if (normalized.includes('direct deposit')) {
      return 'Direct Deposit';
    }
    
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