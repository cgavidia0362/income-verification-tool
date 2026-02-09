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

    // Create the prompt
    const prompt = `You are a financial analyst AI specialized in extracting income data from bank statements, credit card statements, and other financial documents.

    FIRST, find the bank account number on the statement and extract ONLY THE LAST 4 DIGITS.

    THEN, analyze this document and extract ALL income transactions (money coming INTO the account).

For EACH income transaction, identify:
1. **Date** - The exact date of the transaction
2. **Type** - Categorize as one of these: "ACH Deposit", "Wire Transfer", "Zelle Transfer", "Venmo", "Cash App", "PayPal", "Bank Deposit", "Check Deposit", "Mobile Deposit", "Direct Deposit", "Transfer In", or "Other"
3. **Source** - The name of the person or company that sent the money (extract from description)
4. **Amount** - The dollar amount (numbers only, no symbols)

Group transactions by MONTH and provide:
- Monthly totals
- Category breakdowns
- Individual transaction details

CRITICAL RULES:
- ONLY include INCOMING money
- EXCLUDE outgoing payments, withdrawals, debits, fees
- Extract the source name from descriptions

Return your response as a valid JSON object with this EXACT structure:
{
  {
    "accountNumber": "Last 4 digits of account number only (or 'N/A' if not found)",
    "totalIncome": 0.00,
    "totalTransactions": 0,
    "months": [
    {
      "month": "January 2024",
      "total": 0.00,
      "categories": {
        "ACH Deposit": { "amount": 0.00, "count": 0 }
      },
      "transactions": [
        {
          "date": "2024-01-15",
          "type": "ACH Deposit",
          "source": "Company Name",
          "amount": 1000.00,
          "description": "Original description"
        }
      ]
    }
  ]
}

IMPORTANT: Return ONLY the JSON object, no other text.`;

    // Call Gemini API directly using v1 endpoint
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