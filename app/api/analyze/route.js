import { GoogleGenerativeAI } from '@google/generative-ai';
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

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: 'models/gemini-1.0-pro-vision-latest'
    });

    // Prepare the file for Gemini
    const base64Data = fileData.split(',')[1] || fileData;
    
    // Determine mime type from file extension
    let mimeType = 'application/pdf';
    if (fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg')) {
      mimeType = 'image/jpeg';
    } else if (fileName.toLowerCase().endsWith('.png')) {
      mimeType = 'image/png';
    }

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: mimeType,
      },
    };

    // Create the prompt
    const prompt = `You are a financial analyst AI specialized in extracting income data from bank statements, credit card statements, and other financial documents.

Analyze this document and extract ALL income transactions (money coming INTO the account). 

For EACH income transaction, identify:
1. **Date** - The exact date of the transaction
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

Return your response as a valid JSON object with this EXACT structure:
{
  "totalIncome": 0.00,
  "totalTransactions": 0,
  "months": [
    {
      "month": "January 2024",
      "total": 0.00,
      "categories": {
        "ACH Deposit": { "amount": 0.00, "count": 0 },
        "Zelle Transfer": { "amount": 0.00, "count": 0 }
      },
      "transactions": [
        {
          "date": "2024-01-15",
          "type": "ACH Deposit",
          "source": "Company Name",
          "amount": 1000.00,
          "description": "Original description from statement"
        }
      ]
    }
  ]
}

IMPORTANT: Return ONLY the JSON object, no other text before or after.`;

    // Call Gemini API
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

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