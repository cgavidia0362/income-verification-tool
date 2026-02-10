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
    
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    
    console.log(`Processing PDF with ${totalPages} pages`);
    
    if (totalPages <= 12) {
      console.log('Small file detected - processing without chunking');
      return await processSingleChunk(fileData, fileName);
    }
    
    console.log('Large file detected - splitting into chunks');
    const chunkSize = 12;
    const chunks = [];
    
    for (let i = 0; i < totalPages; i += chunkSize) {
      const chunkDoc = await PDFDocument.create();
      const endPage = Math.min(i + chunkSize, totalPages);
      const pageIndices = Array.from({ length: endPage - i }, (_, j) => i + j);
      
      const copiedPages = await pdfDoc.copyPages(pdfDoc, pageIndices);
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
          `${fileName}_chunk_${i + 1}`
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

async function processSingleChunk(fileData, fileName) {
  const base64Data = fileData.split(',')[1] || fileData;
  
  let mimeType = 'application/pdf';
  if (fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg')) {
    mimeType = 'image/jpeg';
  } else if (fileName.toLowerCase().endsWith('.png')) {
    mimeType = 'image/png';
  }
  
  const prompt = `You are a financial analyst AI specialized in extracting income data from bank statements, credit card statements, and other financial documents.

CRITICAL INSTRUCTIONS:
1. This document may contain MULTIPLE bank statements covering DIFFERENT MONTHS
2. You MUST extract transactions from ALL MONTHS present in the document
3. Look for month/year headers throughout the ENTIRE document
4. Each month should be processed separately in the output

FIRST, find the bank account number on the statement and extract ONLY THE LAST 4 DIGITS (or return "N/A" if not found).

THEN, analyze this ENTIRE document and extract ALL income transactions (money coming INTO the account) from ALL months present.

For EACH income transaction, identify:
1. Date - The exact date of the transaction (including month and year)
2. Type - Categorize as one of these: "ACH Deposit", "Wire Transfer", "Zelle Transfer", "Venmo", "Cash App", "PayPal", "Bank Deposit", "Check Deposit", "Mobile Deposit", "Direct Deposit", "Transfer In", or "Other"
3. Source - The name of the person or company that sent the money (extract from description)
4. Amount - The dollar amount (numbers only, no symbols)
5. Description - The original transaction description from the statement

Group transactions by MONTH and provide:
- Monthly totals
- Category breakdowns (how much from each transaction type per month)
- Individual transaction details

CRITICAL RULES:
- ONLY include INCOMING money (deposits, credits, transfers IN)
- EXCLUDE outgoing payments, withdrawals, debits, fees, purchases
- If you see "CR" or "CREDIT" or positive amounts in a deposit column, those are income
- Extract the source name from descriptions
- Process EVERY page of the document
- If there are multiple months, create separate month objects for each

Return your response as a valid JSON object with this EXACT structure:
{
  "accountNumber": "1514",
  "totalIncome": 0.00,
  "totalTransactions": 0,
  "months": [
    {
      "month": "November 2025",
      "total": 0.00,
      "categories": {
        "ACH Deposit": { "amount": 0.00, "count": 0 },
        "Zelle Transfer": { "amount": 0.00, "count": 0 }
      },
      "transactions": [
        {
          "date": "2025-11-15",
          "type": "ACH Deposit",
          "source": "Company Name",
          "amount": 1000.00,
          "description": "Original description from statement"
        }
      ]
    }
  ]
}

IMPORTANT: 
- Return ONLY the JSON object, no other text before or after
- Include ALL months found in the document
- Make sure totalIncome and totalTransactions reflect the sum across ALL months`;

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
  
  results.forEach(result => {
    merged.totalIncome += result.totalIncome || 0;
    merged.totalTransactions += result.totalTransactions || 0;
    
    if (result.months && Array.isArray(result.months)) {
      result.months.forEach(month => {
        const monthKey = month.month;
        
        if (monthMap.has(monthKey)) {
          const existing = monthMap.get(monthKey);
          
          existing.total += month.total || 0;
          
          if (month.transactions) {
            existing.transactions.push(...month.transactions);
          }
          
          if (month.categories) {
            Object.keys(month.categories).forEach(catKey => {
              if (existing.categories[catKey]) {
                existing.categories[catKey].amount += month.categories[catKey].amount || 0;
                existing.categories[catKey].count += month.categories[catKey].count || 0;
              } else {
                existing.categories[catKey] = { ...month.categories[catKey] };
              }
            });
          }
        } else {
          monthMap.set(monthKey, {
            month: month.month,
            total: month.total || 0,
            categories: JSON.parse(JSON.stringify(month.categories || {})),
            transactions: [...(month.transactions || [])]
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
  
  return merged;
}