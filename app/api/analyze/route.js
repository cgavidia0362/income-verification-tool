import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { fileData, fileName } = await request.json();

    if (!fileData) {
      return NextResponse.json(
        { error: 'No file data provided' },
        { status: 400 }
      );
    }

    // Prepare the file
    const base64Data = fileData.split(',')[1] || fileData;
    
    // Determine mime type
    let mimeType = 'application/pdf';
    if (fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg')) {
      mimeType = 'image/jpeg';
    } else if (fileName.toLowerCase().endsWith('.png')) {
      mimeType = 'image/png';
    }

    // Create the enhanced prompt for multi-month documents
    const prompt = `You are a financial analyst AI specialized in extracting income data from bank statements, credit card statements, and other financial documents.

CRITICAL INSTRUCTIONS:
1. This document may contain MULTIPLE bank statements covering DIFFERENT MONTHS (e.g., January, February, March, etc.)
2. You MUST extract transactions from ALL MONTHS present in the document
3. Look for month/year headers throughout the ENTIRE document
4. Each month should be processed separately in the output

FIRST, find the bank account number on the statement and extract ONLY THE LAST 4 DIGITS (or return "N/A" if not found).

THEN, analyze this ENTIRE document and extract ALL income transactions (money coming INTO the account) from ALL months present.

For EACH income transaction, identify:
1. **Date** - The exact date of the transaction (including month and year)
2. **Type** - Categorize as one of these: "ACH Deposit", "Wire Transfer", "Zelle Transfer", "Venmo", "Cash App", "PayPal", "Bank Deposit", "Check Deposit", "Mobile Deposit", "Direct Deposit", "Transfer In", or "Other"
3. **Source** - The name of the person or company that sent the money (extract from description)
4. **Amount** - The dollar amount (numbers only, no symbols)
5. **Description** - The original transaction description from the statement

Group transactions by MONTH and provide:
- Monthly totals
- Category breakdowns (how much from each transaction type per month)
- Individual transaction details

CRITICAL RULES:
- ONLY include INCOMING money (deposits, credits, transfers IN)
- EXCLUDE outgoing payments, withdrawals, debits, fees, purchases
- If you see "CR" or "CREDIT" or positive amounts in a deposit column, those are income
- Extract the source name from descriptions (e.g., "ACH DEPOSIT ACME CORP PAYROLL" → source is "ACME CORP")
- Process EVERY page of the document - don't stop after finding one month
- If there are multiple months, create separate month objects for each

Return your response as a valid JSON object with this EXACT structure:
{
  "accountNumber": "Last 4 digits of account number only (or 'N/A' if not found)",
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
    },
    {
      "month": "December 2025",
      "total": 0.00,
      "categories": {
        "ACH Deposit": { "amount": 0.00, "count": 0 }
      },
      "transactions": [
        {
          "date": "2025-12-15",
          "type": "ACH Deposit",
          "source": "Company Name",
          "amount": 1000.00,
          "description": "Original description"
        }
      ]
    }
  ]
}

IMPORTANT: 
- Return ONLY the JSON object, no other text before or after
- Include ALL months found in the document
- Make sure totalIncome and totalTransactions reflect the sum across ALL months`;

    // Call Gemini API with increased token limits
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
          maxOutputTokens: 16384  // INCREASED from default to handle large responses
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;

    // Parse the JSON response
    let jsonText = text.trim();
    
    // Remove markdown code blocks if present
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

  } catch (error) {
    console.error('Error analyzing document:', error);
    return NextResponse.json(
      {
        error: 'Failed to analyze document',
        details: error.message,
      },
      { status: 500 }
    );
  }
}