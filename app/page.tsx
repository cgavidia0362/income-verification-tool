'use client';

import { useState } from 'react';
import './globals.css';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const processFile = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.readAsDataURL(selectedFile);
      
      reader.onload = async () => {
        const fileData = reader.result as string;

        // Call API
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileData: fileData,
            fileName: selectedFile.name,
          }),
        });

        const data = await response.json();

        if (data.success) {
          setResults(data.data);
        } else {
          setError(data.error || 'Failed to analyze document');
        }
        
        setIsProcessing(false);
      };

      reader.onerror = () => {
        setError('Failed to read file');
        setIsProcessing(false);
      };

    } catch (err) {
      setError((err as Error).message || 'An error occurred');
      setIsProcessing(false);
    }
  };

  const resetApp = () => {
    setSelectedFile(null);
    setResults(null);
    setError(null);
  };

  const getTransactionTypeClass = (type: string) => {
    const typeMap: { [key: string]: string } = {
      'ACH Deposit': 'type-ach',
      'Wire Transfer': 'type-wire',
      'Zelle Transfer': 'type-zelle',
      'Venmo': 'type-transfer',
      'Cash App': 'type-transfer',
      'PayPal': 'type-transfer',
      'Bank Deposit': 'type-deposit',
      'Check Deposit': 'type-deposit',
      'Mobile Deposit': 'type-deposit',
      'Direct Deposit': 'type-ach',
      'Transfer In': 'type-transfer',
    };
    return typeMap[type] || 'type-deposit';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-purple-900 p-5">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center text-white mb-8">
          <h1 className="text-5xl font-bold mb-3 drop-shadow-lg">💼 Income Verification Tool</h1>
          <p className="text-xl opacity-90">Upload bank statements and get instant income analysis</p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-2xl p-10">
          
          {/* Upload Section */}
          {!isProcessing && !results && (
            <div>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => document.getElementById('fileInput')?.click()}
                className={`border-4 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all ${
                  selectedFile
                    ? 'border-green-500 bg-green-50'
                    : 'border-purple-400 bg-gradient-to-br from-gray-50 to-purple-50 hover:border-purple-600 hover:bg-purple-100'
                }`}
              >
                <div className="text-6xl mb-5">📄</div>
                <h3 className="text-2xl font-semibold text-gray-800 mb-3">
                  {selectedFile ? `✓ ${selectedFile.name}` : 'Drag & Drop Your Statement'}
                </h3>
                <p className="text-gray-600 text-lg">
                  {selectedFile ? 'File ready to process' : 'or click to browse (PDF, Word, Images supported)'}
                </p>
                <input
                  type="file"
                  id="fileInput"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  onChange={(e) => e.target.files && e.target.files.length > 0 && handleFileSelect(e.target.files[0])}
                />
              </div>

              {error && (
                <div className="mt-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded">
                  <p className="font-semibold">Error:</p>
                  <p>{error}</p>
                </div>
              )}

              <div className="text-center mt-6">
                <button
                  onClick={processFile}
                  disabled={!selectedFile}
                  className="bg-gradient-to-r from-purple-600 to-purple-800 text-white px-12 py-4 rounded-xl text-xl font-semibold shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105"
                >
                  Process Statement
                </button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {isProcessing && (
            <div className="text-center py-16">
              <div className="inline-block w-16 h-16 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mb-6"></div>
              <p className="text-xl text-gray-700 font-semibold">Analyzing your statement...</p>
              <p className="text-gray-500 mt-3">Extracting transactions and categorizing income sources</p>
            </div>
          )}

          {/* Results Section */}
          {results && (
            <div>
              {/* Results Header */}
              <div className="flex justify-between items-center mb-8 pb-6 border-b-2">
                <h2 className="text-4xl font-bold text-gray-800">📊 Analysis Results</h2>
                <button
                  onClick={resetApp}
                  className="border-2 border-purple-600 text-purple-600 px-6 py-3 rounded-lg font-semibold hover:bg-purple-600 hover:text-white transition-all"
                >
                  New Analysis
                </button>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div className="bg-gradient-to-br from-purple-600 to-purple-800 text-white p-8 rounded-2xl shadow-lg">
                  <h3 className="text-sm uppercase tracking-wider opacity-90 mb-3">Total Income</h3>
                  <div className="text-4xl font-bold mb-2">
                    ${results.totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm opacity-80">{results.months.length} months analyzed</div>
                </div>

                <div className="bg-gradient-to-br from-purple-600 to-purple-800 text-white p-8 rounded-2xl shadow-lg">
                  <h3 className="text-sm uppercase tracking-wider opacity-90 mb-3">Transactions</h3>
                  <div className="text-4xl font-bold mb-2">{results.totalTransactions}</div>
                  <div className="text-sm opacity-80">All income sources identified</div>
                </div>

                <div className="bg-gradient-to-br from-purple-600 to-purple-800 text-white p-8 rounded-2xl shadow-lg">
                  <h3 className="text-sm uppercase tracking-wider opacity-90 mb-3">Avg Monthly Income</h3>
                  <div className="text-4xl font-bold mb-2">
                    ${(results.totalIncome / results.months.length).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm opacity-80">Consistent income detected</div>
                </div>
              </div>

              {/* Monthly Breakdown */}
              {results.months.map((month: any, idx: number) => (
                <div key={idx} className="bg-gray-50 rounded-2xl p-8 mb-6 border-l-4 border-purple-600">
                  {/* Month Header */}
                  <div className="flex justify-between items-center mb-6 pb-4 border-b-2">
                    <h3 className="text-2xl font-bold text-gray-800">📅 {month.month}</h3>
                    <div className="bg-gradient-to-r from-purple-600 to-purple-800 text-white px-6 py-3 rounded-xl text-2xl font-bold">
                      ${month.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  {/* Category Breakdown */}
                  <h4 className="text-sm uppercase tracking-wider text-gray-600 mb-4">Category Breakdown</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    {Object.entries(month.categories).map(([catName, catData]: [string, any]) => (
                      <div key={catName} className="bg-white p-5 rounded-xl border-l-4 border-purple-600 shadow-sm">
                        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">{catName}</div>
                        <div className="text-2xl font-bold text-gray-800">
                          ${catData.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {catData.count} transaction{catData.count > 1 ? 's' : ''}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Transaction Table */}
                  <h4 className="text-sm uppercase tracking-wider text-gray-600 mb-4">Transaction Details</h4>
                  <div className="bg-white rounded-xl overflow-hidden shadow-sm">
                    <table className="w-full">
                      <thead className="bg-gradient-to-r from-purple-600 to-purple-800 text-white">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs uppercase tracking-wider">Date</th>
                          <th className="px-6 py-4 text-left text-xs uppercase tracking-wider">Type</th>
                          <th className="px-6 py-4 text-left text-xs uppercase tracking-wider">Source</th>
                          <th className="px-6 py-4 text-left text-xs uppercase tracking-wider">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {month.transactions.map((tx: any, txIdx: number) => (
                          <tr key={txIdx} className="border-b hover:bg-gray-50">
                            <td className="px-6 py-4 text-gray-800">{tx.date}</td>
                            <td className="px-6 py-4">
                              <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${getTransactionTypeClass(tx.type)}`}>
                                {tx.type}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-gray-800">{tx.source}</td>
                            <td className="px-6 py-4 text-green-600 font-bold">
                              ${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .type-deposit {
          background-color: #d1f4e0;
          color: #0d9e4a;
        }
        .type-ach {
          background-color: #cfe2ff;
          color: #084298;
        }
        .type-zelle {
          background-color: #f8d7da;
          color: #842029;
        }
        .type-wire {
          background-color: #fff3cd;
          color: #856404;
        }
        .type-transfer {
          background-color: #e7d4f8;
          color: #6f42c1;
        }
      `}</style>
    </div>
  );
}